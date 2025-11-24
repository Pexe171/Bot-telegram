from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List

from dotenv import load_dotenv

load_dotenv()


@dataclass
class Product:
    """Modelo imutável de produto exibido na vitrine."""

    codigo: str
    nome: str
    descricao: str
    preco: float


@dataclass
class Settings:
    """Carrega e tipa todas as variáveis de ambiente necessárias ao bot."""

    telegram_token: str
    asaas_api_key: str
    asaas_base_url: str
    payment_service_url: str
    admin_chat_ids: List[int]
    suporte_url: str

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.getenv("TELEGRAM_BOT_TOKEN")
        if not token:
            raise ValueError("Defina a variável de ambiente TELEGRAM_BOT_TOKEN.")

        asaas_api_key = os.getenv("ASAAS_API_KEY")
        if not asaas_api_key:
            raise ValueError("Defina a variável de ambiente ASAAS_API_KEY.")

        asaas_base_url = os.getenv("ASAAS_BASE_URL", "https://www.asaas.com/api/v3").rstrip("/")
        payment_service_url = os.getenv("PAYMENT_SERVICE_URL", "http://localhost:4000").rstrip("/")
        admin_ids_raw = os.getenv("ADMIN_CHAT_IDS", "")
        admin_chat_ids = [
            int(item.strip()) for item in admin_ids_raw.split(",") if item.strip().isdigit()
        ]
        suporte_url = os.getenv("SUPORTE_URL", "https://t.me/+seu_contato")

        return cls(
            telegram_token=token,
            asaas_api_key=asaas_api_key,
            asaas_base_url=asaas_base_url,
            payment_service_url=payment_service_url,
            admin_chat_ids=admin_chat_ids,
            suporte_url=suporte_url,
        )
