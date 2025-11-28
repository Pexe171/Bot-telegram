
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const { Telegraf, Markup, session } = require('telegraf');

// Remove telegraf-session-mongodb dependency since it's not installed and not necessary now
const { loadSettings } = require('../src/config');
const { PaymentClient } = require('../src/paymentClient');
const { obterProduto } = require('../src/products');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(bodyParser.json());

// Initialize SQLite database
const dbFile = path.resolve(__dirname, 'botdata.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegramId TEXT UNIQUE,
    username TEXT,
    firstName TEXT,
    lastName TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    content TEXT,
    imageUrl TEXT,
    scheduledFor DATETIME,
    sent BOOLEAN DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id)
  )`);


  // Add other tables for promotions, pricing, analytics as needed
});

// --- Telegram Bot Setup ---

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
  const adminId = parseInt(process.env.ADMIN_ID) || 5764516358;

  const sendWelcomeMessage = async (ctx, edit = false) => {
    const mensagem = [
      '👋 Seja bem-vindo!',
      '',
      'Este bot foi pensado para vendas rápidas e seguras.',
      'Clique no botão abaixo para ver nossa assinatura e receber o link ou QR Code de pagamento.',
    ].join('\\n');
    const botoes = botoesBoasVindas(suporteUrl);

    if (edit) {
      await ctx.editMessageText(mensagem, botoes);
    } else {
      await ctx.reply(mensagem, botoes);
    }
  };

  const sendAdminButtons = async (ctx) => {
    const mensagemAdmin = '⚠️ Painel de controle do Admin ⚠️\nEscolha uma opção:';
    const botoesAdmin = Markup.inlineKeyboard([
      [Markup.button.callback('Enviar Promoção', 'admin_promocao')]
    ]);
    await ctx.reply(mensagemAdmin, botoesAdmin);
  };

  bot.start(async (ctx) => {
    // Register user on first interaction if not exists
    const telegramId = ctx.from.id.toString();
    const username = ctx.from.username || '';
    const firstName = ctx.from.first_name || '';
    const lastName = ctx.from.last_name || '';

    db.run(
      `INSERT OR IGNORE INTO users (telegramId, username, firstName, lastName) VALUES (?, ?, ?, ?)`,
      [telegramId, username, firstName, lastName],
      (err) => {
        if (err) {
          console.error('Erro ao inserir usuário:', err);
        }
      }
    );

    await sendWelcomeMessage(ctx);

    if (ctx.from.id === adminId) {
      await sendAdminButtons(ctx);
    }
  });

  bot.action('start_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await sendWelcomeMessage(ctx, true);

    if (ctx.from.id === adminId) {
      await sendAdminButtons(ctx);
    }
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
    ].join('\\n');

    await ctx.editMessageText(mensagem, botoesConfirmacao());
  });

  bot.action('confirmar', async (ctx) => {
    await ctx.answerCbQuery();
    // Try to fetch session first if undefined
    if (!ctx.session) {
      // Manually get session from middleware store if exists (telegraf-session uses in-memory by default)
      // But here, safer to fail gracefully with a detailed error
      await ctx.editMessageText('❌ Erro: sessão não encontrada. Por favor, recomece a compra com /start.');
      return;
    }
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
    ].join('\\n');

    const botoes = Markup.inlineKeyboard([
      [Markup.button.callback('Verificar status', 'verificar_pagamento')],
      [Markup.button.callback('🔙 Início', 'start_menu')],
    ]);

    await ctx.editMessageText(texto, {
      parse_mode: 'HTML',
      ...botoes,
    });
  });

  bot.action('admin_promocao', async (ctx) => {
    if (ctx.from.id !== adminId) {
      await ctx.answerCbQuery('⚠️ Você não tem permissão para executar esta ação.');
      return;
    }

    // Query all users who have interacted with the bot
    db.all('SELECT telegramId FROM users', async (err, rows) => {
      if (err) {
        console.error('Erro ao buscar usuários no banco de dados:', err);
        await ctx.editMessageText('❌ Erro ao buscar usuários no banco de dados.');
        return;
      }

      const mensagemPromocional = `🚨 ÚLTIMA CHANCE 🚨
📦 +20 MILHÕES de vídeos +60 MIL MODELOS REAIS
❌ Vai continuar pagando caro e tomando no seco?
✅ Um pagamento +15 GRUPOS VIP LIBERADOS

💣 Atualizações diárias
➕ 19 GRUPOS VIP inclusos

