"""
A prova comum a todos os estimadores.

A heuristica de cor e o modelo treinado sao medidos pelo MESMO codigo, sobre os
MESMOS recortes. Na primeira rodada, cada um tinha o seu jeito de ler a base, e
os numeros comparados vinham de provas diferentes (DECISOES.md 2.20).

QUAIS RECORTES ENTRAM

Os da validacao com pelo menos 10% de lavoura — a mesma cobertura minima que o
modulo de visao exige em producao (indice.COBERTURA_MINIMA). Abaixo disso o
recorte e carreador ou borda do voo, o dano de referencia e zero por falta de
planta, e acertar zero ali nao diz nada sobre o modelo.

A REFERENCIA TRIVIAL

Com os rotulos corrigidos, o dano medio da lavoura e de uns 5%. Um estimador que
responda SEMPRE 0% ja erra so isso em media. Qualquer estimador que nao fique
bem abaixo desse numero nao esta enxergando o estresse — esta so acompanhando a
media. Por isso a referencia trivial sai junto de toda avaliacao.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from visao.indice import CLASSES, COBERTURA_MINIMA, indice_de_dano

RAIZ = Path(__file__).resolve().parents[1]
PREPARADO = RAIZ / "dados" / "preparado"


@dataclass
class Recorte:
    imagem: Path
    mascara: Path
    dano: float


def recortes(dados: Path = PREPARADO, divisao: str = "validacao") -> list[Recorte]:
    """Recortes da divisao com lavoura suficiente para o indice significar algo."""
    indice = dados / "indice.csv"

    if not indice.exists():
        raise SystemExit(
            f"Nao ha {indice}: a preparacao dos dados nao rodou, ou falhou.\n"
            "Rode treino/preparar_dados.py e confira a mensagem que ele imprime."
        )

    with indice.open(encoding="utf-8") as arquivo:
        linhas = [l for l in csv.DictReader(arquivo) if l["divisao"] == divisao]

    return [
        Recorte(dados / "images" / l["imagem"], dados / "masks" / l["mascara"], float(l["dano"]))
        for l in linhas
        if float(l["lavoura"]) >= COBERTURA_MINIMA
    ]


def contagem(mapa: np.ndarray) -> dict[str, int]:
    return {nome: int((mapa == i).sum()) for i, nome in enumerate(CLASSES)}


def dano_de_referencia(recorte: Recorte) -> float:
    return indice_de_dano(contagem(np.asarray(Image.open(recorte.mascara))))


def relatorio(titulo: str, estimados: list[float], verdadeiros: list[float]) -> dict:
    """Imprime e devolve as metricas. O vies tem sinal: + superestima, - subestima."""
    erros = [e - v for e, v in zip(estimados, verdadeiros)]
    absolutos = sorted(abs(e) for e in erros)
    trivial = sum(verdadeiros) / len(verdadeiros)  # erro medio de responder sempre 0%

    metricas = {
        "recortes": len(erros),
        "dano_medio_real": sum(verdadeiros) / len(verdadeiros),
        "dano_medio_estimado": sum(estimados) / len(estimados),
        "erro_absoluto_medio": sum(absolutos) / len(absolutos),
        "erro_mediano": absolutos[len(absolutos) // 2],
        "erro_maximo": absolutos[-1],
        "vies": sum(erros) / len(erros),
        "erro_de_responder_sempre_zero": trivial,
    }

    print(titulo)
    print(f"  Recortes avaliados..: {metricas['recortes']} (validacao, com 10% ou mais de lavoura)")
    print(f"  Dano medio real.....: {metricas['dano_medio_real']:.1%}")
    print(f"  Dano medio estimado.: {metricas['dano_medio_estimado']:.1%}")
    print(f"  Erro absoluto medio.: {metricas['erro_absoluto_medio']:.1%}")
    print(f"  Erro mediano........: {metricas['erro_mediano']:.1%}")
    print(f"  Erro maximo.........: {metricas['erro_maximo']:.1%}")
    sentido = "superestima" if metricas["vies"] > 0 else "subestima"
    print(f"  Vies................: {metricas['vies']:+.1%} ({sentido})")
    print(f"  Responder sempre 0% erraria, em media: {trivial:.1%}")
    print()
    print("  Fonte da referencia: Suicmez, Yilmaz e Kahraman (2026), v2.1,")
    print("  DOI 10.5281/zenodo.22062459, CC BY 4.0. Rotulos automaticos (indices de vegetacao).")

    return metricas
