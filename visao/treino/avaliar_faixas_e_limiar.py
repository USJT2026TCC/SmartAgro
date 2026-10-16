"""
Dois pontos que ficaram em aberto na adocao do bat-resnet18-r3 (DECISOES.md 1.19):

1. ERRO POR FAIXA DE DANO. O erro medio de 2,6 pontos mistura os recortes de dano baixo,
   que sao a maioria. Os modelos anteriores subestimavam o dano alto (recortes com 10%
   ou mais: real 15,6%, estimado perto de 8%, VISAO.md 6.4). Aqui se mede o mesmo para
   o modelo em operacao, faixa por faixa.

2. CRITERIO 2 DA HU17. Os maiores erros ficam concentrados abaixo do limiar de confianca
   (70%, RF17)? Se nao ficam, a confianca nao serve para mandar ao perito justamente os
   lotes que erram mais.

A classificacao passa por `modelo.classificar_com`, o caminho do servico em producao,
com a confianca como o servico a calcula (sem calibrar, pixels de lavoura PREVISTOS).
Por isso a correlacao daqui pode diferir um pouco da de calibrar_confianca.py, que usa a
mascara de referencia para escolher os pixels.

    python treino/avaliar_faixas_e_limiar.py --pesos pesos/unet.pt
"""

from __future__ import annotations

import argparse
import csv
import hashlib
from pathlib import Path

import numpy as np
from avaliacao import PREPARADO, RAIZ, dano_de_referencia, recortes

from visao.indice import indice_de_dano
from visao.modelo import classificar_com
from visao.rede import carregar

LIMIAR = 0.70  # RF17
SHA_DOCUMENTADO = "2c428d64e907b70d2a2d878bc5101f439767f2caf2c4cdc2ac13deb28198bb55"
FAIXAS = [
    ("menos de 2%", 0.00, 0.02),
    ("2% a 5%", 0.02, 0.05),
    ("5% a 10%", 0.05, 0.10),
    ("10% a 20%", 0.10, 0.20),
    ("20% ou mais", 0.20, 10.0),
]
CSV_PADRAO = RAIZ.parent / "docs" / "resultados" / "visao-bateria-2026-10-15" / "faixas-e-limiar.csv"


def medir(modelo, lista) -> list[dict]:
    linhas = []
    for recorte in lista:
        contagem, confianca = classificar_com(modelo, recorte.imagem.read_bytes())
        linhas.append(
            {
                "imagem": recorte.imagem.name,
                "real": dano_de_referencia(recorte),
                "estimado": indice_de_dano(contagem),
                "confianca": confianca,
            }
        )
    return linhas


def resumo(nome: str, grupo: list[dict]) -> None:
    if not grupo:
        print(f"  {nome:<14}{0:>4}   sem recortes")
        return
    real = np.mean([g["real"] for g in grupo])
    estimado = np.mean([g["estimado"] for g in grupo])
    absoluto = np.mean([abs(g["estimado"] - g["real"]) for g in grupo])
    print(
        f"  {nome:<14}{len(grupo):>4}{real:>10.1%}{estimado:>10.1%}"
        f"{estimado - real:>+10.1%}{absoluto:>10.1%}"
    )


def por_faixa(titulo: str, linhas: list[dict]) -> None:
    print(f"ERRO POR FAIXA DE DANO REAL, {titulo} ({len(linhas)} recortes)")
    print(f"  {'faixa':<14}{'n':>4}{'real':>10}{'estimado':>10}{'vies':>10}{'erro abs.':>10}")
    for nome, minimo, maximo in FAIXAS:
        resumo(nome, [x for x in linhas if minimo <= x["real"] < maximo])
    resumo("10% ou mais", [x for x in linhas if x["real"] >= 0.10])
    resumo("todos", linhas)
    print("  vies negativo = subestima o dano.")
    print()


def spearman(a, b) -> float:
    ra = np.argsort(np.argsort(a))
    rb = np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def criterio_2(titulo: str, linhas: list[dict]) -> None:
    n = len(linhas)
    erros = np.array([abs(x["estimado"] - x["real"]) for x in linhas])
    confianca = np.array([x["confianca"] for x in linhas])
    abaixo = confianca < LIMIAR

    print(f"CRITERIO 2 DA HU17, {titulo} ({n} recortes)")
    print(
        f"  Confianca por foto: minima {confianca.min():.1%}, mediana {np.median(confianca):.1%}, "
        f"maxima {confianca.max():.1%}"
    )
    print(f"  Abaixo de {LIMIAR:.0%}: {int(abaixo.sum())} de {n}")
    if abaixo.any():
        print(f"  Erro medio abaixo do limiar..: {erros[abaixo].mean():.1%}")
    if (~abaixo).any():
        print(f"  Erro medio acima do limiar...: {erros[~abaixo].mean():.1%}")

    k = max(5, int(np.ceil(0.10 * n)))
    maiores = np.argsort(-erros)[:k]
    dentro = int(abaixo[maiores].sum())
    print(f"  Os {k} maiores erros, abaixo de {LIMIAR:.0%}: {dentro} de {k}")
    for i in maiores:
        marca = "abaixo" if abaixo[i] else "acima"
        print(f"    erro {erros[i]:.1%}  confianca {confianca[i]:.1%}  ({marca})")

    q = max(1, n // 4)
    menos = np.argsort(confianca)[:q]
    resto = np.setdiff1d(np.arange(n), menos)
    print(
        f"  O quarto menos confiante ({q} recortes): erro medio {erros[menos].mean():.1%}, "
        f"contra {erros[resto].mean():.1%} nos demais"
    )
    print(f"  Correlacao de postos, confianca x erro: {spearman(confianca, erros):+.2f}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Erro por faixa e criterio 2 da HU17")
    parser.add_argument("--pesos", type=Path, default=RAIZ / "pesos" / "unet.pt")
    parser.add_argument("--dados", type=Path, default=PREPARADO)
    parser.add_argument("--csv", type=Path, default=CSV_PADRAO)
    opcoes = parser.parse_args()

    sha = hashlib.sha256(opcoes.pesos.read_bytes()).hexdigest()
    modelo, versao = carregar(opcoes.pesos)
    print(f"Modelo...: {versao}")
    print(f"SHA-256..: {sha}")
    print(f"          {'igual' if sha == SHA_DOCUMENTADO else 'DIFERENTE'} ao documentado em DECISOES 1.19")
    print()

    todas = []
    for divisao, titulo in (("validacao", "validacao"), ("teste", "teste")):
        linhas = medir(modelo, recortes(opcoes.dados, divisao))
        todas += [{"divisao": divisao, **x} for x in linhas]
        por_faixa(titulo, linhas)
        criterio_2(titulo, linhas)

    opcoes.csv.parent.mkdir(parents=True, exist_ok=True)
    with opcoes.csv.open("w", newline="", encoding="utf-8") as arquivo:
        saida = csv.DictWriter(arquivo, fieldnames=["divisao", "imagem", "real", "estimado", "confianca"])
        saida.writeheader()
        saida.writerows(todas)
    print(f"Resultado por recorte gravado em {opcoes.csv}")


if __name__ == "__main__":
    main()
