"""
Validacao externa: o modelo treinado em milho por drone, em fotos de soja no campo.

POR QUE ESTE TESTE

O modelo foi treinado num voo de drone multiespectral sobre milho
(Suicmez et al., v2.1). O aplicativo recebe fotos RGB de soja. Ate aqui, a
diferenca entre os dois era so uma ressalva escrita. Este script a mede.

A BASE

BANERJEE, S. et al. Study of Leaf Wilt in Soybean Plants. Zenodo, 2023.
DOI 10.5281/zenodo.8256382 — CC BY 4.0. Artigo: Agriculture, v. 15, n. 6,
art. 614, 2025. 1.892 fotos RGB de parcelas de soja no campo (Carolina do
Norte, ago-set de 2019), de cameras fixas, cada uma com uma nota de murcha
dada por especialistas (0 = sem murcha; no arquivo, a escala vai ate 5).

O QUE ESPERAR, ANTES DE OLHAR O RESULTADO

Murcha e area afetada nao sao a mesma medida. A murcha e a postura da folha
(perde turgor, cai, vira), e acontece todo dia no calor da tarde, mesmo sem
seca: na base, a nota media sobe de 0 as 6h para cerca de 2 as 16h. O nosso
modelo mede COR — folha amarelada ou seca, pixel a pixel. Uma folha murcha e
ainda verde nao muda de cor. Por isso:

  - a correlacao com a nota e o teste certo, e nao a igualdade;
  - a correlacao precisa ser medida tambem dentro do mesmo horario, para nao
    confundir o calor do dia com o estresse da lavoura.

Uso:
    python treino/validar_soja_murcha.py --pesos pesos/unet.pt
"""

from __future__ import annotations

import argparse
import csv
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
from calibrar_confianca import spearman

from visao import baseline
from visao.indice import indice_de_dano
from visao.modelo import classificar_com
from visao.rede import carregar

RAIZ = Path(__file__).resolve().parents[1]
PASTA = RAIZ / "dados" / "externos" / "soja-murcha"


def hora_de(nome: str) -> int:
    """`3-106_12_08_2019_06_30_40.jpg` -> 6 (camera-parcela_dia_mes_ano_hora_min_seg)."""
    return int(Path(nome).stem.split("_")[4])


def ler_anotacoes(caminho: Path) -> dict[str, int]:
    with caminho.open(encoding="utf-8-sig") as arquivo:
        return {linha["fullID"]: int(linha["Annotation"]) for linha in csv.DictReader(arquivo)}


def avaliar(nome: str, classificar, imagens: dict[str, bytes], notas: dict[str, int]) -> list:
    resultados = []
    for arquivo, conteudo in imagens.items():
        contagem, confianca = classificar(conteudo)
        resultados.append(
            {
                "arquivo": arquivo,
                "nota": notas[arquivo],
                "hora": hora_de(arquivo),
                "indice": indice_de_dano(contagem),
                "confianca": confianca,
            }
        )

    indices = [r["indice"] for r in resultados]
    nota = [r["nota"] for r in resultados]

    print(f"\n{nome} — {len(resultados)} fotos")
    print(f"  correlacao indice x nota, todas as fotos......: {spearman(indices, nota):+.2f}")

    por_hora = defaultdict(list)
    for r in resultados:
        por_hora[r["hora"]].append(r)

    dentro = []
    for hora, grupo in sorted(por_hora.items()):
        if len(grupo) >= 30 and len({r["nota"] for r in grupo}) > 1:
            rho = spearman([r["indice"] for r in grupo], [r["nota"] for r in grupo])
            dentro.append((hora, len(grupo), rho))
    if dentro:
        media = sum(n * rho for _, n, rho in dentro) / sum(n for _, n, _ in dentro)
        print(f"  correlacao dentro do mesmo horario (media)....: {media:+.2f}")
        print("    por hora: " + ", ".join(f"{h}h {rho:+.2f} (n={n})" for h, n, rho in dentro))

    print("  indice medio por nota de murcha:")
    for valor in sorted({r["nota"] for r in resultados}):
        grupo = [r["indice"] for r in resultados if r["nota"] == valor]
        print(f"    nota {valor}: {np.mean(grupo):6.1%}  (n={len(grupo)})")

    return resultados


def main() -> None:
    parser = argparse.ArgumentParser(description="Validacao externa em soja com nota de murcha")
    parser.add_argument("--pesos", type=Path, required=True)
    parser.add_argument("--pasta", type=Path, default=PASTA)
    opcoes = parser.parse_args()

    notas = ler_anotacoes(opcoes.pasta / "dataAnns_goodFiles.csv")

    imagens = {}
    with zipfile.ZipFile(opcoes.pasta / "full_data.zip") as arquivo:
        for info in arquivo.infolist():
            nome = Path(info.filename).name
            if nome in notas:
                imagens[nome] = arquivo.read(info)

    faltando = len(notas) - len(imagens)
    print(
        f"Fotos anotadas: {len(notas)} | encontradas no zip: {len(imagens)} | faltando: {faltando}"
    )

    modelo, versao = carregar(opcoes.pesos)
    modelo.eval()
    resultados = avaliar(versao, lambda c: classificar_com(modelo, c), imagens, notas)
    avaliar(
        "heuristica de cor (referencia)",
        lambda c: (baseline.classificar(c), baseline.CONFIANCA),
        imagens,
        notas,
    )

    confiancas = [r["confianca"] for r in resultados]
    print(f"\nConfianca media do {versao} nestas fotos: {np.mean(confiancas):.1%}")
    print(
        f"Fotos acima do limiar de 70%: {sum(c >= 0.70 for c in confiancas)} de {len(confiancas)}"
    )

    saida = opcoes.pasta / f"resultado-{versao}.csv"
    with saida.open("w", newline="", encoding="utf-8") as arquivo:
        escritor = csv.DictWriter(arquivo, fieldnames=list(resultados[0].keys()))
        escritor.writeheader()
        escritor.writerows(resultados)
    print(f"Resultado foto a foto em {saida}")
    print("Fonte: Banerjee et al., Zenodo 10.5281/zenodo.8256382, CC BY 4.0")


if __name__ == "__main__":
    main()
