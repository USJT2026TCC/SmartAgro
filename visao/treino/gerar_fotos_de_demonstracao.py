"""
Gera fotos de demonstracao, com GPS gravado no EXIF, para a tela "Fotos da lavoura".

As imagens sao recortes reais da validacao da base de referencia; as COORDENADAS
sao inventadas, para cairem no talhao-01 da demonstracao, em Sao Simao/SP. Isso
fica escrito no nome dos arquivos e no LEIAME gerado junto: sao fotos de
demonstracao, e nao fotos da lavoura segurada.

Fonte das imagens: Suicmez, Yilmaz e Kahraman (2026), v2.1,
DOI 10.5281/zenodo.22062459, CC BY 4.0.

    python treino/gerar_fotos_de_demonstracao.py

Gera, em docs/demonstracao/fotos/:
  - 6 fotos com GPS dentro do talhao, com estresse visivel
  - 1 foto com GPS fora do talhao, que o servidor recusa
  - 1 foto sem GPS, para localizar pelo aparelho ou marcando no mapa
"""

from __future__ import annotations

import csv
from datetime import datetime
from fractions import Fraction
from pathlib import Path

from PIL import Image
from PIL.TiffImagePlugin import IFDRational

RAIZ = Path(__file__).resolve().parents[1]
PREPARADO = RAIZ / "dados" / "preparado"
DESTINO = RAIZ.parent / "docs" / "demonstracao" / "fotos"

# Dentro do talhao-01 (lon -47,59 a -47,57; lat -21,45 a -21,47), espalhados.
DENTRO = [
    (-21.4535, -47.5860),
    (-21.4560, -47.5735),
    (-21.4610, -47.5820),
    (-21.4645, -47.5745),
    (-21.4675, -47.5870),
    (-21.4630, -47.5790),
]
FORA = (-21.4600, -47.6000)  # uns 1,1 km a oeste do talhao

LADO = 896  # recortes de 224 ampliados 4x, para parecerem fotos e nao miniaturas
QUANDO = datetime(2026, 9, 20, 9, 30)


def em_graus_minutos_segundos(valor: float) -> tuple:
    valor = abs(valor)
    graus = int(valor)
    minutos = int((valor - graus) * 60)
    segundos = (valor - graus - minutos / 60) * 3600
    return (
        IFDRational(graus, 1),
        IFDRational(minutos, 1),
        IFDRational(Fraction(segundos).limit_denominator(10_000)),
    )


def salvar(imagem: Image.Image, caminho: Path, posicao: tuple | None, instante: datetime) -> None:
    exif = Image.Exif()
    texto_da_data = instante.strftime("%Y:%m:%d %H:%M:%S")

    exif[0x0132] = texto_da_data  # DateTime
    exif[0x010F] = "AgroSmart (demonstracao)"  # Make
    exif.get_ifd(0x8769)[0x9003] = texto_da_data  # DateTimeOriginal

    if posicao is not None:
        lat, lon = posicao
        gps = exif.get_ifd(0x8825)
        gps[0x0001] = "S" if lat < 0 else "N"
        gps[0x0002] = em_graus_minutos_segundos(lat)
        gps[0x0003] = "W" if lon < 0 else "E"
        gps[0x0004] = em_graus_minutos_segundos(lon)

    imagem.save(caminho, "JPEG", quality=90, exif=exif.tobytes())


def main() -> None:
    with (PREPARADO / "indice.csv").open(encoding="utf-8") as arquivo:
        linhas = [
            l for l in csv.DictReader(arquivo)
            if l["divisao"] == "validacao" and float(l["lavoura"]) >= 0.5
        ]

    if not linhas:
        raise SystemExit("Rode treino/preparar_dados.py antes.")

    # As de mais estresse primeiro: na demonstracao, o indice precisa aparecer.
    linhas.sort(key=lambda l: float(l["dano"]), reverse=True)

    DESTINO.mkdir(parents=True, exist_ok=True)
    for antigo in DESTINO.glob("*.jpg"):
        antigo.unlink()

    def abrir(linha):
        return Image.open(PREPARADO / "images" / linha["imagem"]).convert("RGB").resize(
            (LADO, LADO), Image.NEAREST
        )

    for numero, (linha, posicao) in enumerate(zip(linhas, DENTRO), start=1):
        salvar(abrir(linha), DESTINO / f"demo-{numero:02d}-com-gps.jpg", posicao, QUANDO)

    salvar(abrir(linhas[len(DENTRO)]), DESTINO / "demo-07-fora-do-talhao.jpg", FORA, QUANDO)
    salvar(abrir(linhas[len(DENTRO) + 1]), DESTINO / "demo-08-sem-gps.jpg", None, QUANDO)

    (DESTINO / "LEIAME.md").write_text(
        """# Fotos de demonstração

Para testar e apresentar a tela **Fotos da lavoura** do aplicativo.

**As imagens são reais; as coordenadas, não.** Cada foto é um recorte da validação da base de
referência (Suiçmez, Yilmaz e Kahraman, 2026, v2.1, DOI 10.5281/zenodo.22062459, CC BY 4.0),
ampliado, com um GPS inventado gravado no EXIF para cair no talhão-01 da demonstração, em São
Simão/SP. Não são fotos da lavoura segurada.

| Arquivo | O que mostra |
|---|---|
| `demo-01` a `demo-06` | GPS dentro do talhão: o aplicativo lê o local da própria foto |
| `demo-07-fora-do-talhao` | GPS a 1 km do talhão: aparece em vermelho no mapa e o servidor recusa |
| `demo-08-sem-gps` | Sem GPS: localizar pelo aparelho ou marcando no mapa (fica registrado como manual) |

Gerado por `visao/treino/gerar_fotos_de_demonstracao.py`.
""",
        encoding="utf-8",
    )

    print(f"{len(list(DESTINO.glob('*.jpg')))} fotos em {DESTINO}")


if __name__ == "__main__":
    main()
