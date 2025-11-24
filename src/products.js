export const produtos = [
  {
    codigo: 'vip',
    nome: 'Assinatura VIP',
    descricao: 'Acesso premium ao conteúdo exclusivo do seu nicho.',
    preco: 49.9,
  },
  {
    codigo: 'pacote_plus',
    nome: 'Pacote Plus',
    descricao: 'Combinação de conteúdos + bônus surpresa.',
    preco: 79.9,
  },
  {
    codigo: 'consultoria',
    nome: 'Consultoria 1:1',
    descricao: 'Sessão privada para tirar dúvidas e acelerar resultados.',
    preco: 149.9,
  },
];

export function buscarProduto(codigo) {
  return produtos.find((item) => item.codigo === codigo);
}
