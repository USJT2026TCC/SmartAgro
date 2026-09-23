"""
Estimador classico de estresse, por indices de cor. Sem rede neural.

POR QUE ISTO EXISTE

O modelo treinado e o destino (ver `modelo.py` e `treino/`). Mas um modelo
treinado precisa de GPU, de dataset preparado e de tempo — e enquanto ele nao
existe, o resto da cadeia (produtor fotografa, backend guarda, perito revisa,
oraculo publica) nao pode ficar sem nada para exercitar.

Este modulo preenche esse lugar com uma tecnica que e honesta sobre o que e:
separacao de solo e planta por indice de excesso de verde (ExG), e separacao de
planta sadia e planta em estresse por matiz. E o que a literatura de agricultura
de precisao usa ha decadas, roda em CPU, e nao depende de treino.

A CONFIANCA E DELIBERADAMENTE BAIXA

Ela e fixada abaixo do limiar de 70%. Consequencia, e nao efeito colateral: toda
analise produzida aqui vai para o perito (RF17), e NENHUMA aciona pagamento
sozinha. Uma heuristica de cor nao tem como distinguir milho seco de milho
maduro, nem lavoura queimada de solo argiloso — e um numero desses acionando
transferencia de valor automaticamente seria exatamente o tipo de coisa que este
trabalho argumenta que nao se deve fazer.

Quando o modelo treinado entrar, ele reporta a propria confianca, e o limiar
volta a ter o significado que deveria ter.
"""

from __future__ import annotations

from io import BytesIO

import numpy as np
from PIL import Image

from .indice import CLASSES

VERSAO = "visao-baseline-exg-1.0.0"

# Confianca fixa, sempre abaixo do limiar de encaminhamento ao perito (0,70).
CONFIANCA = 0.45

# Abaixo deste excesso de verde, o pixel e solo, palhada ou sombra.
LIMIAR_DE_VEGETACAO = 0.05

# Matiz (graus) dentro da vegetacao. Verde vivo e lavoura sadia; amarelo e
# estresse; alaranjado e marrom sao tecido seco.
MATIZ_SAUDAVEL = (70, 170)
MATIZ_LEVE = (40, 70)

# Reduzir a imagem antes de contar pixels muda pouco a proporcao e muda muito o
# tempo. A proporcao e o que interessa aqui, nao o detalhe.
LADO_MAXIMO = 1024


def _abrir(conteudo: bytes) -> np.ndarray:
    """Bytes da imagem -> matriz RGB float em [0, 1], reduzida."""
    imagem = Image.open(BytesIO(conteudo)).convert("RGB")

    if max(imagem.size) > LADO_MAXIMO:
        escala = LADO_MAXIMO / max(imagem.size)
        novo = (max(1, int(imagem.width * escala)), max(1, int(imagem.height * escala)))
        imagem = imagem.resize(novo, Image.BILINEAR)

    return np.asarray(imagem, dtype=np.float32) / 255.0


def _matiz(rgb: np.ndarray) -> np.ndarray:
    """Matiz em graus (0-360), calculado sem depender de conversao da Pillow."""
    maximo = rgb.max(axis=2)
    minimo = rgb.min(axis=2)
    amplitude = maximo - minimo

    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    seguro = np.where(amplitude == 0, 1.0, amplitude)

    matiz = np.zeros_like(maximo)
    matiz = np.where(maximo == r, ((g - b) / seguro) % 6, matiz)
    matiz = np.where(maximo == g, ((b - r) / seguro) + 2, matiz)
    matiz = np.where(maximo == b, ((r - g) / seguro) + 4, matiz)

    return np.where(amplitude == 0, 0.0, matiz * 60.0)


def classificar(conteudo: bytes) -> dict[str, int]:
    """Conta os pixels de cada classe em uma imagem."""
    rgb = _abrir(conteudo)

    # Coordenadas cromaticas: tiram o efeito de sombra e de exposicao, que de
    # outro modo fariam a mesma planta mudar de classe conforme a hora do dia.
    soma = rgb.sum(axis=2)
    soma = np.where(soma == 0, 1.0, soma)
    r, g, b = rgb[:, :, 0] / soma, rgb[:, :, 1] / soma, rgb[:, :, 2] / soma

    excesso_de_verde = 2 * g - r - b
    vegetacao = excesso_de_verde > LIMIAR_DE_VEGETACAO

    matiz = _matiz(rgb)
    saudavel = vegetacao & (matiz >= MATIZ_SAUDAVEL[0]) & (matiz < MATIZ_SAUDAVEL[1])
    leve = vegetacao & (matiz >= MATIZ_LEVE[0]) & (matiz < MATIZ_LEVE[1])
    severo = vegetacao & ~saudavel & ~leve

    contagem = {
        "solo": int((~vegetacao).sum()),
        "saudavel": int(saudavel.sum()),
        "estresse_leve": int(leve.sum()),
        "estresse_severo": int(severo.sum()),
        "outro_dano": 0,
    }

    assert set(contagem) == set(CLASSES)

    return contagem
