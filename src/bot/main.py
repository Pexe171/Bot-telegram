from __future__ import annotations

import logging

from telegram.ext import Application, ApplicationBuilder

from .config import Settings
from .handlers import build_conversation
from .payment import PaymentClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def build_app() -> Application:
    settings = Settings.from_env()
    payment_client = PaymentClient(settings)

    application = ApplicationBuilder().token(settings.telegram_token).build()
    conversation = build_conversation(payment_client)
    application.add_handler(conversation)
    return application


def main() -> None:
    logger.info("Iniciando o bot de vendas...")
    application = build_app()
    application.run_polling(close_loop=False)


if __name__ == "__main__":
    main()
