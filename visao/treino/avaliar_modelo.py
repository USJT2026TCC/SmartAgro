"""
Mede o modelo treinado com as MESMAS metricas e o MESMO recorte da linha de base.

POR QUE ESTE SCRIPT EXISTE

O treino reporta o erro do indice sobre a validacao inteira: 132 recortes de
estresse hidrico e 130 de ferrugem. Nos de ferrugem, o dano por seca verdadeiro
e zero, e acertar zero e facil — esses recortes puxam a media para baixo. A
linha de base, por outro lado, foi medida so nos de estresse hidrico.

Comparar os dois numeros seria comparar provas diferentes. Aqui o modelo faz a
mesma prova que a heuristica fez, e o resultado sai no mesmo formato.

Mede tambem a CONFUSAO COM DOENCA: quanto da lavoura dos recortes de estresse
hidrico o modelo chama de ferrugem. Doenca tem peso zero no indice de dano por
seca, entao cada pixel de estresse confundido com ferrugem some da conta — e um
jeito silencioso de subestimar o dano.

    python treino/avaliar_modelo.py --pesos pesos/unet.pt --grupo water
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from visao.indice import CLASSES, indice_de_dano
from visao.rede import carregar, padronizar

RAIZ = Path(__file__).resolve().parents[1]
PREPARADO = RAIZ / "dados" / "preparado"

# base -> AgroSmart (ver preparar_dados.py)
MAPA_DE_CLASSES = {0: 0, 1: 2, 2: 3, 3: 1, 4: 4}


def verdade(caminho: Path) -> np.ndarray:
    bruto = np.asarray(Image.open(caminho), dtype=np.int64)
    traduzido = np.zeros_like(bruto)

    for origem, destino in MAPA_DE_CLASSES.items():
        traduzido[bruto == origem] = destino

    return traduzido


def contar(mapa: np.ndarray) -> dict[str, int]:
    return {nome: int((mapa == i).sum()) for i, nome in enumerate(CLASSES)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Avalia o modelo treinado")
    parser.add_argument("--pesos", type=Path, default=RAIZ / "pesos" / "unet.pt")
    parser.add_argument("--dados", type=Path, default=PREPARADO)
    parser.add_argument("--divisao", default="validacao")
    parser.add_argument("--grupo", choices=("water", "rust", "todos"), default="water")
    opcoes = parser.parse_args()

    if not (opcoes.dados / "indice.csv").exists():
        raise SystemExit("Nao ha indice.csv. Rode treino/preparar_dados.py antes.")

    with (opcoes.dados / "indice.csv").open(encoding="utf-8") as arquivo:
        linhas = [l for l in csv.DictReader(arquivo) if l["divisao"] == opcoes.divisao]

    if opcoes.grupo != "todos":
        linhas = [l for l in linhas if l["grupo"] == opcoes.grupo]

    modelo, versao = carregar(opcoes.pesos)

    erros, estimados, verdadeiros = [], [], []
    lavoura_total = 0
    lavoura_como_doenca = 0

    for linha in linhas:
        imagem = Image.open(opcoes.dados / "images" / linha["imagem"]).convert("RGB")
        entrada = torch.from_numpy(np.asarray(imagem, dtype=np.float32) / 255.0).permute(2, 0, 1)

        with torch.no_grad():
            previsto = modelo(padronizar(entrada)[None]).argmax(dim=1)[0].numpy()

        referencia = verdade(opcoes.dados / "masks" / linha["mascara"])

        estimado = indice_de_dano(contar(previsto))
        real = indice_de_dano(contar(referencia))

        estimados.append(estimado)
        verdadeiros.append(real)
        erros.append(estimado - real)

        # Lavoura de verdade (nao solo, nao doenca) que o modelo chamou de doenca.
        lavoura = (referencia != CLASSES.index("solo")) & (referencia != CLASSES.index("outro_dano"))
        lavoura_total += int(lavoura.sum())
        lavoura_como_doenca += int((lavoura & (previsto == CLASSES.index("outro_dano"))).sum())

    absolutos = [abs(e) for e in erros]
    media = sum(erros) / len(erros)
    ordenados = sorted(absolutos)

    print(f"Modelo..............: {versao}")
    print(f"Recortes avaliados..: {len(linhas)} ({opcoes.divisao}, grupo {opcoes.grupo})")
    print(f"Dano medio real.....: {sum(verdadeiros) / len(verdadeiros):.1%}")
    print(f"Dano medio estimado.: {sum(estimados) / len(estimados):.1%}")
    print(f"Erro absoluto medio.: {sum(absolutos) / len(absolutos):.1%}")
    print(f"Erro mediano........: {ordenados[len(ordenados) // 2]:.1%}")
    print(f"Erro maximo.........: {max(absolutos):.1%}")
    print(f"Vies................: {media:+.1%} ({'superestima' if media > 0 else 'subestima'})")

    if lavoura_total:
        print(f"Lavoura lida como doenca: {lavoura_como_doenca / lavoura_total:.1%}")


if __name__ == "__main__":
    main()
