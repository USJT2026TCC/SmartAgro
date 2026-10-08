"""
API HTTP do modulo de visao, em FastAPI (secao 5.3 da documentacao de software).

    GET  /saude      o servico esta de pe, e com qual modelo
    GET  /modelo     versao e resumo SHA-256 dos pesos (RNF19)
    POST /analisar   imagens -> indice de dano, confianca e o que pesou (RF15, RF16)

Ha dois jeitos de usar o mesmo estimador:

 - o `servico`, que busca no backend os lotes fechados e devolve os resultados.
   E o caminho de producao: o backend guarda o resumo das evidencias, e a
   analise e gravada junto da versao do modelo;
 - esta API, para quem quiser submeter imagens direto — o perito reexaminando
   uma contestacao (RF28), ou alguem reproduzindo um resultado com a mesma
   versao (HU11, criterio 4).

Os dois chamam exatamente as mesmas funcoes (`Estimador.classificar` e
`consolidar`). Uma API que calculasse "parecido" com o servico seria uma
segunda fonte de verdade para o mesmo numero.
"""

from __future__ import annotations

import hashlib

from fastapi import FastAPI, File, HTTPException, UploadFile

from .indice import CLASSES, PESOS_PADRAO, consolidar
from .servico import Estimador

# O mesmo teto do RNF02: um lote de ate 50 imagens.
MAXIMO_DE_IMAGENS = 50
MAXIMO_DE_BYTES_POR_IMAGEM = 15 * 1024 * 1024

# Assinaturas dos formatos aceitos, conferidas nos bytes e nao no nome do arquivo.
ASSINATURAS = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n")


def resumo_dos_pesos(caminho) -> str | None:
    """SHA-256 do arquivo de pesos: identifica o modelo sem depender do nome da versao."""
    try:
        with open(caminho, "rb") as arquivo:
            return hashlib.sha256(arquivo.read()).hexdigest()
    except (OSError, TypeError):
        return None


def criar_api(estimador: Estimador, caminho_dos_pesos=None) -> FastAPI:
    app = FastAPI(
        title="AgroSmart - visao computacional",
        description="Indice de dano da lavoura a partir de imagens do talhao (RF15, RF16).",
        version="1.0.0",
    )
    hash_dos_pesos = resumo_dos_pesos(caminho_dos_pesos)

    @app.get("/saude")
    def saude():
        return {"situacao": "ok", "modelo": estimador.versao}

    @app.get("/modelo")
    def modelo():
        return {
            "versao": estimador.versao,
            "resumoDosPesos": hash_dos_pesos,
            "classes": list(CLASSES),
            "pesosDoIndice": PESOS_PADRAO,
        }

    @app.post("/analisar")
    async def analisar(imagens: list[UploadFile] = File(...)):
        if len(imagens) > MAXIMO_DE_IMAGENS:
            raise HTTPException(413, f"No maximo {MAXIMO_DE_IMAGENS} imagens por lote.")

        contagens, confiancas, resumos, problemas = [], [], [], []

        for arquivo in imagens:
            conteudo = await arquivo.read(MAXIMO_DE_BYTES_POR_IMAGEM + 1)

            if len(conteudo) > MAXIMO_DE_BYTES_POR_IMAGEM:
                problemas.append(f"{arquivo.filename}: maior que 15 MB, ignorada")
                continue
            if not conteudo.startswith(ASSINATURAS):
                problemas.append(f"{arquivo.filename}: nao e JPEG nem PNG, ignorada")
                continue

            try:
                contagem, confianca = estimador.classificar(conteudo)
            except Exception as erro:  # imagem corrompida
                problemas.append(f"{arquivo.filename}: {erro}")
                continue

            contagens.append(contagem)
            confiancas.append(confianca)
            resumos.append(hashlib.sha256(conteudo).hexdigest())

        if not contagens:
            raise HTTPException(422, {"mensagem": "Nenhuma imagem analisavel.", "problemas": problemas})

        analise = consolidar(contagens, sum(confiancas) / len(confiancas))
        if problemas:
            analise.observacoes.extend(problemas)

        return {
            "versaoModelo": estimador.versao,
            "resumoDosPesos": hash_dos_pesos,
            "imagens": analise.imagens,
            "indiceDanoBps": round(analise.indice_dano * 10_000),
            "confiancaBps": round(analise.confianca * 10_000),
            "coberturaDeLavoura": analise.cobertura_de_lavoura,
            "resumosDasImagens": resumos,
            "observacoes": analise.observacoes,
        }

    return app
