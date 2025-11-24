from __future__ import annotations

import asyncio

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from .config import Product
from .payment import PaymentClient
from .products import PRODUTOS

ESCOLHENDO, CONFIRMANDO = range(2)


def _formatar_card(produto: Product) -> InlineKeyboardMarkup:
    """Cria o teclado com o botão de compra do produto escolhido."""

    botoes = [
        [
            InlineKeyboardButton(
                f"Comprar por R$ {produto.preco:.2f}", callback_data=f"comprar:{produto.codigo}"
            )
        ],
    ]
    return InlineKeyboardMarkup(botoes)


def _resposta_boas_vindas(suporte_url: str) -> InlineKeyboardMarkup:
    botoes = [
        [InlineKeyboardButton("Ver produtos", callback_data="listar")],
        [InlineKeyboardButton("Falar com suporte", url=suporte_url)],
    ]
    return InlineKeyboardMarkup(botoes)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    suporte_url = context.bot_data.get("suporte_url", "https://t.me/+seu_contato")
    mensagem = (
        "👋 Seja bem-vindo!\n\n"
        "Este bot foi pensado para vendas rápidas e seguras.\n"
        "Escolha um dos planos abaixo para receber o link ou QR Code de pagamento."
    )
    if update.message:
        await update.message.reply_text(
            mensagem, reply_markup=_resposta_boas_vindas(suporte_url)
        )
    return ESCOLHENDO


def _formatar_vitrine() -> str:
    return "\n\n".join(
        f"<b>{produto.nome}</b> (R$ {produto.preco:.2f})\n{produto.descricao}\nCódigo: <code>{codigo}</code>"
        for codigo, produto in PRODUTOS.items()
    )


async def listar_produtos(update: Update, _: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    if query:
        await query.answer()
        botoes = [
            [InlineKeyboardButton("Comprar VIP", callback_data="comprar:vip")],
            [InlineKeyboardButton("Comprar Plus", callback_data="comprar:pacote_plus")],
            [InlineKeyboardButton("Comprar Consultoria", callback_data="comprar:consultoria")],
        ]
        await query.edit_message_text(
            _formatar_vitrine(),
            reply_markup=InlineKeyboardMarkup(botoes),
            parse_mode=ParseMode.HTML,
        )
    return ESCOLHENDO


def _obter_produto(codigo: str) -> Product | None:
    return PRODUTOS.get(codigo)


async def preparar_compra(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    if not query:
        return ESCOLHENDO

    await query.answer()
    _, codigo = query.data.split(":", maxsplit=1)
    produto = _obter_produto(codigo)
    if not produto:
        await query.edit_message_text("❌ Produto não encontrado. Tente novamente.")
        return ESCOLHENDO

    context.user_data["produto_codigo"] = codigo
    mensagem = (
        f"Você escolheu <b>{produto.nome}</b> (R$ {produto.preco:.2f}).\n"
        "Confirme para gerar o pagamento via ASAAS."
    )
    botoes = [
        [InlineKeyboardButton("✅ Confirmar", callback_data="confirmar")],
        [InlineKeyboardButton("🔙 Voltar", callback_data="listar")],
    ]
    await query.edit_message_text(
        mensagem, reply_markup=InlineKeyboardMarkup(botoes), parse_mode=ParseMode.HTML
    )
    return CONFIRMANDO


async def confirmar_compra(
    update: Update, context: ContextTypes.DEFAULT_TYPE, payment_client: PaymentClient
) -> int:
    query = update.callback_query
    if not query:
        return ESCOLHENDO

    await query.answer()
    codigo = context.user_data.get("produto_codigo")
    produto = _obter_produto(codigo) if codigo else None
    if not produto:
        await query.edit_message_text("❌ Não encontrei o produto escolhido. Recomece.")
        return ESCOLHENDO

    await query.edit_message_text("⏳ Gerando pagamento...")

    chat_id = query.message.chat_id if query.message else query.from_user.id
    dados_pagamento = await asyncio.to_thread(
        payment_client.criar_cobranca, produto, chat_id
    )
    if not dados_pagamento:
        await query.edit_message_text(
            "⚠️ Não consegui gerar o pagamento agora. Tente novamente em instantes."
        )
        return ESCOLHENDO

    suporte_url = context.bot_data.get("suporte_url", "https://t.me/+seu_contato")
    texto = (
        f"Prontinho!\n\n"
        f"<b>{produto.nome}</b> — R$ {produto.preco:.2f}\n"
        f"Link de pagamento: {dados_pagamento.get('paymentLink', 'Indisponível')}\n\n"
        "Use o QR Code abaixo para pagar pelo app do seu banco ou carteira digital."
    )
    botoes = [[InlineKeyboardButton("📨 Enviar comprovante", url=suporte_url)]]

    qr_code_base64 = dados_pagamento.get("qrCodeBase64")
    if qr_code_base64 and query.message:
        await query.message.reply_photo(
            photo=qr_code_base64,
            caption=texto,
            parse_mode=ParseMode.HTML,
            reply_markup=InlineKeyboardMarkup(botoes),
        )
    else:
        await query.edit_message_text(
            texto, reply_markup=InlineKeyboardMarkup(botoes), parse_mode=ParseMode.HTML
        )

    return ESCOLHENDO


async def fallback(update: Update, _: ContextTypes.DEFAULT_TYPE) -> int:
    if update.message:
        await update.message.reply_text("Use /start para começar.")
    return ESCOLHENDO


def build_conversation(payment_client: PaymentClient) -> ConversationHandler:
    async def _confirmar(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
        return await confirmar_compra(update, context, payment_client)

    return ConversationHandler(
        entry_points=[CommandHandler("start", start)],
        states={
            ESCOLHENDO: [
                CallbackQueryHandler(listar_produtos, pattern="^listar$") ,
                CallbackQueryHandler(preparar_compra, pattern=r"^comprar:.*"),
            ],
            CONFIRMANDO: [
                CallbackQueryHandler(_confirmar, pattern="^confirmar$") ,
                CallbackQueryHandler(listar_produtos, pattern="^listar$") ,
            ],
        },
        fallbacks=[
            CommandHandler("start", start),
            MessageHandler(filters.ALL, fallback),
        ],
        per_message=True,
        name="fluxo_vendas",
        persistent=False,
        block=False,
    )


def registrar_contexto(application, suporte_url: str) -> None:
    """Armazena valores compartilhados no contexto do bot."""

    application.bot_data["suporte_url"] = suporte_url
