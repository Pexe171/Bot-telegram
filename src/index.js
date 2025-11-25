const { Telegraf, Markup, session } = require('telegraf');
const { loadSettings } = require('./config');
const { PaymentClient } = require('./paymentClient');
const { obterProduto } = require('./products');

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

async function registrarHandlers(bot, paymentClient, suporteUrl) {
  const sendWelcomeMessage = async (ctx, edit = false) => {
    const mensagem = [
      '👋 Seja bem-vindo!',
      '',
      'Este bot foi pensado para vendas rápidas e seguras.',
      'Clique no botão abaixo para ver nossa assinatura e receber o link ou QR Code de pagamento.',
    ].join('\n');
    const botoes = botoesBoasVindas(suporteUrl);

    if (edit) {
      await ctx.editMessageText(mensagem, botoes);
    } else {
      await ctx.reply(mensagem, botoes);
    }
  };

  bot.start(async (ctx) => {
    await sendWelcomeMessage(ctx);
  });

  bot.action('start_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await sendWelcomeMessage(ctx, true);
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

  bot.on('message', async (ctx) => {
    await ctx.reply('Use /start para começar.');
  });
}

async function bootstrap() {
  const settings = loadSettings();
  const paymentClient = new PaymentClient({
    apiKey: settings.asaasApiKey,
    baseUrl: settings.asaasBaseUrl,
  });

  const bot = new Telegraf(settings.telegramToken);
  bot.use(session());
  await registrarHandlers(bot, paymentClient, settings.suporteUrl);

  console.log('🤖 Iniciando o bot de vendas...');
  await bot.launch();

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

bootstrap().catch((error) => {
  console.error('Erro fatal ao iniciar o bot:', error);
  process.exit(1);
});
