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
import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset

from visao.indice import CLASSES as NOMES_DAS_CLASSES
from visao.rede import UNet, padronizar, salvar

RAIZ = Path(__file__).resolve().parents[1]
PREPARADO = RAIZ / "dados" / "preparado"
PESOS = RAIZ / "pesos"

CLASSES = len(NOMES_DAS_CLASSES)


class BaseDeRecortes(Dataset):
    """
    Le os pares imagem/mascara listados no indice.csv.

    AUMENTO DE DADOS, so no treino

    Sao 738 recortes de treino, poucos para uma rede de segmentacao. Espelhar e
    girar em multiplos de 90 graus multiplica isso por oito, e e um aumento
    legitimo aqui: lavoura vista de cima nao tem lado certo — o drone sobrevoa
    em qualquer direcao, e o talhao continua o mesmo.

    O que NAO se mexe e a cor. Alterar brilho ou matiz ensinaria o modelo que
    planta amarelada pode ser verde, que e exatamente a distincao que ele
    precisa aprender.

    O aumento nunca vale na validacao: a metrica tem que descrever a imagem
    como ela chegou.
    """

    def __init__(self, raiz: Path, divisao: str, aumentar: bool = False):
        self.raiz = raiz
        self.aumentar = aumentar

        if not (raiz / "indice.csv").exists():
            raise SystemExit(
                f"Nao ha {raiz / 'indice.csv'}: a preparacao dos dados nao rodou, ou falhou.\n"
                "Rode treino/preparar_dados.py e confira a mensagem que ele imprime."
            )

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

        x = padronizar(torch.from_numpy(np.asarray(imagem, dtype=np.float32) / 255.0).permute(2, 0, 1))
        bruto = np.asarray(mascara, dtype=np.int64)

        # base -> AgroSmart, o mesmo mapa de preparar_dados.py
        traduzido = np.zeros_like(bruto)
        for origem, destino in {0: 0, 1: 2, 2: 3, 3: 1, 4: 4}.items():
            traduzido[bruto == origem] = destino

        y = torch.from_numpy(traduzido)

        if self.aumentar:
            # A MESMA transformacao na imagem e na mascara. Girar so uma das
            # duas ensinaria o modelo a associar cada pixel ao rotulo errado.
            if torch.rand(1).item() < 0.5:
                x, y = torch.flip(x, [2]), torch.flip(y, [1])
            if torch.rand(1).item() < 0.5:
                x, y = torch.flip(x, [1]), torch.flip(y, [0])

            giros = int(torch.randint(0, 4, (1,)).item())
            if giros:
                x, y = torch.rot90(x, giros, [1, 2]), torch.rot90(y, giros, [0, 1])

        return x, y.contiguous()


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
    parser.add_argument("--sem-aumento", action="store_true", help="desliga espelhamento e giros")
    opcoes = parser.parse_args()

    dispositivo = "cuda" if torch.cuda.is_available() else "cpu"
    if dispositivo == "cpu":
        print("AVISO: sem GPU. O treino funciona, mas leva horas. Prefira Colab ou Kaggle.")

    treino = BaseDeRecortes(opcoes.dados, "treino", aumentar=not opcoes.sem_aumento)
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

    opcoes.saida.parent.mkdir(parents=True, exist_ok=True)

    historico = []
    melhor = None

    for epoca in range(1, opcoes.epocas + 1):
        comeco = time.time()
        erro = uma_epoca(modelo, carregador_treino, otimizador, perda, dispositivo)
        metricas = avaliar(modelo, carregador_validacao, dispositivo)
        metricas["epoca"] = epoca
        metricas["perda"] = round(erro, 4)
        metricas["segundos"] = round(time.time() - comeco, 1)
        historico.append(metricas)

        # O criterio de "melhor" e o ERRO DO INDICE, e nao a IoU media. IoU mede
        # o acerto pixel a pixel; o indice e o numero que paga. Um modelo pode
        # errar a borda de cada mancha e ainda acertar a PROPORCAO de lavoura
        # afetada — e e a proporcao que vira dinheiro.
        #
        # Com uma ressalva, que vale pesos gravados: um modelo que NUNCA marca
        # estresse reporta dano zero em tudo, e num conjunto onde a maioria dos
        # recortes tem pouco dano isso rende um erro medio baixo por acidente.
        # Seria uma apolice que nunca paga, com boa metrica. Por isso so
        # qualifica a epoca em que as duas classes de estresse foram de fato
        # previstas em algum lugar.
        atual = metricas["erro_medio_do_indice"]
        preve_estresse = (
            metricas["iou_por_classe"]["estresse_leve"] > 0
            and metricas["iou_por_classe"]["estresse_severo"] > 0
        )
        estrela = "" if preve_estresse else "  (nao previu estresse; nao qualifica)"

        if preve_estresse and (melhor is None or atual < melhor):
            melhor = atual
            salvar(modelo, opcoes.saida, opcoes.versao)
            estrela = "  <- melhor ate agora, pesos gravados"

        print(
            f"epoca {epoca:3d}  perda {erro:.4f}  IoU media {metricas['iou_media']:.3f}  "
            f"erro do indice {atual:.3f}  ({metricas['segundos']:.0f}s){estrela}"
        )

    caminho_do_historico = opcoes.saida.with_suffix(".historico.json")
    caminho_do_historico.write_text(
        json.dumps(
            {
                "versao": opcoes.versao,
                "recortes_de_treino": len(treino),
                "recortes_de_validacao": len(validacao),
                "aumento_de_dados": not opcoes.sem_aumento,
                "dispositivo": dispositivo,
                "melhor_erro_do_indice": melhor,
                "epocas": historico,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    if melhor is None:
        raise SystemExit(
            "\nNenhuma epoca previu as duas classes de estresse: nao ha pesos para gravar.\n"
            "Um modelo que nunca marca estresse reporta dano zero sempre — uma apolice que\n"
            "nunca paga. Treine por mais epocas, ou reveja os pesos das classes."
        )

    print(f"\nPesos da melhor epoca em {opcoes.saida}")
    print(f"Historico em {caminho_do_historico}")
    print("Para usar: VISAO_PESOS=<caminho> no .env do modulo de visao.")
    print(f"Melhor erro do indice de dano: {melhor:.1%}")


if __name__ == "__main__":
    main()
