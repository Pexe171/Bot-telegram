# Bot de Vendas no Telegram (Node.js)

Bot completo para vender produtos digitais via Telegram com geração de cobrança PIX via ASAAS. Toda a automação está em
Node.js, pensada para ser humanizada e em português.

## Visão geral
- `/start` exibe a vitrine, botão de suporte e leva o usuário ao fluxo de compra.
- Listagem de produtos com descrições e preços.
- Confirmação do item antes de gerar a cobrança.
- Integração direta com a API do ASAAS para gerar link e QR Code PIX.
- Código organizado em camadas simples: configuração, catálogo, cliente de pagamento e handlers do bot.

## Requisitos
- Node.js 18+
- Token do bot do Telegram
- Chave de API do ASAAS

## Configuração
1. Crie um arquivo `.env` na raiz com:
   ```env
   TELEGRAM_BOT_TOKEN=sua_chave_do_bot
   ASAAS_API_KEY=sua_chave_da_api_asaas
   ASAAS_BASE_URL=https://www.asaas.com/api/v3  # opcional, já vem como padrão
   SUPORTE_URL=https://t.me/seu_usuario          # opcional, personaliza o botão de suporte
   ADMIN_IDS=123456789,987654321                 # IDs numéricos dos administradores separados por vírgula
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

3. Rode o bot:
   ```bash
   npm start
   ```

## Estrutura do código
- `src/config.js`: leitura de variáveis de ambiente e saneamento de URLs.
- `src/products.js`: catálogo inicial de produtos.
- `src/paymentClient.js`: cliente HTTP para criar cobranças PIX no ASAAS.
- `src/index.js`: inicialização do Telegraf, handlers e fluxo de compra.
- `src/storage.js`: persistência da mensagem inicial personalizada e das métricas básicas de uso.

## Comandos administrativos
- `/msg <texto>`: envia comunicados apenas para os administradores listados em `ADMIN_IDS`. Suporta envio de foto ou vídeo
  anexados ao comando, mantendo quebras de linha do texto.
- `/trocar_inicio <texto>`: altera a mensagem inicial exibida no `/start`. Aceita texto simples ou mídia (foto/vídeo) com
  legenda; o conteúdo fica salvo em `data/bot-state.json` para ser reaproveitado nos próximos inícios.
- `/metricas`: mostra para administradores quantos usuários únicos já conversaram em DM e o total de mensagens recebidas.

## Fluxo de compra
1. Usuário envia `/start` e clica em **Ver produtos**.
2. Escolhe um item e confirma.
3. O bot gera a cobrança na API ASAAS e retorna link + QR Code (Base64).
4. Usuário paga e envia comprovante via botão de suporte.

## Boas práticas e próximos passos
- Substitua a URL de suporte pelo seu contato real do Telegram.
- Ajuste produtos em `products.js` conforme sua oferta.
- Adicione webhooks do ASAAS caso queira registrar confirmação automática de pagamento.
- Proteja tokens e chaves de API (não faça commit deles).

## Aviso sobre conteúdo adulto
O bot foi pensado para vendas de nicho adulto de forma genérica, sem armazenar ou distribuir conteúdo explícito. Caso adicione
esse tipo de material, respeite as políticas do Telegram e a legislação vigente.
