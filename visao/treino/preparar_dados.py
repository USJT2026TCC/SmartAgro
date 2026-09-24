"""
Prepara a base de imagens para treino e avaliacao.

FONTE (ver docs/DADOS.md, secao 2.1)

    SUICMEZ, C.; YILMAZ, C.; KAHRAMAN, H. T. UAV-Based Multispectral Maize
    Dataset for Water Stress 2025 and Common Rust 2025 Detection: Full Dataset
    with Source Orthomosaics. Zenodo, v2.1, 2026.
    DOI 10.5281/zenodo.22062459 — licenca CC BY 4.0.

    Arquivo usado: 02_processed_patches.zip (571 MB).

POR QUE A v2.1, E NAO O SUBCONJUNTO v1.0

As mascaras da base sao pseudo-rotulos: geradas automaticamente por indices de
vegetacao que usam infravermelho e red-edge. Na v1.0, esses indices foram
calculados com as duas bandas trocadas, e 56% da lavoura saia rotulada como
estresse. Na v2.1, com as bandas corretas, sao 5,8%. O primeiro treino aprendeu
o rotulo errado (DECISOES.md 2.22).

SO O VOO DO ESTRESSE HIDRICO

A base tem dois voos, um para estresse hidrico e outro para ferrugem. Doenca
esta fora do escopo do trabalho, e o voo da ferrugem ensinou o modelo a
reconhecer o VOO em vez da lesao (DECISOES.md 2.21). Entra so `water_2025/`.

RGB PELAS BANDAS NOMEADAS

A ordem verificada das bandas no `.npy` e azul, verde, vermelho, red-edge,
infravermelho e alfa. O `.jpg` da base grava as bandas 0, 1 e 2 como se fossem
vermelho, verde e azul — ou seja, com vermelho e azul trocados. Aqui o RGB e
montado pelas bandas pelo NOME, e o `.jpg` nao e usado.

AS MASCARAS SAEM JA NA ORDEM DO AGROSMART

    base (water_2025)   0 solo   1 estresse leve    2 estresse severo   3 saudavel
    AgroSmart           0 solo   1 saudavel         2 estresse_leve     3 estresse_severo

A traducao e feita uma vez, aqui. Treino e avaliacao leem as mascaras prontas,
sem mapa proprio — quatro copias do mesmo mapa eram quatro lugares para errar.

DIVISAO ENTRE TREINO E VALIDACAO

Espacial, por faixas verticais de 512 px alternadas: uma faixa a cada quatro
vai para a validacao. O estresse nao se espalha por igual no talhao (vai de
0,3% a 9,7% conforme a regiao), e cortar o talhao em dois pedacos poria na
validacao uma regiao so. Com faixas alternadas, a validacao ve o talhao todo, e
recortes vizinhos continuam do mesmo lado na maior parte dos casos.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parents[1]
ZIP_PADRAO = RAIZ / "dados" / "v2.1" / "02_processed_patches.zip"
DESTINO_PADRAO = RAIZ / "dados" / "preparado"

PASTA = "water_2025"

# Indices verificados na v2.1 (band_info.json da propria base).
VERMELHO, VERDE, AZUL = 2, 1, 0

# O que a base declara em water_2025/meta/class_map.json. Conferido na leitura:
# se uma versao futura reordenar as classes, o preparo para aqui, em vez de
# produzir mascaras trocadas que ninguem notaria.
CLASSES_DA_BASE = {"soil": 0, "low_stress": 1, "high_stress": 2, "healthy": 3}

# base -> AgroSmart (solo, saudavel, estresse_leve, estresse_severo)
MAPA_DE_CLASSES = {0: 0, 1: 2, 2: 3, 3: 1}

LARGURA_DA_FAIXA = 512
FAIXAS_POR_CICLO = 4  # 1 de cada 4 faixas vai para a validacao


def divisao_de(x0: int) -> str:
    return "validacao" if (x0 // LARGURA_DA_FAIXA) % FAIXAS_POR_CICLO == FAIXAS_POR_CICLO - 1 else "treino"


def conferir_classes(arquivo: zipfile.ZipFile) -> None:
    declarado = json.loads(arquivo.read(f"{PASTA}/meta/class_map.json"))["class_map"]

    if declarado != CLASSES_DA_BASE:
        raise SystemExit(
            f"A base declara outra ordem de classes: {declarado}.\n"
            f"Este preparo foi escrito para {CLASSES_DA_BASE}. Revise MAPA_DE_CLASSES."
        )


def rgb_do_npy(bandas: np.ndarray) -> np.ndarray:
    """Monta o RGB pelas bandas nomeadas, em uint8."""
    rgb = np.stack([bandas[:, :, VERMELHO], bandas[:, :, VERDE], bandas[:, :, AZUL]], axis=-1)

    return (np.clip(rgb.astype(np.float32), 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def traduzir(mascara: np.ndarray) -> np.ndarray:
    saida = np.zeros_like(mascara, dtype=np.uint8)

    for origem, destino in MAPA_DE_CLASSES.items():
        saida[mascara == origem] = destino

    return saida


def preparar(caminho_zip: Path, destino: Path) -> dict[str, dict]:
    (destino / "images").mkdir(parents=True, exist_ok=True)
    (destino / "masks").mkdir(parents=True, exist_ok=True)

    resumo = {d: {"recortes": 0, "com_lavoura": 0, "dano": []} for d in ("treino", "validacao")}

    with zipfile.ZipFile(caminho_zip) as arquivo:
        conferir_classes(arquivo)

        texto = arquivo.read(f"{PASTA}/meta/patches.csv").decode("utf-8-sig")
        registros = list(csv.DictReader(io.StringIO(texto)))

        with (destino / "indice.csv").open("w", newline="", encoding="utf-8") as saida:
            escritor = csv.writer(saida)
            escritor.writerow(["divisao", "grupo", "imagem", "mascara", "y", "x", "lavoura", "dano"])

            for registro in registros:
                identificador = registro["id"]

                bandas = np.load(io.BytesIO(arquivo.read(f"{PASTA}/images/{identificador}.npy")))
                bruta = np.asarray(
                    Image.open(io.BytesIO(arquivo.read(f"{PASTA}/masks/{identificador}.png")))
                )
                mascara = traduzir(bruta)

                Image.fromarray(rgb_do_npy(bandas)).save(destino / "images" / f"{identificador}.png")
                Image.fromarray(mascara).save(destino / "masks" / f"{identificador}.png")

                # Fracao de lavoura e dano de referencia, gravados para que a
                # avaliacao possa separar os recortes em que o indice significa
                # alguma coisa (ver indice.COBERTURA_MINIMA).
                contagem = np.bincount(mascara.ravel(), minlength=4) / mascara.size
                lavoura = float(contagem[1] + contagem[2] + contagem[3])
                dano = float((0.5 * contagem[2] + contagem[3]) / lavoura) if lavoura > 0 else 0.0

                x0, y0 = int(registro["x0"]), int(registro["y0"])
                divisao = divisao_de(x0)

                escritor.writerow(
                    [divisao, "water", f"{identificador}.png", f"{identificador}.png",
                     y0, x0, round(lavoura, 4), round(dano, 4)]
                )

                resumo[divisao]["recortes"] += 1
                if lavoura >= 0.10:
                    resumo[divisao]["com_lavoura"] += 1
                    resumo[divisao]["dano"].append(dano)

    return resumo


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepara a base de imagens para o treino")
    parser.add_argument("--zip", type=Path, default=ZIP_PADRAO)
    parser.add_argument("--destino", type=Path, default=DESTINO_PADRAO)
    opcoes = parser.parse_args()

    if not opcoes.zip.exists():
        raise SystemExit(
            f"Base nao encontrada em {opcoes.zip}.\n"
            "Baixe 02_processed_patches.zip de https://doi.org/10.5281/zenodo.22062459 (CC BY 4.0)."
        )

    resumo = preparar(opcoes.zip, opcoes.destino)

    print(f"Preparado em {opcoes.destino}")
    for divisao, dados in resumo.items():
        media = sum(dados["dano"]) / len(dados["dano"]) if dados["dano"] else 0.0
        print(
            f"  {divisao:10} {dados['recortes']:4d} recortes, {dados['com_lavoura']:4d} com lavoura, "
            f"dano medio de referencia {media:.1%}"
        )
    print("RGB montado pelas bandas nomeadas (vermelho=2, verde=1, azul=0); o .jpg da base nao e usado.")
    print("Fonte: Suicmez, Yilmaz e Kahraman (2026), v2.1, DOI 10.5281/zenodo.22062459, CC BY 4.0")


if __name__ == "__main__":
    main()
