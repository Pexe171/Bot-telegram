from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, MessageHandler, filters, ContextTypes

TOKEN = "7708953131:AAGJbDM76DaWHanuGTStp_zTgvsKCmYbEqw"
ADMIN_ID = "5764516358"
PIX_KEY = "sjkdbfbsbfs18@gmail.com"
GRUPO_LINK = "https://t.me/+NElA4jmhC41jY2Ix"

dados_usuarios = {}

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.message.from_user
    mensagem = f"Olá {user.first_name}!\nSeu ID: {user.id}\nBem-vindo ao nosso bot!"
    
    keyboard = [[
        InlineKeyboardButton("Plano Mensal - R$9,99", callback_data='mensal'),
        InlineKeyboardButton("Plano Trimestral - R$29,99", callback_data='trimestral')
    ], [
        InlineKeyboardButton("Plano 6 meses - R$50,00", callback_data='semestral')
    ]]
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(mensagem, reply_markup=reply_markup)

async def escolher_plano(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    user_id = query.from_user.id
    plano = query.data
    
    planos = {
        "mensal": "R$9,99",
        "trimestral": "R$29,99",
        "semestral": "R$50,00"
    }
    
    if user_id not in dados_usuarios:
        dados_usuarios[user_id] = {}
    
    dados_usuarios[user_id]['plano'] = plano
    
    await query.message.reply_text(f"Você escolheu o plano {planos[plano]}\nInforme o nome do titular da conta PIX:")
    await query.answer()

async def receber_nome(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.message.from_user.id
    nome_titular = update.message.text
    
    if user_id not in dados_usuarios or 'plano' not in dados_usuarios[user_id]:
        await update.message.reply_text("Por favor, selecione um plano antes de enviar o nome.")
        return
    
    dados_usuarios[user_id]['titular'] = nome_titular
    plano = dados_usuarios[user_id]['plano']
    planos = {
        "mensal": "R$9,99",
        "trimestral": "R$29,99",
        "semestral": "R$50,00"
    }
    
    await update.message.reply_text(f"Obrigado! Faça o pagamento de {planos[plano]} para a chave PIX: {PIX_KEY}\nApós o pagamento, aguarde a confirmação do ADM.")
    
    keyboard = [[
        InlineKeyboardButton("✅ Sim", callback_data=f'confirmar_{user_id}'),
        InlineKeyboardButton("❌ Não", callback_data=f'recusar_{user_id}')
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await context.application.bot.send_message(
        chat_id=ADMIN_ID,
        text=f"Novo pagamento!\nCliente: {update.message.from_user.first_name}\nID: {user_id}\nPlano: {planos[plano]}\nTitular: {nome_titular}\nPIX: {PIX_KEY}\nO pagamento chegou?",
        reply_markup=reply_markup
    )

    await update.message.reply_text("Por favor, aguarde a confirmação do pagamento. O administrador irá verificar.")

async def confirmar_pagamento(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    user_id = query.data.split('_')[1]
    
    await context.application.bot.send_message(chat_id=user_id, text=f"Pagamento confirmado! Aqui está o link do grupo: {GRUPO_LINK}")
    await query.message.reply_text("Pagamento confirmado. O link do grupo foi enviado ao cliente.")
    await query.answer()

async def recusar_pagamento(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    user_id = query.data.split('_')[1]
    
    await context.application.bot.send_message(chat_id=user_id, text="Não foi identificado o seu pagamento. Por favor, tente novamente. Faça a compra novamente.")
    await query.message.reply_text("Pagamento recusado. O cliente foi notificado.")
    await query.answer()

def main():
    application = Application.builder().token(TOKEN).build()
    
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CallbackQueryHandler(escolher_plano, pattern="mensal|trimestral|semestral"))
    application.add_handler(CallbackQueryHandler(confirmar_pagamento, pattern="confirmar_.*"))
    application.add_handler(CallbackQueryHandler(recusar_pagamento, pattern="recusar_.*"))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, receber_nome))
    
    application.run_polling()

if __name__ == '__main__':
    main()
