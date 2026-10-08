"""
API HTTP do modulo de visao (FastAPI, secao 5.3).

Usa a heuristica de cor como estimador: o que se testa aqui e o contrato da
API — e que ela chega ao MESMO numero que o servico —, nao a qualidade do modelo.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from visao.api import MAXIMO_DE_IMAGENS, criar_api
from visao.indice import consolidar
from visao.servico import estimador_baseline

FOTOS = Path(__file__).resolve().parents[2] / "docs" / "demonstracao" / "fotos"


def cliente():
    return TestClient(criar_api(estimador_baseline()))


def foto(nome: str) -> tuple[str, bytes, str]:
    return (nome, (FOTOS / nome).read_bytes(), "image/jpeg")


def test_saude_e_modelo():
    c = cliente()

    assert c.get("/saude").json()["situacao"] == "ok"

    modelo = c.get("/modelo").json()
    assert modelo["classes"] == ["solo", "saudavel", "estresse_leve", "estresse_severo"]
    assert modelo["versao"] == estimador_baseline().versao


def test_analisa_o_lote_com_o_mesmo_calculo_do_servico():
    nomes = ["demo-01-com-gps.jpg", "demo-02-com-gps.jpg", "demo-03-com-gps.jpg"]
    resposta = cliente().post("/analisar", files=[("imagens", foto(n)) for n in nomes])

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["imagens"] == 3
    assert len(corpo["resumosDasImagens"]) == 3

    # O mesmo numero que o servico calcularia: as mesmas funcoes, sem atalho.
    estimador = estimador_baseline()
    resultados = [estimador.classificar((FOTOS / n).read_bytes()) for n in nomes]
    esperado = consolidar([r[0] for r in resultados], sum(r[1] for r in resultados) / 3)
    assert corpo["indiceDanoBps"] == round(esperado.indice_dano * 10_000)
    assert corpo["confiancaBps"] == round(esperado.confianca * 10_000)


def test_reexecutar_o_mesmo_lote_da_o_mesmo_indice():
    """HU11, criterio 4: mesma versao, mesmo lote, mesmo indice."""
    c = cliente()
    arquivos = [("imagens", foto("demo-04-com-gps.jpg")), ("imagens", foto("demo-05-com-gps.jpg"))]

    primeira = c.post("/analisar", files=arquivos).json()
    segunda = c.post("/analisar", files=arquivos).json()

    assert primeira["indiceDanoBps"] == segunda["indiceDanoBps"]
    assert primeira["resumosDasImagens"] == segunda["resumosDasImagens"]


def test_arquivo_que_nao_e_imagem_e_ignorado_e_relatado():
    resposta = cliente().post(
        "/analisar",
        files=[
            ("imagens", foto("demo-01-com-gps.jpg")),
            ("imagens", ("planilha.jpg", b"isto nao e uma imagem", "image/jpeg")),
        ],
    )

    corpo = resposta.json()
    assert corpo["imagens"] == 1
    assert any("planilha.jpg" in o for o in corpo["observacoes"])


def test_lote_sem_nenhuma_imagem_valida_e_recusado():
    resposta = cliente().post("/analisar", files=[("imagens", ("x.png", b"nada", "image/png"))])
    assert resposta.status_code == 422


def test_lote_acima_de_50_imagens_e_recusado():
    arquivos = [("imagens", foto("demo-01-com-gps.jpg"))] * (MAXIMO_DE_IMAGENS + 1)
    assert cliente().post("/analisar", files=arquivos).status_code == 413
