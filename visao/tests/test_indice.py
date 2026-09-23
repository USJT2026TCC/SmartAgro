"""
O calculo do indice de dano.

Estes testes descrevem decisoes que mudam quanto o contrato paga. Cada um deles
existe porque a alternativa — somar solo, somar leve com severo, confiar em uma
foto so — produziria um numero defensavel a primeira vista e errado no fim.
"""

from visao.indice import (
    COBERTURA_MINIMA,
    confianca_da_amostragem,
    consolidar,
    indice_de_dano,
    proporcoes,
)


def contagem(solo=0, saudavel=0, leve=0, severo=0, outro=0):
    return {
        "solo": solo,
        "saudavel": saudavel,
        "estresse_leve": leve,
        "estresse_severo": severo,
        "outro_dano": outro,
    }


def test_lavoura_toda_sadia_nao_tem_dano():
    assert indice_de_dano(contagem(saudavel=1000)) == 0.0


def test_lavoura_toda_em_estresse_severo_e_dano_total():
    assert indice_de_dano(contagem(severo=1000)) == 1.0


def test_solo_nao_entra_no_denominador():
    # Metade da foto e carreador. O dano continua sendo metade da LAVOURA,
    # e nao um quarto da foto: terra sem planta nao e lavoura prejudicada.
    com_solo = indice_de_dano(contagem(solo=1000, saudavel=500, severo=500))
    sem_solo = indice_de_dano(contagem(saudavel=500, severo=500))

    assert com_solo == sem_solo == 0.5


def test_estresse_leve_pesa_metade_do_severo():
    leve = indice_de_dano(contagem(leve=1000))
    severo = indice_de_dano(contagem(severo=1000))

    assert leve == 0.5
    assert severo == 1.0


def test_peso_da_gravidade_e_configuravel():
    # A ponderacao e escolha atuarial, nao tecnica. A seguradora pode decidir
    # que estresse leve nao entra no indice.
    pesos = {"solo": 0, "saudavel": 0, "estresse_leve": 0.0, "estresse_severo": 1.0, "outro_dano": 0}

    assert indice_de_dano(contagem(leve=1000), pesos) == 0.0


def test_doenca_nao_vira_dano_por_seca():
    # Ferrugem nao e estiagem. A apolice contratada cobre seca; pagar por
    # doenca seria pagar por risco que nao foi precificado.
    assert indice_de_dano(contagem(saudavel=500, outro=500)) == 0.0


def test_foto_so_de_solo_nao_gera_dano():
    assert indice_de_dano(contagem(solo=1000)) == 0.0


def test_proporcoes_somam_um():
    fracoes = proporcoes(contagem(solo=250, saudavel=250, leve=250, severo=250))

    assert abs(sum(fracoes.values()) - 1.0) < 1e-9


def test_pouca_lavoura_derruba_a_confianca():
    _, observacoes = confianca_da_amostragem([0.5], 0.5, 0.9)
    confianca_ruim, observacoes_ruins = confianca_da_amostragem(
        [0.5], COBERTURA_MINIMA - 0.01, 0.9
    )

    assert not any("lavoura" in o for o in observacoes)
    assert confianca_ruim < 0.9
    assert any("lavoura" in o for o in observacoes_ruins)


def test_uma_unica_imagem_derruba_a_confianca():
    uma, _ = confianca_da_amostragem([0.4], 0.8, 0.9)
    varias, _ = confianca_da_amostragem([0.4, 0.42, 0.38, 0.41], 0.8, 0.9)

    assert uma < varias


def test_imagens_que_discordam_derrubam_a_confianca():
    # 10% em uma foto e 80% em outra: a media de 45% nao descreve nenhuma das duas.
    concordam, _ = confianca_da_amostragem([0.40, 0.42, 0.38], 0.8, 0.9)
    discordam, observacoes = confianca_da_amostragem([0.10, 0.80, 0.45], 0.8, 0.9)

    assert discordam < concordam
    assert any("discordam" in o for o in observacoes)


def test_confianca_nunca_sobe_acima_da_do_modelo():
    confianca, _ = confianca_da_amostragem([0.5, 0.5, 0.5], 0.9, 0.62)

    assert confianca <= 0.62


def test_consolidar_soma_pixels_em_vez_de_mediar_indices():
    # Um ortomosaico de 1 milhao de pixels e uma foto de 100 nao podem pesar
    # igual. A soma dos pixels faz o ortomosaico dominar, como deve.
    grande = contagem(saudavel=1_000_000)
    pequena = contagem(severo=100)

    analise = consolidar([grande, pequena], 0.9)

    assert analise.indice_dano < 0.01
    assert analise.imagens == 2


def test_lote_sem_imagem_nao_produz_dano_nem_confianca():
    analise = consolidar([], 0.9)

    assert analise.indice_dano == 0.0
    assert analise.confianca == 0.0


def test_para_api_usa_os_nomes_e_a_escala_do_backend():
    corpo = consolidar([contagem(saudavel=500, severo=500)], 0.8).para_api("v1", "lote-1")

    assert corpo["loteId"] == "lote-1"
    assert corpo["versaoModelo"] == "v1"
    assert 0 <= corpo["indiceDano"] <= 1
    assert 0 <= corpo["confianca"] <= 1
    assert corpo["indiceDano"] == 0.5
