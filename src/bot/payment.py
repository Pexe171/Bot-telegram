from __future__ import annotations

import os
from typing import Dict, Optional
import requests
from requests.exceptions import HTTPError, RequestException

from .config import Product

class PaymentClient:
    def __init__(self) -> None:
        self.api_key = os.getenv("ASAAS_API_KEY")
        self.base_url = os.getenv("ASAAS_BASE_URL", "https://www.asaas.com/api/v3")
        if not self.api_key:
            raise ValueError("A variável de ambiente ASAAS_API_KEY não está definida.")

    def criar_cobranca(self, produto: Product, chat_id: int) -> Optional[Dict[str, str]]:
        payload = {
            "billingType": "PIX",
            "description": produto.nome,
            "value": produto.preco,
            "externalReference": f"telegram-{chat_id}-{produto.codigo}",
            "customer": {
                "name": f"Cliente Telegram {chat_id}",
                "cpfCnpj": "00000000000",  # Pode ser ajustado para dados reais se disponíveis
                "email": f"cliente{chat_id}@example.com",  # Exemplo de email dinâmico
            }
        }

        headers = {
            "access_token": self.api_key,
            "Content-Type": "application/json",
        }

        try:
            response = requests.post(
                f"{self.base_url}/payments",
                json=payload,
                headers=headers,
                timeout=15,
            )
            response.raise_for_status()
            data = response.json()

            return {
                "paymentLink": data.get("invoiceUrl"),
                "qrCode": data.get("bankSlipUrl"),
                "qrCodeBase64": data.get("bankSlipBase64"),
            }
        except (HTTPError, RequestException) as e:
            print(f"[PaymentClient] Erro ao criar cobrança ASAAS: {e}")
            return None
