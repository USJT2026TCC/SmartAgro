# Resultado: os modelos de visão num teste nunca visto

Medição de 13/10/2026. Resolve a primeira ressalva do [resultado 2.0.0](../visao-unet-2.0.0/README.md):
lá, a melhor época era escolhida olhando a própria validação, e o erro relatado era otimista por
construção. Aqui, o número vem de recortes que nenhum modelo viu, nem no treino nem na escolha da
época. Testa também o experimento que aquele resultado sugeria para o dano alto.

## Como foi feita a divisão

`treino/preparar_dados.py` passou a separar treino, validação e teste. O treino continua com os
**mesmos 257 recortes** de antes; a validação antiga foi dividida ao meio, por faixas alternadas do
talhão:

| Divisão | Recortes | Com lavoura | Dano médio de referência | Uso |
|---|---:|---:|---:|---|
| treino | 257 | 227 | 6,2% | ajustar os pesos |
| validação | 41 | 34 | 3,0% | escolher a melhor época |
| **teste** | 46 | **45** | **6,3%** | **só o número final** |

Os pesos da 2.0.0 e da 3.0.0 foram treinados na divisão antiga, cujo treino é o mesmo de agora;
então o teste também é inédito para eles. A ressalva que sobra para esses dois: o teste fazia parte
da validação antiga, usada na escolha da época deles. A **2.0.1** foi retreinada do zero, com a
mesma configuração da 2.0.0, já na divisão nova: para ela, o teste é inédito em todos os sentidos.

## No teste nunca visto

Medido por `treino/avaliacao.py`, a mesma prova de todos os resultados anteriores:

| | Erro médio por recorte | Dano da área (real: 5,9%) | Sem dano (real 0,6%) | Baixo (real 4,6%) | Alto (real 15,2%) |
|---|---:|---:|---:|---:|---:|
| Responder sempre 0% | 6,3 | 0% | — | — | — |
| Heurística de cor | 9,6 | 14,7% | 17,7% | 15,0% | 12,7% |
| **U-Net 2.0.0 (em operação)** | **3,3** | **5,4%** | 3,3% | 5,1% | 8,2% |
| U-Net 2.0.1 (retreino honesto) | 3,3 | 5,6% | 3,6% | 5,4% | 7,9% |
| ResNet-18 3.0.0 | 3,3 | 5,8% | 2,9% | 5,8% | 8,6% |
| U-Net 2.0.2 (estresse pesado) | 7,4 | 13,1% | 11,1% | 12,5% | 18,1% |

Recortes por faixa: 2 sem dano, 35 com dano baixo (1 a 10%), 8 com dano alto (10% ou mais).

**O 3,3 se confirma.** O retreino sem nenhum vazamento dá o mesmo erro que a 2.0.0 tinha relatado,
e as três redes empatam. No nível do talhão, que é o que a apólice usa, o erro fica entre 0,1 e 0,5
ponto.

**O dano alto continua subestimado pela metade** em todas as redes (cerca de 8% onde o real é 15%).

## O experimento para o dano alto não funcionou

A 2.0.2 é a 2.0.0 com os pesos das classes de estresse elevados (`--expoente-dos-pesos 1.0` em vez
de 0.5), o experimento sugerido no resultado 2.0.0. Ela deixou de subestimar o dano alto (18,1%
contra 15,2% real), mas passou a **superestimar todo o resto**: 12,5% onde o real é 4,6%, e 13,1% de
dano na área contra 5,9%. O erro médio, 7,4, é pior que responder sempre 0%. O ajuste não ensinou o
modelo a reconhecer o dano alto; só empurrou todas as estimativas para cima.

Conclusão: o problema do dano alto não se resolve com peso de classe. São só 8 recortes de dano alto
no teste e poucas dezenas no treino; a causa provável é a falta de exemplos, e não a configuração do
treino.

## Uma ressalva que a divisão nova revelou

A metade da validação ficou com pouco dano (3,0% em média), e a do teste com mais (6,3%). Na
validação, a 2.0.1 erra 3,25 e responder sempre 0% erraria 3,01 — o modelo não vence a referência
trivial ali; no teste, vence com folga (3,3 contra 6,3). As duas metades vêm do mesmo voo e diferem
tanto entre si: com tão poucos recortes, um único número de erro depende muito de quais recortes
caíram em cada lado. É mais um sinal de que a base é pequena.

## A confiança

`treino/calibrar_confianca.py`, no mesmo teste:

| | Confiança média | Correlação confiança × erro |
|---|---:|---:|
| U-Net 2.0.0 | 78,7% | −0,19 |
| ResNet-18 3.0.0 (sem calibrar) | 46,7% | −0,13 |
| ResNet-18 3.0.0 (calibrada) | 86,2% | −0,13 |
| U-Net 2.0.2 | 73,5% | −0,63 |

A 2.0.2 é a única cuja confiança acompanha bem o erro — mas o erro dela é alto em quase todo lugar.
Ver [resultado 3.0.0](../visao-unet-resnet18-3.0.0/README.md) para a calibração.

## Decisão

A 2.0.0 continua em operação. O retreino honesto (2.0.1) dá o mesmo resultado e confirma o número
publicado; o experimento do dano alto (2.0.2) fica registrado como resultado negativo.

## Reproduzir

```bash
cd visao
.venv/Scripts/python treino/preparar_dados.py
.venv/Scripts/python treino/treinar.py --epocas 30 --expoente-dos-pesos 0.5 --saida pesos/unet-2.0.1.pt --versao visao-unet-2.0.1-cpu
.venv/Scripts/python treino/treinar.py --epocas 30 --expoente-dos-pesos 1.0 --saida pesos/unet-2.0.2.pt --versao visao-unet-2.0.2-cpu
.venv/Scripts/python treino/avaliar_modelo.py --pesos pesos/unet-2.0.1.pt --divisao teste
```

CPU local, 30 épocas, cerca de 50 minutos por treino. Melhor época: 14 na 2.0.1, 10 na 2.0.2.

| Arquivo | O que é |
|---|---|
| `unet-2.0.1.historico.json` | Métricas por época do retreino honesto |
| `unet-2.0.2.historico.json` | Métricas por época do experimento do dano alto |
