"""
O laco do servico, com um backend falso.

Nenhum teste toca a rede. O que se verifica aqui e o comportamento diante do que
pode dar errado do outro lado: evidencia adulterada, arquivo ilegivel, lote sem
imagem — casos em que a resposta certa e reduzir a confianca, e nao publicar um
numero como se nada tivesse acontecido.
"""

from io import BytesIO

import pytest
from PIL import Image

from visao.clienteBackend import Imagem, Lote, ResumoDivergente
from visao.servico import Estimador, analisar_lote, processar_pendentes


def png(cor=(60, 150, 45)) -> bytes:
    memoria = BytesIO()
    Image.new("RGB", (32, 32), cor).save(memoria, format="PNG")
    return memoria.getvalue()


class BackendFalso:
    def __init__(self, lotes, arquivos, falhas=()):
        self._lotes = lotes
        self._arquivos = arquivos
        self._falhas = set(falhas)
        self.enviados = []

    def pendentes(self):
        return self._lotes

    def baixar(self, imagem):
        if imagem.id in self._falhas:
            raise ResumoDivergente(f"imagem {imagem.id}: o arquivo nao corresponde ao sha256")
        return self._arquivos[imagem.id]

    def enviar_resultado(self, corpo):
        self.enviados.append(corpo)
        return {"analise": {"encaminhadaAoPerito": corpo["confianca"] < 0.7}}


def imagem(identificador):
    return Imagem(identificador, "0" * 64, "image/png", -47.58, -21.46, "2026-09-20T10:00:00Z")


def lote(identificador, imagens):
    return Lote(identificador, "talhao-01", "soja", "0x" + "a" * 64, imagens)


ESTIMADOR = Estimador(
    versao="teste-1.0.0",
    classificar=lambda conteudo: ({"solo": 0, "saudavel": 50, "estresse_leve": 0,
                                   "estresse_severo": 50}, 0.9),
)


def test_lote_analisado_vira_corpo_no_formato_do_backend():
    imagens = [imagem("i1"), imagem("i2"), imagem("i3")]
    backend = BackendFalso([lote("l1", imagens)], {i.id: png() for i in imagens})

    assert processar_pendentes(backend, ESTIMADOR, registrar=lambda _: None) == 1

    corpo = backend.enviados[0]
    assert corpo["loteId"] == "l1"
    assert corpo["versaoModelo"] == "teste-1.0.0"
    assert corpo["indiceDano"] == 0.5
    assert 0 < corpo["confianca"] <= 0.9


def test_evidencia_adulterada_derruba_a_confianca_e_fica_registrada():
    imagens = [imagem("i1"), imagem("i2"), imagem("i3")]
    backend = BackendFalso(
        [lote("l1", imagens)], {i.id: png() for i in imagens}, falhas={"i2"}
    )

    analise = analisar_lote(backend, lote("l1", imagens), ESTIMADOR)

    intacto = analisar_lote(
        BackendFalso([], {i.id: png() for i in imagens}), lote("l1", imagens), ESTIMADOR
    )

    assert analise.confianca < intacto.confianca
    assert any("nao corresponde ao sha256" in o for o in analise.observacoes)
    # O indice continua sendo calculado com o que sobrou: descartar o lote
    # inteiro apagaria evidencia boa por causa de um arquivo ruim.
    assert analise.indice_dano == 0.5


def test_lote_sem_imagem_legivel_nao_produz_confianca():
    imagens = [imagem("i1")]
    backend = BackendFalso([lote("l1", imagens)], {}, falhas={"i1"})

    analise = analisar_lote(backend, lote("l1", imagens), ESTIMADOR)

    assert analise.confianca == 0.0
    assert analise.indice_dano == 0.0


def test_arquivo_ilegivel_nao_derruba_o_servico():
    imagens = [imagem("i1"), imagem("i2")]
    backend = BackendFalso([lote("l1", imagens)], {"i1": png(), "i2": b"isto nao e imagem"})

    quebra = Estimador(
        versao="teste-1.0.0",
        classificar=lambda conteudo: (
            ({"solo": 0, "saudavel": 100, "estresse_leve": 0, "estresse_severo": 0}, 0.9)
            if conteudo.startswith(b"\x89PNG")
            else (_ for _ in ()).throw(ValueError("formato desconhecido"))
        ),
    )

    analise = analisar_lote(backend, lote("l1", imagens), quebra)

    assert analise.imagens == 1
    assert any("formato desconhecido" in o for o in analise.observacoes)


def test_confianca_baixa_vai_para_o_perito():
    imagens = [imagem("i1")]
    backend = BackendFalso([lote("l1", imagens)], {"i1": png()})
    baixa = Estimador(
        versao="baseline",
        classificar=lambda _: (
            {"solo": 0, "saudavel": 50, "estresse_leve": 0, "estresse_severo": 50},
            0.45,
        ),
    )

    registros = []
    processar_pendentes(backend, baixa, registrar=registros.append)

    assert backend.enviados[0]["confianca"] < 0.7
    assert any("perito" in linha for linha in registros)


def test_falha_de_rede_nao_interrompe_o_laco():
    class BackendQuebrado:
        def pendentes(self):
            raise ConnectionError("backend fora do ar")

    from visao.servico import servir

    registros = []
    servir(BackendQuebrado(), ESTIMADOR, uma_vez=True, registrar=registros.append)

    assert any("ciclo falhou" in linha for linha in registros)


@pytest.mark.parametrize("quantidade", [1, 2, 5])
def test_mais_imagens_nao_reduzem_a_confianca(quantidade):
    imagens = [imagem(f"i{n}") for n in range(quantidade)]
    backend = BackendFalso([lote("l1", imagens)], {i.id: png() for i in imagens})

    analise = analisar_lote(backend, lote("l1", imagens), ESTIMADOR)

    assert analise.imagens == quantidade
    assert analise.confianca > 0
