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
  const asaasBaseUrl = ensureEnv('ASAAS_BASE_URL', 'https://api-sandbox.asaas.com');
  const suporteUrl = ensureEnv('SUPORTE_URL', 'https://t.me/+seu_contato');
  const adminIdsRaw = ensureEnv('ADMIN_IDS', '');

  const adminIds = adminIdsRaw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => !Number.isNaN(value));

  // Garante que a URL base da API Asaas termine com /v3 e não tenha barras duplicadas
  const cleanBaseUrl = asaasBaseUrl.replace(/\/v3$/, '').replace(/\/$/, '');
  const finalAsaasUrl = `${cleanBaseUrl}/v3`;

  return {
    telegramToken,
    asaasApiKey,
    asaasBaseUrl: finalAsaasUrl,
    suporteUrl,
    adminIds,
  };
}

module.exports = {
  loadSettings,
};
