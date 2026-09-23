"""
Conversa com o backend do AgroSmart.

O modulo de visao e um servico, como o oraculo: autentica com a chave de
servico, pergunta o que ha para analisar, baixa as imagens e devolve o
resultado. Nao tem sessao de usuario e nao tem chave privada de carteira —
nada do que ele faz move valor diretamente.

CONFERENCIA DO RESUMO DA IMAGEM

Cada imagem baixada e conferida contra o `sha256` que o backend registrou. O
resumo do lote inteiro ja foi para a cadeia quando o lote foi fechado; analisar
um arquivo diferente do que gerou aquele resumo produziria um indice que nao
corresponde a evidencia registrada, e a reexecucao da analise — que e o que o
RNF21 promete — daria outro numero.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import requests


@dataclass
class Imagem:
    id: str
    sha256: str
    tipo: str
    lon: float
    lat: float
    capturada_em: str


@dataclass
class Lote:
    id: str
    talhao: str
    cultura: str
    hash_evidencias: str
    imagens: list[Imagem]


class ResumoDivergente(Exception):
    """O arquivo baixado nao corresponde ao resumo registrado da evidencia."""


class ClienteBackend:
    def __init__(self, url: str, chave_de_servico: str, tempo_limite: int = 60):
        self.url = url.rstrip("/")
        self.tempo_limite = tempo_limite
        self.sessao = requests.Session()
        self.sessao.headers.update({"X-Chave-De-Servico": chave_de_servico})

    def pendentes(self) -> list[Lote]:
        """Lotes fechados que ainda nao foram analisados."""
        resposta = self.sessao.get(f"{self.url}/visao/pendentes", timeout=self.tempo_limite)
        resposta.raise_for_status()

        lotes = []
        for bruto in resposta.json().get("lotes", []):
            lotes.append(
                Lote(
                    id=bruto["id"],
                    talhao=bruto.get("talhao", "?"),
                    cultura=bruto.get("cultura", "?"),
                    hash_evidencias=bruto.get("hash_evidencias", ""),
                    imagens=[
                        Imagem(
                            id=i["id"],
                            sha256=i["sha256"],
                            tipo=i.get("tipo", ""),
                            lon=i.get("lon", 0.0),
                            lat=i.get("lat", 0.0),
                            capturada_em=i.get("capturadaEm", ""),
                        )
                        for i in (bruto.get("imagens") or [])
                    ],
                )
            )

        return lotes

    def baixar(self, imagem: Imagem) -> bytes:
        """Baixa o arquivo e confere o resumo antes de devolver."""
        resposta = self.sessao.get(
            f"{self.url}/visao/imagens/{imagem.id}/arquivo", timeout=self.tempo_limite
        )
        resposta.raise_for_status()

        if hashlib.sha256(resposta.content).hexdigest() != imagem.sha256:
            raise ResumoDivergente(f"imagem {imagem.id}: o arquivo nao corresponde ao sha256")

        return resposta.content

    def enviar_resultado(self, corpo: dict) -> dict:
        """POST /visao/resultados — o unico ponto em que o resultado entra no sistema."""
        resposta = self.sessao.post(
            f"{self.url}/visao/resultados", json=corpo, timeout=self.tempo_limite
        )
        resposta.raise_for_status()

        return resposta.json()
