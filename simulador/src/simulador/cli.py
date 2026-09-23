"""
Linha de comando do simulador de estacoes (HU04).

    python -m simulador baixar --ano 2024
    python -m simulador estacoes --uf SP --perto -21.46,-47.58
    python -m simulador analisar --estacao A770 --ano 2024
    python -m simulador enviar --estacao A770 --ano 2024 --de 2024-06-01 --ate 2024-08-09 \
           --fonte estacao-inmet-a770 --ate-hoje
    python -m simulador enviar ... --destino mqtt --broker localhost
    python -m simulador ponte --api http://localhost:3001/api

As chaves privadas das estacoes vem do arquivo `.env` (CHAVE_<FONTE>) ou da
opcao `--chave`. Nunca sao gravadas no repositorio (RNF16).
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import envio, mqtt, serie
from .assinatura import endereco_de
from .inmet import abrir_do_zip, baixar_ano, listar_estacoes

RAIZ = Path(__file__).resolve().parents[2]
DIR_DADOS = RAIZ / "dados"


def _carregar_env() -> None:
    """Le o .env do simulador, se existir. Sem dependencia externa."""
    caminho = RAIZ / ".env"

    if not caminho.exists():
        return

    for linha in caminho.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        os.environ.setdefault(chave.strip(), valor.strip())


def _chave_da_fonte(fonte: str, informada: str | None) -> str:
    if informada:
        return informada

    variavel = "CHAVE_" + fonte.upper().replace("-", "_")
    chave = os.environ.get(variavel)

    if not chave:
        raise SystemExit(
            f"Defina a chave privada da fonte em {variavel} (no .env) ou passe --chave."
        )

    return chave


def _zip_do_ano(ano: int) -> Path:
    return baixar_ano(ano, DIR_DADOS / f"{ano}.zip")


def _data(texto: str, fim_do_dia: bool = False) -> datetime:
    data = datetime.strptime(texto, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    return data.replace(hour=23) if fim_do_dia else data


# ----------------------------------------------------------------- comandos


def comando_baixar(opcoes) -> None:
    caminho = _zip_do_ano(opcoes.ano)
    tamanho = caminho.stat().st_size / (1024 * 1024)

    print(f"{caminho}  ({tamanho:.0f} MB)")
    print("Fonte: INMET — https://portal.inmet.gov.br/dadoshistoricos")


def comando_estacoes(opcoes) -> None:
    estacoes = listar_estacoes(_zip_do_ano(opcoes.ano), uf=opcoes.uf)

    if opcoes.perto:
        latitude, longitude = (float(parte) for parte in opcoes.perto.split(","))
        estacoes.sort(key=lambda e: e.distancia_km(latitude, longitude))
    else:
        estacoes.sort(key=lambda e: e.codigo)

    for estacao in estacoes[: opcoes.limite]:
        linha = f"{estacao.codigo}  {estacao.nome[:28]:28}  {estacao.uf}"
        linha += f"  {estacao.latitude:9.4f} {estacao.longitude:9.4f}"

        if opcoes.perto:
            linha += f"  {estacao.distancia_km(latitude, longitude):6.1f} km"

        print(linha)


def comando_analisar(opcoes) -> None:
    estacao, leituras = abrir_do_zip(_zip_do_ano(opcoes.ano), opcoes.estacao)
    dias = serie.resumo_diario(leituras)
    completos = [chave for chave, dia in dias.items() if dia["horas"] >= 20]

    print(f"{estacao.codigo} {estacao.nome}/{estacao.uf} ({estacao.latitude}, {estacao.longitude})")
    print(f"leituras horarias..: {len(leituras)}")
    print(f"com medicao de chuva: {sum(1 for l in leituras if l.completa)}")
    print(f"dias com 20h ou mais: {len(completos)} de {len(dias)}")
    print(f"chuva no periodo....: {sum(d['chuva_mm'] for d in dias.values()):.1f} mm")

    # Maior estiagem: a mesma regra do oraculo, aplicada dia a dia.
    melhor, inicio, atual, inicio_atual = 0, None, 0, None
    for chave in sorted(dias):
        dia = dias[chave]

        if dia["horas"] < 20:
            atual, inicio_atual = 0, None
            continue

        if dia["chuva_mm"] < 1:
            inicio_atual = inicio_atual or chave
            atual += 1
            if atual > melhor:
                melhor, inicio = atual, inicio_atual
        else:
            atual, inicio_atual = 0, None

    print(f"maior estiagem......: {melhor} dias consecutivos, a partir de {inicio}")


def comando_enviar(opcoes) -> None:
    estacao, leituras = abrir_do_zip(_zip_do_ano(opcoes.ano), opcoes.estacao)

    if opcoes.de or opcoes.ate:
        de = _data(opcoes.de) if opcoes.de else leituras[0].instante
        ate = _data(opcoes.ate, fim_do_dia=True) if opcoes.ate else leituras[-1].instante
        leituras = serie.recortar(leituras, de, ate)

    if not leituras:
        raise SystemExit("A janela escolhida nao tem leitura nenhuma.")

    total_bruto = len(leituras)

    if not opcoes.incluir_falhas:
        leituras = [leitura for leitura in leituras if leitura.completa]

    deslocamento = timedelta(0)
    if opcoes.ate_hoje:
        # A serie termina as 23h de ONTEM, e nao na hora atual: o dia de hoje
        # ainda nao acabou, e um dia com menos de 20 horas medidas interrompe a
        # contagem de dias secos em vez de contar como seco. Terminar em um dia
        # incompleto zeraria o indice — foi o que aconteceu na primeira tentativa.
        ontem = datetime.now(timezone.utc) - timedelta(days=1)
        fim = ontem.replace(hour=23, minute=0, second=0, microsecond=0)
        leituras, deslocamento = serie.deslocar_para(leituras, fim)

    chave = _chave_da_fonte(opcoes.fonte, opcoes.chave)

    print(f"Estacao {estacao.codigo} {estacao.nome}/{estacao.uf} — fonte '{opcoes.fonte}'")
    print(f"Endereco que assina.: {endereco_de(chave)}")
    print(f"Leituras............: {len(leituras)} de {total_bruto} na janela")
    print(f"Periodo enviado.....: {leituras[0].instante:%Y-%m-%d} a {leituras[-1].instante:%Y-%m-%d}")

    if deslocamento:
        print(
            f"ATENCAO: datas deslocadas em {deslocamento.days} dias para terminarem hoje. "
            "Os valores medidos sao os originais do INMET; as datas, nao."
        )

    print(f"Dias secos no fim...: {serie.dias_secos_ao_final(leituras)}")
    print(f"Periodo para o oraculo: {leituras[-1].instante:%Y%m%d}")
    print("Fonte dos dados.....: INMET — https://portal.inmet.gov.br/dadoshistoricos")
    print()

    if opcoes.destino == "mqtt":
        envelopes = [
            mqtt.montar_envelope(opcoes.fonte, lote, chave) for lote in serie.em_lotes(leituras)
        ]
        publicados = mqtt.publicar(envelopes, broker=opcoes.broker, porta=opcoes.porta)
        print(f"{publicados} lote(s) publicados em {opcoes.broker}:{opcoes.porta}")
        return

    for indice, resultado in enumerate(
        envio.enviar_serie(opcoes.api, opcoes.fonte, leituras, chave), start=1
    ):
        if resultado.erro:
            print(f"  lote {indice}: {resultado.erro}")
            continue

        escore = f"{resultado.escore:.2f}" if resultado.escore is not None else "—"
        print(
            f"  lote {indice}: {resultado.aceitas} aceitas, "
            f"{resultado.recusadas} recusadas, {resultado.duplicadas} repetidas "
            f"— reputacao {escore}"
        )


def comando_ponte(opcoes) -> None:
    mqtt.ponte(opcoes.api, broker=opcoes.broker, porta=opcoes.porta)


def comando_endereco(opcoes) -> None:
    chave = _chave_da_fonte(opcoes.fonte, opcoes.chave)
    print(endereco_de(chave))


# ------------------------------------------------------------------ parser


def construir_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="simulador", description="Simulador de estacoes do AgroSmart, com dados reais do INMET"
    )
    sub = parser.add_subparsers(dest="comando", required=True)

    baixar = sub.add_parser("baixar", help="baixa o ZIP anual do INMET")
    baixar.add_argument("--ano", type=int, default=2024)
    baixar.set_defaults(funcao=comando_baixar)

    estacoes = sub.add_parser("estacoes", help="lista estacoes, opcionalmente por proximidade")
    estacoes.add_argument("--ano", type=int, default=2024)
    estacoes.add_argument("--uf")
    estacoes.add_argument("--perto", help="latitude,longitude do talhao")
    estacoes.add_argument("--limite", type=int, default=10)
    estacoes.set_defaults(funcao=comando_estacoes)

    analisar = sub.add_parser("analisar", help="qualidade da serie e maior estiagem")
    analisar.add_argument("--estacao", required=True)
    analisar.add_argument("--ano", type=int, default=2024)
    analisar.set_defaults(funcao=comando_analisar)

    enviar = sub.add_parser("enviar", help="envia a serie assinada para a API ou para o MQTT")
    enviar.add_argument("--estacao", required=True, help="codigo WMO, por exemplo A770")
    enviar.add_argument("--ano", type=int, default=2024)
    enviar.add_argument("--de", help="AAAA-MM-DD")
    enviar.add_argument("--ate", help="AAAA-MM-DD")
    enviar.add_argument("--fonte", required=True, help="identificador da fonte no backend")
    enviar.add_argument("--chave", help="chave privada da fonte; prefira o .env")
    enviar.add_argument("--api", default=os.environ.get("API_URL", "http://localhost:3001/api"))
    enviar.add_argument("--destino", choices=("api", "mqtt"), default="api")
    enviar.add_argument("--broker", default="localhost")
    enviar.add_argument("--porta", type=int, default=1883)
    enviar.add_argument(
        "--ate-hoje",
        action="store_true",
        help="desloca as datas para a serie terminar hoje, sem alterar os valores",
    )
    enviar.add_argument(
        "--incluir-falhas",
        action="store_true",
        help="envia tambem as horas sem medicao, para exercitar RF12 e RF13",
    )
    enviar.set_defaults(funcao=comando_enviar)

    ponte = sub.add_parser("ponte", help="repassa do broker MQTT para a API")
    ponte.add_argument("--api", default=os.environ.get("API_URL", "http://localhost:3001/api"))
    ponte.add_argument("--broker", default="localhost")
    ponte.add_argument("--porta", type=int, default=1883)
    ponte.set_defaults(funcao=comando_ponte)

    endereco = sub.add_parser("endereco", help="endereco publico da chave de uma fonte")
    endereco.add_argument("--fonte", required=True)
    endereco.add_argument("--chave")
    endereco.set_defaults(funcao=comando_endereco)

    return parser


def main(argumentos: list[str] | None = None) -> int:
    _carregar_env()
    opcoes = construir_parser().parse_args(argumentos)

    try:
        opcoes.funcao(opcoes)
    except KeyboardInterrupt:
        print("\ninterrompido")
        return 130

    return 0


if __name__ == "__main__":
    sys.exit(main())
