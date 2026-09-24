# Módulo de visão

Estima **quanto por cento da lavoura foi prejudicado** a partir das imagens do talhão, e entrega
esse número ao backend com uma confiança associada (RF15, RF16, RF17, HU11). Código em
[`visao/`](../visao).

---

## 1. Onde ele fica

```
produtor fotografa ──► backend guarda e fecha o lote (hash das evidências)
                            │
                            ▼
                    MÓDULO DE VISÃO
                    busca pendentes, baixa imagens, classifica pixel a pixel
                            │
                            ▼
              índice de dano + confiança + versão do modelo
                            │
              confiança < 70% ──► perito decide (RF17)
              confiança ≥ 70% ──► oráculo publica na cadeia
```

O módulo **não fala com a blockchain**. Ele entrega um número ao backend, e é o oráculo que
decide levá-lo à cadeia. Um componente a menos com poder de mover valor.

## 2. Como o percentual é calculado

O modelo classifica cada pixel em quatro classes — solo, lavoura saudável, estresse leve e
estresse severo. O índice sai daí, e **três decisões nessa conta mudam
quanto a apólice paga**:

### 2.1 O denominador é a lavoura, não a foto

```
dano = área de lavoura em estresse / área de lavoura
```

Solo exposto — carreador, área de manobra, falha de plantio — sai da conta. Contar solo como
dano faria a apólice pagar por terra que nunca teve planta. Uma foto só de carreador dá dano
zero, e não dano total.

### 2.2 Estresse leve não vale o mesmo que estresse severo

Peso padrão: **0,5 para leve, 1,0 para severo**. Somar as duas classes trataria uma folha murcha
que se recupera com a próxima chuva como perda total. A ponderação é uma escolha atuarial, da
seguradora, e não uma escolha técnica — por isso é configurável e vai registrada junto do
resultado.

### 2.3 Doença está fora do escopo

O trabalho trata de dano por estiagem, e o modelo não tem classe de doença. A primeira versão
tinha: a base traz a ferrugem de um voo separado, sobre outra lavoura, e o modelo aprendeu a
reconhecer o **voo** em vez da lesão — chamou de doença 13% da lavoura em estresse hídrico, e como
doença tinha peso zero, esse dano sumia da conta (DECISOES.md 2.21).

Consequência a declarar: numa lavoura com doença, o modelo vai classificar as lesões como estresse
ou como lavoura sadia. O gatilho principal da apólice é o índice climático, e análises de baixa
confiança vão ao perito.

### 2.4 Foto é amostra; ortomosaico é censo

Um voo de drone cobre o talhão inteiro, e a proporção medida **é** a proporção do talhão. Fotos
de celular cobrem alguns pontos, e a proporção medida é uma **estimativa**. Por isso a confiança
cai quando:

| Situação | Efeito na confiança |
|---|---|
| Menos de 10% da imagem tem lavoura | × 0,5 |
| Uma única imagem no lote | × 0,6 |
| Duas imagens | × 0,8 |
| Imagens discordam muito entre si (desvio > 25%) | × 0,6 |
| Alguma evidência não pôde ser analisada | × 0,5 |

Cada fator só **derruba** a confiança, nunca a levanta. E confiança baixa manda a análise ao
perito, em vez de acionar pagamento.

Na consolidação, os **pixels são somados**, e não os índices mediados: um ortomosaico de 4
milhões de pixels não pode pesar o mesmo que uma foto de 4 mil.

## 3. Os dois estimadores

### 3.1 Heurística de cor (`baseline.py`) — funciona hoje, em CPU

Separa solo de planta pelo índice de excesso de verde (ExG), e planta sadia de planta estressada
pelo matiz. É o que a agricultura de precisão usa há décadas. Não precisa de treino nem de GPU.

**A confiança é fixa em 45%, abaixo do limiar de 70%.** Consequência, e não efeito colateral:
toda análise dela vai ao perito, e nenhuma aciona pagamento sozinha. Uma heurística de cor não
distingue milho seco de milho maduro; um número desses movendo dinheiro automaticamente seria
exatamente o que este trabalho argumenta que não se deve fazer.

**Limitação conhecida, e medida:** palha seca tem a cor da terra. A heurística classifica
lavoura totalmente seca como solo, e como solo sai do denominador, o índice dá **zero justamente
no caso mais grave** — subestimando o dano e prejudicando o produtor. Está fixado em teste
(`test_limitacao_conhecida_palha_seca_e_confundida_com_solo`) e o tamanho do erro é medido
contra as máscaras de referência:

```bash
python treino/avaliar_baseline.py --divisao validacao
```

**Medido na validação da base v2.1** (79 recortes com pelo menos 10% de lavoura, rótulos
corrigidos), com `python treino/avaliar_baseline.py`:

