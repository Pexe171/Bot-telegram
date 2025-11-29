const { Telegraf, Markup, session } = require('telegraf');
const { loadSettings } = require('./config');
const { PaymentClient } = require('./paymentClient');
const { obterProduto } = require('./products');
const { carregarEstado, salvarMensagemInicio, registrarInteracao, adicionarPagamentoPendente, removerPagamentoPendente, obterPagamentosPendentes, incrementarCheckCount } = require('./storage');
const fs = require('fs');
const path = require('path');

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

async function registrarHandlers(bot, paymentClient, settings, estadoInicial) {
  let estadoAtual = estadoInicial;
  let mensagemInicio = estadoAtual.mensagemInicio;

  const suporteUrl = settings.suporteUrl;
  const adminIds = settings.adminIds;

  const isAdmin = (userId) => adminIds.includes(Number(userId));

  // Automatic payment verification
  const verificarPagamentosAutomaticamente = async () => {
    const pagamentosPendentes = obterPagamentosPendentes(estadoAtual);

    for (const pagamento of pagamentosPendentes) {
      // Skip if less than 5 seconds have passed since last check
      if (Date.now() - pagamento.timestamp < 5000) continue;

      try {
        // Increment check count
        estadoAtual = incrementarCheckCount(estadoAtual, pagamento.qrCodeId);
        const pagamentoAtualizado = estadoAtual.pendingPayments.find(p => p.qrCodeId === pagamento.qrCodeId);

        if (!pagamentoAtualizado) continue;

        const statusPagamento = await paymentClient.verificarPagamento(pagamento.qrCodeId);

        if (statusPagamento && (statusPagamento.status === 'RECEIVED' || statusPagamento.status === 'CONFIRMED')) {
          // Payment confirmed - notify user and admins
          const mensagemConfirmacao = [
            '🎉 Pagamento confirmado automaticamente!',
            `💰 Valor pago: R$ ${statusPagamento.value.toFixed(2)}`,
            `📅 Data do pagamento: ${new Date(statusPagamento.paymentDate).toLocaleDateString('pt-BR')}`,
            '',
            '✅ Seu acesso foi liberado! Você receberá as instruções em breve.',
            '',
            '📞 Em caso de dúvidas, entre em contato com o suporte.',
          ].join('\n');

          const botoes = Markup.inlineKeyboard([
            [Markup.button.url('Falar com suporte', suporteUrl)],
            [Markup.button.callback('🔙 Início', 'start_menu')],
          ]);

          try {
            await bot.telegram.sendMessage(pagamento.userId, mensagemConfirmacao, botoes);
          } catch (error) {
            console.error(`Erro ao notificar usuário ${pagamento.userId}:`, error);
          }

          // Notify admins
          const notificacaoAdmin = [
            '💰 PAGAMENTO CONFIRMADO AUTOMATICAMENTE!',
            `👤 Cliente ID: ${pagamento.userId}`,
            `💵 Valor: R$ ${statusPagamento.value.toFixed(2)}`,
            `📅 Data: ${new Date(statusPagamento.paymentDate).toLocaleDateString('pt-BR')}`,
            `🆔 ID Pagamento: ${pagamento.qrCodeId}`,
            '',
            'Envie as instruções de acesso para o cliente.',
          ].join('\n');

          adminIds.forEach(async (adminId) => {
            try {
              await bot.telegram.sendMessage(adminId, notificacaoAdmin);
            } catch (error) {
              console.error(`Erro ao notificar admin ${adminId}:`, error);
            }
          });

          // Remove from pending payments
          estadoAtual = removerPagamentoPendente(estadoAtual, pagamento.qrCodeId);
        } else if (statusPagamento && statusPagamento.status !== 'PENDING') {
          // Payment failed or expired - remove from pending
          estadoAtual = removerPagamentoPendente(estadoAtual, pagamento.qrCodeId);
        } else if (pagamentoAtualizado.checkCount >= 20) {
          // Max checks reached - invalidate QR code and notify user
          const mensagemExpirado = [
            '⏰ QR Code expirado!',
            '',
            'O QR code de pagamento expirou após várias tentativas de verificação.',
            'Para continuar, gere um novo QR code.',
            '',
            '📞 Em caso de dúvidas, entre em contato com o suporte.',
          ].join('\n');

          const botoes = Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Gerar novo QR code', 'confirmar')],
            [Markup.button.url('Falar com suporte', suporteUrl)],
            [Markup.button.callback('🔙 Início', 'start_menu')],
          ]);

          try {
            await bot.telegram.sendMessage(pagamento.userId, mensagemExpirado, botoes);
          } catch (error) {
            console.error(`Erro ao notificar usuário ${pagamento.userId} sobre expiração:`, error);
          }

          // Remove from pending payments
          estadoAtual = removerPagamentoPendente(estadoAtual, pagamento.qrCodeId);
        }
        // If still pending and under max checks, keep checking
      } catch (error) {
        console.error(`Erro ao verificar pagamento ${pagamento.qrCodeId}:`, error);
      }
    }
  };

  // Start automatic verification every 5 seconds
  setInterval(verificarPagamentosAutomaticamente, 5000);

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

    if (mensagemInicio.tipo === 'video_local' && mensagemInicio.arquivoPath) {
      try {
        // Ler o arquivo de vídeo localmente
        const videoStream = fs.createReadStream(mensagemInicio.arquivoPath);
        await ctx.replyWithVideo({ source: videoStream }, {
          caption: mensagemInicio.texto,
          parse_mode: 'HTML',
          ...botoes,
        });
      } catch (error) {
        console.error('Erro ao enviar vídeo local:', error);
        // Fallback para texto se o vídeo não puder ser enviado
        if (viaCallback && ctx.callbackQuery?.message?.message_id) {
          await ctx.editMessageText(mensagemInicio.texto, botoes);
        } else {
          await ctx.reply(mensagemInicio.texto, botoes);
        }
      }
      return;
    }

    if (viaCallback && ctx.callbackQuery?.message?.message_id) {
      await ctx.editMessageText(mensagemInicio.texto, botoes);
    } else {
      await ctx.reply(mensagemInicio.texto, botoes);
    }
  };

  bot.use(async (ctx, next) => {
    // Ensure session is always initialized
    ctx.session = ctx.session || {};

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
    ctx.session = ctx.session || {};
    const codigo = ctx.session.produtoCodigo;
    let produto = codigo ? obterProduto(codigo) : null;

    // Se for promoção, usar o produto promocional da sessão
    if (codigo === 'promocao' && ctx.session.produtoPromocional) {
      produto = ctx.session.produtoPromocional;
    }

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

    // Add to pending payments for automatic verification
    estadoAtual = adicionarPagamentoPendente(estadoAtual, dadosPagamento.qrCodeId, ctx.from.id, produto);

    const texto = [
      '🌟 Você selecionou o seguinte plano:',
      `🎁 Plano: ${produto.nome}`,
      `💰 Valor: R$${produto.preco.toFixed(2)}`,
      '',
      '💠 Para efetuar o pagamento, clique 𝗨𝗠𝗔 𝗩𝗘𝗭 no código 𝗣𝗜𝗫 abaixo para 𝗖𝗢𝗣𝗜𝗔-𝗟𝗢, vá em seu banco, selecione a opção "𝗣𝗔𝗚𝗔𝗥" no seu aplicativo e escolher "𝗣𝗶𝘅 𝗖𝗼𝗽𝗶𝗮 𝗲 𝗖𝗼𝗹𝗮".',
      '',
      `<code>${dadosPagamento.qrCodePix}</code>`,
      '',
      '👆 Toque na chave PIX acima para copiá-la',
      '',
      '‼️ Após o pagamento, será atualizado automaticamente',
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
    await ctx.answerCbQuery();

    ctx.session = ctx.session || {};
    const qrCodeId = ctx.session.qrCodeId;

    if (!qrCodeId) {
      // Se não há pagamento pendente, gerar um novo QR code
      const codigo = ctx.session.produtoCodigo;
      let produto = codigo ? obterProduto(codigo) : null;

      // Se for promoção, usar o produto promocional da sessão
      if (codigo === 'promocao' && ctx.session.produtoPromocional) {
        produto = ctx.session.produtoPromocional;
      }

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

      await ctx.editMessageText('⏳ Gerando novo pagamento...');

      const dadosPagamento = await paymentClient.criarPagamento(produto, ctx.from);

      if (!dadosPagamento) {
        await ctx.editMessageText('⚠️ Não consegui gerar o pagamento agora. Tente novamente em instantes.');
        return;
      }

      ctx.session.qrCodeId = dadosPagamento.qrCodeId;

      const texto = [
        '🌟 Você selecionou o seguinte plano:',
        `🎁 Plano: ${produto.nome}`,
        `💰 Valor: R$${produto.preco.toFixed(2)}`,
        '',
        '💠 Para efetuar o pagamento, clique 𝗨𝗠𝗔 𝗩𝗘𝗭 no código 𝗣𝗜𝗫 abaixo para 𝗖𝗢𝗣𝗜𝗔-𝗟𝗢, vá em seu banco, selecione a opção "𝗣𝗔𝗚𝗔𝗥" no seu aplicativo e escolher "𝗣𝗶𝘅 𝗖𝗼𝗽𝗶𝗮 𝗲 𝗖𝗼𝗹𝗮".',
        '',
        `<code>${dadosPagamento.qrCodePix}</code>`,
        '',
        '👆 Toque na chave PIX acima para copiá-la',
        '',
        '‼️ Após o pagamento, sera atualizado automaticamente',
      ].join('\n');

      const botoes = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Verificar novamente', 'verificar_pagamento')],
        [Markup.button.callback('🔙 Início', 'start_menu')],
      ]);

      await ctx.editMessageText(texto, {
        parse_mode: 'HTML',
        ...botoes,
      });
      return;
    }

    await ctx.editMessageText('⏳ Verificando status do pagamento...');

    const statusPagamento = await paymentClient.verificarPagamento(qrCodeId);

    if (!statusPagamento) {
      await ctx.editMessageText('⚠️ Não consegui verificar o status do pagamento agora. Tente novamente em instantes.');
      return;
    }

    let mensagemStatus;
    let botoes;

    if (statusPagamento.status === 'RECEIVED' || statusPagamento.status === 'CONFIRMED') {
      mensagemStatus = [
        '🎉 Pagamento confirmado!',
        `💰 Valor pago: R$ ${statusPagamento.value.toFixed(2)}`,
        `📅 Data do pagamento: ${new Date(statusPagamento.paymentDate).toLocaleDateString('pt-BR')}`,
        '',
        '✅ Seu acesso foi liberado! Você receberá as instruções em breve.',
        '',
        '📞 Em caso de dúvidas, entre em contato com o suporte.',
      ].join('\n');

      botoes = Markup.inlineKeyboard([
        [Markup.button.url('Falar com suporte', suporteUrl)],
        [Markup.button.callback('🔙 Início', 'start_menu')],
      ]);

      // Notificar administradores sobre o pagamento confirmado
      const notificacaoAdmin = [
        '💰 PAGAMENTO CONFIRMADO!',
        `👤 Cliente: ${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim(),
        `💵 Valor: R$ ${statusPagamento.value.toFixed(2)}`,
        `📅 Data: ${new Date(statusPagamento.paymentDate).toLocaleDateString('pt-BR')}`,
        `🆔 ID Pagamento: ${qrCodeId}`,
        '',
        'Envie as instruções de acesso para o cliente.',
      ].join('\n');

      adminIds.forEach(async (adminId) => {
        try {
          await bot.telegram.sendMessage(adminId, notificacaoAdmin);
        } catch (error) {
          console.error(`Erro ao notificar admin ${adminId}:`, error);
        }
      });

      // Remove from pending payments and clear session
      estadoAtual = removerPagamentoPendente(estadoAtual, qrCodeId);
      ctx.session.qrCodeId = undefined;
      ctx.session.produtoCodigo = undefined;
      ctx.session.produtoPromocional = undefined;

    } else if (statusPagamento.status === 'PENDING') {
      mensagemStatus = [
        '⏳ Pagamento ainda pendente',
        `💰 Valor: R$ ${statusPagamento.value.toFixed(2)}`,
        '',
        'O PIX ainda não foi identificado. Pode levar alguns minutos.',
        'Clique abaixo para verificar novamente.',
      ].join('\n');

      botoes = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Verificar novamente', 'verificar_pagamento')],
        [Markup.button.url('Falar com suporte', suporteUrl)],
        [Markup.button.callback('🔙 Início', 'start_menu')],
      ]);

    } else {
      mensagemStatus = [
        '❌ Pagamento não identificado',
        `💰 Valor esperado: R$ ${statusPagamento.value.toFixed(2)}`,
        `📊 Status atual: ${statusPagamento.status}`,
        '',
        'Se você já pagou, aguarde alguns minutos e tente novamente.',
        'Caso tenha problemas, entre em contato com o suporte.',
      ].join('\n');

      botoes = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Tentar novamente', 'verificar_pagamento')],
        [Markup.button.url('Falar com suporte', suporteUrl)],
        [Markup.button.callback('🔙 Início', 'start_menu')],
      ]);
    }

    await ctx.editMessageText(mensagemStatus, botoes);
  });

  bot.action(/^promocao:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const valor = Number(ctx.match[1]);

    if (Number.isNaN(valor) || valor <= 0) {
      await ctx.editMessageText('❌ Promoção inválida. Tente novamente mais tarde.');
      return;
    }

    // Recuperar o nome da promoção da sessão (armazenado quando a promoção foi enviada)
    const nomePromocao = ctx.session?.nomePromocao || 'PROMOÇÃO ESPECIAL';

    // Criar produto promocional com o preço informado e nome da promoção
    const produtoPromocional = {
      codigo: 'promocao',
      nome: nomePromocao,
      descricao: 'Acesso vitalício ao conteúdo com todos os bônus inclusos - PREÇO PROMOCIONAL!',
      preco: valor,
    };

    ctx.session = ctx.session || {};
    ctx.session.produtoCodigo = produtoPromocional.codigo;
    ctx.session.produtoPromocional = produtoPromocional;

    const mensagem = [
      `🎉 Você escolheu a promoção ${produtoPromocional.nome} (R$ ${produtoPromocional.preco.toFixed(2)}).`,
      'Deseja gerar o QR code de pagamento?',
    ].join('\n');

    await ctx.editMessageText(mensagem, botoesConfirmacao());
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

  bot.command('video_inicio', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Comando restrito a administradores.');
      return;
    }

    const midia = extrairMidia(ctx.message);

    if (midia && midia.tipo === 'video') {
      // Vídeo enviado junto com o comando
      await processarVideoInicio(ctx, midia);
    } else {
      // Iniciar fluxo para pedir o vídeo
      ctx.session = ctx.session || {};
      ctx.session.videoInicio = { etapa: 'aguardando_video' };
      await ctx.reply('📹 Agora envie o vídeo que será usado na mensagem de boas-vindas.');
    }
  });

  const iniciarFluxoPromocao = async (ctx) => {
    ctx.session = ctx.session || {};
    ctx.session.promocao = { etapa: 'nome' };
    await ctx.reply(
      '📣 Vamos disparar uma promoção!\nEnvie o nome da promoção (mínimo 10 caracteres).',
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
      `Promoção: ${corpo.texto}`,
      '',
      `💰 Valor promocional: R$ ${valor.toFixed(2)}`,
      'Clique no botão abaixo para aproveitar.',
    ].join('\n');

    const botoes = Markup.inlineKeyboard([
      [Markup.button.callback(`Ver assinatura R$ ${valor.toFixed(2)}`, `promocao:${valor}`)],
      [Markup.button.url('Falar com suporte', suporteUrl)],
    ]);

    // Armazenar o nome da promoção na sessão do admin para uso posterior
    ctx.session = ctx.session || {};
    ctx.session.nomePromocao = corpo.texto;

    for (const chatId of usuarios) {
      try {
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

  const processarVideoInicio = async (ctx, midia) => {
    await ctx.reply('⏳ Baixando vídeo...');

    try {
      // Obter informações do arquivo
      const fileInfo = await ctx.telegram.getFile(midia.arquivoId);
      const fileUrl = `https://api.telegram.org/file/bot${settings.telegramToken}/${fileInfo.file_path}`;

      // Baixar o vídeo
      const axios = require('axios');
      const response = await axios.get(fileUrl, { responseType: 'stream' });

      // Criar nome único para o arquivo
      const timestamp = Date.now();
      const fileName = `welcome_video_${timestamp}.mp4`;
      const filePath = path.join(__dirname, '..', 'data', 'videos', fileName);

      // Salvar o vídeo localmente
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      const texto = extrairTextoComando(ctx.message, 'video_inicio');

      const novaMensagem = {
        tipo: 'video_local',
        texto: texto || 'Bem-vindo! Assista ao vídeo abaixo.',
        arquivoPath: filePath,
        arquivoId: midia.arquivoId, // Manter para compatibilidade
      };

      estadoAtual = salvarMensagemInicio(estadoAtual, novaMensagem);
      mensagemInicio = estadoAtual.mensagemInicio;

      await ctx.reply('🎥 Vídeo baixado e configurado com sucesso! Use /start para conferir.');
    } catch (error) {
      console.error('Erro ao baixar vídeo:', error);
      await ctx.reply('❌ Erro ao baixar o vídeo. Tente novamente.');
    }
  };

  bot.on('message', async (ctx) => {
    if (isAdmin(ctx.from.id)) {
      // Verificar se está aguardando vídeo para /video_inicio
      if (ctx.session?.videoInicio?.etapa === 'aguardando_video') {
        const midia = extrairMidia(ctx.message);

        if (midia && midia.tipo === 'video') {
          ctx.session.videoInicio = undefined;
          await processarVideoInicio(ctx, midia);
          return;
        } else {
          await ctx.reply('❌ Você deve enviar um vídeo. Tente novamente.');
          return;
        }
      }

      // Verificar se está no fluxo de promoção
      if (ctx.session?.promocao?.etapa) {
        const etapa = ctx.session.promocao.etapa;

        if (etapa === 'nome') {
          const textoLivre = extrairTextoLivre(ctx.message);

          if (!textoTemTamanhoMinimo(textoLivre)) {
            await ctx.reply('O nome da promoção deve ter pelo menos 10 caracteres.');
            return;
          }

          ctx.session.promocao = {
            etapa: 'valor',
            corpo: { texto: textoLivre },
          };

          await ctx.reply('💰 Qual é o valor da promoção? Envie apenas o número (ex: 49,90).');
          return;
        }

        if (etapa === 'valor') {
          const valorTexto = extrairTextoLivre(ctx.message).replace(',', '.');
          const valor = Number(valorTexto);

          if (Number.isNaN(valor) || valor < 5) {
            await ctx.reply('Informe um valor numérico válido para a promoção (mínimo R$ 5,00).');
            return;
          }

          const corpo = ctx.session.promocao.corpo;
          ctx.session.promocao = undefined;

          await enviarPromocaoParaTodos(ctx, corpo, valor);
          return;
        }
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
  await registrarHandlers(bot, paymentClient, settings, estado);

  console.log('🤖 Iniciando o bot de vendas...');
  await bot.launch();

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

bootstrap().catch((error) => {
  console.error('Erro fatal ao iniciar o bot:', error);
  process.exit(1);
});
