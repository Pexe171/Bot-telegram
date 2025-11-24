from __future__ import annotations

import json
from typing import Dict, Optional

import requests

from .config import Product, Settings


class PaymentClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def criar_cobranca(self, produto: Product, chat_id: int) -> Optional[Dict[str, str]]:
        payload = {
            "externalReference": f"telegram-{chat_id}-{produto.codigo}",
            "description": produto.nome,
            "value": produto.preco,
            "dueDate": None,
        }
        try:
            response = requests.post(
                f"{self.settings.payment_service_url}/pagamentos",
                json=payload,
                timeout=15,
            )
            response.raise_for_status()
            data = response.json()
            return {
                "paymentLink": data.get("paymentLink"),
                "qrCode": data.get("qrCode"),
                "qrCodeBase64": data.get("qrCodeBase64"),
            }
        except (requests.HTTPError, requests.RequestException, json.JSONDecodeError):
            return None
