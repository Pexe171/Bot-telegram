const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORAGE_FILE = path.join(DATA_DIR, 'bot-state.json');

const DEFAULT_WELCOME_MESSAGE = {
  tipo: 'text',
  texto: [
    '👋 Seja bem-vindo!',
    '',
    'Este bot foi pensado para vendas rápidas e seguras.',
    'Clique no botão abaixo para ver nossa assinatura e receber o link ou QR Code de pagamento.',
  ].join('\n'),
  arquivoId: null,
};

const DEFAULT_STATE = {
  mensagemInicio: DEFAULT_WELCOME_MESSAGE,
  metricas: {
    usuarios: [],
    totalMensagens: 0,
  },
  pendingPayments: [], // {qrCodeId, userId, produto, timestamp, checkCount}
  promotions: [], // {id, name, value, link, createdAt}
  pixPhoto: null, // {arquivoId: string, tipo: 'photo'}
  referrals: {}, // {userId: {points: number, referredUsers: [userId], referralCode: string}}
};

function garantirDiretorio() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizarEstado(rawState) {
  const estado = rawState || {};

  const mensagemInicio = estado.mensagemInicio || DEFAULT_WELCOME_MESSAGE;

  const usuarios = Array.from(
    new Set((estado.metricas?.usuarios || []).map((value) => Number(value)).filter((value) => !Number.isNaN(value))),
  );

  const metricas = {
    usuarios,
    totalMensagens: Number(estado.metricas?.totalMensagens) || usuarios.length || 0,
  };

  const pendingPayments = estado.pendingPayments || [];
  const promotions = estado.promotions || [];
  const pixPhoto = estado.pixPhoto || null;
  const referrals = estado.referrals || {};

  return {
    mensagemInicio,
    metricas,
    pendingPayments,
    promotions,
    pixPhoto,
    referrals,
  };
}

