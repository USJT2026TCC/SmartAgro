"""
Linha de comando do simulador, de ponta a ponta, com um ZIP sintetico no
formato do INMET (o mesmo cabecalho e as mesmas colunas do arquivo real).

Nada aqui toca a rede: o envio a API e o broker MQTT sao substituidos por
dobles que registram o que receberiam.
"""

from __future__ import annotations

import csv
import io
import json
import zipfile
from types import SimpleNamespace

import pytest

from simulador import cli, envio, mqtt
from simulador.envio import Resultado

CHAVE = "0x" + "11" * 32


def csv_da_estacao(codigo: str, nome: str, lat: str, lon: str, ano: int, chuva_no_dia: dict[int, float]) -> bytes:
    """30 dias de julho, de hora em hora; chuva so nos dias informados (as 12h)."""
    linhas = [
        "REGIAO:;SE",
        "UF:;SP",
        f"ESTACAO:;{nome}",
        f"CODIGO (WMO):;{codigo}",
        f"LATITUDE:;{lat}",
        f"LONGITUDE:;{lon}",
        "ALTITUDE:;600",
        "DATA DE FUNDACAO:;01/01/08",
        "Data;Hora UTC;PRECIPITAÇÃO TOTAL, HORÁRIO (mm);"
        "TEMPERATURA DO AR - BULBO SECO, HORARIA (°C);UMIDADE RELATIVA DO AR, HORARIA (%);",
    ]
    for dia in range(1, 31):
        for hora in range(24):
            chuva = chuva_no_dia.get(dia, 0) if hora == 12 else 0
            linhas.append(f"{ano}/07/{dia:02d};{hora:02d}00 UTC;{str(chuva).replace('.', ',')};20,0;70;")
    return ("\r\n".join(linhas) + "\r\n").encode("latin-1")


@pytest.fixture
def dados(tmp_path, monkeypatch):
    """Pasta de dados com ZIPs de 2023 e 2024: A770 chove no dia 5; A747, no dia 10."""
    for ano in (2023, 2024):
        with zipfile.ZipFile(tmp_path / f"{ano}.zip", "w") as z:
            z.writestr(
                f"{ano}/INMET_SE_SP_A770_SAO SIMAO_01-01-{ano}_A_31-12-{ano}.CSV",
                csv_da_estacao("A770", "SAO SIMAO", "-21,46111111", "-47,57944444", ano, {5: 12.0}),
            )
            z.writestr(
                f"{ano}/INMET_SE_SP_A747_PRADOPOLIS_01-01-{ano}_A_31-12-{ano}.CSV",
                csv_da_estacao("A747", "PRADOPOLIS", "-21,33833333", "-48,11388888", ano, {10: 3.5}),
            )
    monkeypatch.setattr(cli, "DIR_DADOS", tmp_path)
    monkeypatch.setenv("CHAVE_ESTACAO_INMET_A770", CHAVE)
    return tmp_path


def rodar(capsys, *argumentos) -> str:
    assert cli.main(list(argumentos)) == 0
    return capsys.readouterr().out


def test_baixar_usa_o_zip_que_ja_esta_em_disco(dados, capsys):
    saida = rodar(capsys, "baixar", "--ano", "2024")
    assert "2024.zip" in saida
    assert "portal.inmet.gov.br" in saida


def test_estacoes_ordena_pela_distancia_do_talhao(dados, capsys):
    saida = rodar(capsys, "estacoes", "--ano", "2024", "--perto=-21.46,-47.58")
    linhas = [l for l in saida.splitlines() if l.strip()]
    assert linhas[0].startswith("A770")
    assert linhas[1].startswith("A747")
    assert "km" in linhas[1]


def test_estacoes_sem_ponto_de_referencia_ordena_pelo_codigo(dados, capsys):
    saida = rodar(capsys, "estacoes", "--ano", "2024", "--uf", "SP")
    assert saida.index("A747") < saida.index("A770")


def test_analisar_aponta_a_maior_estiagem(dados, capsys):
    saida = rodar(capsys, "analisar", "--estacao", "A770", "--ano", "2024")
    # Chove no dia 5; do dia 6 ao 30 sao 25 dias secos.
    assert "maior estiagem......: 25 dias consecutivos, a partir de 20240706" in saida
    assert "chuva no periodo....: 12.0 mm" in saida


def test_endereco_da_chave_da_fonte(dados, capsys):
    saida = rodar(capsys, "endereco", "--fonte", "estacao-inmet-a770")
    assert saida.strip().startswith("0x") and len(saida.strip()) == 42


def test_enviar_pela_api_relata_cada_lote(dados, capsys, monkeypatch):
    recebidos = []

    def falso(api, fonte, leituras, chave, tls_ca=None):
        recebidos.append((api, fonte, len(leituras), tls_ca))
        return Resultado(len(leituras), 0, 0, 1.0)

    monkeypatch.setattr(envio, "enviar_lote", falso)

    saida = rodar(
        capsys,
        "enviar", "--estacao", "A770", "--ano", "2024", "--de", "2024-07-01", "--ate", "2024-07-30",
        "--fonte", "estacao-inmet-a770", "--api", "https://api.exemplo/api", "--tls-ca", "ca.crt",
    )

    assert "Dias secos no fim...: 25" in saida
    assert "Periodo para o oraculo: 20240730" in saida
    assert sum(n for _, _, n, _ in recebidos) == 720
    assert all(r[3] == "ca.crt" for r in recebidos)


