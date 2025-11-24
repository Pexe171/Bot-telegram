import { settings } from './config.js';
import { PaymentClient } from './paymentClient.js';
import { criarBot } from './telegramBot.js';

async function bootstrap() {
  console.info('Iniciando bot de vendas em Node.js...');

  const paymentClient = new PaymentClient({
    apiKey: settings.asaasApiKey,
    baseUrl: settings.asaasBaseUrl,
  });

  const bot = criarBot({ settings, paymentClient });

  await bot.launch();
  console.info('Bot em execução. Pressione Ctrl+C para encerrar.');
}

bootstrap().catch((err) => {
  console.error('Falha ao iniciar o bot:', err);
  process.exit(1);
});

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
