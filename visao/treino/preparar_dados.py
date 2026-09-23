"""
Prepara a base do Zenodo para treino e avaliacao.

FONTE (ver docs/DADOS.md, secao 2.1)

    SUICMEZ, C.; YILMAZ, C.; KAHRAMAN, H. T. UAV-Based Multispectral Maize
    Dataset for Water Stress and Rust Detection. Zenodo, 2025.
    DOI 10.5281/zenodo.19385720 — licenca CC BY 4.0.

O que vem no ZIP, por amostra:

    images/<nome>.jpg    recorte RGB de 224x224
    images/<nome>.npy    mesmo recorte, 6 canais multiespectrais (float16)
    masks/<nome>.png     mascara de classes, um byte por pixel
    masks_viz/<nome>.png versao colorida, so para olhar

AS CLASSES DA BASE NAO ESTAO NA MESMA ORDEM DAS NOSSAS

    base           0 fundo/solo   1 estresse leve  2 estresse severo  3 saudavel  4 ferrugem
    AgroSmart      0 solo         1 saudavel       2 estresse_leve    3 estresse_severo  4 outro_dano

A ordem do AgroSmart e a de `visao/indice.py`, e existe porque o indice de dano
pondera as classes. Traduzir aqui, uma vez, evita que a confusao apareca depois
como um indice de dano trocado — que ninguem notaria, porque continuaria sendo
um numero plausivel entre 0 e 1.

DIVISAO ENTRE TREINO E VALIDACAO

Os recortes vem de poucos voos sobre os mesmos talhoes. Sortear recorte a
recorte colocaria pedacos vizinhos da MESMA lavoura nos dois lados, e o modelo
seria avaliado sobre terra que ele ja viu — com metrica boa e sem valor. A
divisao e, por isso, ESPACIAL: recortes a esquerda de um corte em x vao para
treino, os da direita para validacao.
"""

from __future__ import annotations

import argparse
import csv
import re
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
ZIP_PADRAO = RAIZ / "dados" / "milho-estresse-hidrico.zip"
DESTINO_PADRAO = RAIZ / "dados" / "preparado"

# base -> AgroSmart
MAPA_DE_CLASSES = {0: 0, 1: 2, 2: 3, 3: 1, 4: 4}

# Nome do recorte: ..._y3360_x896_t224
COORDENADAS = re.compile(r"_y(\d+)_x(\d+)_t\d+$")


def coordenadas_do_recorte(nome: str) -> tuple[int, int]:
    achado = COORDENADAS.search(Path(nome).stem)

    if not achado:
        return (0, 0)

    return (int(achado.group(1)), int(achado.group(2)))


def extrair(caminho_zip: Path, destino: Path) -> Path:
    """Extrai imagens e mascaras, se ainda nao estiverem extraidas."""
    destino.mkdir(parents=True, exist_ok=True)
    marca = destino / ".extraido"

    if marca.exists():
        return destino

    with zipfile.ZipFile(caminho_zip) as arquivo:
        for nome in arquivo.namelist():
            partes = nome.split("/")
            if len(partes) < 2:
                continue

            pasta, arquivo_nome = partes[-2], partes[-1]
            if pasta not in ("images", "masks") or not arquivo_nome:
                continue
            if arquivo_nome.endswith(".npy"):
                continue  # o treino usa RGB; ver o cabecalho de treinar.py

            alvo = destino / pasta / arquivo_nome
            alvo.parent.mkdir(parents=True, exist_ok=True)
            alvo.write_bytes(arquivo.read(nome))

    marca.write_text("ok", encoding="utf-8")

    return destino


def dividir(destino: Path, fracao_de_validacao: float = 0.25) -> dict[str, int]:
    """
    Gera `indice.csv` com a divisao espacial entre treino e validacao.

    O corte em x e escolhido pelo quantil, e nao por um valor fixo, para que a
    proporcao saia como pedida mesmo se a base mudar de tamanho.
    """
    imagens = sorted((destino / "images").glob("*.jpg"))
    mascaras = {m.stem: m for m in (destino / "masks").glob("*.png")}

    pares = [(i, mascaras[i.stem]) for i in imagens if i.stem in mascaras]
    if not pares:
        raise SystemExit("Nenhum par imagem/mascara encontrado. O ZIP foi extraido?")

    xs = sorted(coordenadas_do_recorte(i.name)[1] for i, _ in pares)
    corte = xs[int(len(xs) * (1 - fracao_de_validacao))]

    contagem = {"treino": 0, "validacao": 0}

    with (destino / "indice.csv").open("w", newline="", encoding="utf-8") as saida:
        escritor = csv.writer(saida)
        escritor.writerow(["divisao", "grupo", "imagem", "mascara", "y", "x"])

        for imagem, mascara in pares:
            y, x = coordenadas_do_recorte(imagem.name)
            divisao = "validacao" if x >= corte else "treino"
            grupo = "rust" if "__rust__" in imagem.name else "water"

            escritor.writerow([divisao, grupo, imagem.name, mascara.name, y, x])
            contagem[divisao] += 1

    return contagem


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepara a base de imagens para o treino")
    parser.add_argument("--zip", type=Path, default=ZIP_PADRAO)
    parser.add_argument("--destino", type=Path, default=DESTINO_PADRAO)
    parser.add_argument("--validacao", type=float, default=0.25)
    opcoes = parser.parse_args()

    if not opcoes.zip.exists():
        raise SystemExit(
            f"Base nao encontrada em {opcoes.zip}.\n"
            "Baixe de https://doi.org/10.5281/zenodo.19385720 (CC BY 4.0)."
        )

    destino = extrair(opcoes.zip, opcoes.destino)
    contagem = dividir(destino, opcoes.validacao)

    print(f"Preparado em {destino}")
    print(f"  treino....: {contagem['treino']} recortes")
    print(f"  validacao.: {contagem['validacao']} recortes (divisao espacial, por coluna)")
    print("Fonte: Suicmez, Yilmaz e Kahraman (2025), DOI 10.5281/zenodo.19385720, CC BY 4.0")


if __name__ == "__main__":
    main()