| | |
|---|---:|
| Dano médio real | 4,9% |
| Dano médio estimado pela heurística | 18,0% |
| Erro absoluto médio | **13,9 pontos** |
| Viés | **+13,1 (superestima)** |
| Responder sempre 0% erraria | **4,9 pontos** |

**A heurística erra mais do que responder sempre zero.** Com os rótulos corrigidos, o estresse é
raro — uns 6% da lavoura —, e a heurística, que classifica por cor, marca como estressada muita
lavoura que não está. Um estimador que não vence a resposta trivial não está enxergando o
estresse. É o argumento, agora com número, para o modelo treinado.

> Uma medição anterior, contra as máscaras do subconjunto v1.0, dava 18,4 pontos e viés de −16,3.
> Aquelas máscaras foram calculadas com bandas trocadas (DECISOES.md 2.22) e aquela medição não
> vale.

A limitação da palha seca, fixada em teste, continua valendo: em RGB, palha seca e terra têm a
mesma cor.

### 3.2 U-Net treinada (`modelo.py` + `treino/`) — o destino

Rede de segmentação treinada na base de milho com estresse hídrico
([DADOS.md §2.1](DADOS.md)). Cinco classes, entrada RGB de 224×224.

**Por que RGB, e não os seis canais multiespectrais da base:** o produtor fotografa com o
celular, e celular só tem RGB. Um modelo que exige câmera multiespectral seria melhor no artigo
e inútil na lavoura. A base fica disponível para a versão multiespectral quando houver drone com
essa câmera.

**Cada imagem é padronizada antes de entrar na rede** — subtrai-se a média e divide-se pelo
desvio, canal a canal. As imagens de treino vêm de câmera de drone, mais escuras e menos
saturadas que uma foto de celular da mesma lavoura; sem padronizar, o modelo aprenderia também o
brilho típico daquela câmera e, no celular, veria outra lavoura. A padronização não elimina a
diferença entre os equipamentos — só um conjunto de fotos reais da lavoura resolveria isso —,
mas tira a parte mais grosseira dela.

Treino e inferência usam **a mesma função**, e há teste fixando isso: padronizar de um lado e
não do outro produziria um modelo que parece bom na validação e erra em produção, sem nenhum
erro aparecer.

A confiança aqui **vem do modelo**: média da probabilidade da classe escolhida, considerando
apenas os pixels de lavoura. A certeza do modelo sobre o céu e sobre o carreador não diz nada
sobre a lavoura estar em estresse, e incluí-la inflaria a confiança justamente nas fotos com
pouca planta.

**Treine em GPU.** Esta máquina não tem GPU NVIDIA; o caminho previsto é Google Colab ou Kaggle,
ambos com GPU gratuita. Ver [`visao/README.md`](../visao/README.md).

O arquivo de pesos guarda `state_dict`, versão e lista de classes — nunca o objeto Python. É
dado, e não código: carregar um modelo serializado como objeto executaria o que estivesse dentro
dele. A versão reportada com cada análise vem **do arquivo**, e não de uma variável de ambiente,
para que fique registrado o modelo que de fato rodou (ver [DECISOES.md §2.18](DECISOES.md)).

### 3.3 Primeira rodada (visao-unet-1.0.0) — invalidada

Treinada no Colab com o subconjunto v1.0 da base, cujas máscaras foram calculadas com as bandas de
infravermelho e red-edge trocadas: 56% da lavoura rotulada como estresse, contra 5,8% com os
rótulos corrigidos. O modelo aprendeu o rótulo errado, e as medições dela — 14,7 pontos contra
18,4 da heurística — foram feitas contra o mesmo rótulo errado. **Não devem ser citadas.**

A rodada ainda serviu: revelou os defeitos 2.19, 2.20 e 2.21 de DECISOES.md, e o histórico fica em
[resultados/visao-unet-1.0.0](resultados/visao-unet-1.0.0/README.md) como registro.

### 3.4 Segunda rodada (visao-unet-2.0.0) — base v2.1, só estresse hídrico

Validação de 79 recortes com pelo menos 10% de lavoura, rótulos corrigidos:

| | Sempre 0% | Heurística | **U-Net 2.0.0** |
|---|---:|---:|---:|
| Erro absoluto médio, por recorte | 4,9 | 13,9 | **3,3** |
| Viés | −4,9 | +13,1 | **+0,1** |
| Dano da área, somando os recortes (real: 4,3%) | 0% | 18,6% | **4,6%** |

**No nível do talhão, o modelo acerta o dano da área com 0,3 ponto de diferença.** É o número que
importa para a apólice, que soma os pixels de um lote de fotos.

**Mas o modelo é puxado para a média:** superestima o dano de lavoura sadia (+4 pontos) e
**subestima pela metade o dano alto** (15,6% real, 8,1% estimado). Por isso o índice de dano por
imagem continua complementar ao índice climático, e não gatilho principal. O experimento natural é
treinar com `--expoente-dos-pesos 1.0`, que pesa mais o estresse.

