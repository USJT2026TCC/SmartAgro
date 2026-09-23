"""
Do mapa de classes ao indice de dano que vai para a cadeia (RF15, RF16).

O modelo de visao classifica cada pixel em uma de cinco classes. Esta e a parte
que transforma esse mapa em UM numero entre 0 e 1 — o percentual da lavoura
prejudicado — e em uma confianca. Depois desse ponto, o numero atravessa a
fronteira e o contrato paga com base nele, sem revisar nada.

TRES DECISOES QUE MUDAM O VALOR PAGO

1. O DENOMINADOR E A LAVOURA, NAO O TALHAO INTEIRO.

   Solo exposto nao e lavoura prejudicada: e carreador, area de manobra, falha
   de plantio, ou simplesmente cultura que ainda nao fechou o dossel. Contar
   solo como dano faria a apolice pagar por terra que nunca teve planta. O
   indice e, portanto:

       dano = area de lavoura em estresse / area de lavoura

2. ESTRESSE LEVE NAO VALE O MESMO QUE ESTRESSE SEVERO.

   Somar as duas classes trataria uma folha murcha que se recupera com a
   proxima chuva como perda total. O peso padrao e 0,5 para leve e 1,0 para
   severo — e uma escolha atuarial, nao tecnica, e por isso fica configuravel e
   registrada junto do resultado.

3. FOTO E AMOSTRA; ORTOMOSAICO E CENSO.

   Um ortomosaico de drone cobre o talhao inteiro, e a proporcao medida E a
   proporcao do talhao. Fotos de celular cobrem alguns pontos, e a proporcao
   medida e uma ESTIMATIVA. A confianca cai quando ha poucas amostras ou quando
   elas discordam entre si — ver `confianca_da_amostragem`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import pstdev

# Classes do mapa de segmentacao. A ordem e a do dataset de referencia
# (ver docs/DADOS.md, secao 2.1).
CLASSES = ("solo", "saudavel", "estresse_leve", "estresse_severo", "outro_dano")

# Peso de cada classe no numerador do indice de dano.
PESOS_PADRAO = {
    "solo": 0.0,
    "saudavel": 0.0,
    "estresse_leve": 0.5,
    "estresse_severo": 1.0,
    # Ferrugem e outras doencas nao sao dano por seca. Entram com peso zero no
    # indice climatico-hidrico; se um dia virarem cobertura propria, ganham o
    # proprio indice, e nao um peso aqui dentro.
    "outro_dano": 0.0,
}

# Classes que compoem a lavoura — o denominador.
CLASSES_DE_LAVOURA = ("saudavel", "estresse_leve", "estresse_severo", "outro_dano")

# Abaixo disto, a imagem e quase toda solo: um talhao recem-plantado, uma foto do
# carreador, uma foto do ceu. A proporcao de dano sobre tao pouca lavoura nao
# significa nada.
COBERTURA_MINIMA = 0.10


@dataclass
class Analise:
    """Resultado de um lote, no formato que o backend espera."""

    indice_dano: float
    confianca: float
    cobertura_de_lavoura: float
    imagens: int
    pesos: dict[str, float] = field(default_factory=lambda: dict(PESOS_PADRAO))
    observacoes: list[str] = field(default_factory=list)

    def para_api(self, versao_modelo: str, lote_id: str) -> dict:
        return {
            "loteId": lote_id,
            "versaoModelo": versao_modelo,
            "indiceDano": round(self.indice_dano, 4),
            "confianca": round(self.confianca, 4),
        }


def proporcoes(contagem: dict[str, int]) -> dict[str, float]:
    """Fracao de pixels de cada classe. Chaves desconhecidas sao ignoradas."""
    total = sum(contagem.get(classe, 0) for classe in CLASSES)

    if total == 0:
        return {classe: 0.0 for classe in CLASSES}

    return {classe: contagem.get(classe, 0) / total for classe in CLASSES}


def indice_de_dano(contagem: dict[str, int], pesos: dict[str, float] | None = None) -> float:
    """
    Fracao da LAVOURA em estresse, ponderada pela gravidade.

    Devolve 0 quando nao ha lavoura na imagem: sem planta, nao ha o que estar
    danificado, e inventar dano ai seria inventar indenizacao.
    """
    pesos = pesos or PESOS_PADRAO
    fracoes = proporcoes(contagem)

    lavoura = sum(fracoes[classe] for classe in CLASSES_DE_LAVOURA)
    if lavoura == 0:
        return 0.0

    dano = sum(fracoes[classe] * pesos.get(classe, 0.0) for classe in CLASSES)

    return min(dano / lavoura, 1.0)


def confianca_da_amostragem(
    danos_por_imagem: list[float],
    cobertura_de_lavoura: float,
    confianca_do_modelo: float,
) -> tuple[float, list[str]]:
    """
    Combina tres coisas que podem estar erradas, e devolve a confianca final.

    - `confianca_do_modelo`: o quanto o classificador confia nos proprios pixels;
    - a CONCORDANCIA entre as imagens do lote: se uma foto diz 10% e outra diz
      80%, a media de 45% nao descreve nem uma nem outra;
    - o NUMERO de imagens: uma foto sozinha nao sustenta uma afirmacao sobre um
      talhao de centenas de hectares.

    Cada fator so pode DERRUBAR a confianca, nunca levanta-la. Um lote bom
    mantem a confianca do modelo; qualquer fragilidade a reduz, e confianca
    baixa manda a analise para o perito (RF17) em vez de acionar pagamento.
    """
    observacoes: list[str] = []
    confianca = max(0.0, min(confianca_do_modelo, 1.0))

    if not danos_por_imagem:
        return 0.0, ["lote sem imagem analisavel"]

    if cobertura_de_lavoura < COBERTURA_MINIMA:
        observacoes.append(
            f"apenas {cobertura_de_lavoura:.0%} da area fotografada tem lavoura; "
            "o indice foi calculado sobre pouca planta"
        )
        confianca *= 0.5

    quantidade = len(danos_por_imagem)
    if quantidade < 3:
        observacoes.append(f"amostra pequena: {quantidade} imagem(ns) no lote")
        confianca *= 0.6 if quantidade == 1 else 0.8

    if quantidade > 1:
        desvio = pstdev(danos_por_imagem)
        if desvio > 0.25:
            observacoes.append(
                f"as imagens discordam entre si (desvio de {desvio:.0%} no dano estimado)"
            )
            confianca *= 0.6
        elif desvio > 0.15:
            observacoes.append(f"dispersao moderada entre as imagens ({desvio:.0%})")
            confianca *= 0.85

    return round(max(confianca, 0.0), 4), observacoes


def consolidar(
    contagens_por_imagem: list[dict[str, int]],
    confianca_do_modelo: float,
    pesos: dict[str, float] | None = None,
) -> Analise:
    """
    Junta as imagens de um lote em uma unica analise.

    A soma das contagens, e nao a media dos indices, e o que vai para o indice:
    uma foto de 4 mil pixels nao pode pesar tanto quanto um ortomosaico de 4
    milhoes. Os indices individuais entram apenas no calculo da confianca, para
    medir se as imagens concordam.
    """
    if not contagens_por_imagem:
        return Analise(0.0, 0.0, 0.0, 0, dict(pesos or PESOS_PADRAO), ["lote sem imagens"])

    total: dict[str, int] = {classe: 0 for classe in CLASSES}
    for contagem in contagens_por_imagem:
        for classe in CLASSES:
            total[classe] += contagem.get(classe, 0)

    fracoes = proporcoes(total)
    cobertura = sum(fracoes[classe] for classe in CLASSES_DE_LAVOURA)

    danos = [indice_de_dano(contagem, pesos) for contagem in contagens_por_imagem]
    confianca, observacoes = confianca_da_amostragem(danos, cobertura, confianca_do_modelo)

    return Analise(
        indice_dano=round(indice_de_dano(total, pesos), 4),
        confianca=confianca,
        cobertura_de_lavoura=round(cobertura, 4),
        imagens=len(contagens_por_imagem),
        pesos=dict(pesos or PESOS_PADRAO),
        observacoes=observacoes,
    )
