# Bot de Vendas no Telegram

Bot completo para vender produtos digitais via Telegram com geração de cobrança PIX via ASAAS. A automação foi pensada para ser humanizada, em português, e mescla Python (bot) com JavaScript (microserviço de pagamento).

## Visão geral
- `/start` exibe a vitrine, botão de suporte e leva o usuário ao fluxo de compra.
- Listagem de produtos com descrições e preços.
- Confirmação do item antes de gerar a cobrança.
- Integração com ASAAS para gerar link e QR Code (via serviço Node.js).
- Código organizado em camadas (configuração, produtos, pagamentos, handlers).

## Requisitos
- Python 3.11+
- Node.js 18+
- Token de bot do Telegram
- Chave de API do ASAAS

## Configuração
1. Crie um arquivo `.env` na raiz com:
   ```env
   TELEGRAM_BOT_TOKEN=sua_chave_do_bot
   PAYMENT_SERVICE_URL=http://localhost:4000
   ADMIN_CHAT_IDS=123456789,987654321
   ```

2. Instale dependências do bot:
   ```bash
   python -m pip install -r requirements.txt
   ```

3. Instale dependências do serviço de pagamento:
   ```bash
   cd payment_service
   npm install
   cd ..
   ```

4. Configure as variáveis do serviço ASAAS antes de iniciá-lo:
   ```bash
   export ASAAS_API_KEY=sua_chave_asaas
   export ASAAS_BASE_URL=https://www.asaas.com/api/v3  # opcional
   npm --prefix payment_service start
   ```

5. Em outro terminal, rode o bot:
   ```bash
   python -m src.bot.main
   ```

## Estrutura do código
- `src/bot/config.py`: leitura de variáveis de ambiente e modelo de produto.
- `src/bot/products.py`: catálogo inicial para testes.
- `src/bot/payment.py`: cliente HTTP que aciona o microserviço Node.
- `src/bot/handlers.py`: comandos, callbacks e fluxo de conversa.
- `src/bot/main.py`: inicialização da aplicação do Telegram.
- `payment_service/index.js`: Express + Axios chamando a API ASAAS.
- `payment_service/package.json`: dependências do serviço.

## Fluxo de compra
1. Usuário envia `/start` e clica em **Ver produtos**.
2. Escolhe um item e confirma.
3. O bot gera cobrança via serviço Node (ASAAS) e retorna link + QR Code (Base64).
4. Usuário paga e envia comprovante via botão de contato.

## Boas práticas e próximos passos
- Substitua URLs de suporte pelo seu contato real do Telegram.
- Ajuste produtos em `products.py` conforme sua oferta.
- Adicione verificação de pagamento por webhook do ASAAS se desejar marcar pedidos como pagos.
- Proteja tokens e chaves de API (não commitá-los).

## Aviso sobre conteúdo adulto
O bot foi pensado para vendas de nicho adulto de forma genérica, sem armazenar ou distribuir conteúdo explícito. Caso adicione esse tipo de material, respeite as políticas do Telegram e a legislação vigente.
