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

---

# Painel de Controle (Dashboard)

Este projeto agora inclui um painel de controle web para gerenciar funcionalidades do bot, incluindo mensagens personalizadas, agendamento, promoções, ajustes de preços e visualização de estatísticas.

### Backend da API

O backend usa Node.js com Express e banco SQLite para armazenar dados do bot.

Para iniciar o backend:
```bash
node backend/server.js
```

### Frontend do Painel

O frontend é uma aplicação React com tema escuro, para gerenciar o bot via interface web.

Para iniciar o frontend:
```bash
cd frontend
npm install
npm start
```

> É necessário que o backend (porta 4000) e o frontend (porta 3000) estejam rodando para o painel funcionar corretamente.

### Uso

- O painel permite visualizar usuários, criar e agendar mensagens personalizadas, gerenciar promoções e preços, além de monitorar estatísticas do bot.
- A integração com o bot se dá via API backend, que o bot pode utilizar para leitura e escrita dos dados necessários.

### Desenvolvimento

Para desenvolvimento, recomenda-se rodar bot, backend e frontend separadamente conforme descrito acima.
