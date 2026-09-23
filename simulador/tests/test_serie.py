"""Recorte, deslocamento de datas e contagem de dias secos."""

from datetime import datetime, timedelta, timezone

from simulador.inmet import Leitura
from simulador.serie import (
    dias_secos_ao_final,
    deslocar_para,
    em_lotes,
    para_api,
    recortar,
    resumo_diario,
)


def horas(dia: str, chuva_por_hora, horas_no_dia: int = 24):
    """Serie horaria de um dia, com a chuva informada em cada hora."""
    base = datetime.fromisoformat(dia).replace(tzinfo=timezone.utc)

    return [
        Leitura(
            instante=base + timedelta(hours=hora),
            chuva_mm=chuva_por_hora,
            temperatura_c=25.0,
            umidade_pct=60.0,
        )
        for hora in range(horas_no_dia)
    ]


def test_recorta_incluindo_as_pontas():
    serie = horas("2024-07-02", 0) + horas("2024-07-03", 0)
    recorte = recortar(
        serie,
        datetime(2024, 7, 3, tzinfo=timezone.utc),
        datetime(2024, 7, 3, 23, tzinfo=timezone.utc),
    )

    assert len(recorte) == 24
    assert all(leitura.instante.day == 3 for leitura in recorte)


def test_deslocamento_move_datas_e_preserva_valores():
    serie = horas("2024-07-02", 1.5)
    fim = datetime(2026, 9, 22, 23, tzinfo=timezone.utc)
    deslocada, deslocamento = deslocar_para(serie, fim)

    assert deslocada[-1].instante == fim
    assert deslocamento.days > 0
    assert [l.chuva_mm for l in deslocada] == [l.chuva_mm for l in serie]
    # O intervalo entre leituras continua o mesmo: a serie foi movida, nao esticada.
    assert deslocada[1].instante - deslocada[0].instante == timedelta(hours=1)


def test_resumo_diario_soma_a_chuva_das_horas():
    # 24 horas de 0,5 mm sao 12 mm no dia — a mesma regra do consolidador.
    dias = resumo_diario(horas("2024-07-02", 0.5))

    assert dias[20240702]["chuva_mm"] == 12
    assert dias[20240702]["horas"] == 24


def test_dias_secos_ao_final_para_no_dia_com_chuva():
    serie = horas("2024-07-01", 1.0) + horas("2024-07-02", 0) + horas("2024-07-03", 0)

    assert dias_secos_ao_final(serie) == 2


def test_dia_incompleto_interrompe_a_contagem_em_vez_de_contar_como_seco():
    # Estacao que so reportou 5 horas do dia nao autoriza dizer que o dia foi seco.
    serie = horas("2024-07-02", 0) + horas("2024-07-03", 0, horas_no_dia=5)

    assert dias_secos_ao_final(serie) == 0


def test_para_api_usa_o_nome_canonico_da_marca_de_tempo():
    corpo = para_api(horas("2024-07-02", 0.4)[0])

    assert corpo["instante"] == "2024-07-02T00:00:00Z"
    assert corpo["chuvaMm"] == 0.4
    assert corpo["temperaturaC"] == 25.0
    assert corpo["umidadePct"] == 60.0


def test_em_lotes_respeita_o_limite_da_api():
    lotes = em_lotes(horas("2024-07-02", 0) * 30, tamanho=500)

    assert [len(lote) for lote in lotes] == [500, 220]