def test_enviar_com_intervalo_manda_um_dia_por_vez(dados, capsys, monkeypatch):
    lotes = []
    monkeypatch.setattr(envio, "enviar_lote", lambda *a, **k: lotes.append(len(a[2])) or Resultado(24, 0, 0, None))
    monkeypatch.setattr("time.sleep", lambda s: None)

    saida = rodar(
        capsys,
        "enviar", "--estacao", "A770", "--ano", "2024", "--de", "2024-07-01", "--ate", "2024-07-03",
        "--fonte", "estacao-inmet-a770", "--intervalo", "5",
    )

    assert "3 envio(s), um a cada 5.0s" in saida
    assert lotes == [24, 24, 24]


def test_envio_recusado_aparece_com_o_motivo(dados, capsys, monkeypatch):
    monkeypatch.setattr(envio, "enviar_lote", lambda *a, **k: Resultado(0, 0, 0, None, erro="HTTP 401: assinatura"))

    saida = rodar(
        capsys,
        "enviar", "--estacao", "A770", "--ano", "2024", "--fonte", "estacao-inmet-a770", "--ate", "2024-07-02",
    )
    assert "HTTP 401: assinatura" in saida


def test_enviar_ate_hoje_desloca_as_datas_e_avisa(dados, capsys, monkeypatch):
    monkeypatch.setattr(envio, "enviar_lote", lambda *a, **k: Resultado(1, 0, 0, 1.0))

    saida = rodar(
        capsys,
        "enviar", "--estacao", "A770", "--ano", "2024", "--fonte", "estacao-inmet-a770", "--ate-hoje",
    )
    assert "datas deslocadas" in saida


def test_enviar_pelo_mqtt_monta_envelopes_assinados(dados, capsys, monkeypatch):
    publicados = {}

    def falso(envelopes, **opcoes):
        publicados["envelopes"] = envelopes
        publicados["opcoes"] = opcoes
        return len(envelopes)

    monkeypatch.setattr(mqtt, "publicar", falso)

    saida = rodar(
        capsys,
        "enviar", "--estacao", "A770", "--ano", "2024", "--fonte", "estacao-inmet-a770",
        "--destino", "mqtt", "--broker", "broker.local", "--porta", "8883", "--tls-ca", "ca.crt",
    )

    assert "lote(s) publicados em broker.local:8883" in saida
    envelope = publicados["envelopes"][0]
    assert envelope.fonte == "estacao-inmet-a770"
    assert json.loads(envelope.corpo)["leituras"]
    assert publicados["opcoes"]["tls_ca"] == "ca.crt"


def test_sem_chave_da_fonte_o_envio_para_com_mensagem_clara(dados, monkeypatch):
    monkeypatch.delenv("CHAVE_ESTACAO_INMET_A770")
    with pytest.raises(SystemExit, match="CHAVE_ESTACAO_INMET_A770"):
        cli.main(["enviar", "--estacao", "A770", "--ano", "2024", "--fonte", "estacao-inmet-a770"])


def test_historico_extrai_a_chuva_diaria_de_varios_anos(dados, capsys, tmp_path):
    saida_csv = tmp_path / "saida" / "historico.csv"

    saida = rodar(
        capsys, "historico", "--estacoes", "A770,A747", "--de", "2023", "--ate", "2024", "--saida", str(saida_csv),
    )

    linhas = list(csv.DictReader(io.StringIO(saida_csv.read_text(encoding="utf-8"))))
    assert "120 dias gravados" in saida  # 30 dias x 2 estacoes x 2 anos
    dia_5 = next(l for l in linhas if l["estacao"] == "A770" and l["data"] == "2024-07-05")
    assert float(dia_5["chuva_mm"]) == 12.0
    assert int(dia_5["horas_validas"]) == 24
    assert (dados / "2024.zip").exists(), "o ZIP que ja existia nao e apagado"


def test_envelope_ida_e_volta_preserva_os_bytes_assinados():
    envelope = mqtt.Envelope(fonte="f", assinatura="0xabc", corpo=b'{"x":1}')
    volta = mqtt.Envelope.de_json(envelope.para_json())
    assert volta == envelope


class ClienteMqttFalso:
    """Imita o paho.mqtt.client.Client no que o simulador usa."""

    ultimo = None

    def __init__(self, *_):
        self.publicados, self.tls = [], None
        ClienteMqttFalso.ultimo = self

    def tls_set(self, ca_certs):
        self.tls = ca_certs

    def connect(self, *a, **k):
        pass

    def loop_start(self):
        pass

    def loop_stop(self):
        pass

    def disconnect(self):
        pass

    def publish(self, topico, carga, qos):
        self.publicados.append((topico, carga, qos))
        return SimpleNamespace(wait_for_publish=lambda timeout: None)


def test_publicar_no_broker_com_tls_e_intervalo(monkeypatch):
    import paho.mqtt.client as paho

    monkeypatch.setattr(paho, "Client", ClienteMqttFalso)
    esperas = []
    monkeypatch.setattr("time.sleep", esperas.append)

    envelopes = [mqtt.Envelope("fonte-1", "0x1", b"{}"), mqtt.Envelope("fonte-1", "0x2", b"{}")]
    assert mqtt.publicar(envelopes, intervalo_s=2, tls_ca="ca.crt") == 2

    cliente = ClienteMqttFalso.ultimo
    assert cliente.tls == "ca.crt"
    assert [p[0] for p in cliente.publicados] == ["agrosmart/leituras/fonte-1"] * 2
    assert all(p[2] == 1 for p in cliente.publicados), "qos 1: entrega garantida"
    assert esperas == [2]
