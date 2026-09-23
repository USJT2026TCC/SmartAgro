"""
O laco do modulo de visao: pega lote pendente, analisa, devolve o resultado.

    backend ──lotes pendentes──► visao
            ──arquivos───────────►
            ◄──indice de dano + confianca + versao do modelo──

A versao do modelo vai junto do resultado e e gravada com a analise. Nao e
enfeite: sem ela, ninguem consegue dizer, seis meses depois, qual codigo
produziu o numero que pagou uma indenizacao (RNF20, RNF21).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

from . import baseline
from .clienteBackend import ClienteBackend, Lote, ResumoDivergente
from .indice import Analise, consolidar


@dataclass
class Estimador:
    """
    O que o servico precisa de um modelo.

    `classificar` recebe os bytes de uma imagem e devolve a contagem de pixels
    por classe e a confianca DAQUELA imagem. Qualquer implementacao serve — a
    heuristica de cor, um U-Net treinado, ou um modelo de satelite — desde que
    respeite esse contrato.
    """

    versao: str
    classificar: Callable[[bytes], tuple[dict[str, int], float]]


def estimador_baseline() -> Estimador:
    """Heuristica de cor, com a confianca fixa e deliberadamente baixa."""
    return Estimador(
        versao=baseline.VERSAO,
        classificar=lambda conteudo: (baseline.classificar(conteudo), baseline.CONFIANCA),
    )


def analisar_lote(cliente: ClienteBackend, lote: Lote, estimador: Estimador) -> Analise:
    """Baixa as imagens do lote, classifica cada uma e consolida."""
    contagens: list[dict[str, int]] = []
    confiancas: list[float] = []
    problemas: list[str] = []

    for imagem in lote.imagens:
        try:
            contagem, confianca = estimador.classificar(cliente.baixar(imagem))
            contagens.append(contagem)
            confiancas.append(confianca)
        except ResumoDivergente as erro:
            # Evidencia adulterada nao entra na conta, e o lote fica marcado: o
            # resumo que foi para a cadeia cobre este arquivo.
            problemas.append(str(erro))
        except Exception as erro:  # arquivo corrompido, formato inesperado
            problemas.append(f"imagem {imagem.id}: {erro}")

    confianca_do_modelo = sum(confiancas) / len(confiancas) if confiancas else 0.0
    analise = consolidar(contagens, confianca_do_modelo)

    if problemas:
        analise.observacoes.extend(problemas)
        # Cada arquivo perdido e um pedaco da evidencia que nao foi analisado.
        analise.confianca = round(analise.confianca * 0.5, 4)

    return analise


def processar_pendentes(
    cliente: ClienteBackend, estimador: Estimador | None = None, registrar=print
) -> int:
    """Analisa todos os lotes pendentes. Devolve quantos foram processados."""
    estimador = estimador or estimador_baseline()
    processados = 0

    for lote in cliente.pendentes():
        analise = analisar_lote(cliente, lote, estimador)
        resposta = cliente.enviar_resultado(analise.para_api(estimador.versao, lote.id))
        processados += 1

        destino = (
            "encaminhada ao perito"
            if resposta.get("analise", {}).get("encaminhadaAoPerito")
            else "liberada para o oraculo"
        )

        registrar(
            f"lote {lote.id[:8]} ({lote.talhao}, {lote.cultura}): "
            f"dano {analise.indice_dano:.1%}, confianca {analise.confianca:.0%}, "
            f"{analise.imagens} imagem(ns) — {destino}"
        )

        for observacao in analise.observacoes:
            registrar(f"    - {observacao}")

    return processados


def servir(
    cliente: ClienteBackend,
    estimador: Estimador | None = None,
    intervalo_s: int = 60,
    uma_vez: bool = False,
    registrar=print,
) -> None:
    """Laco continuo. Falha de rede nao derruba o servico: espera e tenta de novo."""
    while True:
        try:
            if processar_pendentes(cliente, estimador, registrar) == 0:
                registrar("nenhum lote pendente")
        except Exception as erro:
            registrar(f"ciclo falhou: {erro}")

        if uma_vez:
            return

        time.sleep(intervalo_s)
