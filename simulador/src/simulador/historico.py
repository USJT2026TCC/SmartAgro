"""
Historico de chuva diaria por estacao, para a cotacao (RF06).

A cotacao precisa responder "nos ultimos N anos, quantas vezes esta condicao
teria acionado?". Para isso basta a chuva de cada dia, e nao a serie horaria
inteira: de ~100 MB por ano no ZIP do INMET sobram algumas dezenas de KB por
estacao, pequenos o bastante para ir para o repositorio junto com o backend.

Fonte: INMET, Banco de Dados Meteorologicos, https://portal.inmet.gov.br/dadoshistoricos
"""

from __future__ import annotations

import csv
import zipfile
from pathlib import Path

from .inmet import abrir_do_zip, baixar_ano
from .serie import resumo_diario

COLUNAS = ("estacao", "data", "chuva_mm", "horas_validas")


def dias_do_ano(caminho_zip: Path, codigo: str) -> list[dict]:
    """Chuva e horas validas de cada dia de uma estacao, em um ano."""
    try:
        _, leituras = abrir_do_zip(caminho_zip, codigo)
    except (FileNotFoundError, KeyError, ValueError, zipfile.BadZipFile):
        # A estacao nao existia naquele ano, ou nao mandou arquivo.
        return []

    dias = resumo_diario(leituras)

    return [
        {
            "estacao": codigo,
            "data": f"{chave // 10000:04d}-{chave // 100 % 100:02d}-{chave % 100:02d}",
            "chuva_mm": round(dia["chuva_mm"], 1),
            "horas_validas": dia["horas"],
        }
        for chave, dia in sorted(dias.items())
    ]


def gerar(
    anos: list[int],
    estacoes: list[str],
    pasta_dos_zips: Path,
    saida: Path,
    apagar_zip: bool = False,
    aviso=print,
) -> int:
    """Baixa os anos que faltam, extrai as estacoes e grava o CSV. Devolve as linhas."""
    linhas: list[dict] = []

    for ano in anos:
        caminho = pasta_dos_zips / f"{ano}.zip"
        ja_existia = caminho.exists()

        try:
            baixar_ano(ano, caminho)
        except Exception as erro:  # noqa: BLE001 - um ano que falha nao derruba os outros
            aviso(f"  {ano}: nao foi possivel baixar ({erro})")
            continue

        for codigo in estacoes:
            dias = dias_do_ano(caminho, codigo)
            linhas.extend(dias)
            aviso(f"  {ano} {codigo}: {len(dias)} dias com medicao")

        # So apaga o que este comando baixou: o ZIP de 2024 da demonstracao fica.
        if apagar_zip and not ja_existia:
            caminho.unlink(missing_ok=True)

    saida.parent.mkdir(parents=True, exist_ok=True)
    with saida.open("w", newline="", encoding="utf-8") as arquivo:
        escritor = csv.DictWriter(arquivo, fieldnames=COLUNAS)
        escritor.writeheader()
        escritor.writerows(sorted(linhas, key=lambda l: (l["estacao"], l["data"])))

    return len(linhas)
