"""
Mede o modelo treinado com a MESMA prova da heuristica (ver avaliacao.py).

A classificacao passa por `modelo.classificar_com` — exatamente o caminho que o
servico usa em producao. Medir por outro caminho ja escondeu um defeito: a
producao redimensionava a imagem para outro tamanho, e o erro real era quase o
dobro do medido (DECISOES.md 2.19).

    python treino/avaliar_modelo.py --pesos pesos/unet.pt
"""

from __future__ import annotations

import argparse
from pathlib import Path

from avaliacao import PREPARADO, RAIZ, dano_de_referencia, recortes, relatorio

from visao.indice import indice_de_dano
from visao.modelo import classificar_com
from visao.rede import carregar


def main() -> None:
    parser = argparse.ArgumentParser(description="Avalia o modelo treinado")
    parser.add_argument("--pesos", type=Path, default=RAIZ / "pesos" / "unet.pt")
    parser.add_argument("--dados", type=Path, default=PREPARADO)
    parser.add_argument("--divisao", default="validacao")
    opcoes = parser.parse_args()

    modelo, versao = carregar(opcoes.pesos)
    lista = recortes(opcoes.dados, opcoes.divisao)

    estimados = []
    for recorte in lista:
        contagem, _ = classificar_com(modelo, recorte.imagem.read_bytes())
        estimados.append(indice_de_dano(contagem))

    verdadeiros = [dano_de_referencia(r) for r in lista]

    relatorio(f"MODELO TREINADO ({versao})", estimados, verdadeiros)


if __name__ == "__main__":
    main()
