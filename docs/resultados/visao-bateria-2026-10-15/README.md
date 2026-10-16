# Resultado: bateria de treinos de 15/10/2026

Doze treinos (4 configurações × 3 repetições) para reduzir o erro e o viés do índice de dano, com a
mesma base, os mesmos rótulos e os mesmos 257 recortes de treino das rodadas anteriores. Sem semente
fixa: a variação entre as repetições é parte do resultado.

| | |
|---|---|
| Máquina | GTX 1060 de 3 GB, PyTorch 2.14.1+cu126, `--lote 4` |
| Base | Suiçmez, Yilmaz e Kahraman (2026), **v2.1**, DOI 10.5281/zenodo.22062459, CC BY 4.0 |
| Divisão | treino 257, validação 41 (34 com lavoura), **teste 46 (45 com lavoura)** |
| Duração | cerca de 8 minutos por rodada de 60 épocas |
| Script | `visao/Bateria.ps1`; resultados brutos em `visao/bateria-resultados.csv` |

## Configurações

| Nome | O que muda |
|---|---|
| `base60` | U-Net do zero, 60 épocas |
| `pesos10` | `base60` com `--expoente-dos-pesos 1.0` (pesa mais o estresse) |
| `pesos10lr` | `pesos10` com `--taxa 0.0003` |
| `resnet18` | `--arquitetura unet-resnet18` (codificador pré-treinado na ImageNet), 40 épocas, `--taxa 0.0003` |

## Resultado: média de 3 rodadas

Erro absoluto médio do índice de dano e viés, em pontos percentuais:

| | Validação: erro | Validação: viés | **Teste: erro** | Teste: viés |
|---|---:|---:|---:|---:|
| Responder sempre 0% | 3,0 | — | 6,3 | — |
| Heurística de cor | 19,6 | +19,5 | 9,6 | +8,4 |
| Treino de 30 épocas (uma rodada) | 3,0 | −0,8 | 4,6 | −3,9 |
| `base60` | 2,7 | +0,2 | 3,2 | −1,1 |
| `pesos10` | 6,5 | +5,8 | 6,8 | +6,3 |
| `pesos10lr` | 5,3 | +4,9 | 5,5 | +4,9 |
| **`resnet18`** | **2,2** | +0,0 | **2,6** | **−0,7** |

Faixa do `resnet18` no teste: 2,5 a 2,8. Faixa do `base60`: 3,0 a 3,5.

## O que a bateria mostra

1. **O codificador pré-treinado foi o melhor**, na validação e no teste. A diferença para o
   `base60` é pequena (cerca de 0,6 ponto), mas se repete nas duas provas e as faixas das três
   rodadas mal se tocam.
2. **Mais épocas reduziram a subestimação do dano**: o viés no teste foi de −3,9 (30 épocas) para
   −1,1 (60 épocas). A comparação é frágil, porque o treino de 30 épocas é uma rodada só.
3. **Dar mais peso às classes de estresse piorou.** Os modelos passaram a superestimar o dano em 5 a
   6 pontos e ficaram pior que responder sempre 0%.

## O modelo escolhido: `bat-resnet18-r3`

Menor erro de validação entre as rodadas (2,0). No teste, 45 recortes com pelo menos 10% de lavoura:

| | Valor |
|---|---:|
| Dano médio real | 6,3% |
| Dano médio estimado | 5,4% |
| Erro absoluto médio | 2,6 |
| Erro mediano | 1,9 |
| Erro máximo | 11,0 |
| Viés | −0,9 |

## Confiança

Nas fotos de demonstração (`docs/demonstracao/fotos`):

| Lote | Heurística de cor | `bat-resnet18-r3` |
|---|---|---|
| `demo-01`, 1 foto | dano 21,0%, confiança 27% | dano 13,5%, confiança 46% |
| 8 fotos | — | dano 13,7%, cobertura 59,3%, **confiança 76%** |

