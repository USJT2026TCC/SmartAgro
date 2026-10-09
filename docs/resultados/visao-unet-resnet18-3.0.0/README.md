# Resultado: visao-unet-resnet18-3.0.0

Terceira rodada de treino, a primeira com **transferência de aprendizado**, como pede a tabela de
tecnologias da Entrega 3 ("modelo pré-treinado reduz o custo de treino"). CPU local, 30 épocas,
07/10/2026.

| | |
|---|---|
| Arquitetura | U-Net com codificador ResNet-18 (He et al., 2016) pré-treinado na ImageNet (`torchvision`, `IMAGENET1K_V1`) |
| Comando | `python treino/treinar.py --arquitetura unet-resnet18 --epocas 30 --versao visao-unet-resnet18-3.0.0-cpu --saida pesos/unet-resnet18.pt` |
| Base, rótulos, divisão, pesos das classes | os mesmos da [2.0.0](../visao-unet-2.0.0/README.md), para a comparação ser direta |
| Melhor época | **7** de 30 (a 2.0.0 precisou de 18) |
| Tamanho dos pesos | 57,5 MB (a 2.0.0 tem 7,8 MB) |

## Recorte a recorte

Os mesmos 79 recortes de validação com pelo menos 10% de lavoura, medidos por
`treino/avaliar_modelo.py` — que classifica pelo mesmo caminho da produção:

| | Sempre 0% | U-Net 2.0.0 | **ResNet-18 3.0.0** |
|---|---:|---:|---:|
| Erro absoluto médio | 4,9 | 3,3 | **3,2** |
| Erro mediano | — | 2,2 | **2,0** |
| Erro máximo | — | **25,7** | 28,7 |
| Viés | −4,9 | **+0,1** | +0,4 |

## No nível do talhão

Os 79 recortes somados, como o índice faz com um lote:

| | Dano da área |
|---|---:|
| Real | 4,3% |
| U-Net 2.0.0 | 4,6% |
| ResNet-18 3.0.0 | 4,7% |

## Por faixa de dano

| Dano real | Recortes | Real médio | 2.0.0 | 3.0.0 |
|---|---:|---:|---:|---:|
| sem dano (< 1%) | 16 | 0,3% | 4,3% | 4,1% |
| baixo (1 a 10%) | 53 | 4,3% | 4,6% | 5,0% |
| alto (10% ou mais) | 10 | 15,6% | 8,1% | 8,6% |

O codificador pré-treinado não resolveu a subestimação do dano alto, que continua sendo a
principal limitação do modelo (ver a 2.0.0). Melhorou meio ponto.

## O custo de treino caiu, como a Entrega 3 previa

Com o mesmo número de épocas e o mesmo tempo por época (~105 s em CPU), a rede pré-treinada chegou
ao melhor resultado na **época 7**; a treinada do zero, na 18. Para o mesmo erro, cerca de 40% do
tempo de treino. É a justificativa da tabela de tecnologias, agora medida.

## A confiança não serve para o limiar — e por isso a 3.0.0 não é o padrão

O backend manda ao perito toda análise com confiança abaixo de 70% (`LIMIAR_CONFIANCA_BPS`, RF17).
A confiança é a média da probabilidade da classe escolhida nos pixels de lavoura:

| | 2.0.0 | 3.0.0 |
|---|---:|---:|
| Confiança mínima / mediana / máxima | 0,65 / 0,78 / 0,86 | 0,39 / 0,46 / 0,50 |
| Recortes acima do limiar de 70% | 78 de 79 | **0 de 79** |
| Erro médio dos recortes abaixo do limiar | 25,7 (é o pior recorte) | 3,2 (todos) |
| Lote de 50 fotos de celular (demonstração) | 72,8% | 44,0% |

Na 2.0.0, a confiança faz o que deve: o único recorte abaixo do limiar é justamente o de maior
erro. Na 3.0.0, nenhum passa — **todo** lote iria ao perito, e o índice de dano nunca acionaria
pagamento sozinho, exatamente como o estimador clássico (DECISOES.md 1.12). A rede pré-treinada
acerta tanto quanto, mas espalha a probabilidade entre as classes; o número deixa de separar as
análises boas das ruins.

**Decisão:** a 2.0.0 continua sendo o modelo em operação (`VISAO_PESOS=pesos/unet.pt`). A 3.0.0
fica treinada, medida e disponível pela mesma variável (`VISAO_PESOS=pesos/unet-resnet18.pt`); a
versão gravada com cada análise é a que de fato rodou, então trocar não exige mudar código.

**Para a 3.0.0 virar o padrão**, falta calibrar a confiança — por exemplo, ajustar uma
temperatura na saída da rede com os recortes de validação — e medir de novo a separação acima.
Baixar o limiar só para essa versão seria esconder o problema.

## Tempo de análise (RNF02)

`treino/medir_lote.py`: um lote de 50 fotos de celular (10,8 MB) enviado de uma vez ao
`POST /analisar` da API de visão, em CPU, pior de duas execuções:

| Estimador | Lote de 50 | Por foto | Limite do RNF02 |
|---|---:|---:|---:|
| Heurística de cor | 13,4 s | 0,27 s | 600 s |
| U-Net 2.0.0 | 6,2 s | 0,12 s | 600 s |
| ResNet-18 3.0.0 | 6,2 s | 0,12 s | 600 s |

As duas redes ficam cerca de cem vezes abaixo do limite. A heurística é mais lenta porque trabalha
na resolução original da foto; as redes reduzem a imagem antes.

## Ressalvas

As mesmas da 2.0.0: um voo, 0,3 ha de milho, uma data, rótulos automáticos. A melhor época foi
escolhida olhando a validação, então os números recorte a recorte são otimistas para as duas
versões, por igual.

## Arquivos

| Arquivo | O que é |
|---|---|
| `historico.json` | Métricas por época |

Os pesos (`unet-resnet18.pt`, 57,5 MB) não estão no repositório; ficam em `visao/pesos/`, ignorado
pelo git.
