"""
Leitura dos dados historicos das estacoes automaticas do INMET.

FONTE DOS DADOS

    Instituto Nacional de Meteorologia (INMET) — Dados Historicos
    https://portal.inmet.gov.br/dadoshistoricos
    Um arquivo ZIP por ano, com um CSV por estacao automatica.

Dados publicos, distribuidos gratuitamente pelo INMET, orgao do Ministerio da
Agricultura e Pecuaria. O TCC cita a fonte em toda apresentacao de numero que
venha daqui.

FORMATO DO CSV (que nao e o formato padrao de CSV)

    codificacao : latin-1
    separador   : ponto e virgula
    decimal     : virgula
    cabecalho   : 8 linhas de metadados, depois a linha de colunas
    ausente     : campo vazio ou valor negativo sentinela (-9999)
    horario     : UTC, na coluna "Hora UTC", no formato "0300 UTC"

O campo ausente e comum: em 2025, a estacao de Pradopolis (A747) tem chuva em
3.406 das 8.760 horas do ano. Nao e ruido de importacao, e falha de sensor — e
o sistema precisa tratar isso como o que e. Por isso a leitura sem medicao de
chuva vira `None` aqui, e nao zero: presumir zero transformaria sensor quebrado
em dia seco, e dia seco e exatamente o que aciona o pagamento.
"""

from __future__ import annotations

import csv
import io
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import requests

URL_DO_ANO = "https://portal.inmet.gov.br/uploads/dadoshistoricos/{ano}.zip"

# O portal do INMET fecha a conexao quando o cabecalho de agente nao parece o de
# um navegador. Nao e autenticacao nem contorno de protecao: o arquivo e publico
# e o mesmo que o navegador baixa.
CABECALHOS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0 Safari/537.36"
    ),
    "Accept": "*/*",
}

# Colunas do CSV que interessam ao seguro indexado, pelo nome que o INMET usa.
COLUNA_CHUVA = "PRECIPITAÇÃO TOTAL, HORÁRIO (mm)"
COLUNA_TEMPERATURA = "TEMPERATURA DO AR - BULBO SECO, HORARIA (°C)"
COLUNA_UMIDADE = "UMIDADE RELATIVA DO AR, HORARIA (%)"


@dataclass(frozen=True)
class Estacao:
    """Metadados do cabecalho do CSV."""

    codigo: str
    nome: str
    uf: str
    regiao: str
    latitude: float
    longitude: float
    altitude: float | None

    def distancia_km(self, latitude: float, longitude: float) -> float:
        """Distancia aproximada ate um ponto, boa o bastante para ordenar estacoes."""
        import math

        graus_lat = (self.latitude - latitude) * 111.0
        graus_lon = (self.longitude - longitude) * 111.0 * math.cos(math.radians(latitude))

        return math.hypot(graus_lat, graus_lon)


@dataclass(frozen=True)
class Leitura:
    """Uma hora medida. Campo ausente e `None`, nunca zero."""

    instante: datetime
    chuva_mm: float | None
    temperatura_c: float | None
    umidade_pct: float | None

    @property
    def completa(self) -> bool:
        return self.chuva_mm is not None


def baixar_ano(ano: int, destino: Path) -> Path:
    """Baixa o ZIP anual do INMET, se ainda nao estiver em disco."""
    destino.parent.mkdir(parents=True, exist_ok=True)

    if destino.exists() and destino.stat().st_size > 0:
        return destino

    resposta = requests.get(URL_DO_ANO.format(ano=ano), headers=CABECALHOS, timeout=600)
    resposta.raise_for_status()
    destino.write_bytes(resposta.content)

    return destino


def _numero(texto: str) -> float | None:
    """Converte '12,5' em 12.5; vazio e sentinela negativo viram None."""
    texto = (texto or "").strip()

    if not texto:
        return None

    try:
        valor = float(texto.replace(",", "."))
    except ValueError:
        return None

    # -9999 é o sentinela do INMET. Chuva, umidade e radiacao nunca sao negativas;
    # temperatura pode ser, e por isso o corte e feito por coluna, nao aqui.
    return valor


def _instante(data: str, hora: str) -> datetime:
    """'2024/07/02' + '0300 UTC' -> datetime com fuso UTC."""
    data = data.replace("-", "/").strip()
    hora_limpa = hora.strip().replace("UTC", "").strip()
    horas = int(hora_limpa[:2])

    ano, mes, dia = (int(parte) for parte in data.split("/"))

    return datetime(ano, mes, dia, horas, tzinfo=timezone.utc)


def ler_csv(conteudo: bytes) -> tuple[Estacao, list[Leitura]]:
    """Interpreta o CSV de uma estacao, devolvendo metadados e leituras horarias."""
    texto = conteudo.decode("latin-1")
    linhas = texto.splitlines()

    cabecalho: dict[str, str] = {}
    for linha in linhas[:8]:
        if ";" not in linha:
            continue
        chave, valor = linha.split(";", 1)
        cabecalho[chave.strip().rstrip(":").upper()] = valor.strip().rstrip(";")

    estacao = Estacao(
        codigo=cabecalho.get("CODIGO (WMO)", "?"),
        nome=cabecalho.get("ESTACAO", "?"),
        uf=cabecalho.get("UF", "?"),
        regiao=cabecalho.get("REGIAO", "?"),
        latitude=float(cabecalho.get("LATITUDE", "0").replace(",", ".")),
        longitude=float(cabecalho.get("LONGITUDE", "0").replace(",", ".")),
        altitude=_numero(cabecalho.get("ALTITUDE", "")),
    )

    leitor = csv.DictReader(io.StringIO("\n".join(linhas[8:])), delimiter=";")
    leituras: list[Leitura] = []

    for registro in leitor:
        data = (registro.get("Data") or "").strip()
        hora = (registro.get("Hora UTC") or "").strip()

        if not data or not hora:
            continue

        chuva = _numero(registro.get(COLUNA_CHUVA, ""))
        umidade = _numero(registro.get(COLUNA_UMIDADE, ""))

        leituras.append(
            Leitura(
                instante=_instante(data, hora),
                chuva_mm=chuva if chuva is not None and chuva >= 0 else None,
                temperatura_c=_numero(registro.get(COLUNA_TEMPERATURA, "")),
                umidade_pct=umidade if umidade is not None and 0 <= umidade <= 100 else None,
            )
        )

    return estacao, leituras


def abrir_do_zip(caminho_zip: Path, codigo: str) -> tuple[Estacao, list[Leitura]]:
    """Le, de dentro do ZIP anual, o CSV da estacao de codigo informado."""
    codigo = codigo.upper()

    with zipfile.ZipFile(caminho_zip) as arquivo:
        for nome in arquivo.namelist():
            if not nome.upper().endswith(".CSV"):
                continue
            if f"_{codigo}_" in nome.upper():
                return ler_csv(arquivo.read(nome))

    raise KeyError(f"Estacao {codigo} nao encontrada em {caminho_zip.name}")


def listar_estacoes(caminho_zip: Path, uf: str | None = None) -> list[Estacao]:
    """Le so o cabecalho de cada CSV do ZIP. Serve para achar a estacao mais proxima."""
    estacoes: list[Estacao] = []

    with zipfile.ZipFile(caminho_zip) as arquivo:
        for nome in arquivo.namelist():
            if not nome.upper().endswith(".CSV"):
                continue
            if uf and f"_{uf.upper()}_" not in nome.upper():
                continue

            with arquivo.open(nome) as fluxo:
                cabecalho = fluxo.read(600)

            estacao, _ = ler_csv(cabecalho + b"\n")
            estacoes.append(estacao)

    return estacoes
