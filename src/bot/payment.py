from __future__ import annotations

import logging
from typing import Dict, Optional

import requests
from requests import Session
from requests.exceptions import HTTPError, RequestException, Timeout

from .config import Product

logger = logging.getLogger(__name__)


class PaymentClient:
    """Cliente HTTP simples para criar cobranças ASAAS."""

    def __init__(self, api_key: str, base_url: str) -> None:
        if not api_key:
            raise ValueError("Chave ASAAS não configurada.")

        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.session: Session = requests.Session()

    def criar_cobranca(self, produto: Product, chat_id: int) -> Optional[Dict[str, str]]:
        """Cria uma cobrança PIX no ASAAS.

        Retorna um dicionário com link e QR Code quando disponível ou ``None`` em caso de erro.
        """

        payload = {
            "billingType": "PIX",
            "description": produto.nome,
            "value": produto.preco,
            "externalReference": f"telegram-{chat_id}-{produto.codigo}",
            "customer": {
                "name": f"Cliente Telegram {chat_id}",
                "cpfCnpj": "00000000000",  # Pode ser ajustado para dados reais se disponíveis
                "email": f"cliente{chat_id}@example.com",  # Exemplo de email dinâmico
            },
        }

        headers = {
            "access_token": self.api_key,
            "Content-Type": "application/json",
        }

        try:
            response = self.session.post(
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
        except Timeout:
            logger.warning("[PaymentClient] ASAAS demorou para responder (timeout).")
        except (HTTPError, RequestException) as exc:
            logger.error("[PaymentClient] Erro ao criar cobrança ASAAS: %s", exc)
        return None
