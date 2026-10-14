"""
O preparo da base: bandas, classes e divisao.

Cada teste aqui corresponde a um erro que ja aconteceu neste projeto ou que
passaria sem ninguem notar — uma mascara com as classes trocadas continua sendo
uma mascara valida, e um RGB com vermelho e azul trocados continua sendo uma
imagem.
"""

import importlib.util
import io
import json
import zipfile
from pathlib import Path

import numpy as np
import pytest

CAMINHO = Path(__file__).resolve().parents[1] / "treino" / "preparar_dados.py"
especificacao = importlib.util.spec_from_file_location("preparar_dados", CAMINHO)
preparo = importlib.util.module_from_spec(especificacao)
especificacao.loader.exec_module(preparo)


def test_rgb_e_montado_pelas_bandas_nomeadas():
    # Bandas da base: 0 azul, 1 verde, 2 vermelho. O .jpg da base grava 0,1,2
    # como R,G,B — vermelho e azul trocados. Aqui o vermelho tem que vir da 2.
    bandas = np.zeros((2, 2, 6), dtype=np.float16)
    bandas[:, :, 0] = 0.2  # azul
    bandas[:, :, 1] = 0.5  # verde
    bandas[:, :, 2] = 1.0  # vermelho

    rgb = preparo.rgb_do_npy(bandas)

    assert rgb[0, 0].tolist() == [255, 128, 51]


def test_classes_da_base_sao_traduzidas_para_a_ordem_do_agrosmart():
    # base: 0 solo, 1 estresse leve, 2 estresse severo, 3 saudavel
    # AgroSmart: 0 solo, 1 saudavel, 2 estresse_leve, 3 estresse_severo
    base = np.array([[0, 1], [2, 3]], dtype=np.uint8)

    assert preparo.traduzir(base).tolist() == [[0, 2], [3, 1]]


def test_uma_faixa_a_cada_quatro_fica_fora_do_treino():
    assert preparo.divisao_de(0) == "treino"
    assert preparo.divisao_de(1535) == "treino"
    assert preparo.divisao_de(1536) in ("validacao", "teste")
    assert preparo.divisao_de(2047) in ("validacao", "teste")
    assert preparo.divisao_de(2048) == "treino"


def test_as_faixas_fora_do_treino_se_dividem_entre_validacao_e_teste():
    # Faixa 3 (x0 = 1536): primeiro ciclo fora do treino, vai para a validacao,
    # usada para escolher a melhor epoca, como sempre.
    assert preparo.divisao_de(3 * preparo.LARGURA_DA_FAIXA) == "validacao"
    # Faixa 7 (x0 = 3584): segundo ciclo fora do treino, vai para o teste —
    # nunca visto no treino nem na escolha de epoca, para um numero honesto.
    assert preparo.divisao_de(7 * preparo.LARGURA_DA_FAIXA) == "teste"
    # Faixa 11: terceiro ciclo, volta para validacao. As duas se alternam
    # cobrindo o talhao inteiro, em vez de uma ficar numa ponta so.
    assert preparo.divisao_de(11 * preparo.LARGURA_DA_FAIXA) == "validacao"
    # O treino continua do mesmo tamanho de antes: nenhuma faixa de treino
    # virou validacao ou teste.
    assert preparo.divisao_de(4 * preparo.LARGURA_DA_FAIXA) == "treino"


def _zip_com_classes(mapa: dict) -> zipfile.ZipFile:
    memoria = io.BytesIO()
    with zipfile.ZipFile(memoria, "w") as arquivo:
        arquivo.writestr(
            "water_2025/meta/class_map.json", json.dumps({"task": "water", "class_map": mapa})
        )
    memoria.seek(0)
    return zipfile.ZipFile(memoria)


def test_ordem_de_classes_declarada_pela_base_e_conferida():
    preparo.conferir_classes(_zip_com_classes(preparo.CLASSES_DA_BASE))


def test_base_com_outra_ordem_de_classes_e_recusada():
    # Se uma versao futura da base reordenar as classes, o preparo precisa parar,
    # em vez de gerar mascaras trocadas que ninguem notaria.
    trocada = {"soil": 0, "low_stress": 2, "high_stress": 1, "healthy": 3}

    with pytest.raises(SystemExit, match="outra ordem de classes"):
        preparo.conferir_classes(_zip_com_classes(trocada))
