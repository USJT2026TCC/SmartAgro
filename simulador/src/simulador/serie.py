"""
Da serie do INMET ao lote que a API do AgroSmart aceita.

Tres operacoes, e cada uma existe por um motivo:

RECORTE       escolhe a janela de datas que sera enviada.

DESLOCAMENTO  move as datas para terminarem hoje, SEM tocar nos valores. A
              apolice da demonstracao tem vigencia agora; a estiagem real de
              Sao Simao aconteceu em 2024. Sem deslocar, as leituras cairiam
              fora da janela que o backend consulta e nada seria publicado.
              O deslocamento e sempre declarado na saida do comando: um numero
              medido em 2024 continua sendo um numero de 2024, e a banca precisa
              saber disso.

DESCARTE      a leitura sem medicao de chuva nao vai por padrao. A API a
              aceitaria e a marcaria como invalida, o que derrubaria a reputacao
              da estacao por uma falha que o simulador introduziu ao escolher a
              janela. Com `--incluir-falhas`, elas vao — e ai o objetivo e
              justamente exercitar RF12 e RF13.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .inmet import Leitura

# A API recusa lotes maiores que isto (MAXIMO_DE_LEITURAS_POR_LOTE no backend).
LEITURAS_POR_LOTE = 500


def recortar(leituras: list[Leitura], de: datetime, ate: datetime) -> list[Leitura]:
    """Leituras com instante dentro da janela, inclusive nas pontas."""
    return [leitura for leitura in leituras if de <= leitura.instante <= ate]


def deslocar_para(leituras: list[Leitura], fim: datetime) -> tuple[list[Leitura], timedelta]:
    """
    Desloca a serie inteira para que a ultima leitura caia em `fim`.

    Devolve tambem o deslocamento aplicado, para que quem chamou possa dize-lo
    em voz alta. Os valores medidos nao sao alterados.
    """
    if not leituras:
        return [], timedelta(0)

    deslocamento = fim - max(leitura.instante for leitura in leituras)
    deslocadas = [
        Leitura(
            instante=leitura.instante + deslocamento,
            chuva_mm=leitura.chuva_mm,
            temperatura_c=leitura.temperatura_c,
            umidade_pct=leitura.umidade_pct,
        )
        for leitura in leituras
    ]

    return deslocadas, deslocamento


def para_api(leitura: Leitura) -> dict:
    """
    Formato que a API aceita.

    O campo da marca de tempo se chama `instante` na API e no banco. A API
    tambem aceita `timestamp`, o nome usado pelo consolidador do oraculo, mas
    quem envia deve usar o nome canonico.
    """
    corpo: dict[str, object] = {
        "instante": leitura.instante.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "chuvaMm": leitura.chuva_mm,
    }

    if leitura.temperatura_c is not None:
        corpo["temperaturaC"] = leitura.temperatura_c
    if leitura.umidade_pct is not None:
        corpo["umidadePct"] = leitura.umidade_pct

    return corpo


def em_lotes(leituras: list[Leitura], tamanho: int = LEITURAS_POR_LOTE) -> list[list[Leitura]]:
    """Divide a serie em lotes do tamanho que a API aceita."""
    return [leituras[i : i + tamanho] for i in range(0, len(leituras), tamanho)]


def resumo_diario(leituras: list[Leitura]) -> dict[int, dict]:
    """
    Totais por dia, do mesmo jeito que o oraculo agrega: soma da chuva na fonte.

    Serve para o simulador conseguir dizer, antes de enviar, quantos dias secos
    consecutivos a serie contem — util para escolher a janela da demonstracao.
    """
    dias: dict[int, dict] = {}

    for leitura in leituras:
        if not leitura.completa:
            continue

        chave = int(leitura.instante.strftime("%Y%m%d"))
        dia = dias.setdefault(chave, {"chuva_mm": 0.0, "horas": 0})
        dia["chuva_mm"] += leitura.chuva_mm or 0.0
        dia["horas"] += 1

    return dias


def dias_secos_ao_final(
    leituras: list[Leitura], limiar_mm: float = 1.0, horas_minimas: int = 20
) -> int:
    """
    Quantos dias secos consecutivos a serie tem no fim, pela regra do oraculo.

    Dia com menos de `horas_minimas` medicoes interrompe a contagem, em vez de
    contar como seco — a mesma decisao do consolidador (ver DECISOES.md 1.8).
    """
    dias = resumo_diario(leituras)
    contagem = 0

    for chave in sorted(dias, reverse=True):
        dia = dias[chave]

        if dia["horas"] < horas_minimas:
            break
        if dia["chuva_mm"] >= limiar_mm:
            break

        contagem += 1

    return contagem
