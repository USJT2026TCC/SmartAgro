"""
Linha de comando do modulo de visao (HU11).

    python -m visao servico --uma-vez
    python -m visao servico --intervalo 60
    python -m visao analisar foto.jpg
    python -m visao avaliar --dados dados/preparado

Variaveis de ambiente (arquivo `.env` deste modulo):

    API_URL           http://localhost:3001/api
    CHAVE_DE_SERVICO  a mesma do backend
    VISAO_PESOS       caminho do modelo treinado; sem ele, usa o estimador classico
    VISAO_VERSAO      versao gravada junto da analise
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from . import baseline, modelo
from .clienteBackend import ClienteBackend
from .indice import consolidar
from .servico import Estimador, estimador_baseline, servir

RAIZ = Path(__file__).resolve().parents[2]


def _carregar_env() -> None:
    caminho = RAIZ / ".env"

    if not caminho.exists():
        return

    for linha in caminho.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        os.environ.setdefault(chave.strip(), valor.strip())


def _estimador(registrar=print) -> Estimador:
    """
    Modelo treinado, se houver; estimador classico, se nao.

    A escolha e dita em voz alta toda vez. Rodar com a heuristica de cor achando
    que se esta rodando o modelo treinado seria o pior dos dois mundos.
    """
    if modelo.disponivel():
        try:
            carregado, versao = modelo.carregar()
        except modelo.ModeloIndisponivel as erro:
            # Pesos presentes mas incompativeis — por exemplo, treinados com a
            # classe de doenca, que saiu do escopo. Cair para a heuristica e
            # AVISAR e melhor que classificar com uma rede que conta outra coisa.
            registrar(f"AVISO......: pesos em {modelo.CAMINHO_DOS_PESOS} recusados: {erro}")
        else:
            registrar(f"Modelo.....: {versao} ({modelo.CAMINHO_DOS_PESOS})")

            return Estimador(
                versao=versao,
                classificar=lambda conteudo: modelo.classificar_com(carregado, conteudo),
            )

    registrar(f"Modelo.....: {baseline.VERSAO} (heuristica de cor, sem treino)")
    registrar(
        "             Confianca fixa em "
        f"{baseline.CONFIANCA:.0%}: abaixo do limiar, entao toda analise vai ao perito."
    )

    return estimador_baseline()


def comando_servico(opcoes) -> None:
    api = opcoes.api or os.environ.get("API_URL", "http://localhost:3001/api")
    chave = opcoes.chave or os.environ.get("CHAVE_DE_SERVICO", "")

    if not chave:
        raise SystemExit("Defina CHAVE_DE_SERVICO no .env ou passe --chave.")

    print("Modulo de visao do AgroSmart")
    print("----------------------------")
    print(f"Backend....: {api}")
    estimador = _estimador()
    print(f"Intervalo..: {opcoes.intervalo}s{' (um unico ciclo)' if opcoes.uma_vez else ''}")
    print()

    servir(
        ClienteBackend(api, chave),
        estimador,
        intervalo_s=opcoes.intervalo,
        uma_vez=opcoes.uma_vez,
    )


def comando_analisar(opcoes) -> None:
    """Analisa arquivos locais, sem backend. Util para conferir o estimador."""
    estimador = _estimador()
    resultados = [estimador.classificar(Path(caminho).read_bytes()) for caminho in opcoes.arquivos]
    contagens = [contagem for contagem, _ in resultados]
    confianca = sum(c for _, c in resultados) / len(resultados)
    analise = consolidar(contagens, confianca)

    print()
    print(f"Imagens............: {analise.imagens}")
    print(f"Cobertura de lavoura: {analise.cobertura_de_lavoura:.1%}")
    print(f"Indice de dano.....: {analise.indice_dano:.1%}")
    print(f"Confianca..........: {analise.confianca:.0%}")

    for observacao in analise.observacoes:
        print(f"  - {observacao}")


def construir_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="visao", description="Modulo de visao do AgroSmart")
    sub = parser.add_subparsers(dest="comando", required=True)

    servico = sub.add_parser("servico", help="analisa os lotes pendentes no backend")
    servico.add_argument("--api")
    servico.add_argument("--chave")
    servico.add_argument("--intervalo", type=int, default=60)
    servico.add_argument("--uma-vez", action="store_true")
    servico.set_defaults(funcao=comando_servico)

    analisar = sub.add_parser("analisar", help="analisa arquivos locais, sem backend")
    analisar.add_argument("arquivos", nargs="+")
    analisar.set_defaults(funcao=comando_analisar)

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
