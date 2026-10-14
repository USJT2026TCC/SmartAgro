# Resultado: o modelo de visão em fotos de soja no campo

Validação externa de 14/10/2026. O modelo em operação (2.0.0) foi treinado num voo de drone
multiespectral sobre milho; o aplicativo recebe fotos RGB de soja. Até aqui, essa diferença era uma
ressalva escrita. Esta medição a transforma em número.

## A base usada

**BANERJEE, S.; RAMOS, P.; REBERG-HORTON, C.; MIRSKY, S.; LOCKE, A.; LOBATON, E.** *Study of Leaf
Wilt in Soybean Plants*. Zenodo, 2023. DOI [10.5281/zenodo.8256382](https://doi.org/10.5281/zenodo.8256382),
CC BY 4.0. Artigo associado: *A Multiple Instance Learning Approach to Study Leaf Wilt in Soybean
Plants*, Agriculture, v. 15, n. 6, art. 614, 2025.

| | |
|---|---|
| Fotos | 1.892, RGB, de câmeras fixas sobre parcelas de soja no campo |
| Local e data | Carolina do Norte, EUA; agosto e setembro de 2019 |
| Rótulo | nota de murcha por especialistas, de 0 (sem murcha) a 5 no arquivo (a página fala em 0 a 4) |
| Arquivo | `full_data.zip`, 655.705.161 bytes, MD5 conferido com o publicado no Zenodo |

## O que se esperava, antes de medir

Murcha e área afetada não são a mesma medida. A murcha é a postura da folha, que perde turgor e cai;
o modelo mede cor, pixel a pixel. Uma folha murcha e ainda verde não muda de cor. Além disso, a
murcha acontece todo dia no calor da tarde, mesmo sem seca: na base, a nota média sobe de 0 às 6h
para cerca de 2 às 16h. Por isso o teste é a correlação, e medida também dentro do mesmo horário.
Uma correlação positiva e moderada já seria um bom resultado.

## Resultado

`treino/validar_soja_murcha.py`, com os pesos em operação:

| | Correlação índice × nota, todas as fotos | Dentro do mesmo horário (média) |
|---|---:|---:|
| **U-Net 2.0.0** | **−0,21** | **−0,05** |
| Heurística de cor | +0,12 | +0,09 |

Índice de dano médio estimado pelo modelo, por nota de murcha:

| Nota | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|---:|
| Fotos | 524 | 473 | 369 | 216 | 206 | 104 |
| Índice médio | 5,1% | 2,9% | 2,3% | 2,6% | 2,0% | 3,8% |

**O índice de dano não acompanha a murcha.** Dentro do mesmo horário, a correlação é praticamente
zero. No conjunto, é levemente negativa, e o horário explica por quê:

| Hora | 6h | 8h | 10h | 12h | 14h | 16h | 18h | 19h |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Nota média de murcha | 0,00 | 0,84 | 1,35 | 1,91 | 1,98 | 2,15 | 1,84 | 1,52 |
| Índice médio do modelo | 7,9% | 6,5% | 3,8% | 2,6% | 2,5% | 2,4% | 3,1% | 4,4% |

O modelo estima mais dano com o sol baixo, de manhã cedo e no fim da tarde, e menos ao meio-dia — o
contrário da murcha. **Ele reage à iluminação, não à planta.** O treino veio de um único
voo, numa só data, portanto com pouca variação de luz; a causa provável é que o modelo nunca viu a
mesma lavoura sob sol alto e sol baixo. A padronização da imagem (DECISOES.md 1.13) tira o nível
geral de exposição, mas não a mudança de cor da luz.
A heurística de cor, que não aprendeu nada do voo de milho, fica um pouco à frente, mas também
fraca.

## O achado mais importante: a confiança não percebe que a foto é de outro mundo

| | |
|---|---:|
| Confiança média do modelo nestas fotos | **82,4%** |
| Fotos acima do limiar de 70% (iriam direto ao oráculo, sem perito) | **1.891 de 1.892** |

O limiar de confiança do RF17 foi pensado para mandar ao perito as análises em que o modelo hesita.
Em fotos de uma cultura e de uma câmera que ele nunca viu, ele **não hesita**: está tão confiante
quanto no milho de treino. A confiança protege contra dúvida dentro do domínio, não contra o modelo
estar fora dele.

## Conclusões para o TCC

1. **O índice de dano está validado só no domínio do treino** (milho, drone, um voo). Em soja por foto
   comum, não há evidência de que funcione — e esta medição é evidência de que, para a murcha, não
   funciona.
2. **O limiar de confiança não basta como proteção.** Para um produto que pague só pelo índice de dano
   (operador `DANO`), uma foto fora do domínio passaria sem perito. Os produtos com o operador `E`
   (clima e imagem precisam concordar) ou só climáticos continuam protegidos, porque o índice
   climático, medido por estação, não depende do modelo.
3. **A ressalva deixa de ser hipótese.** "Aplicar à soja com foto de celular é extrapolação" estava
   escrito desde o resultado 2.0.0; agora há um número que mostra o tamanho do problema.

## Limites desta medição

- Murcha não é a mesma coisa que área afetada por seca. Uma base de soja com a área afetada marcada
  pixel a pixel seria o teste ideal, e não existe publicamente (DADOS.md).
- As fotos são da Carolina do Norte, de câmeras fixas, não de celular no Brasil. É o mais próximo do
  uso real que existe em base pública, mas não é o uso real.

## Reproduzir

Baixe os dois arquivos do registro Zenodo 8256382 para `visao/dados/externos/soja-murcha/` e rode:

```bash
cd visao && .venv/Scripts/python treino/validar_soja_murcha.py --pesos pesos/unet.pt
```

O resultado foto a foto fica em `visao/dados/externos/soja-murcha/resultado-visao-unet-2.0.0-cpu.csv`
(fora do git, como os dados).
