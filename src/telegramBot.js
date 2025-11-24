import { Markup, Telegraf, session } from 'telegraf';
import { buscarProduto, produtos } from './products.js';

function tecladoInicial(suporteUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛍️ Ver produtos', 'listar')],
    [Markup.button.url('💬 Falar com suporte', suporteUrl)],
  ]);
}

function vitrineHtml() {
  return produtos
    .map(
      (produto) =>
        `<b>${produto.nome}</b> (R$ ${produto.preco.toFixed(2)})\n${produto.descricao}\nCódigo: <code>${produto.codigo}</code>`
    )
    .join('\n\n');
}

function botoesDeProdutos() {
  return Markup.inlineKeyboard(
    produtos.map((produto) => [
      Markup.button.callback(`Comprar ${produto.nome}`, `comprar:${produto.codigo}`),
    ])
  );
}

function botoesConfirmacao() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirmar', 'confirmar')],
    [Markup.button.callback('🔙 Voltar', 'listar')],
  ]);
}

export function criarBot({ settings, paymentClient }) {
  const bot = new Telegraf(settings.telegramToken);
  bot.use(session());

  bot.start(async (ctx) => {
    ctx.session ??= {};
    ctx.session.produto = null;

    const mensagem =
      '👋 Seja bem-vindo!\n\n' +
      'Este bot foi pensado para vendas rápidas e seguras.\n' +
      'Escolha um dos planos abaixo para receber o link ou QR Code de pagamento.';

    await ctx.reply(mensagem, tecladoInicial(settings.suporteUrl));
  });

  bot.command('produtos', async (ctx) => {
    await ctx.replyWithHTML(vitrineHtml(), botoesDeProdutos());
  });

  bot.action('listar', async (ctx) => {
    await ctx.answerCbQuery();
    const texto = vitrineHtml();

    const mensagemExiste = ctx.callbackQuery?.message?.message_id;
    if (mensagemExiste) {
      await ctx.editMessageText(texto, { parse_mode: 'HTML', ...botoesDeProdutos() });
    } else {
      await ctx.replyWithHTML(texto, botoesDeProdutos());
    }
  });

  bot.action(/^comprar:(.+)$/i, async (ctx) => {
    await ctx.answerCbQuery();
    const [, codigo] = ctx.callbackQuery.data.split(':');
    const produto = buscarProduto(codigo);

    if (!produto) {
      await ctx.reply('❌ Produto não encontrado. Tente novamente.');
      return;
    }

    ctx.session.produto = codigo;
    const mensagem =
      `Você escolheu <b>${produto.nome}</b> (R$ ${produto.preco.toFixed(2)}).\n` +
      'Confirme para gerar o pagamento via ASAAS.';

    await ctx.editMessageText(mensagem, { parse_mode: 'HTML', ...botoesConfirmacao() });
  });

  bot.action('confirmar', async (ctx) => {
    await ctx.answerCbQuery();
    const codigo = ctx.session?.produto;
    const produto = buscarProduto(codigo);

    if (!produto) {
      await ctx.reply('❌ Não encontrei o produto escolhido. Recomece com /start.');
      return;
    }

    await ctx.editMessageText('⏳ Gerando pagamento...');

    const chatId = ctx.chat?.id || ctx.from?.id;
    const dadosPagamento = await paymentClient.criarCobranca(produto, chatId);

    if (!dadosPagamento) {
      await ctx.reply('⚠️ Não consegui gerar o pagamento agora. Tente novamente em instantes.');
      return;
    }

    const texto =
      `Prontinho!\n\n` +
      `<b>${produto.nome}</b> — R$ ${produto.preco.toFixed(2)}\n` +
      `Link de pagamento: ${dadosPagamento.paymentLink || 'Indisponível'}\n\n` +
      'Use o QR Code abaixo para pagar pelo app do seu banco ou carteira digital.';

    const botoesSuporte = Markup.inlineKeyboard([
      [Markup.button.url('📨 Enviar comprovante', settings.suporteUrl)],
    ]);

    const qrBase64 = dadosPagamento.qrCodeBase64;
    if (qrBase64) {
      const buffer = Buffer.from(qrBase64, 'base64');
      await ctx.replyWithPhoto({ source: buffer }, {
        caption: texto,
        parse_mode: 'HTML',
        ...botoesSuporte,
      });
    } else {
      await ctx.replyWithHTML(texto, botoesSuporte);
    }

    ctx.session.produto = null;
  });

  bot.catch((err, ctx) => {
    console.error('Erro não tratado no bot:', err);
    ctx.reply?.('⚠️ Tive um problema aqui, mas já estou voltando. Use /start para recomeçar.');
  });

  return bot;
}
