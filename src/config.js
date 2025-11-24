import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name, mensagem) {
  const valor = process.env[name];
  if (!valor) {
    throw new Error(mensagem ?? `Defina a variável de ambiente ${name}.`);
  }
  return valor;
}

export const settings = {
  telegramToken: requireEnv(
    'TELEGRAM_BOT_TOKEN',
    'Informe o token do bot em TELEGRAM_BOT_TOKEN.'
  ),
  asaasApiKey: requireEnv('ASAAS_API_KEY', 'Defina a chave ASAAS em ASAAS_API_KEY.'),
  asaasBaseUrl: (process.env.ASAAS_BASE_URL || 'https://www.asaas.com/api/v3').replace(/\/+$/, ''),
  suporteUrl: process.env.SUPORTE_URL || 'https://t.me/+seu_contato',
};
