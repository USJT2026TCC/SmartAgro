"""
Treino do segmentador de estresse hidrico (HU11).

    python treino/treinar.py --epocas 20 --lote 16

RODE ISTO EM GPU. Em CPU o treino termina, mas leva horas. O caminho previsto
para a equipe e o Google Colab ou o Kaggle, ambos com GPU gratuita — ver
README.md deste modulo.

POR QUE RGB, E NAO OS SEIS CANAIS MULTIESPECTRAIS

A base traz, para cada recorte, um `.npy` com cinco bandas mais mascara. Um
modelo treinado nelas acertaria mais: infravermelho proximo separa planta
estressada de planta sadia muito antes de a diferenca aparecer na cor visivel.

O problema e que o produtor fotografa com o celular, e o celular so tem RGB.
Um modelo que precisa de camera multiespectral seria melhor no artigo e inutil
na lavoura. Treinar em RGB mantem o modelo utilizavel com o equipamento que o
usuario realmente tem — e a base fica disponivel para a versao multiespectral
quando existir drone com essa camera.

ARQUITETURA

A rede fica em `visao/rede.py`, e nao aqui: os pesos precisam carregar no
servico de inferencia, que nao importa este script. O que se salva e o
`state_dict`, nunca o objeto Python — ver o cabecalho daquele modulo.
"""

from __future__ import annotations

import argparse
import csv
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset

from visao.indice import CLASSES as NOMES_DAS_CLASSES
from visao.rede import UNet, salvar

RAIZ = Path(__file__).resolve().parents[1]
PREPARADO = RAIZ / "dados" / "preparado"
PESOS = RAIZ / "pesos"

CLASSES = len(NOMES_DAS_CLASSES)


class BaseDeRecortes(Dataset):
    """Le os pares imagem/mascara listados no indice.csv."""

    def __init__(self, raiz: Path, divisao: str):
        self.raiz = raiz
        with (raiz / "indice.csv").open(encoding="utf-8") as arquivo:
            self.linhas = [l for l in csv.DictReader(arquivo) if l["divisao"] == divisao]

        if not self.linhas:
            raise SystemExit(f"Nenhum recorte na divisao '{divisao}'. Rode preparar_dados.py.")

    def __len__(self) -> int:
        return len(self.linhas)

    def __getitem__(self, indice: int):
        linha = self.linhas[indice]

        imagem = Image.open(self.raiz / "images" / linha["imagem"]).convert("RGB")
        mascara = Image.open(self.raiz / "masks" / linha["mascara"])

        x = torch.from_numpy(np.asarray(imagem, dtype=np.float32) / 255.0).permute(2, 0, 1)
        bruto = np.asarray(mascara, dtype=np.int64)

        # base -> AgroSmart, o mesmo mapa de preparar_dados.py
        traduzido = np.zeros_like(bruto)
        for origem, destino in {0: 0, 1: 2, 2: 3, 3: 1, 4: 4}.items():
            traduzido[bruto == origem] = destino

        return x, torch.from_numpy(traduzido)


def pesos_das_classes(base: BaseDeRecortes, amostras: int = 100) -> torch.Tensor:
    """
    Peso inverso a frequencia.

    Sem isso, a classe mais comum domina a funcao de perda e o modelo aprende a
    responder "saudavel" para tudo — o que da acuracia alta e indice de dano
    sempre zero, ou seja, uma apolice que nunca paga.
    """
    contagem = torch.zeros(CLASSES)

    for indice in range(min(amostras, len(base))):
        _, mascara = base[indice]
        contagem += torch.bincount(mascara.flatten(), minlength=CLASSES).float()

    frequencia = contagem / contagem.sum().clamp(min=1)

    return (1.0 / frequencia.clamp(min=1e-4)).sqrt()


def uma_epoca(modelo, carregador, otimizador, perda, dispositivo) -> float:
    modelo.train()
    total = 0.0

    for x, y in carregador:
        x, y = x.to(dispositivo), y.to(dispositivo)

        otimizador.zero_grad()
        erro = perda(modelo(x), y)
        erro.backward()
        otimizador.step()

        total += erro.item() * x.size(0)

    return total / len(carregador.dataset)


