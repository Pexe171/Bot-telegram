# Bot de Vendas no Telegram (Node.js)

Bot humanizado para vender produtos digitais pelo Telegram com geração de cobrança PIX via ASAAS. Tudo em Node.js, com mensagens em português e fluxo de compra simples.

## Visão geral
- `/start` mostra vitrine, botão de suporte e leva ao fluxo de compra.
- Listagem de produtos com descrições e preços.
- Confirmação do item antes de gerar a cobrança.
- Integração direta com API ASAAS para gerar link e QR Code (Base64).
- Código organizado em camadas: configuração, catálogo, integração ASAAS e bot do Telegram.

## Requisitos
- Node.js 18+
- Token do bot do Telegram
- Chave de API do ASAAS

## Configuração
1. Crie um arquivo `.env` na raiz (há um exemplo em `.env.example`):
   ```env
   TELEGRAM_BOT_TOKEN=sua_chave_do_bot
   ASAAS_API_KEY=sua_chave_da_api_asaas
   ASAAS_BASE_URL=https://www.asaas.com/api/v3
   SUPORTE_URL=https://t.me/seu_usuario
   ```

2. Instale as dependências do projeto:
   ```bash
   npm install
   ```

3. Rode o bot:
   ```bash
   npm start
   ```

## Estrutura do código
- `src/config.js`: carrega variáveis de ambiente e valida obrigatórios.
- `src/products.js`: catálogo de produtos exibido na vitrine.
- `src/paymentClient.js`: cliente HTTP para criar cobranças PIX no ASAAS.
- `src/telegramBot.js`: comandos, callbacks e fluxo de conversa com Telegraf.
- `src/index.js`: ponto de entrada que monta dependências e inicia o bot.

## Fluxo de compra
1. Usuário envia `/start` e clica em **Ver produtos**.
2. Escolhe um item e confirma.
3. O bot gera a cobrança via ASAAS e retorna link + QR Code (Base64).
4. Usuário paga e pode enviar comprovante pelo botão de suporte.

## Boas práticas e próximos passos
- Ajuste os produtos em `src/products.js` conforme sua oferta real.
- Substitua o `SUPORTE_URL` pelo contato oficial do seu time.
- Adapte o payload do ASAAS em `src/paymentClient.js` se precisar coletar CPF, e-mail ou webhook de confirmação.
- Nunca commit tokens ou chaves reais.

## Aviso sobre conteúdo adulto
O bot foi pensado para vendas de nicho adulto de forma genérica, sem armazenar ou distribuir conteúdo explícito. Caso adicione esse tipo de material, respeite as políticas do Telegram e a legislação vigente.
