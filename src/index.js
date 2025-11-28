const { Telegraf, Markup, session } = require('telegraf');
const { loadSettings } = require('./config');
const { PaymentClient } = require('./paymentClient');
const { obterProduto } = require('./products');
const { carregarEstado, salvarMensagemInicio, registrarInteracao } = require('./storage');

const qrCodeRateLimiter = new Map();

function botoesBoasVindas(suporteUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Ver assinatura', 'listar')],
    [Markup.button.url('Falar com suporte', suporteUrl)],
  ]);
}

function botoesConfirmacao() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirmar', 'confirmar')],
    [Markup.button.callback('🔙 Voltar', 'start_menu')],
  ]);
}

function extrairTextoComando(message, comando) {
  const origem = message.text || message.caption || '';
  return origem.replace(new RegExp(`^/${comando}(?:@\\w+)?\\b`), '').trim();
}

function extrairTextoLivre(message) {
  return (message.text || message.caption || '').trim();
}

function extrairMidia(message) {
  if (message.photo?.length) {
    const ultimaFoto = message.photo[message.photo.length - 1];
    return { tipo: 'photo', arquivoId: ultimaFoto.file_id };
  }

  if (message.video) {
    return { tipo: 'video', arquivoId: message.video.file_id };
  }

  return null;
}

function textoTemTamanhoMinimo(texto, minimo = 10) {
  return typeof texto === 'string' && texto.trim().length >= minimo;
}