@torch.no_grad()
def avaliar(modelo, carregador, dispositivo) -> dict:
    """IoU por classe e erro do indice de dano — que e o numero que paga."""
    from visao.indice import indice_de_dano

    NOMES = NOMES_DAS_CLASSES

    modelo.eval()
    intersecao = torch.zeros(CLASSES)
    uniao = torch.zeros(CLASSES)
    erros_do_indice = []

    for x, y in carregador:
        previsto = modelo(x.to(dispositivo)).argmax(dim=1).cpu()

        for classe in range(CLASSES):
            p, v = previsto == classe, y == classe
            intersecao[classe] += (p & v).sum()
            uniao[classe] += (p | v).sum()

        for i in range(previsto.size(0)):
            contar = lambda m: {  # noqa: E731
                nome: int((m[i] == c).sum()) for c, nome in enumerate(NOMES)
            }
            erros_do_indice.append(
                abs(indice_de_dano(contar(previsto)) - indice_de_dano(contar(y)))
            )

    iou = (intersecao / uniao.clamp(min=1)).tolist()

    return {
        "iou_por_classe": {nome: round(v, 4) for nome, v in zip(NOMES, iou)},
        "iou_media": round(sum(iou) / len(iou), 4),
        "erro_medio_do_indice": round(sum(erros_do_indice) / len(erros_do_indice), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Treina o segmentador de estresse hidrico")
    parser.add_argument("--dados", type=Path, default=PREPARADO)
    parser.add_argument("--epocas", type=int, default=20)
    parser.add_argument("--lote", type=int, default=16)
    parser.add_argument("--taxa", type=float, default=1e-3)
    parser.add_argument("--saida", type=Path, default=PESOS / "unet.pt")
    parser.add_argument("--limite", type=int, default=0, help="usa so N recortes (teste rapido)")
    parser.add_argument("--versao", default="visao-unet-1.0.0", help="gravada junto dos pesos")
    opcoes = parser.parse_args()

    dispositivo = "cuda" if torch.cuda.is_available() else "cpu"
    if dispositivo == "cpu":
        print("AVISO: sem GPU. O treino funciona, mas leva horas. Prefira Colab ou Kaggle.")

    treino = BaseDeRecortes(opcoes.dados, "treino")
    validacao = BaseDeRecortes(opcoes.dados, "validacao")

    if opcoes.limite:
        treino.linhas = treino.linhas[: opcoes.limite]
        validacao.linhas = validacao.linhas[: max(1, opcoes.limite // 4)]

    print(f"treino {len(treino)} recortes · validacao {len(validacao)} · dispositivo {dispositivo}")

    carregador_treino = DataLoader(treino, batch_size=opcoes.lote, shuffle=True)
    carregador_validacao = DataLoader(validacao, batch_size=opcoes.lote)

    modelo = UNet().to(dispositivo)
    otimizador = torch.optim.AdamW(modelo.parameters(), lr=opcoes.taxa)
    perda = nn.CrossEntropyLoss(weight=pesos_das_classes(treino).to(dispositivo))

    for epoca in range(1, opcoes.epocas + 1):
        comeco = time.time()
        erro = uma_epoca(modelo, carregador_treino, otimizador, perda, dispositivo)
        metricas = avaliar(modelo, carregador_validacao, dispositivo)

        print(
            f"epoca {epoca:3d}  perda {erro:.4f}  IoU media {metricas['iou_media']:.3f}  "
            f"erro do indice {metricas['erro_medio_do_indice']:.3f}  ({time.time() - comeco:.0f}s)"
        )

    opcoes.saida.parent.mkdir(parents=True, exist_ok=True)
    salvar(modelo, opcoes.saida, opcoes.versao)

    print(f"\nPesos em {opcoes.saida}")
    print("Para usar: VISAO_PESOS=<caminho> no .env do modulo de visao.")
    print(f"Metricas finais: {avaliar(modelo, carregador_validacao, dispositivo)}")


if __name__ == "__main__":
    main()
