# Resultado: visao-unet-1.0.0

Primeira rodada de treino do segmentador de estresse hídrico. Google Colab, GPU, 30 épocas,
23/09/2026.

| | |
|---|---|
| Base | Suiçmez, Yilmaz e Kahraman (2025), DOI 10.5281/zenodo.19385720, CC BY 4.0 |
| Recortes de treino | 738 (com espelhamento e giros) |
| Recortes de validação | 262: 132 de estresse hídrico e 130 de ferrugem |
| Divisão | espacial, por coluna do ortomosaico |
| Melhor época | 19 de 30 |

## A comparação que vale

Medida nos **132 recortes de estresse hídrico** da validação, os mesmos em que a linha de base
foi medida:

| | Heurística de cor | U-Net 1.0.0 |
|---|---:|---:|
| Dano médio real | 29,5% | 29,5% |
| Dano médio estimado | 13,2% | 32,8% |
| **Erro absoluto médio** | **18,4 pontos** | **14,7 pontos** |
| Erro mediano | — | 12,6 pontos |
| Erro máximo | 50,4 pontos | 59,4 pontos |
| **Viés** | **−16,3 (subestima)** | **+3,3 (superestima)** |
| Lavoura lida como doença | — | 13,0% |

Reproduzir:

```bash
python treino/avaliar_baseline.py --divisao validacao --grupo water
python treino/avaliar_modelo.py --pesos pesos/unet.pt --grupo water
```

## Como ler

**O ganho maior é no viés, não no erro médio.** O erro médio caiu 20% (18,4 → 14,7), mas o viés
praticamente sumiu: a heurística subestimava o dano de forma sistemática, e o modelo erra para
os dois lados. Para um seguro, isso importa mais que o erro médio. Erro sistemático para baixo
significa pagar menos do que a apólice promete, **sempre**; erro sem viés se compensa ao longo de
uma carteira.

**Mas o erro por imagem ainda é grande.** Uma mediana de 12,6 pontos quer dizer que, numa foto
típica, o modelo erra o percentual de dano por mais de dez pontos. Com fotos isoladas, isso
**não sustenta pagamento automático**. Continua valendo o encaminhamento ao perito quando a
confiança é baixa, e a confiança cai com poucas imagens no lote (ver VISAO.md §2.4).

## Três defeitos que esta rodada revelou

1. **O número do treino media a prova errada.** O treino reportou 7,4 pontos, calculados sobre a
   validação inteira. Os 130 recortes de ferrugem têm dano por seca zero, e acertar zero é fácil.
   Na prova certa, o erro é 14,7. O treino agora escolhe a melhor época por essa prova
   (DECISOES.md §2.20).

2. **A produção usava outro tamanho de imagem.** O serviço redimensionava para 512 um modelo
   treinado em 224, e o erro ia a **25,4 pontos, pior que a heurística**, sem nenhum aviso. O
   tamanho agora viaja no arquivo de pesos (DECISOES.md §2.19).

3. **O modelo aprendeu um atalho: "parece a lavoura da ferrugem, então é ferrugem".** Nos
   recortes de ferrugem, 88% da lavoura **saudável** foi classificada como doença. Nos de estresse
   hídrico, 13% da lavoura. O modelo parece reconhecer o *voo* (luz, época, talhão) em vez da
   *lesão*. Como doença tem peso zero no índice de seca, cada pixel de estresse lido como
   ferrugem some da conta. A primeira linha da figura de comparação mostra isso: lavoura inteira
   pintada de roxo, dano estimado 0% contra 7% real.

## Arquivos

| Arquivo | O que é |
|---|---|
| `historico.json` | Métricas por época, gravadas pelo treino |
| `curva-de-treino.png` | Erro do índice e IoU por época. **Atenção:** nesta rodada, a curva de erro é sobre a validação inteira, a métrica que depois se mostrou inadequada |
| `comparacao.jpg` | Imagem, referência e predição para quatro recortes de estresse hídrico |

Os pesos (`unet.pt`, 7,7 MB) não estão no repositório. Ficam com a equipe e em `visao/pesos/`,
que é ignorado pelo git.
