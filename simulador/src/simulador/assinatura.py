"""
Assinatura do lote de leituras (RNF19).

A API do AgroSmart so aceita um lote se ele vier assinado pela chave registrada
para aquela fonte. O formato esta especificado em docs/BACKEND.md, secao 5, e e
implementado tambem em JavaScript no backend — este modulo e o outro lado.

MENSAGEM ASSINADA (EIP-191, personal_sign)

    AgroSmart:leituras:v1
    sha256:<resumo hexadecimal dos bytes do corpo>

A assinatura cobre os BYTES QUE TRAFEGAM, e nao um JSON reconstruido. Python e
JavaScript serializam numeros de formas diferentes — `json.dumps(0.0)` produz
"0.0" onde o JavaScript produz "0" — e um lado nunca conseguiria reproduzir
exatamente o texto do outro. Assinando os bytes enviados, cada lado so precisa
calcular SHA-256 sobre o mesmo corpo.

A chave privada da estacao fica no `.env` do simulador, nunca no repositorio
(RNF16). Em campo, cada estacao guarda a sua.
"""

from __future__ import annotations

import hashlib
import json

from eth_account import Account
from eth_account.messages import encode_defunct

PREFIXO = "AgroSmart:leituras:v1"


def corpo_em_bytes(lote: dict) -> bytes:
    """Serializa o lote uma unica vez. E este resultado que e assinado e enviado."""
    return json.dumps(lote, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def mensagem(corpo: bytes) -> str:
    """Mensagem que a fonte assina para um corpo de requisicao."""
    return f"{PREFIXO}\nsha256:{hashlib.sha256(corpo).hexdigest()}"


def assinar(corpo: bytes, chave_privada: str) -> str:
    """Assinatura EIP-191 do corpo, no formato 0x... que vai no cabecalho."""
    assinada = Account.sign_message(encode_defunct(text=mensagem(corpo)), chave_privada)

    return assinada.signature.hex() if assinada.signature.hex().startswith("0x") else (
        "0x" + assinada.signature.hex()
    )


def endereco_de(chave_privada: str) -> str:
    """Endereco publico da fonte, que a seguradora cadastra no backend."""
    return Account.from_key(chave_privada).address
