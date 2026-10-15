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
causa não foi investigada. A correlação entre confiança e erro **não foi medida** nesta bateria, e
a da 3.0.0 era fraca (cerca de −0,1), então a confiança alta não garante análise correta.

## Ressalvas

- Um voo, 0,3 ha de milho, uma data, rótulos automáticos por infravermelho. Nada disto vale para
  soja nem para outras lavouras.
- O conjunto de teste vem da mesma lavoura que o treino, em faixas separadas: mede a generalização
  dentro do voo, não para outra lavoura.
- A configuração foi escolhida pela validação, e o teste foi só reportado. Apenas 45 recortes no
  teste e 3 repetições por configuração, então diferenças de meio ponto podem ser ruído.