const axios = require('axios');

class PaymentClient {
  constructor({ apiKey, baseUrl }) {
    if (!apiKey) {
      throw new Error('Chave ASAAS não configurada.');
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        access_token: this.apiKey,
      },
    });
  }

  async criarCobranca(produto, chatId) {
    const payload = {
      billingType: 'PIX',
      description: produto.nome,
      value: produto.preco,
      externalReference: `telegram-${chatId}-${produto.codigo}`,
      customer: {
        name: `Cliente Telegram ${chatId}`,
        cpfCnpj: '00000000000',
        email: `cliente${chatId}@example.com`,
      },
    };

    try {
      const { data } = await this.http.post('/payments', payload);
      return {
        paymentLink: data.invoiceUrl,
        qrCode: data.bankSlipUrl,
        qrCodeBase64: data.bankSlipBase64,
      };
    } catch (error) {
      const reason = error.response?.data || error.message;
      console.error('[PaymentClient] Erro ao criar cobrança ASAAS:', reason);
      return null;
    }
  }
}

module.exports = { PaymentClient };
