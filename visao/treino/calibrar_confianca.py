"""
Calibracao da confianca do modelo pre-treinado (visao-unet-resnet18-3.0.0).

RESSALVA QUE ESTE SCRIPT INVESTIGA (DECISOES.md 1.19, resultados/visao-unet-
resnet18-3.0.0/README.md)

A 3.0.0 acerta tanto quanto a 2.0.0, mas a confianca dela nunca passa de ~50%
em nenhum recorte de validacao, contra o limiar de 70% do RF17 — entao hoje
todo lote analisado por ela iria ao perito. O README daquele resultado aponta
a calibracao como o passo que falta, sem a fazer.

O QUE E CALIBRACAO DE TEMPERATURA

A rede devolve uma distribuicao de probabilidade por pixel (softmax dos
logits). "Confianca" e a media da maior probabilidade, so nos pixels de
lavoura. Se a rede e mal calibrada, a distribuicao pode ser mais achatada
(pouco confiante) ou mais concentrada (confiante demais) do que o acerto real
justifica. A calibracao por temperatura (GUO et al., On Calibration of Modern
Neural Networks, ICML 2017) divide os logits por um unico escalar T antes do
softmax: T > 1 achata a distribuicao, T < 1 a afia. Nao muda a classe
escolhida (softmax e crescente), so a confianca relatada.

T e ajustado minimizando o erro de entropia cruzada da distribuicao calibrada
contra o rotulo verdadeiro de cada pixel, sobre a VALIDACAO (nunca sobre o
teste). O numero que importa para a decisao e a confianca no TESTE, calibrada
com o T ajustado na validacao — a mesma separacao que treino/treinar.py usa
para a epoca, aplicada aqui ao escalar de temperatura.

NAO HA CONTAMINACAO COM O TREINO DA 3.0.0

Os pesos de unet-resnet18.pt foram treinados sobre a divisao ANTIGA (so
treino/validacao). A validacao antiga e exatamente a uniao da nova validacao
com o novo teste (treino/preparar_dados.py), entao nenhum dos dois conjuntos
usados aqui participou do treino da rede.

Uso:
    python treino/calibrar_confianca.py --pesos pesos/unet-resnet18.pt
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
from avaliacao import PREPARADO, dano_de_referencia, recortes
from PIL import Image

from visao.indice import indice_de_dano
from visao.rede import carregar


def logits_e_rotulos(modelo, recorte) -> tuple[torch.Tensor, torch.Tensor, np.ndarray]:
    """Logits (classes, H, W), rotulo (H, W) e mascara booleana de lavoura (H, W)."""
    from visao.indice import CLASSES
    from visao.rede import padronizar

    lado = getattr(modelo, "entrada", 224)
    imagem = Image.open(recorte.imagem).convert("RGB").resize((lado, lado))
    entrada = torch.from_numpy(np.asarray(imagem, dtype=np.float32) / 255.0)
    entrada = padronizar(entrada.permute(2, 0, 1)).unsqueeze(0)

    rotulo = np.asarray(Image.open(recorte.mascara).resize((lado, lado), Image.NEAREST))

    with torch.no_grad():
        logits = modelo(entrada)[0]  # (classes, H, W)

    lavoura = rotulo != CLASSES.index("solo")
    return logits, torch.from_numpy(rotulo.astype(np.int64)), lavoura


def ajustar_temperatura(modelo, lista) -> float:
    """Minimiza a entropia cruzada calibrada sobre todos os pixels de lavoura da lista."""
    todos_logits = []
    todos_rotulos = []

    for recorte in lista:
        logits, rotulo, lavoura = logits_e_rotulos(modelo, recorte)
        c, h, w = logits.shape
        logits = logits.permute(1, 2, 0).reshape(-1, c)
        rotulo = rotulo.reshape(-1)
        lavoura = lavoura.reshape(-1)
        todos_logits.append(logits[lavoura])
        todos_rotulos.append(rotulo[lavoura])

    logits = torch.cat(todos_logits)
    rotulos = torch.cat(todos_rotulos)

    temperatura = torch.nn.Parameter(torch.ones(1))
    otimizador = torch.optim.LBFGS([temperatura], lr=0.05, max_iter=100)
    perda = torch.nn.CrossEntropyLoss()

    def passo():
        otimizador.zero_grad()
        erro = perda(logits / temperatura.clamp(min=0.05), rotulos)
        erro.backward()
        return erro

    otimizador.step(passo)
    return float(temperatura.clamp(min=0.05).item())


def spearman(a: list[float], b: list[float]) -> float:
    """Correlacao de postos, sem depender de scipy (o projeto nao usa)."""
    ra = np.argsort(np.argsort(a))
    rb = np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def confianca_e_erro_por_recorte(
    modelo, lista, temperatura: float
) -> tuple[list[float], list[float]]:
    """
    Confianca calibrada e erro do indice, um par por recorte.

    Verifica o que a calibracao NAO promete: ela corrige a MAGNITUDE da
    confianca (o numero passa a bater com a taxa de acerto real), mas uma
    transformacao monotonica dos logits nao cria discriminacao que nao
    existia — se a confianca sem calibrar ja nao separava analise boa de
    ruim, a calibrada tambem nao separa.
    """
    from visao.indice import CLASSES

    confiancas, erros = [], []

    for recorte in lista:
        logits, _, lavoura = logits_e_rotulos(modelo, recorte)
        if not lavoura.any():
            continue

        previsto = logits.argmax(dim=0).numpy()
        contagem_prevista = {nome: int((previsto == i).sum()) for i, nome in enumerate(CLASSES)}
        erro = abs(indice_de_dano(contagem_prevista) - dano_de_referencia(recorte))

        c, h, w = logits.shape
        logits_lavoura = logits.permute(1, 2, 0).reshape(-1, c)[
            torch.from_numpy(lavoura.reshape(-1))
        ]
        prob = torch.softmax(logits_lavoura / temperatura, dim=1)
        confianca = prob.max(dim=1).values.mean().item()

        confiancas.append(confianca)
        erros.append(erro)

    return confiancas, erros


def confianca_media(modelo, lista, temperatura: float) -> tuple[float, float, int]:
    """Confianca media nos pixels de lavoura, com e sem calibracao. Devolve (sem, com, n)."""
    somas = {1.0: 0.0, temperatura: 0.0}
    pesos = 0

    for recorte in lista:
        logits, _, lavoura = logits_e_rotulos(modelo, recorte)
        if not lavoura.any():
            continue
        c, h, w = logits.shape
        logits_lavoura = logits.permute(1, 2, 0).reshape(-1, c)[
            torch.from_numpy(lavoura.reshape(-1))
        ]

        for t in somas:
            prob = torch.softmax(logits_lavoura / t, dim=1)
            certeza = prob.max(dim=1).values.mean().item()
            somas[t] += certeza
        pesos += 1

    return somas[1.0] / pesos, somas[temperatura] / pesos, pesos


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibra a confianca de um modelo treinado")
    parser.add_argument("--pesos", type=Path, required=True)
    parser.add_argument("--dados", type=Path, default=PREPARADO)
    opcoes = parser.parse_args()

    modelo, versao = carregar(opcoes.pesos)
    modelo.eval()

    validacao = recortes(opcoes.dados, "validacao")
    teste = recortes(opcoes.dados, "teste")

    print(f"Modelo..............: {versao}")
    print(f"Ajustando T em {len(validacao)} recortes de validacao...")
    temperatura = ajustar_temperatura(modelo, validacao)
    print(f"Temperatura ajustada.: {temperatura:.3f}")
    print()

    for nome, lista in (
        ("validacao (usada para ajustar T)", validacao),
        ("teste (nunca visto)", teste),
    ):
        sem, com, n = confianca_media(modelo, lista, temperatura)
        print(f"{nome} — {n} recortes com lavoura")
        print(f"  confianca sem calibrar: {sem:.1%}")
        print(f"  confianca calibrada...: {com:.1%}")
        print(f"  acima do limiar de 70%: {'SIM' if com >= 0.70 else 'nao'}")
        print()

    confiancas, erros = confianca_e_erro_por_recorte(modelo, teste, temperatura)
    correlacao = spearman(confiancas, erros)
    print(f"Discriminacao no teste (correlacao de postos, confianca x erro): {correlacao:+.2f}")
    print("  negativo e o esperado: confianca mais alta deveria vir com erro mais baixo.")
    print("  a calibracao NAO muda este numero — so a transformacao monotonica dos logits")
    print("  nao cria discriminacao nova; so corrige a magnitude relatada.")


if __name__ == "__main__":
    main()
