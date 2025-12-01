const { Telegraf, Markup, session } = require('telegraf');
const { loadSettings } = require('./config');
const { PaymentClient } = require('./paymentClient');
const { obterProduto } = require('./products');
const { carregarEstado, salvarMensagemInicio, registrarInteracao, adicionarPagamentoPendente, removerPagamentoPendente, obterPagamentosPendentes, incrementarCheckCount, adicionarPromocao, limparPromocoesExpiradas, obterDadosReferencia, criarOuObterCodigoReferencia, registrarReferencia, adicionarPontosReferencia, resgatarPontos } = require('./storage');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const VIDEOS_DIR = path.join(DATA_DIR, 'videos');

function garantirDiretorioLocal(diretorio) {
  if (!fs.existsSync(diretorio)) {
    fs.mkdirSync(diretorio, { recursive: true });
  }
}

garantirDiretorioLocal(DATA_DIR);
garantirDiretorioLocal(VIDEOS_DIR);

const qrCodeRateLimiter = new Map();

function botoesBoasVindas(suporteUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Ver assinatura', 'listar')],
    [Markup.button.callback('Programa de Indicação', 'gerar_referral')],
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

// Helper function to safely send messages, handling blocked users and invalid chats
async function enviarMensagemSegura(bot, chatId, texto, opcoes = {}) {
  try {
    return await bot.telegram.sendMessage(chatId, texto, opcoes);
  } catch (error) {
    if (error.response?.error_code === 403 || (error.response?.error_code === 400 && error.response?.description?.includes('chat not found'))) {
      console.log(`Chat ${chatId} não encontrado ou usuário bloqueou o bot. Removendo da lista de usuários ativos.`);
      return null;
    }
    throw error; // Re-throw other errors
  }
}

// Helper function to safely send photos, handling blocked users and invalid chats
async function enviarFotoSegura(bot, chatId, arquivoId, opcoes = {}) {
  try {
    return await bot.telegram.sendPhoto(chatId, arquivoId, opcoes);
  } catch (error) {
    if (error.response?.error_code === 403 || (error.response?.error_code === 400 && error.response?.description?.includes('chat not found'))) {
      console.log(`Chat ${chatId} não encontrado ou usuário bloqueou o bot. Removendo da lista de usuários ativos.`);
      return null;
    }
    throw error; // Re-throw other errors
  }
}

// Helper function to safely send videos, handling blocked users and invalid chats
async function enviarVideoSeguro(bot, chatId, arquivoIdOuStream, opcoes = {}) {
  try {
    return await bot.telegram.sendVideo(chatId, arquivoIdOuStream, opcoes);
  } catch (error) {
    if (error.response?.error_code === 403 || (error.response?.error_code === 400 && error.response?.description?.includes('chat not found'))) {
      console.log(`Chat ${chatId} não encontrado ou usuário bloqueou o bot. Removendo da lista de usuários ativos.`);
      return null;
    }
    throw error; // Re-throw other errors
  }
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
            if (estadoAtual.pixPhoto?.arquivoId) {
              await enviarFotoSegura(bot, pagamento.userId, estadoAtual.pixPhoto.arquivoId, {
                caption: mensagemConfirmacao,
                parse_mode: 'HTML',
                ...botoes,
              });
            } else {
              await enviarMensagemSegura(bot, pagamento.userId, mensagemConfirmacao, botoes);
            }
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
              await enviarMensagemSegura(bot, adminId, notificacaoAdmin);
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
            await enviarMensagemSegura(bot, pagamento.userId, mensagemExpirado, botoes);
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

  // Clean up expired promotions every hour
  setInterval(() => {
    estadoAtual = limparPromocoesExpiradas(estadoAtual);
  }, 60 * 60 * 1000); // 1 hour

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

    const videoLocalExiste = mensagemInicio.tipo === 'video_local' && mensagemInicio.arquivoPath && fs.existsSync(mensagemInicio.arquivoPath);

    if (mensagemInicio.tipo === 'photo' && mensagemInicio.arquivoId) {
      try {
        await ctx.replyWithPhoto(mensagemInicio.arquivoId, {
          caption: mensagemInicio.texto,
          parse_mode: 'HTML',
          ...botoes,
        });
      } catch (error) {
        if (error.response?.error_code === 403) {
          console.log(`Usuário ${ctx.from.id} bloqueou o bot. Removendo da lista de usuários ativos.`);
          estadoAtual.metricas.usuarios = estadoAtual.metricas.usuarios.filter(id => id !== ctx.from.id);
          return;
        }
        throw error;
      }
      return;
    }

    if (mensagemInicio.tipo === 'video' && mensagemInicio.arquivoId) {
      try {
        await ctx.replyWithVideo(mensagemInicio.arquivoId, {
          caption: mensagemInicio.texto,
          parse_mode: 'HTML',
          ...botoes,
        });
      } catch (error) {
        if (error.response?.error_code === 403) {
          console.log(`Usuário ${ctx.from.id} bloqueou o bot. Removendo da lista de usuários ativos.`);
          estadoAtual.metricas.usuarios = estadoAtual.metricas.usuarios.filter(id => id !== ctx.from.id);
          return;
        }
        throw error;
      }
      return;
    }

    if (mensagemInicio.tipo === 'video_local' && videoLocalExiste) {
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
        if (error.response?.error_code === 403) {
          console.log(`Usuário ${ctx.from.id} bloqueou o bot. Removendo da lista de usuários ativos.`);
          estadoAtual.metricas.usuarios = estadoAtual.metricas.usuarios.filter(id => id !== ctx.from.id);
          return;
        }
        // Fallback para texto se o vídeo não puder ser enviado
        if (viaCallback && ctx.callbackQuery?.message?.message_id) {
          try {
            await ctx.editMessageText(mensagemInicio.texto, botoes);
          } catch (editError) {
            if (editError.response?.error_code === 403) {
              console.log(`Usuário ${ctx.from.id} bloqueou o bot. Removendo da lista de usuários ativos.`);
              estadoAtual.metricas.usuarios = estadoAtual.metricas.usuarios.filter(id => id !== ctx.from.id);
              return;
            }
            throw editError;
          }
        } else {
          try {
            await ctx.reply(mensagemInicio.texto, botoes);
          } catch (replyError) {
            if (replyError.response?.error_code === 403) {
              console.log(`Usuário ${ctx.from.id} bloqueou o bot. Removendo da lista de usuários ativos.`);
              estadoAtual.metricas.usuarios = estadoAtual.metricas.usuarios.filter(id => id !== ctx.from.id);
              return;
            }
            throw replyError;
          }
        }
      }
      return;
    }

    if (mensagemInicio.tipo === 'video_local' && !videoLocalExiste) {
      console.warn('Vídeo local configurado, mas arquivo não encontrado. Enviando mensagem em texto.');
    }

    if (viaCallback && ctx.callbackQuery?.message?.message_id) {
      try {
        await ctx.editMessageText(mensagemInicio.texto, botoes);
      } catch (error) {
        if (error.response?.error_code === 403) {
          console.log(`Usuário ${ctx.from.id} bloqueou o bot. Removendo da lista de usuários ativos.`);
          estadoAtual.metricas.usuarios = estadoAtual.metricas.usuarios.filter(id => id !== ctx.from.id);
          return;
        }
        throw error;
      }
    } else {
      try {
        await ctx.reply(mensagemInicio.texto, botoes);
      } catch (error) {
        if (error.response?.error_code === 403) {
          console.log(`Usuário ${ctx.from.id} bloqueou o bot. Removendo da lista de usuários ativos.`);
          estadoAtual.metricas.usuarios = estadoAtual.metricas.usuarios.filter(id => id !== ctx.from.id);
          return;
        }
        throw error;
      }
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
    // Check for referral code in start command
    const startPayload = ctx.startPayload;
    if (startPayload && /^\d+$/.test(startPayload)) {
      // This is a referral link with user ID
      const referrerCode = startPayload;
      const newUserId = ctx.from.id;

      // Register the referral
      estadoAtual = registrarReferencia(estadoAtual, referrerCode, newUserId);

      // Award points to referrer
      estadoAtual = adicionarPontosReferencia(estadoAtual, referrerCode, 10);

      // Send welcome message with referral info
      await ctx.reply('🎉 Bem-vindo! Você foi indicado por um amigo e ganhou acesso especial!');
    }

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
      await ctx.reply('❌ Produto não encontrado. Tente novamente mais tarde.');
      return;
    }

    ctx.session = ctx.session || {};
    ctx.session.produtoCodigo = produto.codigo;
    const mensagem = [
      `Você escolheu ${produto.nome} (R$ ${produto.preco.toFixed(2)}).`,
      'Deseja gerar o QR code de pagamento?',
    ].join('\n');

    await ctx.reply(mensagem, botoesConfirmacao());
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

    // Send QR code with photo if configured
    try {
      if (estadoAtual.pixPhoto?.arquivoId) {
        await ctx.editMessageText('⏳ Gerando QR code...');
        await ctx.replyWithPhoto(estadoAtual.pixPhoto.arquivoId, {
          caption: texto,
          parse_mode: 'HTML',
          ...botoes,
        });
      } else {
        await ctx.editMessageText(texto, {
          parse_mode: 'HTML',
          ...botoes,
        });
      }
    } catch (error) {
      console.error('Erro ao enviar QR code com foto:', error);
      // Fallback to text message
      await ctx.editMessageText(texto, {
        parse_mode: 'HTML',
        ...botoes,
      });
    }
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

      // Send QR code with photo if configured
      try {
        if (estadoAtual.pixPhoto?.arquivoId) {
          await ctx.editMessageText('⏳ Gerando QR code...');
          await ctx.replyWithPhoto(estadoAtual.pixPhoto.arquivoId, {
            caption: texto,
            parse_mode: 'HTML',
            ...botoes,
          });
        } else {
          await ctx.editMessageText(texto, {
            parse_mode: 'HTML',
            ...botoes,
          });
        }
      } catch (error) {
        console.error('Erro ao enviar QR code com foto:', error);
        // Fallback to text message
        await ctx.editMessageText(texto, {
          parse_mode: 'HTML',
          ...botoes,
        });
      }
      return;
    }

    await ctx.reply('⏳ Verificando status do pagamento...');

    const statusPagamento = await paymentClient.verificarPagamento(qrCodeId);

    if (!statusPagamento) {
      await ctx.reply('⚠️ Não consegui verificar o status do pagamento agora. Tente novamente em instantes.');
      return;
    }

    let mensagemStatus;
    let botoes;

    if (statusPagamento.status === 'RECEIVED' || statusPagamento.status === 'CONFIRMED') {
      // Verificar se é o plano padrão ou promoção
      const pagamentoPendente = estadoAtual.pendingPayments.find(p => p.qrCodeId === qrCodeId);
      const isPlanoPadrao = pagamentoPendente && pagamentoPendente.produto && pagamentoPendente.produto.codigo === 'assinatura';
      const isPromocao = pagamentoPendente && pagamentoPendente.produto && pagamentoPendente.produto.codigo === 'promocao';

      let linkAcesso = '';
      if (isPlanoPadrao) {
        linkAcesso = '🔗 Link de acesso: https://t.me/homemade3';
      } else if (isPromocao && ctx.session.promocaoId) {
        // Buscar a promoção e liberar o link
        const promocao = estadoAtual.promotions.find(p => p.id === ctx.session.promocaoId);
        if (promocao) {
          linkAcesso = `🔗 Link de acesso: ${promocao.link}`;
        }
      }

      mensagemStatus = [
        '🎉 Pagamento confirmado!',
        `💰 Valor pago: R$ ${statusPagamento.value.toFixed(2)}`,
        `📅 Data do pagamento: ${new Date(statusPagamento.paymentDate).toLocaleDateString('pt-BR')}`,
        '',
        '✅ Seu acesso foi liberado!',
        linkAcesso || 'Você receberá as instruções em breve.',
        '',
        '📞 Em caso de dúvidas, entre em contato com o suporte.',
      ].join('\n');

      botoes = Markup.inlineKeyboard([
        [Markup.button.url('Falar com suporte', suporteUrl)],
        [Markup.button.callback('🔙 Início', 'start_menu')],
      ]);

      // Send confirmation message with photo if configured
      try {
        if (estadoAtual.pixPhoto?.arquivoId) {
          await ctx.replyWithPhoto(estadoAtual.pixPhoto.arquivoId, {
            caption: mensagemStatus,
            parse_mode: 'HTML',
            ...botoes,
          });
        } else {
          await ctx.reply(mensagemStatus, botoes);
        }
      } catch (error) {
        console.error('Erro ao enviar confirmação com foto:', error);
        // Fallback to text message
        await ctx.reply(mensagemStatus, botoes);
      }

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
          await enviarMensagemSegura(bot, adminId, notificacaoAdmin);
        } catch (error) {
          console.error(`Erro ao notificar admin ${adminId}:`, error);
        }
      });

      // Remove from pending payments and clear session
      estadoAtual = removerPagamentoPendente(estadoAtual, qrCodeId);
      ctx.session.qrCodeId = undefined;
      ctx.session.produtoCodigo = undefined;
      ctx.session.produtoPromocional = undefined;
      ctx.session.promocaoId = undefined;

      return; // Exit early since we handled the response above

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

    await ctx.reply(mensagemStatus, botoes);
  });

  bot.action(/^promocao:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const promocaoId = ctx.match[1];

    // Buscar a promoção no estado
    const promocao = estadoAtual.promotions.find(p => p.id === promocaoId);

    if (!promocao) {
      await ctx.editMessageText('❌ Promoção não encontrada ou expirada. Tente novamente mais tarde.');
      return;
    }

    // Criar produto promocional baseado na promoção armazenada
    const produtoPromocional = {
      codigo: 'promocao',
      nome: promocao.name,
      descricao: 'Acesso vitalício ao conteúdo com todos os bônus inclusos - PREÇO PROMOCIONAL!',
      preco: promocao.value,
    };

    ctx.session = ctx.session || {};
    ctx.session.produtoCodigo = produtoPromocional.codigo;
    ctx.session.produtoPromocional = produtoPromocional;
    ctx.session.promocaoId = promocaoId; // Armazenar o ID da promoção para liberar o link após pagamento

    const mensagem = [
      `🎉 Você escolheu a promoção ${produtoPromocional.nome} (R$ ${produtoPromocional.preco.toFixed(2)}).`,
      'Deseja gerar o QR code de pagamento?',
    ].join('\n');

    await ctx.editMessageText(mensagem, botoesConfirmacao());
  });

  bot.action('gerar_referral', async (ctx) => {
    await ctx.answerCbQuery();

    const isTextMessage = ctx.callbackQuery.message.text;

    if (isTextMessage) {
      await ctx.editMessageText('⏳ Gerando seu link de indicação...');
    } else {
      await ctx.reply('⏳ Gerando seu link de indicação...');
    }

    const userId = ctx.from.id;
    const dadosReferencia = obterDadosReferencia(estadoAtual, userId);

    if (!dadosReferencia) {
      const errorMsg = '❌ Não foi possível gerar seu código de referência. Tente novamente mais tarde.';
      if (isTextMessage) {
        await ctx.editMessageText(errorMsg);
      } else {
        await ctx.reply(errorMsg);
      }
      return;
    }

    const { referralCode: codigo, points: pontos, referredUsers: indicados } = dadosReferencia;
    const botInfo = await ctx.telegram.getMe();
    const botUsername = botInfo.username;
    const referralLink = `https://t.me/${botUsername}?start=${codigo}`;

    const mensagem = [
      '🎉 Programa de Indicação!',
      '',
      'Convide seus amigos para ganhar pontos e resgatar recompensas!',
      '',
      `🔗 Seu link de indicação: ${referralLink}`,
      '',
      `📊 Seus pontos atuais: ${pontos}`,
      `👥 Amigos indicados: ${indicados}`,
      '',
      '💡 Como funciona:',
      '• Cada amigo que usar seu link ganha 10 pontos',
      '• Com 50 pontos você ganha acesso gratuito!',
      '',
      'Compartilhe seu link e comece a ganhar!',
    ].join('\n');

    const botoes = Markup.inlineKeyboard([
      [Markup.button.callback('Ver meus pontos', 'ver_pontos')],
      [Markup.button.callback('Resgatar recompensa', 'resgatar_pontos')],
      [Markup.button.callback('🔙 Início', 'start_menu')],
    ]);

    if (isTextMessage) {
      await ctx.editMessageText(mensagem, botoes);
    } else {
      await ctx.reply(mensagem, botoes);
    }
  });

  bot.action('ver_pontos', async (ctx) => {
    await ctx.answerCbQuery();

    const userId = ctx.from.id;
    const dadosReferencia = obterDadosReferencia(estadoAtual, userId);

    if (!dadosReferencia) {
      await ctx.editMessageText('❌ Não foi possível obter seus dados de referência.');
      return;
    }

    const { points: pontos, referredUsers: indicados } = dadosReferencia;

    const mensagem = [
      '📊 Seus Pontos de Indicação',
      '',
      `⭐ Pontos atuais: ${pontos}`,
      `👥 Amigos indicados: ${indicados}`,
      '',
      '💡 Como ganhar pontos:',
      '• Cada indicação = 10 pontos',
      '• 50 pontos = Acesso gratuito!',
      '',
      'Use /referral para ver seu link de indicação.',
    ].join('\n');

    const botoes = Markup.inlineKeyboard([
      [Markup.button.callback('Gerar link de indicação', 'gerar_referral')],
      [Markup.button.callback('Resgatar recompensa', 'resgatar_pontos')],
      [Markup.button.callback('🔙 Início', 'start_menu')],
    ]);

    await ctx.editMessageText(mensagem, botoes);
  });

  bot.action('resgatar_pontos', async (ctx) => {
    await ctx.answerCbQuery();

    const userId = ctx.from.id;
    const dadosReferencia = obterDadosReferencia(estadoAtual, userId);

    if (!dadosReferencia) {
      await ctx.editMessageText('❌ Não foi possível verificar seus pontos.');
      return;
    }

    const { pontos } = dadosReferencia;

    if (pontos < 50) {
      const pontosFaltando = 50 - pontos;
      const mensagem = [
        '❌ Pontos insuficientes!',
        '',
        `⭐ Seus pontos: ${pontos}`,
        `🎯 Pontos necessários: 50`,
        `📉 Faltam: ${pontosFaltando} pontos`,
        '',
        'Convide mais amigos para acumular pontos!',
        'Use /referral para ver seu link de indicação.',
      ].join('\n');

      const botoes = Markup.inlineKeyboard([
        [Markup.button.callback('Gerar link de indicação', 'gerar_referral')],
        [Markup.button.callback('Ver meus pontos', 'ver_pontos')],
        [Markup.button.callback('🔙 Início', 'start_menu')],
      ]);

      await ctx.editMessageText(mensagem, botoes);
      return;
    }

    // Resgatar pontos
    estadoAtual = resgatarPontos(estadoAtual, userId);

    const mensagem = [
      '🎉 Parabéns! Recompensa resgatada!',
      '',
      '✅ Você ganhou acesso gratuito ao plano!',
      '🔗 Link de acesso: https://t.me/homemade3',
      '',
      'Obrigado por indicar seus amigos!',
      'Continue compartilhando para ajudar outros usuários.',
    ].join('\n');

    const botoes = Markup.inlineKeyboard([
      [Markup.button.url('Acessar conteúdo', 'https://t.me/homemade3')],
      [Markup.button.callback('🔙 Início', 'start_menu')],
    ]);

    await ctx.editMessageText(mensagem, botoes);
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

  bot.command('pix_foto', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Comando restrito a administradores.');
      return;
    }

    ctx.session = ctx.session || {};
    ctx.session.pixFoto = { etapa: 'aguardando_foto' };
    await ctx.reply('📸 Agora envie a foto que será usada junto com o texto do PIX.');
  });

  bot.command('limpar_pagamentos', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Comando restrito a administradores.');
      return;
    }

    await ctx.reply('⏳ Buscando pagamentos pendentes no Asaas...');

    try {
      const pendingPayments = await paymentClient.getPendingPayments();

      if (!pendingPayments.length) {
        await ctx.reply('✅ Não há pagamentos pendentes no Asaas.');
        return;
      }

      await ctx.reply(`📋 Encontrados ${pendingPayments.length} pagamentos pendentes. Iniciando exclusão...`);

      let deletedCount = 0;
      let failedCount = 0;

      for (const payment of pendingPayments) {
        const success = await paymentClient.deletePayment(payment.id);
        if (success) {
          deletedCount++;
        } else {
          failedCount++;
        }
      }

      const mensagem = [
        '🗑️ Limpeza concluída!',
        `✅ Deletados: ${deletedCount}`,
        `❌ Falhas: ${failedCount}`,
        '',
        'Nota: Os pagamentos locais pendentes no bot não foram afetados.',
      ].join('\n');

      await ctx.reply(mensagem);
    } catch (error) {
      console.error('Erro ao limpar pagamentos:', error);
      await ctx.reply('❌ Erro ao limpar pagamentos. Verifique os logs.');
    }
  });

  bot.command('referral', async (ctx) => {
    await ctx.reply('⏳ Gerando seu link de indicação...');

    const userId = ctx.from.id;
    const dadosReferencia = obterDadosReferencia(estadoAtual, userId);

    if (!dadosReferencia) {
      await ctx.reply('❌ Não foi possível gerar seu código de referência. Tente novamente mais tarde.');
      return;
    }

    const { referralCode: codigo, points: pontos, referredUsers: indicados } = dadosReferencia;
    const botInfo = await ctx.telegram.getMe();
    const botUsername = botInfo.username;
    const referralLink = `https://t.me/${botUsername}?start=${codigo}`;

    const mensagem = [
      '🎉 Programa de Indicação!',
      '',
      'Convide seus amigos para ganhar pontos e resgatar recompensas!',
      '',
      `🔗 Seu link de indicação: ${referralLink}`,
      '',
      `📊 Seus pontos atuais: ${pontos}`,
      `👥 Amigos indicados: ${indicados}`,
      '',
      '💡 Como funciona:',
      '• Cada amigo que usar seu link ganha 10 pontos',
      '• Com 50 pontos você ganha acesso gratuito!',
      '',
      'Compartilhe seu link e comece a ganhar!',
    ].join('\n');

    const botoes = Markup.inlineKeyboard([
      [Markup.button.callback('Ver meus pontos', 'ver_pontos')],
      [Markup.button.callback('Resgatar recompensa', 'resgatar_pontos')],
      [Markup.button.callback('🔙 Início', 'start_menu')],
    ]);

    await ctx.reply(mensagem, botoes);
  });

  bot.command('pontos', async (ctx) => {
    const userId = ctx.from.id;
    const dadosReferencia = obterDadosReferencia(estadoAtual, userId);

    if (!dadosReferencia) {
      await ctx.reply('❌ Não foi possível obter seus dados de referência.');
      return;
    }

    const { points: pontos, referredUsers: indicados } = dadosReferencia;

    const mensagem = [
      '📊 Seus Pontos de Indicação',
      '',
      `⭐ Pontos atuais: ${pontos}`,
      `👥 Amigos indicados: ${indicados}`,
      '',
      '💡 Como ganhar pontos:',
      '• Cada indicação = 10 pontos',
      '• 50 pontos = Acesso gratuito!',
      '',
      'Use /referral para ver seu link de indicação.',
    ].join('\n');

    const botoes = Markup.inlineKeyboard([
      [Markup.button.callback('Gerar link de indicação', 'gerar_referral')],
      [Markup.button.callback('Resgatar recompensa', 'resgatar_pontos')],
      [Markup.button.callback('🔙 Início', 'start_menu')],
    ]);

    await ctx.reply(mensagem, botoes);
  });

  bot.command('resgatar', async (ctx) => {
    const userId = ctx.from.id;
    const dadosReferencia = obterDadosReferencia(estadoAtual, userId);

    if (!dadosReferencia) {
      await ctx.reply('❌ Não foi possível verificar seus pontos.');
      return;
    }

    const { pontos } = dadosReferencia;

    if (pontos < 50) {
      const pontosFaltando = 50 - pontos;
      const mensagem = [
        '❌ Pontos insuficientes!',
        '',
        `⭐ Seus pontos: ${pontos}`,
        `🎯 Pontos necessários: 50`,
        `📉 Faltam: ${pontosFaltando} pontos`,
        '',
        'Convide mais amigos para acumular pontos!',
        'Use /referral para ver seu link de indicação.',
      ].join('\n');

      const botoes = Markup.inlineKeyboard([
        [Markup.button.callback('Gerar link de indicação', 'gerar_referral')],
        [Markup.button.callback('Ver meus pontos', 'ver_pontos')],
        [Markup.button.callback('🔙 Início', 'start_menu')],
      ]);

      await ctx.reply(mensagem, botoes);
      return;
    }

    // Resgatar pontos
    estadoAtual = resgatarPontos(estadoAtual, userId);

    const mensagem = [
      '🎉 Parabéns! Recompensa resgatada!',
      '',
      '✅ Você ganhou acesso gratuito ao plano!',
      '🔗 Link de acesso: https://t.me/homemade3',
      '',
      'Obrigado por indicar seus amigos!',
      'Continue compartilhando para ajudar outros usuários.',
    ].join('\n');

    const botoes = Markup.inlineKeyboard([
      [Markup.button.url('Acessar conteúdo', 'https://t.me/homemade3')],
      [Markup.button.callback('🔙 Início', 'start_menu')],
    ]);

    await ctx.reply(mensagem, botoes);
  });

  const enviarPromocaoParaTodos = async (ctx, corpo, valor, linkTexto) => {
    const usuarios = estadoAtual.metricas.usuarios;

    if (!usuarios.length) {
      await ctx.reply('Não há usuários registrados ainda para receber a promoção.');
      return;
    }

    // Gerar ID único para a promoção
    const promocaoId = `promo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Armazenar a promoção no estado
    estadoAtual = adicionarPromocao(estadoAtual, promocaoId, corpo.texto, valor, linkTexto);

    const mensagem = [
      '🚀 Promoção especial para você!',
      `Promoção: ${corpo.texto}`,
      '',
      `💰 Valor promocional: R$ ${valor.toFixed(2)}`,
      '',
      'Clique no botão abaixo para aproveitar.',
    ].join('\n');

    const botoes = Markup.inlineKeyboard([
      [Markup.button.callback(`Ver assinatura R$ ${valor.toFixed(2)}`, `promocao:${promocaoId}`)],
      [Markup.button.url('Falar com suporte', suporteUrl)],
    ]);

    // Armazenar o nome da promoção na sessão do admin para uso posterior
    ctx.session = ctx.session || {};
    ctx.session.nomePromocao = corpo.texto;

    for (const chatId of usuarios) {
      const result = await enviarMensagemSegura(bot, chatId, mensagem, botoes);
      if (result === null) {
        // Usuário bloqueou o bot, remover da lista
        estadoAtual.metricas.usuarios = estadoAtual.metricas.usuarios.filter(id => id !== chatId);
      }
    }

    await ctx.reply(`✅ Promoção enviada para ${usuarios.length} usuário(s).`);
  };

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
      const filePath = path.join(VIDEOS_DIR, fileName);

      // Salvar o vídeo localmente
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      const novaMensagem = {
        tipo: 'video_local',
        texto: mensagemInicio.texto,
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

      // Verificar se está aguardando foto para /pix_foto
      if (ctx.session?.pixFoto?.etapa === 'aguardando_foto') {
        const midia = extrairMidia(ctx.message);

        if (midia && midia.tipo === 'photo') {
          estadoAtual = salvarPixPhoto(estadoAtual, { arquivoId: midia.arquivoId });
          ctx.session.pixFoto = undefined;
          await ctx.reply('✅ Foto configurada com sucesso! Agora será enviada junto com as confirmações de pagamento.');
          return;
        } else {
          await ctx.reply('❌ Você deve enviar uma foto. Tente novamente.');
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

          ctx.session.promocao = {
            etapa: 'link',
            corpo: ctx.session.promocao.corpo,
            valor: valor,
          };

          await ctx.reply('🔗 Qual é o link do plano da promoção? Envie o link completo (ex: https://t.me/exemplo).');
          return;
        }

        if (etapa === 'link') {
          const linkTexto = extrairTextoLivre(ctx.message).trim();

          if (!linkTexto || !linkTexto.startsWith('http')) {
            await ctx.reply('Por favor, envie um link válido começando com http ou https.');
            return;
          }

          const corpo = ctx.session.promocao.corpo;
          const valor = ctx.session.promocao.valor;
          ctx.session.promocao = undefined;

          await enviarPromocaoParaTodos(ctx, corpo, valor, linkTexto);
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
