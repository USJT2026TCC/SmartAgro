# Resultado: visao-unet-2.0.0

Segunda rodada de treino, a primeira com a base corrigida. CPU local, 30 épocas, 23/09/2026.

| | |
|---|---|
| Base | Suiçmez, Yilmaz e Kahraman (2026), **v2.1**, DOI 10.5281/zenodo.22062459, CC BY 4.0 |
| Dados | só o voo do estresse hídrico: 0,3 ha de milho, uma data |
| Rótulos | automáticos, por índices de vegetação calculados com infravermelho (corrigidos na v2.1) |
| Classes | solo, saudável, estresse leve, estresse severo |
| Recortes | 257 de treino, 87 de validação (79 com lavoura) |
| Divisão | espacial, por faixas verticais alternadas de 512 px |
| Pesos das classes | raiz do inverso da frequência (`--expoente-dos-pesos 0.5`) |
| Melhor época | 18 de 30 |

## Recorte a recorte

79 recortes de validação com pelo menos 10% de lavoura, medidos por `treino/avaliacao.py`:

| | Sempre 0% | Heurística de cor | **U-Net 2.0.0** |
|---|---:|---:|---:|
| Erro absoluto médio | 4,9 | 13,9 | **3,3** |
| Erro mediano | — | 12,8 | **2,2** |
| Viés | −4,9 | +13,1 | **+0,1** |

## No nível do talhão

Os 79 recortes somados, como o índice faz com um lote de fotos:

| | Dano da área |
|---|---:|
| Real | 4,3% |
| **U-Net 2.0.0** | **4,6%** |
| Heurística de cor | 18,6% |

É o resultado mais forte, e o mais relevante para a apólice: sobre a área, o modelo erra por 0,3
ponto; a heurística multiplica o dano por quatro.

## O modelo é puxado para a média

| Dano real | Recortes | Real médio | Modelo médio | Viés |
|---|---:|---:|---:|---:|
| sem dano (< 1%) | 16 | 0,3% | 4,3% | **+4,0** |
| baixo (1 a 10%) | 53 | 4,3% | 4,6% | +0,3 |
| alto (10% ou mais) | 10 | 15,6% | 8,1% | **−7,6** |

O viés quase zero da média é um erro compensando o outro. **Onde o dano é alto, o modelo estima
cerca da metade.** A figura de comparação mostra o mesmo: as manchas estão no lugar certo, mas
menores. São só 10 recortes de dano alto, mas o padrão é claro.

Para o seguro, é o caso que mais importa. Enquanto isso não mudar, o índice de dano por imagem não
deve ser o gatilho principal de pagamento — continua complementar ao índice climático, com o perito
nos casos de baixa confiança.

**Experimento sugerido:** treinar com `--expoente-dos-pesos 1.0`, que pesa mais as classes de
estresse e tende a marcá-las com mais frequência.

## Ressalvas que vão no TCC

- A melhor época foi escolhida olhando a própria validação. Nas últimas cinco épocas, o erro médio
  recorte a recorte ficou em 5,1 — perto da resposta trivial. O 3,3 é otimista; o resultado no nível
  do talhão é menos sensível a isso, porque não depende de acertar cada recorte.
- Um voo, 0,3 ha, milho, uma data. Aplicar à soja de São Simão, com foto de celular, é
  extrapolação.
- Os rótulos são automáticos. O modelo aprende a prever, pelo visível, um mapa definido pelo
  infravermelho — e herda os limites de quem gerou os rótulos.

## Arquivos

| Arquivo | O que é |
|---|---|
| `historico.json` | Métricas por época |
| `curva-de-treino.png` | Erro do índice e IoU por época, com a referência trivial |
| `comparacao.png` | Imagem, referência e predição: os três recortes de maior dano e um sadio |

Os pesos (`unet.pt`, 7,8 MB) não estão no repositório; ficam em `visao/pesos/`, ignorado pelo git.
