"""
Leitura do CSV do INMET.

O trecho usado aqui foi copiado do arquivo real de 2024 da estacao A770
(Sao Simao/SP), inclusive com a hora sem medicao de chuva — que e justamente o
caso que nao pode virar zero.

Fonte: INMET — https://portal.inmet.gov.br/dadoshistoricos
"""

from datetime import datetime, timezone

from simulador.inmet import ler_csv

CSV = (
    "REGIAO:;SE\r\n"
    "UF:;SP\r\n"
    "ESTACAO:;SAO SIMAO\r\n"
    "CODIGO (WMO):;A770\r\n"
    "LATITUDE:;-21,46111111\r\n"
    "LONGITUDE:;-47,57944444\r\n"
    "ALTITUDE:;617,61\r\n"
    "DATA DE FUNDACAO:;22/09/06\r\n"
    "Data;Hora UTC;PRECIPITAÇÃO TOTAL, HORÁRIO (mm);"
    "TEMPERATURA DO AR - BULBO SECO, HORARIA (°C);UMIDADE RELATIVA DO AR, HORARIA (%);\r\n"
    "2024/07/02;0000 UTC;0;18,4;72;\r\n"
    "2024/07/02;0100 UTC;0,2;17,9;75;\r\n"
    "2024/07/02;0200 UTC;;17,5;77;\r\n"
    "2024/07/02;0300 UTC;-9999;17,1;-9999;\r\n"
).encode("latin-1")


def test_le_os_metadados_da_estacao():
    estacao, _ = ler_csv(CSV)

    assert estacao.codigo == "A770"
    assert estacao.nome == "SAO SIMAO"
    assert estacao.uf == "SP"
    assert estacao.latitude == -21.46111111
    assert estacao.longitude == -47.57944444


def test_converte_decimal_com_virgula_e_hora_utc():
    _, leituras = ler_csv(CSV)

    assert leituras[1].chuva_mm == 0.2
    assert leituras[1].temperatura_c == 17.9
    assert leituras[1].instante == datetime(2024, 7, 2, 1, tzinfo=timezone.utc)


def test_hora_sem_medicao_vira_none_e_nao_zero():
    # O contrato paga por dia seco. Se o campo vazio virasse zero, sensor
    # quebrado seria indistinguivel de dia sem chuva.
    _, leituras = ler_csv(CSV)

    assert leituras[2].chuva_mm is None
    assert leituras[2].completa is False
    assert leituras[0].completa is True


def test_sentinela_negativo_tambem_e_ausencia():
    _, leituras = ler_csv(CSV)

    assert leituras[3].chuva_mm is None
    assert leituras[3].umidade_pct is None
    assert leituras[3].temperatura_c == 17.1


def test_distancia_ordena_estacoes_por_proximidade():
    estacao, _ = ler_csv(CSV)

    assert estacao.distancia_km(-21.46, -47.58) < 1
    assert estacao.distancia_km(-23.55, -46.63) > 100


# Formato usado pelo INMET ate 2018: cabecalhos de data e hora com outro nome e
# hora em "00:00". Trecho do arquivo real de 2018 da estacao A747 (Pradopolis/SP).
CSV_ATE_2018 = (
    "REGIAO:;SE\r\n"
    "UF:;SP\r\n"
    "ESTACAO:;PRADOPOLIS\r\n"
    "CODIGO (WMO):;A747\r\n"
    "LATITUDE:;-21,33833333\r\n"
    "LONGITUDE:;-48,11388888\r\n"
    "ALTITUDE:;544\r\n"
    "DATA DE FUNDACAO (YYYY-MM-DD):;2008-04-22\r\n"
    "DATA (YYYY-MM-DD);HORA (UTC);PRECIPITAÇÃO TOTAL, HORÁRIO (mm);"
    "TEMPERATURA DO AR - BULBO SECO, HORARIA (°C);UMIDADE RELATIVA DO AR, HORARIA (%);\r\n"
    "2018-01-01;00:00;0;22,1;81;\r\n"
    "2018-01-01;01:00;1,4;21,7;84;\r\n"
).encode("latin-1")


def test_le_tambem_o_formato_ate_2018():
    estacao, leituras = ler_csv(CSV_ATE_2018)

    assert estacao.codigo == "A747"
    assert len(leituras) == 2
    assert leituras[1].chuva_mm == 1.4
    assert leituras[1].instante == datetime(2018, 1, 1, 1, tzinfo=timezone.utc)
