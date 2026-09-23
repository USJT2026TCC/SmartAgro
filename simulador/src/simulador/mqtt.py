"""
Publicacao por MQTT e ponte MQTT -> API (HU04).

POR QUE MQTT, SE A API JA ACEITA HTTP

Em campo, a estacao nao fala com a API. Ela fala com um broker MQTT, protocolo
feito para enlace ruim e equipamento pequeno: mensagem curta, reconexao barata,
e a entrega continua depois que o sinal volta. Quem fala com a API e uma ponte,
que roda em lugar com rede estavel.

O simulador reproduz essa topologia:

    simulador --destino mqtt  ──publica──►  broker  ──►  ponte  ──POST──►  API
                                            (mosquitto)

A ASSINATURA E FEITA NA ESTACAO, NAO NA PONTE

O envelope que trafega no MQTT carrega o corpo e a assinatura ja prontos:

    { "fonte": "...", "assinatura": "0x...", "corpoBase64": "..." }

A ponte nao tem chave nenhuma: ela decodifica o corpo e o repassa byte a byte.
Uma ponte comprometida pode deixar de entregar leituras, o que aparece como
falta de dado — mas nao consegue forjar uma leitura, porque nao sabe assinar.
E a mesma razao pela qual o backend tambem nao guarda chave de ninguem.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass

from .assinatura import assinar, corpo_em_bytes
from .inmet import Leitura
from .envio import montar_lote

TOPICO_BASE = "agrosmart/leituras"


@dataclass
class Envelope:
    """O que trafega em um topico MQTT."""

    fonte: str
    assinatura: str
    corpo: bytes

    def para_json(self) -> str:
        return json.dumps(
            {
                "fonte": self.fonte,
                "assinatura": self.assinatura,
                "corpoBase64": base64.b64encode(self.corpo).decode("ascii"),
            }
        )

    @staticmethod
    def de_json(texto: str | bytes) -> "Envelope":
        dados = json.loads(texto)

        return Envelope(
            fonte=dados["fonte"],
            assinatura=dados["assinatura"],
            corpo=base64.b64decode(dados["corpoBase64"]),
        )


def montar_envelope(fonte: str, leituras: list[Leitura], chave_privada: str) -> Envelope:
    """Serializa, assina e embrulha um lote para viajar pelo MQTT."""
    corpo = corpo_em_bytes(montar_lote(fonte, leituras))

    return Envelope(fonte=fonte, assinatura=assinar(corpo, chave_privada), corpo=corpo)


def publicar(
    envelopes: list[Envelope],
    broker: str = "localhost",
    porta: int = 1883,
    topico_base: str = TOPICO_BASE,
) -> int:
    """Publica cada envelope no topico da sua fonte. Devolve quantos foram publicados."""
    import paho.mqtt.client as mqtt

    cliente = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    cliente.connect(broker, porta, keepalive=30)
    cliente.loop_start()

    try:
        for envelope in envelopes:
            info = cliente.publish(
                f"{topico_base}/{envelope.fonte}", envelope.para_json(), qos=1
            )
            info.wait_for_publish(timeout=30)
    finally:
        cliente.loop_stop()
        cliente.disconnect()

    return len(envelopes)


def ponte(
    api: str,
    broker: str = "localhost",
    porta: int = 1883,
    topico_base: str = TOPICO_BASE,
    ao_entregar=None,
) -> None:
    """
    Assina o topico de leituras e repassa cada envelope para a API, sem alterar
    os bytes assinados. Roda ate ser interrompida.
    """
    import paho.mqtt.client as mqtt
    import requests

    def entregar(_cliente, _dados, mensagem):
        try:
            envelope = Envelope.de_json(mensagem.payload)
        except (ValueError, KeyError) as erro:
            print(f"envelope invalido em {mensagem.topic}: {erro}")
            return

        resposta = requests.post(
            f"{api.rstrip('/')}/leituras",
            data=envelope.corpo,
            headers={
                "Content-Type": "application/json",
                "X-Assinatura": envelope.assinatura,
            },
            timeout=60,
        )

        print(f"{envelope.fonte}: HTTP {resposta.status_code} {resposta.text[:160]}")

        if ao_entregar:
            ao_entregar(envelope, resposta)

    cliente = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    cliente.on_message = entregar
    cliente.connect(broker, porta, keepalive=30)
    cliente.subscribe(f"{topico_base}/#", qos=1)

    print(f"Ponte MQTT -> {api}: assinando {topico_base}/# em {broker}:{porta}")
    cliente.loop_forever()