Detalhes, figuras e ressalvas em [resultados/visao-unet-2.0.0](resultados/visao-unet-2.0.0/README.md).

## 4. TerraMind (IBM + ESA): serve, mas para outra coisa

[TerraMind](https://ibm.github.io/terramind/) é um modelo fundacional multimodal de observação
da Terra, da IBM com o ESA Φ-lab, aceito no ICCV 2025. Licença **Apache 2.0**, pesos no
[Hugging Face](https://huggingface.co/ibm-esa-geospatial), ajuste fino pelo
[TerraTorch](https://github.com/IBM/terratorch).

| | |
|---|---|
| Pré-treino | TerraMesh — 9 milhões de amostras multimodais alinhadas, 500 bilhões de tokens |
| Modalidades | Sentinel-1 (radar), Sentinel-2 (12 bandas), DEM, NDVI, uso do solo, RGB |
| Entrada | 224×224 |
| Escala dos dados | Sentinel: **10 metros por pixel** |

### O que isso significa para o AgroSmart

**Não substitui o modelo de drone.** TerraMind foi pré-treinado em pixels de 10 metros de lado.
Uma foto de drone tem pixels de poucos centímetros. Um pixel de Sentinel cobre 100 m² — cerca de
um milhão de vezes a área de um pixel de drone —, e as estatísticas de imagem são completamente
diferentes. Usá-lo para classificar foto de celular seria forçar um modelo a fazer o que ele não
foi treinado para fazer.

**Mas resolve um problema que o drone não resolve.** O talhão da demonstração tem 460 ha. Cobrir
isso com drone exige voo planejado, bateria e alguém em campo; com celular, exige o produtor
andando pela lavoura. O Sentinel-2 passa sobre o mesmo ponto **a cada 5 dias, de graça, sem
ninguém ir a lugar nenhum**, e a 10 m um talhão de 460 ha vira cerca de 46 mil pixels — resolução
de sobra para estimar percentual de área afetada.

Como segunda fonte do índice de dano, ele se encaixa exatamente no princípio do projeto:
**nenhuma fonte isolada decide um pagamento**. Hoje o índice climático já exige duas estações; o
índice de dano passaria a ter satélite e imagem de campo, que falham por motivos diferentes —
nuvem atrapalha o satélite, não o drone; amostragem ruim atrapalha o drone, não o satélite.

### Caminho recomendado, em ordem de custo

1. **NDVI do Sentinel-2, sem modelo nenhum.** O índice de vegetação sai de uma conta entre duas
   bandas. Percentual de área com queda de NDVI em relação à linha de base da safra já é um
   estimador de dano defensável, e serve de referência para comparar com o resto.
2. **TerraMind com ajuste fino via TerraTorch**, se houver rótulos para a região. É o passo que
   dá ao trabalho um modelo fundacional de ponta — e o argumento de que satélite e campo se
   corrigem mutuamente.
3. **Thinking-in-Modalities**, a geração de modalidade intermediária, se sobrar tempo.

### Riscos a considerar antes de adotar

- Ajuste fino precisa de **dados rotulados da nossa região**, que não temos. Sem eles, o caminho
  1 é o único honesto.
- É mais um modelo, mais uma dependência e mais uma fonte de erro, em um trabalho que já tem
  contratos, oráculo, backend, aplicativo, simulador e visão.
- **Escopo:** o prazo é 26/10/2026. Sugiro fechar o caminho do drone primeiro, e tratar o
  satélite como extensão — dá um capítulo forte de trabalhos futuros mesmo se não for concluído.

## 5. Rodar

```bash
cd visao && python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"
```

```bash
.venv/Scripts/python -m visao servico --uma-vez
```

O serviço diz, em voz alta, qual estimador está usando. Rodar com a heurística de cor achando
que se está rodando o modelo treinado seria o pior dos dois mundos.

Para analisar arquivos locais, sem backend:

```bash
.venv/Scripts/python -m visao analisar foto1.jpg foto2.jpg
```

## 6. Testes

```bash
cd visao && .venv/Scripts/python -m pytest
```

49 testes, sem rede e sem GPU (os 10 de `test_rede.py` são pulados onde o PyTorch não está instalado).

| Arquivo | Testes | O que cobre |
|---|---:|---|
| `test_indice.py` | 15 | Denominador, ponderação, doença fora da conta, confiança por amostragem |
| `test_baseline.py` | 9 | Cores conhecidas, invariância a sombra, e a limitação da palha seca |
| `test_servico.py` | 9 | Evidência adulterada, arquivo ilegível, lote vazio, falha de rede |
| `test_rede.py` | 10 | Pesos que carregam fora do treino, classes incompatíveis recusadas, padronização e tamanho de entrada iguais aos do treino |
| `test_preparo.py` | 5 | Bandas nomeadas no RGB, tradução das classes, divisão por faixas, ordem de classes conferida |