Com 8 fotos a confiança passa do limiar de 70% (RF17), e o lote seguiria ao oráculo sem o perito.
Isso difere do registrado para o ResNet-18 da 3.0.0, em que a confiança ficava entre 39% e 50%; a
causa não foi investigada. A correlação entre confiança e erro foi medida depois da bateria (seção
seguinte), e a confiança alta não garante análise correta.

## Calibração e discriminação da confiança

`python treino/calibrar_confianca.py --pesos pesos/unet.pt`, em 15/10/2026, sobre o `bat-resnet18-r3`:

| | Validação (34 recortes) | Teste (45 recortes) |
|---|---:|---:|
| Confiança média sem calibrar | 85,1% | 82,3% |
| Confiança média calibrada (T = 0,741) | 89,5% | 87,1% |

Correlação de postos entre confiança e erro no teste: **−0,27**. O sinal é o esperado, e o valor é
melhor que o da 3.0.0 (cerca de −0,1), mas é fraco: com 45 recortes, só passaria do acaso acima de
cerca de ±0,29. A temperatura ajustada deixa o modelo mais confiante sem separar melhor os acertos
dos erros, e por isso não foi aplicada. O critério 2 da HU17 está na seção seguinte.

## Erro por faixa de dano e critério 2 da HU17

`python treino/avaliar_faixas_e_limiar.py --pesos pesos/unet.pt`, em 15/10/2026, pelo caminho do
serviço. Saída em [faixas-e-limiar.txt](faixas-e-limiar.txt) e, por recorte, em
[faixas-e-limiar.csv](faixas-e-limiar.csv). SHA-256 dos pesos igual ao documentado.

Teste, 45 recortes, em pontos percentuais:

| Dano real | Recortes | Real | Estimado | Viés |
|---|---:|---:|---:|---:|
| menos de 2% | 8 | 1,3% | 3,0% | +1,7 |
| 2% a 5% | 15 | 3,4% | 4,3% | +1,0 |
| 5% a 10% | 14 | 7,3% | 5,5% | −1,7 |
| 10% a 20% | 7 | 14,3% | 9,7% | −4,6 |
| 20% ou mais | 1 | 21,8% | 10,8% | −11,0 |
| **10% ou mais** | **8** | **15,2%** | **9,8%** | **−5,4** |

O modelo superestima o dano baixo e subestima o alto, e a subestimação cresce com o dano: com 10% ou
mais, estima 9,8% onde o real é 15,2%. A validação repete o padrão (dois recortes com 10% ou mais:
real 17,2%, estimado 8,6%). Só há um recorte com 20% ou mais em cada conjunto, então essa faixa é
um indício, não uma medida. A consequência prática é que uma seca severa pode ser lida como
moderada, e por isso a imagem não deve decidir sozinha o pagamento.

**Critério 2 da HU17: não atendido.** Nenhuma foto fica abaixo do limiar de 70% (mínimo de 73,5% no
teste e de 74,8% na validação), então nenhum dos maiores erros é desviado ao perito por esse limiar. A
confiança ainda ordena os erros: o quarto menos confiante errou 4,5 pontos no teste contra 2,0 nos
demais (3,9 contra 1,4 na validação), com correlação de postos de −0,36 no teste e −0,27 na validação,
pelo caminho do serviço (o −0,27 da calibração usa a máscara de referência). O limiar de 70% fica, porém, abaixo de todas as
fotos. O que leva um lote ao perito é a redução da confiança do lote quando há poucas fotos, não a
confiança de cada uma.

## Ressalvas

- Um voo, 0,3 ha de milho, uma data, rótulos automáticos por infravermelho. Nada disto vale para
  soja nem para outras lavouras.
- O conjunto de teste vem da mesma lavoura que o treino, em faixas separadas: mede a generalização
  dentro do voo, não para outra lavoura.
- A configuração foi escolhida pela validação, e o teste foi só reportado. Apenas 45 recortes no
  teste e 3 repetições por configuração, então diferenças de meio ponto podem ser ruído.