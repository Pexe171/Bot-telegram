from __future__ import annotations

import asyncio
import logging

from telegram.ext import ApplicationBuilder

from .config import Settings
from .handlers import build_conversation, registrar_contexto
from .payment import PaymentClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def build_app(settings: Settings):
    payment_client = PaymentClient(
        api_key=settings.asaas_api_key,
        base_url=settings.asaas_base_url,
    )

    application = ApplicationBuilder().token(settings.telegram_token).build()
    registrar_contexto(application, suporte_url=settings.suporte_url)
    conversation = build_conversation(payment_client)
    application.add_handler(conversation)
    return application


async def main() -> None:
    logger.info("Iniciando o bot de vendas...")
    settings = Settings.from_env()

    application = build_app(settings)

    await application.run_polling(close_loop=False)


if __name__ == "__main__":
    asyncio.run(main())
