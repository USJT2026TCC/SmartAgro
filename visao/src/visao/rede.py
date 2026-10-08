"""
A arquitetura da rede, em um modulo estavel.

POR QUE ELA NAO MORA NO SCRIPT DE TREINO

O PyTorch, ao salvar um modelo inteiro, guarda uma referencia ao modulo em que a
classe foi definida. Se a classe morasse em `treino/treinar.py`, os pesos so
carregariam de dentro daquele script: rodar `visao analisar` daria

    AttributeError: Can't get attribute 'UNet' on <module 'visao.__main__'>

Foi o que aconteceu na primeira versao. A correcao tem duas partes, e as duas
importam:

 1. a arquitetura vive aqui, em um caminho de importacao estavel;
 2. o que se salva e o `state_dict` — so os numeros —, e nao o objeto Python.
    Arquivo de pesos e dado, nao codigo. Carregar um modelo serializado como
    objeto executa o que estiver dentro dele; com `state_dict`, o unico jeito de
    usar os numeros e com a arquitetura que ja esta no repositorio, sob revisao.

Duas arquiteturas:

 - `unet`: U-Net pequena, escrita a mao e treinada do zero (versoes 1.x e 2.x);
 - `unet-resnet18`: o mesmo decodificador U-Net sobre um codificador ResNet-18
   PRE-TREINADO na ImageNet — a transferencia de aprendizado prevista na secao
   5.3 da documentacao. O codificador ja chega sabendo reconhecer bordas,
   texturas e formas; o treino so precisa ensina-lo a separar solo, planta
   saudavel e planta estressada. Com 257 recortes de treino, essa e a diferenca
   entre aprender o problema e decorar os exemplos.

Os pesos da ImageNet so sao baixados no TREINO. Na inferencia, a rede e
montada vazia e recebe tudo do arquivo de pesos do proprio projeto; o servico
nunca busca nada na rede para funcionar.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from .indice import CLASSES

NUMERO_DE_CLASSES = len(CLASSES)


def padronizar(x: torch.Tensor) -> torch.Tensor:
    """
    Padroniza cada imagem pela propria media e desvio, canal a canal.

    POR QUE ISTO EXISTE

    As imagens de treino vem de camera de drone, com exposicao e normalizacao
    proprias: sao mais escuras e menos saturadas que uma foto de celular da
    mesma lavoura. Um modelo treinado nos valores crus aprenderia tambem o
    brilho tipico daquela camera, e no celular veria "outra lavoura".

    Padronizar remove o nivel e a escala de cada imagem, e deixa o que importa:
    a relacao entre os canais e o contraste dentro da cena. Nao elimina a
    diferenca entre os equipamentos — so um conjunto de fotos reais da lavoura
    resolveria isso —, mas tira a parte mais grosseira dela.

    O treino e a inferencia precisam usar EXATAMENTE esta funcao. Padronizar de
    um lado e nao do outro produz um modelo que parece bom na validacao e erra
    em producao, sem nenhum erro aparecer.
    """
    media = x.mean(dim=(-2, -1), keepdim=True)
    desvio = x.std(dim=(-2, -1), keepdim=True).clamp(min=1e-5)

    return (x - media) / desvio


def bloco(entrada: int, saida: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Conv2d(entrada, saida, 3, padding=1),
        nn.BatchNorm2d(saida),
        nn.ReLU(inplace=True),
        nn.Conv2d(saida, saida, 3, padding=1),
        nn.BatchNorm2d(saida),
        nn.ReLU(inplace=True),
    )


class UNet(nn.Module):
    arquitetura = "unet"

    def __init__(self, classes: int = NUMERO_DE_CLASSES, base: int = 32):
        super().__init__()
        self.base = base
        self.classes = classes

        self.desce1 = bloco(3, base)
        self.desce2 = bloco(base, base * 2)
        self.desce3 = bloco(base * 2, base * 4)
        self.fundo = bloco(base * 4, base * 8)

        self.sobe3 = nn.ConvTranspose2d(base * 8, base * 4, 2, stride=2)
        self.junta3 = bloco(base * 8, base * 4)
        self.sobe2 = nn.ConvTranspose2d(base * 4, base * 2, 2, stride=2)
        self.junta2 = bloco(base * 4, base * 2)
        self.sobe1 = nn.ConvTranspose2d(base * 2, base, 2, stride=2)
        self.junta1 = bloco(base * 2, base)

        self.saida = nn.Conv2d(base, classes, 1)

    def forward(self, x):
        d1 = self.desce1(x)
        d2 = self.desce2(F.max_pool2d(d1, 2))
        d3 = self.desce3(F.max_pool2d(d2, 2))
        f = self.fundo(F.max_pool2d(d3, 2))

        s3 = self.junta3(torch.cat([self.sobe3(f), d3], dim=1))
        s2 = self.junta2(torch.cat([self.sobe2(s3), d2], dim=1))
        s1 = self.junta1(torch.cat([self.sobe1(s2), d1], dim=1))

        return self.saida(s1)


class UNetResNet18(nn.Module):
    """
    U-Net com codificador ResNet-18 (He et al., 2016), pre-treinado na ImageNet.

    O codificador reduz a imagem a 1/32 em cinco estagios; o decodificador sobe
    de volta, juntando em cada nivel o mapa de mesma resolucao do codificador
    (as conexoes de atalho da U-Net), ate a resolucao original.
    """

    arquitetura = "unet-resnet18"

    def __init__(self, classes: int = NUMERO_DE_CLASSES, pretreinado: bool = False):
        super().__init__()
        from torchvision.models import ResNet18_Weights, resnet18

        codificador = resnet18(weights=ResNet18_Weights.IMAGENET1K_V1 if pretreinado else None)

        self.classes = classes
        self.inicio = nn.Sequential(codificador.conv1, codificador.bn1, codificador.relu)  # 1/2, 64
        self.reduz = codificador.maxpool  # 1/4
        self.c1 = codificador.layer1  # 1/4, 64
        self.c2 = codificador.layer2  # 1/8, 128
        self.c3 = codificador.layer3  # 1/16, 256
        self.c4 = codificador.layer4  # 1/32, 512

        self.sobe4 = nn.ConvTranspose2d(512, 256, 2, stride=2)
        self.junta4 = bloco(512, 256)
        self.sobe3 = nn.ConvTranspose2d(256, 128, 2, stride=2)
        self.junta3 = bloco(256, 128)
        self.sobe2 = nn.ConvTranspose2d(128, 64, 2, stride=2)
        self.junta2 = bloco(128, 64)
        self.sobe1 = nn.ConvTranspose2d(64, 64, 2, stride=2)
        self.junta1 = bloco(128, 64)
        self.sobe0 = nn.ConvTranspose2d(64, 32, 2, stride=2)
        self.junta0 = bloco(32, 32)

        self.saida = nn.Conv2d(32, classes, 1)

    def forward(self, x):
        e0 = self.inicio(x)
        e1 = self.c1(self.reduz(e0))
        e2 = self.c2(e1)
        e3 = self.c3(e2)
        e4 = self.c4(e3)

        s = self.junta4(torch.cat([self.sobe4(e4), e3], dim=1))
        s = self.junta3(torch.cat([self.sobe3(s), e2], dim=1))
        s = self.junta2(torch.cat([self.sobe2(s), e1], dim=1))
        s = self.junta1(torch.cat([self.sobe1(s), e0], dim=1))
        s = self.junta0(self.sobe0(s))

        return self.saida(s)


ARQUITETURAS = ("unet", "unet-resnet18")


def criar(arquitetura: str = "unet", pretreinado: bool = False, base: int = 32) -> nn.Module:
    """Monta a rede pelo nome. `pretreinado` so se aplica ao codificador ResNet."""
    if arquitetura == "unet":
        return UNet(base=base)
    if arquitetura == "unet-resnet18":
        return UNetResNet18(pretreinado=pretreinado)
    raise ValueError(f"Arquitetura desconhecida: {arquitetura}. Opcoes: {', '.join(ARQUITETURAS)}")


# Lado, em pixels, dos recortes da base de treino. Os pesos anteriores a este
# campo foram todos treinados nesse tamanho.
ENTRADA_DO_TREINO = 224


def salvar(modelo: nn.Module, caminho, versao: str, entrada: int = ENTRADA_DO_TREINO) -> None:
    """
    Grava os pesos com o minimo necessario para reconstruir e USAR a rede.

    O tamanho de entrada vai junto porque a inferencia precisa repeti-lo. Uma
    rede convolucional aceita qualquer tamanho sem reclamar, e e esse o perigo:
    a primeira versao do servico redimensionava para 512 um modelo treinado em
    224, as plantas apareciam 2,3 vezes maiores do que no treino, e o erro do
    indice subia de 14,7 para 25,4 pontos — pior que a heuristica de cor —, sem
    erro nenhum na tela (ver DECISOES.md 2.19).
    """
    torch.save(
        {
            "arquitetura": getattr(modelo, "arquitetura", "unet"),
            "base": getattr(modelo, "base", None),
            "classes": list(CLASSES),
            "entrada": entrada,
            "versao": versao,
            "estado": modelo.state_dict(),
        },
        caminho,
    )


def carregar(caminho) -> tuple[nn.Module, str]:
    """
    Reconstroi a rede e devolve tambem a versao gravada junto dos pesos.

    O tamanho de entrada do treino fica em `modelo.entrada`, e e dele que a
    inferencia le — nunca de uma constante no codigo de inferencia.
    """
    pacote = torch.load(caminho, map_location="cpu", weights_only=True)

    if list(pacote.get("classes", CLASSES)) != list(CLASSES):
        raise ValueError(
            "Os pesos foram treinados com outra lista de classes: "
            f"{pacote.get('classes')} != {list(CLASSES)}"
        )

    # Sempre sem pre-treino: os numeros vem todos do arquivo de pesos.
    modelo = criar(pacote.get("arquitetura", "unet"), pretreinado=False, base=pacote.get("base") or 32)
    modelo.load_state_dict(pacote["estado"])
    modelo.entrada = int(pacote.get("entrada", ENTRADA_DO_TREINO))
    modelo.eval()

    return modelo, pacote.get("versao", "desconhecida")