async function carregarEstado() {
  garantirDiretorio();

  if (!fs.existsSync(STORAGE_FILE)) {
    return normalizarEstado(DEFAULT_STATE);
  }

  try {
    const raw = await fs.readFile(STORAGE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizarEstado(parsed);
  } catch (error) {
    console.error('Não foi possível ler o arquivo de estado. Usando padrões.', error);
    return normalizarEstado(DEFAULT_STATE);
  }
}

async function salvarEstado(estado) {
  garantirDiretorio();
  const normalizado = normalizarEstado(estado);
  await fs.writeFile(STORAGE_FILE, JSON.stringify(normalizado, null, 2), 'utf8');
  return normalizado;
}

async function salvarMensagemInicio(estadoAtual, mensagemInicio) {
  const novoEstado = await salvarEstado({
    ...estadoAtual,
    mensagemInicio,
  });
  return novoEstado;
}

async function registrarInteracao(estadoAtual, userId) {
  const estado = normalizarEstado(estadoAtual);
  const id = Number(userId);

  if (!Number.isNaN(id) && !estado.metricas.usuarios.includes(id)) {
    estado.metricas.usuarios.push(id);
  }

  estado.metricas.totalMensagens += 1;

  return await salvarEstado(estado);
}

async function adicionarPagamentoPendente(estadoAtual, qrCodeId, userId, produto) {
  const estado = normalizarEstado(estadoAtual);
  estado.pendingPayments = estado.pendingPayments || [];
  estado.pendingPayments.push({
    qrCodeId,
    userId: Number(userId),
    produto,
    timestamp: Date.now(),
    checkCount: 0,
  });
  return await salvarEstado(estado);
}

async function removerPagamentoPendente(estadoAtual, qrCodeId) {
  const estado = normalizarEstado(estadoAtual);
  estado.pendingPayments = estado.pendingPayments || [];
  estado.pendingPayments = estado.pendingPayments.filter(p => p.qrCodeId !== qrCodeId);
  return await salvarEstado(estado);
}

function obterPagamentosPendentes(estadoAtual) {
  const estado = normalizarEstado(estadoAtual);
  return estado.pendingPayments || [];
}

async function incrementarCheckCount(estadoAtual, qrCodeId) {
  const estado = normalizarEstado(estadoAtual);
  const pagamento = estado.pendingPayments.find(p => p.qrCodeId === qrCodeId);
  if (pagamento) {
    pagamento.checkCount += 1;
  }
  return await salvarEstado(estado);
}

async function adicionarPromocao(estadoAtual, id, name, value, link) {
  const estado = normalizarEstado(estadoAtual);
  estado.promotions = estado.promotions || [];
  estado.promotions.push({
    id,
    name,
    value,
    link,
    createdAt: Date.now(),
  });
  return await salvarEstado(estado);
}

async function limparPromocoesExpiradas(estadoAtual) {
  const estado = normalizarEstado(estadoAtual);
  const agora = Date.now();
  const seisHoras = 6 * 60 * 60 * 1000; // 6 horas em milissegundos
  estado.promotions = estado.promotions.filter(p => (agora - p.createdAt) < seisHoras);
  return await salvarEstado(estado);
}

async function salvarPixPhoto(estadoAtual, pixPhoto) {
  const estado = normalizarEstado(estadoAtual);
  estado.pixPhoto = pixPhoto;
  return await salvarEstado(estado);
}

// Referral functions
function obterDadosReferencia(estadoAtual, userId) {
  const estado = normalizarEstado(estadoAtual);
  return estado.referrals[userId] || { points: 0, referredUsers: [], referralCode: null };
}

function gerarCodigoReferencia(userId) {
  return userId.toString();
}

async function criarOuObterCodigoReferencia(estadoAtual, userId) {
  const estado = normalizarEstado(estadoAtual);
  const userIdStr = userId.toString();

  if (!estado.referrals[userIdStr]) {
    estado.referrals[userIdStr] = {
      points: 0,
      referredUsers: [],
      referralCode: gerarCodigoReferencia(userId),
    };
  }

  return await salvarEstado(estado);
}

async function registrarReferencia(estadoAtual, referrerCode, newUserId) {
  const estado = normalizarEstado(estadoAtual);

  // Find referrer by code
  let referrerId = null;
  for (const [userId, data] of Object.entries(estado.referrals)) {
    if (data.referralCode === referrerCode) {
      referrerId = userId;
      break;
    }
  }

  if (!referrerId) return estado; // No referrer found

  const referrerData = estado.referrals[referrerId];
  if (!referrerData.referredUsers.includes(newUserId)) {
    referrerData.referredUsers.push(newUserId);
  }

  return await salvarEstado(estado);
}

async function adicionarPontosReferencia(estadoAtual, userId, points) {
  const estado = normalizarEstado(estadoAtual);
  const userIdStr = userId.toString();

  if (!estado.referrals[userIdStr]) {
    estado.referrals[userIdStr] = {
      points: 0,
      referredUsers: [],
      referralCode: gerarCodigoReferencia(userId),
    };
  }

  estado.referrals[userIdStr].points += points;
  return await salvarEstado(estado);
}

async function resgatarPontos(estadoAtual, userId, pointsToRedeem) {
  const estado = normalizarEstado(estadoAtual);
  const userIdStr = userId.toString();

  if (!estado.referrals[userIdStr] || estado.referrals[userIdStr].points < pointsToRedeem) {
    return estado; // Not enough points
  }

  estado.referrals[userIdStr].points -= pointsToRedeem;
  return await salvarEstado(estado);
}

module.exports = {
  carregarEstado,
  salvarMensagemInicio,
  salvarPixPhoto,
  registrarInteracao,
  adicionarPagamentoPendente,
  removerPagamentoPendente,
  obterPagamentosPendentes,
  incrementarCheckCount,
  adicionarPromocao,
  limparPromocoesExpiradas,
  obterDadosReferencia,
  criarOuObterCodigoReferencia,
  registrarReferencia,
  adicionarPontosReferencia,
  resgatarPontos,
  DEFAULT_WELCOME_MESSAGE,
};
