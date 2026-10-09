"""
Envio dos lotes assinados para a API do AgroSmart.

O lote e montado, serializado UMA vez, assinado sobre esses bytes e enviado sem
reserializar. Qualquer biblioteca que "ajude" reserializando o JSON quebraria a
assinatura — por isso o corpo vai como `data=`, e nao como `json=`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import requests

from .assinatura import assinar, corpo_em_bytes
from .inmet import Leitura
from .serie import em_lotes, para_api


@dataclass
class Resultado:
    """O que a API respondeu sobre um lote."""

    aceitas: int
    recusadas: int
    duplicadas: int
    escore: float | None
    erro: str | None = None


def montar_lote(fonte: str, leituras: list[Leitura]) -> dict:
    """Corpo do POST /api/leituras."""
    return {
        "lote": str(uuid.uuid4()),
        "fonte": fonte,
        "enviadoEm": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "leituras": [para_api(leitura) for leitura in leituras],
    }


def enviar_lote(
    api: str,
    fonte: str,
    leituras: list[Leitura],
    chave_privada: str,
    tempo_limite: int = 60,
    tls_ca: str | None = None,
) -> Resultado:
    """
    Assina e envia um unico lote.

    Com a API em https, o certificado do servidor e sempre conferido (RNF17):
    contra as autoridades do sistema, ou contra `tls_ca` quando o servidor usa
    um certificado de autoridade propria, como o de desenvolvimento. Nao ha
    opcao para desligar a conferencia — um canal cifrado com quem nao se sabe
    quem e nao protege nada.
    """
    corpo = corpo_em_bytes(montar_lote(fonte, leituras))

    resposta = requests.post(
        f"{api.rstrip('/')}/leituras",
        data=corpo,
        headers={
            "Content-Type": "application/json",
            "X-Assinatura": assinar(corpo, chave_privada),
        },
        timeout=tempo_limite,
        verify=tls_ca or True,
    )

    dados = {}
    try:
        dados = resposta.json()
    except ValueError:
        pass

    if not resposta.ok:
        mensagem = dados.get("erro", {}).get("mensagem") if dados else resposta.text[:200]
        return Resultado(0, 0, 0, None, erro=f"HTTP {resposta.status_code}: {mensagem}")

    return Resultado(
        aceitas=dados.get("aceitas", 0),
        recusadas=dados.get("recusadas", 0),
        duplicadas=dados.get("duplicadas", 0),
        escore=dados.get("escore"),
    )


def enviar_serie(
    api: str, fonte: str, leituras: list[Leitura], chave_privada: str
) -> list[Resultado]:
    """Divide a serie em lotes do tamanho aceito e envia cada um."""
    return [enviar_lote(api, fonte, lote, chave_privada) for lote in em_lotes(leituras)]


def enviar_cadenciado(lotes, enviar, intervalo_s: float, dormir=None, ao_enviar=None) -> list:
    """
    Envia um lote por vez, esperando `intervalo_s` entre eles (HU04, criterio 1).

    Com intervalo zero, e o envio em rajada de sempre. Com intervalo, o simulador
    se comporta como uma estacao em campo, que transmite de tempos em tempos —
    e a tela do aplicativo e o oraculo veem os dados chegando aos poucos.
    """
    import time

    dormir = dormir or time.sleep
    resultados = []

    for indice, lote in enumerate(lotes):
        if indice > 0 and intervalo_s > 0:
            dormir(intervalo_s)
        resultado = enviar(lote)
        resultados.append(resultado)
        if ao_enviar:
            ao_enviar(indice + 1, lote, resultado)

    return resultados
