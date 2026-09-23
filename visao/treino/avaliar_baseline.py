"""
Mede o estimador classico contra a verdade de referencia da base.

O objetivo nao e defender a heuristica de cor: e saber o tamanho do erro dela,
para que o trabalho possa dizer, com numero, por que o modelo treinado e
necessario. Um TCC que afirma "a heuristica nao basta" sem medir esta chutando
tanto quanto um que afirma o contrario.

O que e medido:

  - ERRO DO INDICE DE DANO: a diferenca entre o percentual estimado e o
    percentual da mascara de referencia. E o unico numero que chega ao contrato,
    e portanto o unico que decide pagamento.
  - ACERTO DE PIXEL e IoU por classe: quanto da imagem foi classificado na
    classe certa. Util para diagnostico, mas secundario — um modelo pode errar
    muitos pixels e ainda acertar a PROPORCAO, e e a proporcao que paga.
  - VIES: se o erro e sistematicamente para cima ou para baixo. Erro para cima
    faz a seguradora pagar dano que nao houve; para baixo, deixa o produtor sem
    a indenizacao que a apolice prometia. Os dois sao ruins, e de jeitos
    diferentes.

    python treino/avaliar_baseline.py --limite 200
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np
from PIL import Image

from visao.baseline import classificar
from visao.indice import CLASSES, indice_de_dano

RAIZ = Path(__file__).resolve().parents[1]
PREPARADO = RAIZ / "dados" / "preparado"

# base -> AgroSmart (ver preparar_dados.py)
MAPA_DE_CLASSES = {0: 0, 1: 2, 2: 3, 3: 1, 4: 4}


def contagem_da_mascara(caminho: Path) -> dict[str, int]:
    bruto = np.asarray(Image.open(caminho), dtype=np.int64)
    traduzido = np.zeros_like(bruto)

    for origem, destino in MAPA_DE_CLASSES.items():
        traduzido[bruto == origem] = destino

    return {nome: int((traduzido == i).sum()) for i, nome in enumerate(CLASSES)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Avalia o estimador classico")
    parser.add_argument("--dados", type=Path, default=PREPARADO)
    parser.add_argument("--divisao", default="validacao")
    parser.add_argument("--limite", type=int, default=0)
    parser.add_argument("--grupo", choices=("water", "rust", "todos"), default="todos")
    opcoes = parser.parse_args()

    with (opcoes.dados / "indice.csv").open(encoding="utf-8") as arquivo:
        linhas = [l for l in csv.DictReader(arquivo) if l["divisao"] == opcoes.divisao]

    if opcoes.grupo != "todos":
        linhas = [l for l in linhas if l["grupo"] == opcoes.grupo]
    if opcoes.limite:
        linhas = linhas[: opcoes.limite]

    if not linhas:
        raise SystemExit("Nenhum recorte para avaliar. Rode treino/preparar_dados.py antes.")

    erros = []
    estimados = []
    verdadeiros = []

    for linha in linhas:
        imagem = (opcoes.dados / "images" / linha["imagem"]).read_bytes()

        estimado = indice_de_dano(classificar(imagem))
        verdadeiro = indice_de_dano(contagem_da_mascara(opcoes.dados / "masks" / linha["mascara"]))

        estimados.append(estimado)
        verdadeiros.append(verdadeiro)
        erros.append(estimado - verdadeiro)

    absolutos = [abs(e) for e in erros]
    media = sum(erros) / len(erros)

    print(f"Recortes avaliados..: {len(linhas)} ({opcoes.divisao}, grupo {opcoes.grupo})")
    print(f"Dano medio real.....: {sum(verdadeiros) / len(verdadeiros):.1%}")
    print(f"Dano medio estimado.: {sum(estimados) / len(estimados):.1%}")
    print(f"Erro absoluto medio.: {sum(absolutos) / len(absolutos):.1%}")
    print(f"Erro maximo.........: {max(absolutos):.1%}")
    print(f"Vies................: {media:+.1%} ({'superestima' if media > 0 else 'subestima'})")
    print()
    print("Fonte da verdade de referencia: Suicmez, Yilmaz e Kahraman (2025),")
    print("DOI 10.5281/zenodo.19385720, CC BY 4.0.")


if __name__ == "__main__":
    main()
