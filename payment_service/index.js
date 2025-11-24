import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_BASE_URL = process.env.ASAAS_BASE_URL || "https://www.asaas.com/api/v3";

if (!ASAAS_API_KEY) {
  console.warn("[payment_service] Defina ASAAS_API_KEY para gerar cobranças reais.");
}

app.post("/pagamentos", async (req, res) => {
  const { externalReference, description, value } = req.body;

  if (!externalReference || !description || !value) {
    return res.status(400).json({ message: "Payload incompleto." });
  }

  const cliente = {
    name: `Cliente Telegram ${externalReference}`,
    cpfCnpj: "00000000000",
    email: "cliente@example.com",
  };

  try {
    const cobrancaResponse = await axios.post(
      `${ASAAS_BASE_URL}/payments`,
      {
        billingType: "PIX",
        description,
        value,
        externalReference,
        customer: cliente,
      },
      {
        headers: {
          access_token: ASAAS_API_KEY,
        },
      }
    );

    const { invoiceUrl: paymentLink, bankSlipUrl: qrCode, bankSlipBase64: qrCodeBase64 } = cobrancaResponse.data;
    return res.json({ paymentLink, qrCode, qrCodeBase64 });
  } catch (error) {
    console.error("Erro ao criar cobrança:", error.response?.data || error.message);
    return res.status(502).json({ message: "Falha ao comunicar com ASAAS" });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`[payment_service] Rodando na porta ${port}`);
});
