const PRODUTOS = {
  assinatura: {
    codigo: 'assinatura',
    nome: 'VITALÍCIO + BÔNUS + ACESSO BLACK',
    descricao: 'Acesso vitalício ao conteúdo com todos os bônus inclusos.',
    preco: 10.0,
  },
};

function formatarVitrine() {
  const produto = Object.values(PRODUTOS)[0];
  return `<b>${produto.nome}</b> (R$ ${produto.preco.toFixed(2)})\n${produto.descricao}`;
}

function obterProduto(codigo) {
  return PRODUTOS[codigo];
}

module.exports = {
  PRODUTOS,
  formatarVitrine,
  obterProduto,
};
