# Bot de Vendas no Telegram (Node.js)

Bot completo e em português para vender produtos digitais via Telegram com cobranças PIX pelo ASAAS. O projeto é 100% Node.js, usa Telegraf e mantém o estado em arquivos JSON, priorizando simplicidade e uma conversa humanizada com o cliente.

## 📌 Principais recursos
- **Vitrine simples e direta:** fluxo `/start` com botão de vitrine, suporte e painel rápido para admins.
- **Cobrança PIX pelo ASAAS:** cria cliente, gera QR Code e link PIX, verifica pagamento periodicamente e limpa pendências expiradas.
- **Mídia personalizável no início:** mensagem inicial pode ser texto, foto, vídeo enviado ao Telegram ou vídeo local salvo em `data/videos/`.
- **Programa de indicação:** gera link com payload do `/start`, registra indicações, soma pontos (10 por indicação) e permite resgatar acesso gratuito com 50 pontos (`/referral`, `/pontos`, `/resgatar`).
- **Campanhas promocionais guiadas:** fluxo `/promocao` pergunta texto e valor, dispara mensagem (com foto/vídeo opcional) para todos os usuários que já falaram com o bot.
- **Checklists e métricas:** comandos administrativos para testar status, acompanhar número de usuários únicos e mensagens recebidas.
- **Persistência em arquivos:** estado salvo em `data/bot-state.json` (mensagem inicial, métricas, pagamentos pendentes, promoções, programa de indicação e foto do PIX), criado automaticamente.
- **Fácil operação:** sem servidor HTTP separado; basta rodar `npm start` com as variáveis de ambiente corretas.

## 🛠️ Requisitos
- Node.js 18 ou superior
- Conta e chave de API do ASAAS
- Token do bot do Telegram
- IDs numéricos dos administradores (Telegram)

## ⚙️ Configuração
1. **Instale as dependências:**
   ```bash
   npm install
   ```

2. **Crie o arquivo `.env` na raiz** (use `env.example` apenas como referência e ajuste os nomes):
   ```env
   TELEGRAM_BOT_TOKEN=seu_token_do_bot
   ASAAS_API_KEY=sua_chave_asaas
   ASAAS_BASE_URL=https://api-sandbox.asaas.com    # opcional, será normalizada para terminar em /v3
   SUPORTE_URL=https://t.me/seu_usuario             # link de contato que aparece nos botões
   ADMIN_IDS=123456789,987654321                    # IDs numéricos separados por vírgula
   ```

3. **Execute o bot:**
   ```bash
   npm start
   ```
   O mesmo comando serve para desenvolvimento (não há build separado).

## 🧭 Como funciona o fluxo do cliente
1. O usuário envia `/start` e recebe a mensagem inicial (texto, foto ou vídeo) com botões:
   - **Ver assinatura**: mostra o produto principal e pede confirmação.
   - **Programa de Indicação**: gera ou exibe o link de convite com payload do `/start`.
   - **Falar com suporte**: abre o link definido em `SUPORTE_URL`.
2. Ao confirmar a compra, o bot cria a cobrança PIX na ASAAS, devolve link + QR Code e armazena o pagamento como pendente.
3. Um verificador automático checa o status a cada 5 segundos. Se confirmar, o usuário recebe mensagem de sucesso (com foto do PIX se configurada) e os administradores são avisados.
4. Se o QR Code expirar, o usuário é informado e pode gerar outro na mesma conversa.

## 🔐 Comandos disponíveis
### Usuários
- `/start` — abre o menu com vitrine, programa de indicação e suporte.
- `/referral` — gera ou exibe seu link de indicação com payload do `/start`.
- `/pontos` — mostra pontos acumulados e pessoas indicadas.
- `/resgatar` — troca 50 pontos por um acesso gratuito (link configurado no código).

### Administradores (IDs definidos em `ADMIN_IDS`)
- `/msg <texto>` — envia comunicado interno para todos que já falaram com o bot. Aceita foto/vídeo anexados e exige mínimo de 10 caracteres.
- `/trocar_inicio <texto>` — atualiza a mensagem de boas-vindas (mínimo 10 caracteres) e opcionalmente foto ou vídeo; persiste em `data/bot-state.json`.
- `/pix_foto` — pede uma foto para anexar às mensagens de pagamento PIX.
- `/promocao` — fluxo guiado: pede o texto (mínimo 10 caracteres), mídia opcional e valor promocional antes de disparar para todos os usuários.
- `/testar` — checklist rápido para validar admins configurados e total de usuários.
- `/metricas` — mostra usuários únicos e total de mensagens recebidas em DM.
- `/limpar_pagamentos` — varre pagamentos pendentes na ASAAS e tenta excluí-los.

## 🗂️ Estrutura do projeto
- `src/index.js` — inicialização do Telegraf, menus, comandos administrativos, verificador automático de pagamentos e fluxo de compra.
- `src/config.js` — leitura e saneamento de variáveis de ambiente (normaliza `ASAAS_BASE_URL` para terminar em `/v3`).
- `src/paymentClient.js` — cliente HTTP com axios para criar cliente, gerar cobrança PIX, buscar QR Code, verificar status e limpar pendências.
- `src/products.js` — catálogo estático inicial e formatação da vitrine.
- `src/storage.js` — persistência em JSON (`data/bot-state.json`), métricas básicas, promoções, foto do PIX, pagamentos pendentes e dados do programa de indicação.
- `data/` — criada automaticamente; inclui `bot-state.json` e `videos/` para mídias baixadas.

## 💡 Dicas de operação
- Ajuste o produto em `src/products.js` para refletir seu plano real (nome, descrição e preço).
- Personalize a mensagem inicial usando `/trocar_inicio` para alinhar com sua marca.
- Substitua `SUPORTE_URL` por um contato verdadeiro e monitore as notificações enviadas aos admins após cada pagamento.
- Caso queira confirmação automática do ASAAS via webhook, acrescente um endpoint HTTP separado — o bot atual funciona todo via polling.
- Mantenha o arquivo `.env` fora do controle de versão e nunca exponha tokens ou chaves de API.

## 🚀 Desenvolvimento
- O projeto usa Node.js CommonJS e não requer build. Utilize `npm start` durante o desenvolvimento.
- Os logs no terminal ajudam a acompanhar criação de clientes, cobranças e verificações de pagamento.
- O estado pode ser resetado apagando `data/bot-state.json` (o arquivo será recriado com padrões).

## 📜 Licença
Distribuído sob licença MIT. Ajuste conforme sua necessidade comercial.
