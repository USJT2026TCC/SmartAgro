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
    api: str, fonte: str, leituras: list[Leitura], chave_privada: str, tempo_limite: int = 60
) -> Resultado:
    """Assina e envia um unico lote."""
    corpo = corpo_em_bytes(montar_lote(fonte, leituras))

    resposta = requests.post(
        f"{api.rstrip('/')}/leituras",
        data=corpo,
        headers={
            "Content-Type": "application/json",
            "X-Assinatura": assinar(corpo, chave_privada),
        },
        timeout=tempo_limite,
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
