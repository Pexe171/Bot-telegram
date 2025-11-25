const PRODUTOS = {
  vip: {
    codigo: 'vip',
    nome: 'Assinatura VIP',
    descricao: 'Acesso premium ao conteúdo exclusivo do seu nicho.',
    preco: 49.9,
  },
  pacote_plus: {
    codigo: 'pacote_plus',
    nome: 'Pacote Plus',
    descricao: 'Combinação de conteúdos + bônus surpresa.',
    preco: 79.9,
  },
  consultoria: {
    codigo: 'consultoria',
    nome: 'Consultoria 1:1',
    descricao: 'Sessão privada para tirar dúvidas e acelerar resultados.',
    preco: 149.9,
  },
};

function formatarVitrine() {
  return Object.values(PRODUTOS)
    .map(
      (produto) =>
        `<b>${produto.nome}</b> (R$ ${produto.preco.toFixed(2)})\n${produto.descricao}\nCódigo: <code>${produto.codigo}</code>`
    )
    .join('\n\n');
}

function obterProduto(codigo) {
  return PRODUTOS[codigo];
}

module.exports = {
  PRODUTOS,
  formatarVitrine,
  obterProduto,
};
