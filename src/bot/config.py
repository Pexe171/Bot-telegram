from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List

from dotenv import load_dotenv

load_dotenv()


@dataclass
class Product:
    codigo: str
    nome: str
    descricao: str
    preco: float


@dataclass
class Settings:
    telegram_token: str
    payment_service_url: str
    admin_chat_ids: List[int]

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.getenv("TELEGRAM_BOT_TOKEN")
        if not token:
            raise ValueError("Defina a variável de ambiente TELEGRAM_BOT_TOKEN.")

        payment_service_url = os.getenv("PAYMENT_SERVICE_URL", "http://localhost:4000")
        admin_ids_raw = os.getenv("ADMIN_CHAT_IDS", "")
        admin_chat_ids = [int(item.strip()) for item in admin_ids_raw.split(",") if item.strip().isdigit()]

        return cls(
            telegram_token=token,
            payment_service_url=payment_service_url.rstrip("/"),
            admin_chat_ids=admin_chat_ids,
        )
