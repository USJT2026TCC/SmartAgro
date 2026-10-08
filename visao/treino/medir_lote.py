"""
RNF02: tempo para analisar um lote de 50 fotos, pelo caminho de producao.

Monta um lote com as fotos de demonstracao (fotos de celular em tamanho real,
docs/demonstracao/fotos), repetidas ate o tamanho pedido, e envia tudo de uma
vez ao POST /analisar da API de visao. O tempo inclui o carregamento dos
pesos? Nao: a API carrega o modelo uma vez ao subir, como em producao, e o
que se mede e a analise do lote.

    python treino/medir_lote.py --pesos pesos/unet.pt --fotos 50
    python treino/medir_lote.py --fotos 50           # estimador classico
"""

from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
FOTOS = RAIZ.parent / "docs" / "demonstracao" / "fotos"


def main() -> None:
    parser = argparse.ArgumentParser(description="Mede o tempo de analise de um lote (RNF02)")
    parser.add_argument("--pesos", type=Path, default=None)
    parser.add_argument("--fotos", type=int, default=50)
    parser.add_argument("--repeticoes", type=int, default=3)
    opcoes = parser.parse_args()

    # O modulo modelo le VISAO_PESOS ao ser importado.
    if opcoes.pesos:
        os.environ["VISAO_PESOS"] = str(opcoes.pesos.resolve())

    from fastapi.testclient import TestClient

    from visao import modelo
    from visao.api import criar_api
    from visao.servico import Estimador, estimador_baseline

    if opcoes.pesos:
        rede, versao = modelo.carregar()
        estimador = Estimador(versao=versao, classificar=lambda c: modelo.classificar_com(rede, c))
    else:
        estimador = estimador_baseline()

    disponiveis = sorted(FOTOS.glob("*.jpg"))
    lote = [disponiveis[i % len(disponiveis)] for i in range(opcoes.fotos)]
    arquivos = [("imagens", (f.name, f.read_bytes(), "image/jpeg")) for f in lote]
    megabytes = sum(len(a[1][1]) for a in arquivos) / 1e6

    cliente = TestClient(criar_api(estimador, opcoes.pesos))
    tempos = []
    for _ in range(opcoes.repeticoes):
        inicio = time.perf_counter()
        resposta = cliente.post("/analisar", files=arquivos)
        tempos.append(time.perf_counter() - inicio)
        resposta.raise_for_status()

    corpo = resposta.json()
    print(f"Estimador..........: {estimador.versao}")
    print(f"Lote...............: {opcoes.fotos} fotos ({megabytes:.1f} MB, {len(disponiveis)} distintas)")
    print(f"Tempo por lote.....: {', '.join(f'{t:.1f} s' for t in tempos)}")
    print(f"Pior caso..........: {max(tempos):.1f} s (limite do RNF02: 600 s)")
    print(f"Por foto...........: {max(tempos) / opcoes.fotos:.2f} s")
    print(f"Indice de dano.....: {corpo.get('indiceDanoBps')} bps, confianca {corpo.get('confiancaBps')} bps")


if __name__ == "__main__":
    main()
