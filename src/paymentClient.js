const axios = require('axios');

const DEFAULT_CPF = '06778101210';

class PaymentClient {
  constructor({ apiKey, baseUrl }) {
    if (!apiKey) {
      throw new Error('Chave ASAAS não configurada.');
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        access_token: this.apiKey,
      },
    });
  }

  async getOrCreateCustomer(userData) {
    try {
      // 1. Search for customer by CPF
      console.log(`Buscando cliente com CPF: ${DEFAULT_CPF}`);
      let { data: searchResult } = await this.http.get(`/customers?cpfCnpj=${DEFAULT_CPF}`);
      if (searchResult.data && searchResult.data.length > 0) {
        const customer = searchResult.data[0];
        console.log(`Cliente encontrado: ${customer.id}`);
        return customer.id;
      }

      // 2. Create customer if not found
      console.log('Cliente não encontrado, criando um novo...');
      const newCustomer = {
        name: `${userData.first_name} ${userData.last_name || ''}`.trim(),
        cpfCnpj: DEFAULT_CPF,
        // email: userData.email, // Opcional, se você coletar
        // phone: userData.phone, // Opcional
        // mobilePhone: userData.phone, // Opcional
        notificationDisabled: true,
      };
      
      let { data: createResult } = await this.http.post('/customers', newCustomer);
      console.log(`Cliente criado: ${createResult.id}`);
      return createResult.id;

    } catch (error) {
      const reason = error.response?.data || error.message;
      console.error('[PaymentClient] Erro ao buscar ou criar cliente:', reason);
      throw new Error('Não foi possível processar os dados do cliente na Asaas.');
    }
  }

  async criarPagamento(produto, customerData) {
    const customerId = await this.getOrCreateCustomer(customerData);

    const payload = {
      customer: customerId,
      billingType: 'PIX',
      dueDate: new Date(new Date().setDate(new Date().getDate() + 1)).toISOString().split('T')[0], // Amanhã
      value: produto.preco,
      description: `Pagamento para: ${produto.nome}`,
    };

    try {
      console.log('Criando nova cobrança PIX...');
      const { data } = await this.http.post('/payments', payload);

      if (!data.id) {
        throw new Error('Resposta da API Asaas não continha um ID de pagamento.');
      }

      // After creating the payment, we need to get the QR Code
      console.log(`Cobrança ${data.id} criada. Buscando QR Code...`);
      const { data: pixData } = await this.http.get(`/payments/${data.id}/pixQrCode`);

      return {
        qrCodePix: pixData.payload,
        qrCodeId: data.id, // The payment ID
        qrCodeImage: pixData.encodedImage,
      };
    } catch (error) {
      const reason = error.response?.data || error.message;
      console.error('[PaymentClient] Erro ao criar cobrança PIX:', reason);
      return null;
    }
  }

  async verificarPagamento(paymentId) {
    try {
      const { data } = await this.http.get(`/payments/${paymentId}`);
      return {
        status: data.status, // RECEIVED, CONFIRMED, PENDING, etc.
        value: data.value,
        description: data.description,
        paymentDate: data.paymentDate,
        netValue: data.netValue,
      };
    } catch (error) {
      const reason = error.response?.data || error.message;
      console.error('[PaymentClient] Erro ao verificar pagamento:', reason);
      return null;
    }
  }
}

module.exports = { PaymentClient };

