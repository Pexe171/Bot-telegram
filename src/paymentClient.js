import axios from 'axios';

export class PaymentClient {
  constructor({ apiKey, baseUrl }) {
    if (!apiKey) {
      throw new Error('Chave ASAAS não configurada.');
    }

    this.client = axios.create({
      baseURL: baseUrl || 'https://www.asaas.com/api/v3',
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        access_token: apiKey,
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
      const resposta = await this.client.post('/payments', payload);
      const data = resposta.data || {};

      return {
        paymentLink: data.invoiceUrl,
        qrCode: data.bankSlipUrl,
        qrCodeBase64: data.bankSlipBase64,
      };
    } catch (erro) {
      const msg =
        erro?.response?.data?.errors?.[0]?.description ||
        erro?.message ||
        'Erro desconhecido ao criar cobrança ASAAS.';
      console.error('[PaymentClient] Falha ao criar cobrança:', msg);
      return null;
    }
  }
}
