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

U-Net pequena, escrita a mao. Poderia ser uma biblioteca pronta; escrever as
poucas dezenas de linhas evita uma dependencia grande e deixa visivel o que o
modelo faz, que e o ponto de um trabalho academico.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from .indice import CLASSES

NUMERO_DE_CLASSES = len(CLASSES)


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


def salvar(modelo: UNet, caminho, versao: str) -> None:
    """Grava os pesos com o minimo necessario para reconstruir a rede."""
    torch.save(
        {
            "arquitetura": "unet",
            "base": modelo.base,
            "classes": list(CLASSES),
            "versao": versao,
            "estado": modelo.state_dict(),
        },
        caminho,
    )


def carregar(caminho) -> tuple[UNet, str]:
    """Reconstroi a rede e devolve tambem a versao gravada junto dos pesos."""
    pacote = torch.load(caminho, map_location="cpu", weights_only=True)

    if list(pacote.get("classes", CLASSES)) != list(CLASSES):
        raise ValueError(
            "Os pesos foram treinados com outra lista de classes: "
            f"{pacote.get('classes')} != {list(CLASSES)}"
        )

    modelo = UNet(classes=len(pacote.get("classes", CLASSES)), base=pacote.get("base", 32))
    modelo.load_state_dict(pacote["estado"])
    modelo.eval()

    return modelo, pacote.get("versao", "desconhecida")