💥 30% OFF HOJE — SE NÃO CLICAR, FODEU
👇 CLICA AGORA E MERGULHA NA PUTARIA 👇`;

      const produto = obterProduto('assinatura');
      if (!produto) {
        await ctx.editMessageText('❌ Produto padrão não encontrado. Tente novamente mais tarde.');
        return;
      }

      const botoes = Markup.inlineKeyboard([
        [Markup.button.callback(`Comprar - R$ ${produto.preco.toFixed(2)}`, 'confirmar')],
      ]);

      // Send promotional message with purchase button to all users sequentially
      for (const row of rows) {
        try {
          // row.telegramId may be string, but Telegram API expects a number or string;
          // ensure it is string
          const chatId = row.telegramId.toString();
          await ctx.telegram.sendMessage(chatId, mensagemPromocional, { reply_markup: botoes.reply_markup });
        } catch (e) {
          console.error(`Erro ao enviar mensagem para usuário ${row.telegramId}:`, e);
        }
      }

      await ctx.editMessageText('📢 Mensagem de promoção enviada para todos os usuários.');
    });
  });

  bot.action('verificar_pagamento', async (ctx) => {
    await ctx.answerCbQuery('Funcionalidade em desenvolvimento.');
  });

  bot.on('message', async (ctx) => {
    // Register user on any message interaction, if not already registered
    const telegramId = ctx.from.id.toString();
    const username = ctx.from.username || '';
    const firstName = ctx.from.first_name || '';
    const lastName = ctx.from.last_name || '';

    db.run(
      `INSERT OR IGNORE INTO users (telegramId, username, firstName, lastName) VALUES (?, ?, ?, ?)`,
      [telegramId, username, firstName, lastName],
      (err) => {
        if (err) {
          console.error('Erro ao inserir usuário:', err);
        }
      }
    );

    await ctx.reply('Use /start para começar.');
  });

  bot.command('promocao', async (ctx) => {
    const adminId = 5764516358;
    if (ctx.from.id !== adminId) {
      await ctx.reply('⚠️ Você não tem permissão para usar esse comando.');
      return;
    }
  });

  // New command /msg for admin to send multi-line message with photo
  bot.command('msg', async (ctx) => {
    const adminId = 5764516358;
    if (ctx.from.id !== adminId) {
      await ctx.reply('⚠️ Você não tem permissão para usar esse comando.');
      return;
    }

    // Remove the command prefix from the message text to get content body
    const mensagemComando = ctx.message.text;
    const textoMensagem = mensagemComando.replace(/^\/msg\s+/, '').trim();

    // If there's no additional text, prompt the admin to send with caption or photo
    if (!textoMensagem && !ctx.message.photo) {
      await ctx.reply('Por favor, envie a mensagem após o comando /msg, podendo conter texto com quebras de linha e/ou foto.');
      return;
    }

    try {
      const chatId = ctx.chat.id;

      // If message has photo(s), send photo with caption
      if (ctx.message.photo && ctx.message.photo.length > 0) {
        // Use the highest resolution photo
        const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await ctx.telegram.sendPhoto(chatId, photo, { caption: textoMensagem, parse_mode: 'HTML' });
      } else {
        // Only text message
        await ctx.telegram.sendMessage(chatId, textoMensagem, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error('Erro ao enviar mensagem com /msg:', error);
      await ctx.reply('❌ Erro ao enviar a mensagem. Tente novamente.');
    }
  });

    const mensagemPromocional = `🚨 ÚLTIMA CHANCE 🚨
📦 +20 MILHÕES de vídeos +60 MIL MODELOS REAIS
❌ Vai continuar pagando caro e tomando no seco?
✅ Um pagamento +15 GRUPOS VIP LIBERADOS

💣 Atualizações diárias
➕ 19 GRUPOS VIP inclusos

💥 30% OFF HOJE — SE NÃO CLICAR, FODEU
👇 CLICA AGORA E MERGULHA NA PUTARIA 👇`;

    const produto = obterProduto('assinatura');
    if (!produto) {
      await ctx.reply('❌ Produto padrão não encontrado. Tente novamente mais tarde.');
      return;
    }

    ctx.session = ctx.session || {};
    ctx.session.produtoCodigo = produto.codigo;

    const botoes = Markup.inlineKeyboard([
      [Markup.button.callback(`Comprar - R$ ${produto.preco.toFixed(2)}`, 'confirmar')],
    ]);

    await ctx.reply(mensagemPromocional, botoes);
  });
}

// Start bot after syncing database
async function bootstrap() {
  const settings = loadSettings();
  const paymentClient = new PaymentClient({
    apiKey: settings.asaasApiKey,
    baseUrl: settings.asaasBaseUrl,
  });

  // Use memory session middleware for storing session data
  const bot = new Telegraf(settings.telegramToken);

  // Use Telegraf session middleware
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

app.get('/', (req, res) => {
  res.send('Bot Management API running');
});

app.listen(PORT, () => {
  console.log('Server listening on port ' + PORT);
});

module.exports = { app, db };
