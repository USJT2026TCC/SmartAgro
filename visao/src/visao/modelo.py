"""
Modelo treinado de segmentacao, quando existir.

O treino acontece fora daqui (ver `treino/`), em GPU. Este modulo so carrega os
pesos e classifica. Se o PyTorch nao estiver instalado, ou se os pesos nao
estiverem no lugar, quem chama recebe um erro claro e usa o estimador classico
de `baseline.py` — o sistema nunca fica sem resposta, e nunca finge ter um
modelo que nao tem.

A CONFIANCA VEM DO MODELO, E NAO DE UM NUMERO FIXO

Para cada pixel, a rede devolve uma distribuicao sobre as cinco classes. A
confianca da imagem e a media da probabilidade da classe escolhida, considerando
apenas os pixels de lavoura: a certeza do modelo sobre o ceu e sobre o carreador
nao diz nada sobre a lavoura estar ou nao em estresse, e incluir esses pixels
inflaria a confianca justamente nas fotos com pouca planta.
"""

from __future__ import annotations

import os
from io import BytesIO
from pathlib import Path

import numpy as np

from .indice import CLASSES

# Nome do arquivo de pesos e versao correspondente vem por ambiente, para que
# trocar de modelo nao exija alterar codigo — e para que a versao gravada com a
# analise seja sempre a do arquivo que de fato rodou.
CAMINHO_DOS_PESOS = os.environ.get("VISAO_PESOS", "")
VERSAO = os.environ.get("VISAO_VERSAO", "visao-unet-1.0.0")

# Tamanho de entrada da rede. O recorte e feito redimensionando a imagem inteira:
# a proporcao entre as classes e o que interessa, e nao o detalhe de cada folha.
ENTRADA = 512


class ModeloIndisponivel(RuntimeError):
    """PyTorch ausente, pesos ausentes ou incompativeis."""


def disponivel() -> bool:
    if not CAMINHO_DOS_PESOS or not Path(CAMINHO_DOS_PESOS).exists():
        return False

    try:
        import torch  # noqa: F401
    except ImportError:
        return False

    return True


def carregar():
    """
    Carrega os pesos uma vez. Levanta ModeloIndisponivel com motivo legivel.

    Devolve tambem a versao gravada no arquivo, que passa a ser a versao
    reportada com cada analise: assim o que fica registrado e o modelo que de
    fato rodou, e nao o que a variavel de ambiente diz que rodou.
    """
    if not CAMINHO_DOS_PESOS:
        raise ModeloIndisponivel("defina VISAO_PESOS com o caminho do arquivo de pesos")

    if not Path(CAMINHO_DOS_PESOS).exists():
        raise ModeloIndisponivel(f"pesos nao encontrados em {CAMINHO_DOS_PESOS}")

    try:
        from .rede import carregar as carregar_rede
    except ImportError as erro:
        raise ModeloIndisponivel("PyTorch nao instalado: pip install torch") from erro

    try:
        return carregar_rede(CAMINHO_DOS_PESOS)
    except (ValueError, RuntimeError) as erro:
        raise ModeloIndisponivel(f"pesos incompativeis: {erro}") from erro


def classificar_com(modelo, conteudo: bytes) -> tuple[dict[str, int], float]:
    """
    Classifica uma imagem. Devolve a contagem por classe e a confianca media.

    A confianca e calculada apenas sobre os pixels de lavoura, pelo motivo
    explicado no cabecalho deste modulo.
    """
    import torch
    from PIL import Image

    from .rede import padronizar

    imagem = Image.open(BytesIO(conteudo)).convert("RGB").resize((ENTRADA, ENTRADA))
    entrada = torch.from_numpy(np.asarray(imagem, dtype=np.float32) / 255.0)
    # A MESMA padronizacao do treino. Ver o cabecalho de rede.padronizar.
    entrada = padronizar(entrada.permute(2, 0, 1)).unsqueeze(0)

    with torch.no_grad():
        probabilidades = torch.softmax(modelo(entrada), dim=1)[0]

    certeza, classes = probabilidades.max(dim=0)
    classes = classes.numpy()
    certeza = certeza.numpy()

    contagem = {classe: int((classes == i).sum()) for i, classe in enumerate(CLASSES)}

    lavoura = classes != CLASSES.index("solo")
    confianca = float(certeza[lavoura].mean()) if lavoura.any() else 0.0

    return contagem, round(confianca, 4)
