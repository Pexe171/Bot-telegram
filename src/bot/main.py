from __future__ import annotations

import asyncio
import logging

from telegram.ext import ApplicationBuilder

from .config import Settings
from .handlers import build_conversation
from .payment import PaymentClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def build_app(settings: Settings):
    payment_client = PaymentClient()

    application = ApplicationBuilder().token(settings.telegram_token).build()
    conversation = build_conversation(payment_client)
    application.add_handler(conversation)
    return application


def main() -> None:
    logger.info("Iniciando o bot de vendas...")
    settings = Settings.from_env()

    application = build_app(settings)

    # Cria um event loop explícito para o python-telegram-bot utilizar,
    # evitando erros em ambientes onde não existe loop ativo por padrão.
    asyncio.set_event_loop(asyncio.new_event_loop())

    application.run_polling(close_loop=True)


if __name__ == "__main__":
    main()
