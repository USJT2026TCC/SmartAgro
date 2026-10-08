"""
Cenarios pre-configurados e envio cadenciado (HU04, criterios 1 e 3).
"""

from pathlib import Path

import pytest

from simulador import serie
from simulador.envio import enviar_cadenciado

ZIP_2024 = Path(__file__).resolve().parents[1] / "dados" / "2024.zip"


def test_tres_cenarios_previstos_na_hu04():
    assert set(serie.CENARIOS) == {"estiagem_severa", "estiagem_moderada", "safra_normal"}


@pytest.mark.skipif(not ZIP_2024.exists(), reason="baixe 2024 com `simulador baixar --ano 2024`")
@pytest.mark.parametrize("nome", sorted(serie.CENARIOS))
def test_cada_cenario_termina_com_a_estiagem_declarada_na_estacao_a770(nome):
    """A estacao ao lado do talhao, sozinha, ja mostra o que o cenario promete."""
    from datetime import datetime, timezone

    from simulador.inmet import abrir_do_zip

    cenario = serie.CENARIOS[nome]
    _, leituras = abrir_do_zip(ZIP_2024, "A770")
    de = datetime.fromisoformat(cenario["de"]).replace(tzinfo=timezone.utc)
    ate = datetime.fromisoformat(cenario["ate"]).replace(hour=23, tzinfo=timezone.utc)
    janela = [l for l in serie.recortar(leituras, de, ate) if l.completa]

    secos = serie.dias_secos_ao_final(janela)
    if cenario["indice_esperado"] >= 30:
        assert secos >= 30, f"{nome}: {secos} dias"
    elif cenario["indice_esperado"] > 0:
        assert 10 <= secos < 30, f"{nome}: {secos} dias"
    else:
        assert secos == 0, f"{nome}: {secos} dias"


def test_envio_cadenciado_espera_entre_os_lotes_e_nao_antes_do_primeiro():
    esperas, enviados = [], []

    enviar_cadenciado(
        [[1], [2], [3]],
        enviar=lambda lote: enviados.append(lote) or "ok",
        intervalo_s=5,
        dormir=esperas.append,
    )

    assert enviados == [[1], [2], [3]]
    assert esperas == [5, 5]


def test_sem_intervalo_e_rajada():
    esperas = []
    enviar_cadenciado([[1], [2]], enviar=lambda lote: lote, intervalo_s=0, dormir=esperas.append)
    assert esperas == []


def test_envio_sempre_confere_o_certificado_do_servidor(monkeypatch):
    """RNF17: com https, o certificado e conferido; nao ha como desligar."""
    from simulador import envio
    from simulador.inmet import Leitura
    from datetime import datetime, timezone

    chamadas = []

    class Resposta:
        ok = True
        status_code = 200

        def json(self):
            return {"aceitas": 1, "recusadas": 0, "duplicadas": 0, "escore": 1.0}

    monkeypatch.setattr(envio.requests, "post", lambda *a, **k: chamadas.append(k) or Resposta())

    leitura = Leitura(datetime(2024, 7, 1, tzinfo=timezone.utc), 0.0, 20.0, 70.0)
    chave = "0x" + "11" * 32

    envio.enviar_lote("https://api", "fonte", [leitura], chave)
    envio.enviar_lote("https://api", "fonte", [leitura], chave, tls_ca="autoridade.crt")

    assert chamadas[0]["verify"] is True
    assert chamadas[1]["verify"] == "autoridade.crt"