async function registrarHandlers(bot, paymentClient, suporteUrl, adminIds, estadoInicial) {
  let estadoAtual = estadoInicial;
  let mensagemInicio = estadoAtual.mensagemInicio;

  const isAdmin = (userId) => adminIds.includes(Number(userId));

  const enviarPainelAdmin = async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;

    const botoes = Markup.inlineKeyboard([
      [Markup.button.callback('📣 Enviar promoção', 'admin_promocao')],
      [Markup.button.callback('🧪 Testar comandos', 'admin_testar')],
    ]);

    await ctx.reply('⚙️ Painel rápido do administrador', botoes);
  };

  const sendWelcomeMessage = async (ctx, { viaCallback = false } = {}) => {
    const botoes = botoesBoasVindas(suporteUrl);

    if (mensagemInicio.tipo === 'photo' && mensagemInicio.arquivoId) {
      await ctx.replyWithPhoto(mensagemInicio.arquivoId, {
        caption: mensagemInicio.texto,
        parse_mode: 'HTML',
        ...botoes,
      });
      return;
    }

    if (mensagemInicio.tipo === 'video' && mensagemInicio.arquivoId) {
      await ctx.replyWithVideo(mensagemInicio.arquivoId, {
        caption: mensagemInicio.texto,
        parse_mode: 'HTML',
        ...botoes,
      });
      return;
    }

    if (viaCallback && ctx.callbackQuery?.message?.message_id) {
      await ctx.editMessageText(mensagemInicio.texto, botoes);
    } else {
      await ctx.reply(mensagemInicio.texto, botoes);
    }
  };

  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === 'private' && ctx.from?.id) {
      estadoAtual = registrarInteracao(estadoAtual, ctx.from.id);
    }
    return next();
  });

  bot.start(async (ctx) => {
    await sendWelcomeMessage(ctx);
    await enviarPainelAdmin(ctx);
  });

  bot.action('start_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await sendWelcomeMessage(ctx, { viaCallback: true });
    await enviarPainelAdmin(ctx);
  });

  bot.action('listar', async (ctx) => {
    await ctx.answerCbQuery();
    const produto = obterProduto('assinatura');

    if (!produto) {
      await ctx.editMessageText('❌ Produto não encontrado. Tente novamente mais tarde.');
      return;
    }

    ctx.session = ctx.session || {};
    ctx.session.produtoCodigo = produto.codigo;
    const mensagem = [
      `Você escolheu ${produto.nome} (R$ ${produto.preco.toFixed(2)}).`,
      'Deseja gerar o QR code de pagamento?',
    ].join('\n');

    await ctx.editMessageText(mensagem, botoesConfirmacao());
  });

  bot.action('confirmar', async (ctx) => {
    await ctx.answerCbQuery();
    const codigo = ctx.session.produtoCodigo;
    const produto = codigo ? obterProduto(codigo) : null;

    if (!produto) {
      await ctx.editMessageText('❌ Não encontrei o produto escolhido. Recomece.');
      return;
    }

    // Rate limiting: 4 QR codes per hour per user
    const userId = ctx.from.id;
    const now = Date.now();
    const userRequests = qrCodeRateLimiter.get(userId) || [];
    const recentRequests = userRequests.filter(time => now - time < 3600000); // 1 hour

    if (recentRequests.length >= 4) {
      await ctx.editMessageText('⚠️ Você atingiu o limite de 4 QR codes por hora. Tente novamente mais tarde.');
      return;
    }

    recentRequests.push(now);
    qrCodeRateLimiter.set(userId, recentRequests);

    await ctx.editMessageText('⏳ Gerando pagamento...');

    const dadosPagamento = await paymentClient.criarPagamento(produto, ctx.from);

    if (!dadosPagamento) {
      await ctx.editMessageText('⚠️ Não consegui gerar o pagamento agora. Tente novamente em instantes.');
      return;
    }
    
    ctx.session.qrCodeId = dadosPagamento.qrCodeId;

    const texto = [
      '🌟 Você selecionou o seguinte plano:',
      '🎁 Plano: VITALÍCIO + BÔNUS 🎁 + ACESSO BLACK',
      `💰 Valor: R$${produto.preco.toFixed(2)}`,
      '💠 Pague via Pix Copia e Cola (ou QR Code em alguns bancos):',
      `<code>${dadosPagamento.qrCodePix}</code>`,
      '👆 Toque na chave PIX acima para copiá-la',
      '‼ Após o pagamento, clique no botão abaixo para verificar o status:',
    ].join('\n');

    const botoes = Markup.inlineKeyboard([
      [Markup.button.callback('Verificar status', 'verificar_pagamento')],
      [Markup.button.callback('🔙 Início', 'start_menu')],
    ]);

    await ctx.editMessageText(texto, {
      parse_mode: 'HTML',
      ...botoes,
    });
  });

  bot.action('verificar_pagamento', async (ctx) => {
    await ctx.answerCbQuery('Funcionalidade em desenvolvimento.');
  });

  bot.command('msg', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Comando restrito a administradores.');
      return;
    }

    const texto = extrairTextoComando(ctx.message, 'msg');
    const midia = extrairMidia(ctx.message);

    if (!textoTemTamanhoMinimo(texto)) {
      await ctx.reply('A mensagem enviada está vazia ou muito curta. Envie ao menos 10 caracteres junto com /msg.');
      return;
    }

    const promises = adminIds.map(async (adminId) => {
      if (midia?.tipo === 'photo') {
        return bot.telegram.sendPhoto(adminId, midia.arquivoId, {
          caption: texto || undefined,
          parse_mode: 'HTML',
        });
      }

      if (midia?.tipo === 'video') {
        return bot.telegram.sendVideo(adminId, midia.arquivoId, {
          caption: texto || undefined,
          parse_mode: 'HTML',
        });
      }

      return bot.telegram.sendMessage(adminId, texto, { parse_mode: 'HTML' });
    });

    await Promise.all(promises);
    await ctx.reply('✅ Mensagem enviada para os administradores.');
  });

  bot.command('trocar_inicio', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Comando restrito a administradores.');
      return;
    }

    const texto = extrairTextoComando(ctx.message, 'trocar_inicio');
    const midia = extrairMidia(ctx.message);

    if (!textoTemTamanhoMinimo(texto)) {
      await ctx.reply('A mensagem inicial deve ter pelo menos 10 caracteres. Você pode anexar uma foto ou vídeo opcionalmente.');
      return;
    }

    const novaMensagem = {
      tipo: midia?.tipo || 'text',
      texto: texto || 'Bem-vindo!',
      arquivoId: midia?.arquivoId || null,
    };

    estadoAtual = salvarMensagemInicio(estadoAtual, novaMensagem);
    mensagemInicio = estadoAtual.mensagemInicio;

    await ctx.reply('🚀 Mensagem inicial atualizada com sucesso! Use /start para conferir.');
  });

  const iniciarFluxoPromocao = async (ctx) => {
    ctx.session.promocao = { etapa: 'descricao' };
    await ctx.reply(
      '📣 Vamos disparar uma promoção!\nEnvie a mensagem da promoção (mínimo 10 caracteres). Você pode anexar foto ou vídeo para os clientes.',
    );
  };

  bot.command('promocao', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Comando restrito a administradores.');
      return;
    }

    await iniciarFluxoPromocao(ctx);
  });

  bot.action('admin_promocao', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('⚠️ Somente administradores.');
      return;
    }

    await ctx.answerCbQuery();
    await iniciarFluxoPromocao(ctx);
  });

  const enviarPromocaoParaTodos = async (ctx, corpo, valor) => {
    const usuarios = estadoAtual.metricas.usuarios;

    if (!usuarios.length) {
      await ctx.reply('Não há usuários registrados ainda para receber a promoção.');
      return;
    }

    const mensagem = [
      '🚀 Promoção especial para você!',
      corpo.texto,
      '',
      `💰 Valor promocional: R$ ${valor.toFixed(2)}`,
      'Clique no botão abaixo para aproveitar.',
    ].join('\n');

    const botoes = Markup.inlineKeyboard([
      [Markup.button.callback('Ver assinatura', 'listar')],
      [Markup.button.url('Falar com suporte', suporteUrl)],
    ]);

    for (const chatId of usuarios) {
      try {
        if (corpo.midia?.tipo === 'photo') {
          await bot.telegram.sendPhoto(chatId, corpo.midia.arquivoId, {
            caption: mensagem,
            parse_mode: 'HTML',
            reply_markup: botoes.reply_markup,
          });
          continue;
        }

        if (corpo.midia?.tipo === 'video') {
          await bot.telegram.sendVideo(chatId, corpo.midia.arquivoId, {
            caption: mensagem,
            parse_mode: 'HTML',
            reply_markup: botoes.reply_markup,
          });
          continue;
        }

        await bot.telegram.sendMessage(chatId, mensagem, botoes);
      } catch (error) {
        console.error(`Erro ao enviar promoção para ${chatId}:`, error);
      }
    }

    await ctx.reply(`✅ Promoção enviada para ${usuarios.length} usuário(s).`);
  };

  bot.action('admin_testar', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('⚠️ Somente administradores.');
      return;
    }

    await ctx.answerCbQuery();
    const linhas = [
      '🧪 Checklist do bot:',
      `• Admins configurados: ${adminIds.length}`,
      `• Usuários registrados: ${estadoAtual.metricas.usuarios.length}`,
      '• Comandos disponíveis: /msg, /trocar_inicio, /promocao, /metricas, /testar',
      'Se algo não funcionar, revise o token do bot e o arquivo .env.',
    ];

    await ctx.reply(linhas.join('\n'));
  });

  bot.command('testar', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Comando restrito a administradores.');
      return;
    }

    const linhas = [
      '🧪 O bot está no ar!',
      `• Admins configurados: ${adminIds.length}`,
      `• Usuários registrados: ${estadoAtual.metricas.usuarios.length}`,
      '• Use /msg para avisos internos e /promocao para disparos em massa.',
    ];

    await ctx.reply(linhas.join('\n'));
  });

  bot.command('metricas', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Comando restrito a administradores.');
      return;
    }

    const totalUsuarios = estadoAtual.metricas.usuarios.length;
    const totalMensagens = estadoAtual.metricas.totalMensagens;

    const linhas = [
      '📊 Métricas gerais (DM):',
      `• Usuários únicos que já falaram: ${totalUsuarios}`,
      `• Mensagens recebidas em DM: ${totalMensagens}`,
    ];

    await ctx.reply(linhas.join('\n'));
  });

  bot.on('message', async (ctx) => {
    if (isAdmin(ctx.from.id) && ctx.session?.promocao?.etapa) {
      const etapa = ctx.session.promocao.etapa;

      if (etapa === 'descricao') {
        const textoLivre = extrairTextoLivre(ctx.message);
        const midia = extrairMidia(ctx.message);

        if (!textoTemTamanhoMinimo(textoLivre)) {
          await ctx.reply('A descrição da promoção deve ter pelo menos 10 caracteres.');
          return;
        }

        ctx.session.promocao = {
          etapa: 'valor',
          corpo: { texto: textoLivre, midia },
        };

        await ctx.reply('💰 Qual é o valor da promoção? Envie apenas o número (ex: 49,90).');
        return;
      }

      if (etapa === 'valor') {
        const valorTexto = extrairTextoLivre(ctx.message).replace(',', '.');
        const valor = Number(valorTexto);

        if (Number.isNaN(valor) || valor <= 0) {
          await ctx.reply('Informe um valor numérico válido para a promoção (ex: 39.90).');
          return;
        }

        const corpo = ctx.session.promocao.corpo;
        ctx.session.promocao = undefined;

        await enviarPromocaoParaTodos(ctx, corpo, valor);
        return;
      }
    }

    await ctx.reply('Use /start para começar.');
  });
}

async function bootstrap() {
  const settings = loadSettings();
  const estado = carregarEstado();
  const paymentClient = new PaymentClient({
    apiKey: settings.asaasApiKey,
    baseUrl: settings.asaasBaseUrl,
  });

  const bot = new Telegraf(settings.telegramToken);
  bot.use(session());
  await registrarHandlers(bot, paymentClient, settings.suporteUrl, settings.adminIds, estado);

  console.log('🤖 Iniciando o bot de vendas...');
  await bot.launch();

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

bootstrap().catch((error) => {
  console.error('Erro fatal ao iniciar o bot:', error);
  process.exit(1);
});
