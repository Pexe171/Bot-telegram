# Bot de Vendas no Telegram

Bot completo para vender produtos digitais via Telegram com geração de cobrança PIX via ASAAS. A automação foi pensada para ser humanizada, em português, e mescla Python (bot) com JavaScript (microserviço de pagamento).

## Visão geral
- `/start` exibe a vitrine, botão de suporte e leva o usuário ao fluxo de compra.
- Listagem de produtos com descrições e preços.
- Confirmação do item antes de gerar a cobrança.
- Integração com ASAAS para gerar link e QR Code (via serviço Python direto).
- Código organizado em camadas (configuração, produtos, pagamentos, handlers).

## Requisitos
- Python 3.11+
- Token de bot do Telegram
- Chave de API do ASAAS

## Configuração
1. Crie um arquivo `.env` na raiz com:
   ```env
   TELEGRAM_BOT_TOKEN=sua_chave_do_bot
   ASAAS_API_KEY=sua_chave_da_api_asaas
   ASAAS_BASE_URL=https://www.asaas.com/api/v3  # opcional, já vem como padrão
   ADMIN_CHAT_IDS=123456789,987654321
   SUPORTE_URL=https://t.me/seu_usuario  # opcional, personaliza o botão de suporte
   ```

2. Instale dependências do bot:
   ```bash
   python -m pip install -r requirements.txt
   ```

3. Rode o bot com:
   ```bash
   python -m src.bot.main
   ```

## Estrutura do código
- `src/bot/config.py`: leitura de variáveis de ambiente e modelo de produto.
- `src/bot/products.py`: catálogo inicial para testes.
- `src/bot/payment.py`: cliente HTTP que integra diretamente a API ASAAS usando Python.
- `src/bot/handlers.py`: comandos, callbacks e fluxo de conversa.
- `src/bot/main.py`: inicialização da aplicação do Telegram.

## Fluxo de compra
1. Usuário envia `/start` e clica em **Ver produtos**.
2. Escolhe um item e confirma.
3. O bot gera cobrança via API ASAAS diretamente em Python e retorna link + QR Code (Base64).
4. Usuário paga e envia comprovante via botão de contato.

## Boas práticas e próximos passos
- Substitua URLs de suporte pelo seu contato real do Telegram.
- Ajuste produtos em `products.py` conforme sua oferta.
- Adicione verificação de pagamento por webhook do ASAAS se desejar marcar pedidos como pagos.
- Proteja tokens e chaves de API (não commitá-los).

## Aviso sobre conteúdo adulto
O bot foi pensado para vendas de nicho adulto de forma genérica, sem armazenar ou distribuir conteúdo explícito. Caso adicione esse tipo de material, respeite as políticas do Telegram e a legislação vigente.
