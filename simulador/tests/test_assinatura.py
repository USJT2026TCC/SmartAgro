"""
Assinatura do lote e envelope do MQTT.

O par de chaves usado aqui e o da frase publica de teste do Hardhat, conhecida e
sem valor nenhum. Chave de verdade nunca entra em teste nem em repositorio.
"""

import hashlib
import json
from datetime import datetime, timezone

from eth_account import Account
from eth_account.messages import encode_defunct

from simulador.assinatura import assinar, corpo_em_bytes, endereco_de, mensagem
from simulador.envio import montar_lote
from simulador.inmet import Leitura
from simulador.mqtt import Envelope, montar_envelope

CHAVE = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
ENDERECO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

LOTE = {"lote": "abc", "fonte": "estacao-inmet-a770", "leituras": [{"chuvaMm": 0.0}]}


def test_endereco_derivado_da_chave():
    assert endereco_de(CHAVE) == ENDERECO


def test_mensagem_segue_o_formato_acordado_com_o_backend():
    # Precisa bater, caractere a caractere, com mensagemDoLote() do backend.
    corpo = b'{"a":1}'
    texto = mensagem(corpo)

    assert texto.startswith("AgroSmart:leituras:v1\nsha256:")
    assert texto.split("sha256:")[1] == hashlib.sha256(corpo).hexdigest()


def test_assinatura_e_recuperada_para_o_endereco_da_fonte():
    corpo = corpo_em_bytes(LOTE)
    assinatura = assinar(corpo, CHAVE)

    recuperado = Account.recover_message(
        encode_defunct(text=mensagem(corpo)), signature=assinatura
    )

    assert recuperado == ENDERECO
    assert assinatura.startswith("0x")


def test_assinatura_muda_quando_um_unico_byte_do_corpo_muda():
    corpo = corpo_em_bytes(LOTE)
    outro = corpo_em_bytes({**LOTE, "leituras": [{"chuvaMm": 0.1}]})

    assert assinar(corpo, CHAVE) != assinar(outro, CHAVE)


def test_corpo_e_serializado_uma_unica_vez():
    # Se o corpo fosse reserializado depois de assinado, a assinatura cobriria
    # bytes diferentes dos enviados. O teste fixa a serializacao compacta.
    corpo = corpo_em_bytes({"b": 1, "a": 2})

    assert corpo == b'{"b":1,"a":2}'
    assert json.loads(corpo) == {"b": 1, "a": 2}


def test_envelope_do_mqtt_preserva_os_bytes_assinados():
    leitura = Leitura(
        instante=datetime(2024, 7, 2, tzinfo=timezone.utc),
        chuva_mm=0.0,
        temperatura_c=18.4,
        umidade_pct=72.0,
    )

    envelope = montar_envelope("estacao-inmet-a770", [leitura], CHAVE)
    recebido = Envelope.de_json(envelope.para_json())

    assert recebido.corpo == envelope.corpo
    assert recebido.assinatura == envelope.assinatura

    recuperado = Account.recover_message(
        encode_defunct(text=mensagem(recebido.corpo)), signature=recebido.assinatura
    )
    assert recuperado == ENDERECO


def test_lote_tem_identificador_unico_a_cada_envio():
    # Lote repetido e recusado pela API como antirrepeticao; dois envios da mesma
    # serie precisam ter identificadores diferentes.
    primeiro = montar_lote("estacao-inmet-a770", [])
    segundo = montar_lote("estacao-inmet-a770", [])

    assert primeiro["lote"] != segundo["lote"]
