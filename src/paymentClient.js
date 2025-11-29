const axios = require('axios');

// Function to generate a random valid CPF
function gerarCpfAleatorio() {
  const randomDigits = () => Math.floor(Math.random() * 9) + 1; // 1-9 to avoid leading zero
  const digits = Array.from({ length: 9 }, randomDigits);

  // Calculate first check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += digits[i] * (10 - i);
  }
  let firstCheck = 11 - (sum % 11);
  if (firstCheck >= 10) firstCheck = 0;
  digits.push(firstCheck);

  // Calculate second check digit
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += digits[i] * (11 - i);
  }
  let secondCheck = 11 - (sum % 11);
  if (secondCheck >= 10) secondCheck = 0;
  digits.push(secondCheck);

  return digits.join('');
}

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
      // Generate a random CPF for each customer to ensure anonymity
      const cpfAleatorio = gerarCpfAleatorio();
      console.log(`Criando cliente com CPF aleatório: ${cpfAleatorio}`);

      const newCustomer = {
        name: `${userData.first_name} ${userData.last_name || ''}`.trim(),
        cpfCnpj: cpfAleatorio,
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
      console.error('[PaymentClient] Erro ao criar cliente:', reason);
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

