const fs = require('fs');
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

  return {
    mensagemInicio,
    metricas,
    pendingPayments,
  };
}

function carregarEstado() {
  garantirDiretorio();

  if (!fs.existsSync(STORAGE_FILE)) {
    return normalizarEstado(DEFAULT_STATE);
  }

  try {
    const raw = fs.readFileSync(STORAGE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizarEstado(parsed);
  } catch (error) {
    console.error('Não foi possível ler o arquivo de estado. Usando padrões.', error);
    return normalizarEstado(DEFAULT_STATE);
  }
}

function salvarEstado(estado) {
  garantirDiretorio();
  const normalizado = normalizarEstado(estado);
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(normalizado, null, 2), 'utf8');
  return normalizado;
}

function salvarMensagemInicio(estadoAtual, mensagemInicio) {
  const novoEstado = salvarEstado({
    ...estadoAtual,
    mensagemInicio,
  });
  return novoEstado;
}

function registrarInteracao(estadoAtual, userId) {
  const estado = normalizarEstado(estadoAtual);
  const id = Number(userId);

  if (!Number.isNaN(id) && !estado.metricas.usuarios.includes(id)) {
    estado.metricas.usuarios.push(id);
  }

  estado.metricas.totalMensagens += 1;

  return salvarEstado(estado);
}

function adicionarPagamentoPendente(estadoAtual, qrCodeId, userId, produto) {
  const estado = normalizarEstado(estadoAtual);
  estado.pendingPayments = estado.pendingPayments || [];
  estado.pendingPayments.push({
    qrCodeId,
    userId: Number(userId),
    produto,
    timestamp: Date.now(),
    checkCount: 0,
  });
  return salvarEstado(estado);
}

function removerPagamentoPendente(estadoAtual, qrCodeId) {
  const estado = normalizarEstado(estadoAtual);
  estado.pendingPayments = estado.pendingPayments || [];
  estado.pendingPayments = estado.pendingPayments.filter(p => p.qrCodeId !== qrCodeId);
  return salvarEstado(estado);
}

function obterPagamentosPendentes(estadoAtual) {
  const estado = normalizarEstado(estadoAtual);
  return estado.pendingPayments || [];
}

function incrementarCheckCount(estadoAtual, qrCodeId) {
  const estado = normalizarEstado(estadoAtual);
  const pagamento = estado.pendingPayments.find(p => p.qrCodeId === qrCodeId);
  if (pagamento) {
    pagamento.checkCount += 1;
  }
  return salvarEstado(estado);
}

module.exports = {
  carregarEstado,
  salvarMensagemInicio,
  registrarInteracao,
  adicionarPagamentoPendente,
  removerPagamentoPendente,
  obterPagamentosPendentes,
  incrementarCheckCount,
  DEFAULT_WELCOME_MESSAGE,
};
