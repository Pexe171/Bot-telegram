from __future__ import annotations

from typing import Dict

from .config import Product

PRODUTOS: Dict[str, Product] = {
    "vip": Product(
        codigo="vip",
        nome="Assinatura VIP",
        descricao="Acesso premium ao conteúdo exclusivo do seu nicho.",
        preco=49.90,
    ),
    "pacote_plus": Product(
        codigo="pacote_plus",
        nome="Pacote Plus",
        descricao="Combinação de conteúdos + bônus surpresa.",
        preco=79.90,
    ),
    "consultoria": Product(
        codigo="consultoria",
        nome="Consultoria 1:1",
        descricao="Sessão privada para tirar dúvidas e acelerar resultados.",
        preco=149.90,
    ),
}
