"""
Mede o estimador classico (heuristica de cor) contra a referencia da base.

O objetivo nao e defender a heuristica: e saber o tamanho do erro dela, para que
o trabalho possa dizer, com numero, se o modelo treinado e necessario.

    python treino/avaliar_baseline.py
"""

from __future__ import annotations

import argparse
from pathlib import Path

from avaliacao import PREPARADO, dano_de_referencia, recortes, relatorio

from visao.baseline import classificar
from visao.indice import indice_de_dano


def main() -> None:
    parser = argparse.ArgumentParser(description="Avalia o estimador classico")
    parser.add_argument("--dados", type=Path, default=PREPARADO)
    parser.add_argument("--divisao", default="validacao")
    opcoes = parser.parse_args()

    lista = recortes(opcoes.dados, opcoes.divisao)

    estimados = [indice_de_dano(classificar(r.imagem.read_bytes())) for r in lista]
    verdadeiros = [dano_de_referencia(r) for r in lista]

    relatorio("HEURISTICA DE COR (visao-baseline-exg-1.0.0)", estimados, verdadeiros)


if __name__ == "__main__":
    main()
