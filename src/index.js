const { Telegraf, Markup, session } = require('telegraf');
const { loadSettings } = require('./config');
const { PaymentClient } = require('./paymentClient');
const { formatarVitrine, obterProduto } = require('./products');

function botoesBoasVindas(suporteUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Ver produtos', 'listar')],
    [Markup.button.url('Falar com suporte', suporteUrl)],
  ]);
}

function botoesVitrine() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Comprar VIP', 'comprar:vip')],
    [Markup.button.callback('Comprar Plus', 'comprar:pacote_plus')],
    [Markup.button.callback('Comprar Consultoria', 'comprar:consultoria')],
  ]);
}

function botoesConfirmacao() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirmar', 'confirmar')],
    [Markup.button.callback('🔙 Voltar', 'listar')],
  ]);
}

async function registrarHandlers(bot, paymentClient, suporteUrl) {
  bot.start(async (ctx) => {
    const mensagem = [
      '👋 Seja bem-vindo!',
      '',
      'Este bot foi pensado para vendas rápidas e seguras.',
      'Escolha um dos planos abaixo para receber o link ou QR Code de pagamento.',
    ].join('\n');

    await ctx.reply(mensagem, botoesBoasVindas(suporteUrl));
  });

  bot.action('listar', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(formatarVitrine(), {
      ...botoesVitrine(),
      parse_mode: 'HTML',
    });
  });

  bot.action(/comprar:(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const codigo = ctx.match[1];
    const produto = obterProduto(codigo);

    if (!produto) {
      await ctx.editMessageText('❌ Produto não encontrado. Tente novamente.');
      return;
    }

    ctx.session.produtoCodigo = produto.codigo;
    const mensagem = [
      `Você escolheu <b>${produto.nome}</b> (R$ ${produto.preco.toFixed(2)}).`,
      'Confirme para gerar o pagamento via ASAAS.',
    ].join('\n');

    await ctx.editMessageText(mensagem, {
      ...botoesConfirmacao(),
      parse_mode: 'HTML',
    });
  });

  bot.action('confirmar', async (ctx) => {
    await ctx.answerCbQuery();
    const codigo = ctx.session.produtoCodigo;
    const produto = codigo ? obterProduto(codigo) : null;

    if (!produto) {
      await ctx.editMessageText('❌ Não encontrei o produto escolhido. Recomece.');
      return;
    }

    await ctx.editMessageText('⏳ Gerando pagamento...');

    const chatId = ctx.chat?.id ?? ctx.from.id;
    const dadosPagamento = await paymentClient.criarCobranca(produto, chatId);

    if (!dadosPagamento) {
      await ctx.editMessageText('⚠️ Não consegui gerar o pagamento agora. Tente novamente em instantes.');
      return;
    }

    const texto = [
      'Prontinho!\n',
      `<b>${produto.nome}</b> — R$ ${produto.preco.toFixed(2)}`,
      `Link de pagamento: ${dadosPagamento.paymentLink ?? 'Indisponível'}`,
      '',
      'Use o QR Code abaixo para pagar pelo app do seu banco ou carteira digital.',
    ].join('\n');

    const botoes = Markup.inlineKeyboard([
      [Markup.button.url('📨 Enviar comprovante', suporteUrl)],
    ]);

    if (dadosPagamento.qrCodeBase64) {
      await ctx.replyWithPhoto({ source: Buffer.from(dadosPagamento.qrCodeBase64, 'base64') }, {
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
