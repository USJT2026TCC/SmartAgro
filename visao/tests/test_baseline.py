"""
O estimador classico, sobre imagens sinteticas de cor conhecida.

Nao ha modelo treinado aqui: estes testes fixam o comportamento da heuristica
de cor, para que uma mudanca nos limiares apareca como teste vermelho e nao
como indice de dano diferente numa apresentacao.
"""

from io import BytesIO

from PIL import Image

from visao.baseline import CONFIANCA, classificar
from visao.indice import indice_de_dano

VERDE_SADIO = (60, 150, 45)
AMARELADO = (190, 175, 40)
MARROM_SECO = (150, 95, 35)
TERRA = (135, 120, 110)


def imagem(cores, lado=64) -> bytes:
    """Imagem em faixas verticais, uma por cor."""
    largura = lado * len(cores)
    tela = Image.new("RGB", (largura, lado))

    for indice, cor in enumerate(cores):
        tela.paste(Image.new("RGB", (lado, lado), cor), (indice * lado, 0))

    memoria = BytesIO()
    tela.save(memoria, format="PNG")

    return memoria.getvalue()


def test_lavoura_verde_e_classificada_como_sadia():
    contagem = classificar(imagem([VERDE_SADIO]))

    assert contagem["saudavel"] > 0.95 * sum(contagem.values())
    assert indice_de_dano(contagem) == 0.0


def test_solo_exposto_nao_vira_lavoura():
    contagem = classificar(imagem([TERRA]))

    assert contagem["solo"] > 0.95 * sum(contagem.values())
    # Sem lavoura na foto, nao ha dano a declarar.
    assert indice_de_dano(contagem) == 0.0


def test_folha_amarelada_conta_como_estresse():
    contagem = classificar(imagem([AMARELADO]))
    estresse = contagem["estresse_leve"] + contagem["estresse_severo"]

    assert estresse > contagem["saudavel"]
    assert indice_de_dano(contagem) > 0.4


def test_meia_lavoura_amarelada_da_dano_intermediario():
    contagem = classificar(imagem([VERDE_SADIO, AMARELADO]))
    dano = indice_de_dano(contagem)

    assert 0.2 < dano < 0.9


def test_limitacao_conhecida_palha_seca_e_confundida_com_solo():
    """
    Lavoura totalmente seca tem a cor do solo, e a heuristica a classifica como
    solo. Como solo nao entra no denominador, o indice sai ZERO justamente no
    caso mais grave: o estimador SUBESTIMA o dano, e o produtor receberia menos
    do que a apolice prometeu.

    Nenhum ajuste de limiar resolve isto — em RGB, palha seca e terra tem a
    mesma cor. Resolver exige infravermelho proximo, ou um modelo que use
    textura e contexto. E a razao pela qual este estimador tem confianca abaixo
    do limiar e nunca aciona pagamento sozinho.

    O tamanho do erro e medido em `treino/avaliar_baseline.py`, contra as
    mascaras de referencia da base.
    """
    contagem = classificar(imagem([MARROM_SECO]))

    assert contagem["solo"] > 0.9 * sum(contagem.values())
    assert indice_de_dano(contagem) == 0.0


def test_solo_na_foto_nao_muda_o_dano_da_lavoura():
    # A mesma lavoura, fotografada com mais carreador no quadro, tem o mesmo dano.
    sem_solo = indice_de_dano(classificar(imagem([VERDE_SADIO, MARROM_SECO])))
    com_solo = indice_de_dano(classificar(imagem([VERDE_SADIO, MARROM_SECO, TERRA, TERRA])))

    assert abs(sem_solo - com_solo) < 0.05


def test_sombra_nao_transforma_planta_sadia_em_estresse():
    # A mesma cor, com metade do brilho: as coordenadas cromaticas devem
    # neutralizar a diferenca de exposicao.
    escuro = tuple(c // 2 for c in VERDE_SADIO)

    claro = classificar(imagem([VERDE_SADIO]))
    sombra = classificar(imagem([escuro]))

    assert abs(indice_de_dano(claro) - indice_de_dano(sombra)) < 0.05


def test_a_confianca_fica_abaixo_do_limiar_do_perito():
    # 0,70 e o limiar do backend e do oraculo. A heuristica precisa ficar abaixo
    # dele para que nenhuma analise dela acione pagamento sozinha.
    assert CONFIANCA < 0.70


def test_todas_as_classes_aparecem_na_contagem():
    contagem = classificar(imagem([VERDE_SADIO]))

    assert set(contagem) == {"solo", "saudavel", "estresse_leve", "estresse_severo", "outro_dano"}
    assert all(isinstance(v, int) for v in contagem.values())
