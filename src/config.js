const dotenv = require('dotenv');

dotenv.config();

function ensureEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Defina a variável de ambiente ${name}.`);
  }
  return value;
}

function loadSettings() {
  const telegramToken = ensureEnv('TELEGRAM_BOT_TOKEN');
  const asaasApiKey = ensureEnv('ASAAS_API_KEY');
  const asaasBaseUrl = ensureEnv('ASAAS_BASE_URL', 'https://www.asaas.com/api/v3');
  const suporteUrl = ensureEnv('SUPORTE_URL', 'https://t.me/+seu_contato');

  return {
    telegramToken,
    asaasApiKey,
    asaasBaseUrl: asaasBaseUrl.replace(/\/$/, ''),
    suporteUrl,
  };
}

module.exports = {
  loadSettings,
};
