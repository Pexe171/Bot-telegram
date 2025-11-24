from __future__ import annotations

from typing import Dict

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import CallbackContext, CallbackQueryHandler, CommandHandler, ConversationHandler, MessageHandler, filters

from .payment import PaymentClient
from .products import PRODUTOS

ESCOLHENDO, CONFIRMANDO = range(2)


def _formatar_card(produto_codigo: str) -> InlineKeyboardMarkup:
    produto = PRODUTOS[produto_codigo]
    botoes = [
        [InlineKeyboardButton(f"Comprar por R$ {produto.preco:.2f}", callback_data=f"comprar:{produto_codigo}")],
    ]
    return InlineKeyboardMarkup(botoes)


def start(update: Update, _: CallbackContext) -> int:
    mensagem = (
        "👋 Seja bem-vindo!\n\n"
        "Este bot foi pensado para vendas rápidas e seguras.\n"
        "Escolha um dos planos abaixo para receber o link ou QR Code de pagamento."
    )
    botoes = [
        [InlineKeyboardButton("Ver produtos", callback_data="listar")],
        [InlineKeyboardButton("Falar com suporte", url="https://t.me/+seu_contato")],
    ]
    update.message.reply_text(mensagem, reply_markup=InlineKeyboardMarkup(botoes))
    return ESCOLHENDO


def listar_produtos(update: Update, _: CallbackContext) -> int:
    query = update.callback_query
    if query:
        query.answer()
        texto = "\n\n".join(
            f"<b>{produto.nome}</b> (R$ {produto.preco:.2f})\n{produto.descricao}\nCódigo: <code>{codigo}</code>"
            for codigo, produto in PRODUTOS.items()
        )
        botoes = [
            [InlineKeyboardButton("Comprar VIP", callback_data="comprar:vip")],
            [InlineKeyboardButton("Comprar Plus", callback_data="comprar:pacote_plus")],
            [InlineKeyboardButton("Comprar Consultoria", callback_data="comprar:consultoria")],
        ]
        query.edit_message_text(texto, reply_markup=InlineKeyboardMarkup(botoes), parse_mode=ParseMode.HTML)
    return ESCOLHENDO


def preparar_compra(update: Update, context: CallbackContext) -> int:
    query = update.callback_query
    if not query:
        return ESCOLHENDO

    query.answer()
    _, codigo = query.data.split(":", maxsplit=1)
    if codigo not in PRODUTOS:
        query.edit_message_text("❌ Produto não encontrado. Tente novamente.")
        return ESCOLHENDO

    context.user_data["produto_codigo"] = codigo
    produto = PRODUTOS[codigo]
    mensagem = (
        f"Você escolheu <b>{produto.nome}</b> (R$ {produto.preco:.2f}).\n"
        "Confirme para gerar o pagamento via ASAAS."
    )
    botoes = [
        [InlineKeyboardButton("✅ Confirmar", callback_data="confirmar")],
        [InlineKeyboardButton("🔙 Voltar", callback_data="listar")],
    ]
    query.edit_message_text(mensagem, reply_markup=InlineKeyboardMarkup(botoes), parse_mode=ParseMode.HTML)
    return CONFIRMANDO


def confirmar_compra(update: Update, context: CallbackContext, payment_client: PaymentClient) -> int:
    query = update.callback_query
    if not query:
        return ESCOLHENDO

    query.answer()
    codigo = context.user_data.get("produto_codigo")
    if not codigo:
        query.edit_message_text("❌ Não encontrei o produto escolhido. Recomece.")
        return ESCOLHENDO

    produto = PRODUTOS[codigo]
    query.edit_message_text("⏳ Gerando pagamento...")

    dados_pagamento = payment_client.criar_cobranca(produto, query.message.chat_id)
    if not dados_pagamento:
        query.edit_message_text("⚠️ Não consegui gerar o pagamento agora. Tente novamente em instantes.")
        return ESCOLHENDO

    texto = (
        f"Prontinho!\n\n"
        f"<b>{produto.nome}</b> — R$ {produto.preco:.2f}\n"
        f"Link de pagamento: {dados_pagamento.get('paymentLink', 'Indisponível')}\n\n"
        "Use o QR Code abaixo para pagar pelo app do seu banco ou carteira digital."
    )
    botoes = [[InlineKeyboardButton("📨 Enviar comprovante", url="https://t.me/+seu_contato")]]

    qr_code_base64 = dados_pagamento.get("qrCodeBase64")
    if qr_code_base64:
        query.message.reply_photo(photo=qr_code_base64, caption=texto, parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup(botoes))
    else:
        query.edit_message_text(texto, reply_markup=InlineKeyboardMarkup(botoes), parse_mode=ParseMode.HTML)

    return ESCOLHENDO


def fallback(update: Update, _: CallbackContext) -> int:
    update.message.reply_text("Use /start para começar.")
    return ESCOLHENDO


def build_conversation(payment_client: PaymentClient) -> ConversationHandler:
    return ConversationHandler(
        entry_points=[CommandHandler("start", start)],
        states={
            ESCOLHENDO: [
                CallbackQueryHandler(listar_produtos, pattern="^listar$") ,
                CallbackQueryHandler(preparar_compra, pattern=r"^comprar:.*"),
            ],
            CONFIRMANDO: [
                CallbackQueryHandler(lambda u, c: confirmar_compra(u, c, payment_client), pattern="^confirmar$") ,
                CallbackQueryHandler(listar_produtos, pattern="^listar$") ,
            ],
        },
        fallbacks=[
            CommandHandler("start", start),
            MessageHandler(filters.ALL, fallback),
        ],
    )
