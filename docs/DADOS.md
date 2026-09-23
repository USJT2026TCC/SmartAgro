# Fontes de dados

Todo número que aparece na demonstração vem de algum lugar. Este documento diz de onde, sob que
licença, e o que foi feito com ele. Nenhum dado usado no projeto é inventado sem que a própria
tela diga que é simulado.

---

## 1. Dados meteorológicos — INMET

**Fonte:** Instituto Nacional de Meteorologia (INMET), Ministério da Agricultura e Pecuária.
Dados Históricos das estações automáticas — <https://portal.inmet.gov.br/dadoshistoricos>

**O que é:** um arquivo ZIP por ano, de 2000 a 2026, com um CSV por estação automática. Cada
CSV tem uma linha por hora, com chuva, temperatura, umidade, pressão, radiação e vento. São
dados públicos, distribuídos gratuitamente pelo instituto.

**Como citar no TCC:**

> INSTITUTO NACIONAL DE METEOROLOGIA (INMET). *Dados históricos — estações automáticas*.
> Brasília: INMET. Disponível em: https://portal.inmet.gov.br/dadoshistoricos. Acesso em:
> 22 set. 2026.

**Como baixar:**

```bash
cd simulador && python -m simulador baixar --ano 2024
```

O arquivo fica em `simulador/dados/`, que está no `.gitignore` — são ~100 MB por ano, e dado
público de terceiro não entra no repositório do trabalho.

> O portal fecha a conexão quando o cabeçalho de agente não parece o de um navegador. O
> simulador envia um cabeçalho de navegador por isso, e apenas por isso: o arquivo é público e é
> o mesmo que o navegador baixa.

### A estação escolhida, e por quê

| Estação | Local | Distância do talhão | Por que |
|---|---|---:|---|
| **A770** | São Simão/SP | 0,1 km | Fonte principal. Série de 2024 completa: 366 dias com 20 h ou mais de medição |
| **A747** | Pradópolis/SP | 57 km | Segunda fonte. O consolidador exige no mínimo duas, e uma estação sozinha não pode decidir um pagamento |
| A708 | Franca/SP | 79 km | **Descartada:** apenas 106 dias completos em 2024 |

O talhão da demonstração foi posicionado ao lado da A770 justamente por isso: seguro indexado
por estação distante mede outra lavoura que não a segurada.

### A estiagem real de 2024

Na janela de 25/06 a 09/08/2024, a A770 registra **39 dias consecutivos com menos de 1 mm de
chuva**, e a A747 registra a mesma estiagem. É a seca histórica do Sudeste em 2024, e ela cruza
o limiar de 30 dias do produto contratado — o pagamento da demonstração acontece por causa de um
evento climático que realmente ocorreu.

Conferido com:

```bash
python -m simulador analisar --estacao A770 --ano 2024
```

### O que foi feito com os dados

| Operação | Feita? | Observação |
|---|---|---|
| Valores medidos (chuva, temperatura, umidade) | **inalterados** | Vão para a cadeia como o INMET publicou |
| Recorte de janela de datas | sim | `--de` e `--ate` |
| Deslocamento das datas | sim, quando pedido | `--ate-hoje` move a série para terminar ontem, porque a apólice da demonstração tem vigência agora. O comando **avisa na tela** quantos dias deslocou |
| Preenchimento de horas sem medição | **não** | Hora sem medição continua sem medição. Presumir zero transformaria sensor quebrado em dia seco, e dia seco é o que aciona o pagamento |

### Qualidade do dado, tratada como parte do problema

O pluviômetro falha. Em 2025, a estação A747 tem medição de chuva em 3.406 das 8.760 horas do
ano. Isso não é defeito de importação: é o estado real da rede de estações, e o sistema precisa
se comportar bem diante dele.

Por isso a contagem de dias secos **para quando falta dado**, em vez de presumir que o dia foi
seco (ver [DECISOES.md](DECISOES.md), 1.8). E por isso a reputação da fonte cai quando ela envia
leitura implausível (RF13).

---

## 2. Imagens para o módulo de visão

O módulo de visão está em [`visao/`](../visao), e o backend recebe o resultado dele no formato
de [BACKEND.md §6](BACKEND.md). Abaixo, as bases públicas avaliadas, com licença e citação.

### 2.1 Recomendada — milho com estresse hídrico, por drone

**Fonte:** SUİÇMEZ, Ç.; YILMAZ, C.; KAHRAMAN, H. T. *UAV-Based Multispectral Maize Dataset for
Water Stress and Rust Detection*. Zenodo, 2025.
DOI [10.5281/zenodo.22062459](https://doi.org/10.5281/zenodo.22062459) (completo, 1,4 GB) ·
[10.5281/zenodo.19385720](https://doi.org/10.5281/zenodo.19385720) (subconjunto, 344 MB)

**Licença:** Creative Commons Attribution 4.0 (CC BY 4.0) — uso livre, inclusive comercial,
exigindo atribuição.

**Por que esta:** as classes são exatamente o que o projeto precisa — solo, milho saudável,
**estresse hídrico leve**, **estresse hídrico severo** e ferrugem. É captada por drone
multiespectral em campo real, e não em laboratório, que é a condição em que o produtor
fotografaria o talhão. O índice de dano do AgroSmart pode sair da proporção de área classificada
como estresse.

**Artigo associado, para a fundamentação teórica:** SUİÇMEZ, Ç.; YILMAZ, C.; KAHRAMAN, H. T. A
Multi-Head UNet++ Framework with Fractional Differential Output Refinement for UAV Multispectral
Crop Stress Mapping. *Sensors*, v. 26, n. 10, 3228, 2026.

### 2.2 Alternativa de grande escala — Agriculture-Vision

**Fonte:** CHIU, M. T. et al. *Agriculture-Vision: A Large Aerial Image Database for
Agricultural Pattern Analysis*. CVPR 2020.
<https://www.agriculture-vision.com> · [artigo](https://arxiv.org/abs/2001.01306)

**O que é:** 94.986 imagens aéreas de 512×512, de 54 fazendas, anotadas por agrônomos em nove
padrões — entre eles **drydown** (dano por seca), *water damage*, *storm damage* e *nutrient
deficiency*.

**Download:** bucket público na AWS, sem autenticação:

```bash
aws s3 ls --no-sign-request s3://intelinair-data-releases/agriculture-vision/cvpr_paper_2020/
```

**Licença:** o arquivo de licença está no próprio bucket, e **precisa ser lido antes do uso** —
a página do projeto não declara os termos. Até que a equipe confirme, tratar como uso acadêmico.

### 2.3 Complementar — PlantVillage (doenças em folha)

**Fonte:** ARUN PANDIAN, J.; GEETHARAMANI, G. *Data for: Identification of Plant Leaf Diseases
Using a 9-layer Deep Convolutional Neural Network*. Mendeley Data, v1, 2019.
DOI [10.17632/tywbtsjrjv.1](https://doi.org/10.17632/tywbtsjrjv.1)

**Licença:** CC0 1.0 (domínio público).

**O que é:** 61.486 imagens de folhas, 39 classes, incluindo soja e milho. Útil para treinar o
reconhecimento de folha doente, **mas não serve para estresse hídrico**: são folhas isoladas,
em fundo controlado, e o dano por seca aparece na lavoura, não na folha recortada. Fica como
base de apoio, não como base principal.

### Decisão

Adotada a **2.1** (CC BY 4.0, classes de estresse hídrico, tamanho tratável). A base está em uso
em [`visao/`](../visao): `treino/preparar_dados.py` a extrai e divide, e
`treino/avaliar_baseline.py` usa as máscaras de referência para medir o erro do estimador.

O que veio no subconjunto: 1.000 recortes de 224×224, metade de estresse hídrico e metade de
ferrugem, cada um com RGB (`.jpg`), cinco bandas multiespectrais (`.npy`) e máscara de
referência (`.png`).

**As classes da base não estão na mesma ordem das nossas**, e a tradução é feita uma vez só, em
`preparar_dados.py`:

| Código na base | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| Base | fundo/solo | estresse leve | estresse severo | saudável | ferrugem |
| AgroSmart | solo | saudável | estresse leve | estresse severo | outro dano |

Confundir as duas ordens produziria um índice de dano trocado — e ninguém notaria, porque
continuaria sendo um número plausível entre 0 e 1.

### O que encontramos ao abrir a base

Três coisas que não estão escritas no README dela e que mudam como ela deve ser usada:

**1. O `.jpg` é cor natural, e não falsa-cor.** À primeira vista as imagens parecem falsa-cor: a
vegetação sai arroxeada e a cena, escura. Mas o `.jpg` é exatamente a composição das bandas 0, 1
e 2 do `.npy` (correlação de 0,97 a 0,99, médias idênticas), e a assinatura espectral da
ferrugem — lesão alaranjada, com banda 0 acima da banda 2 — confirma que **a banda 0 é o
vermelho**. É RGB de verdade; o que estranha é a exposição.

**2. A exposição não é a de uma foto de celular.** As imagens vêm de câmera de drone, com
normalização própria: mais escuras e menos saturadas. Um modelo treinado nos valores crus
aprenderia também o brilho daquela câmera. É a razão de o módulo padronizar cada imagem antes de
classificar (ver [VISAO.md §3.2](VISAO.md)).

**3. A identificação das bandas 4 e 5 não é confiável nesta versão.** Calculando NDVI com a
banda 4 como infravermelho, a ordem sai **invertida**: lavoura saudável com índice menor que
lavoura em estresse, o que é fisicamente impossível. Os próprios autores publicaram depois uma
correção — *"corrects the spectral identification of Bands 4 and 5"* —, o que explica o
resultado. **Consequência prática:** o caminho multiespectral, se for seguido, precisa da versão
completa e corrigida (DOI 10.5281/zenodo.22062459), e não deste subconjunto. O caminho RGB, que
é o que usamos, não depende dessas bandas.

A 2.2 (Agriculture-Vision) fica como reserva, se for preciso mais volume, depois de conferida a
licença no bucket.

### 2.4 Satélite — Sentinel-2 e TerraMind

Avaliado a pedido da equipe. **[TerraMind](https://ibm.github.io/terramind/)** (IBM + ESA
Φ-lab, ICCV 2025, licença Apache 2.0) é um modelo fundacional multimodal pré-treinado no corpus
TerraMesh — 9 milhões de amostras, 500 bilhões de tokens — sobre Sentinel-1, Sentinel-2, DEM e
NDVI, na escala de **10 metros por pixel**.

Não substitui o modelo de drone, porque foi treinado em outra escala; mas cobre o talhão inteiro
a cada 5 dias, de graça, sem ninguém ir a campo. A análise completa está em
[VISAO.md §4](VISAO.md).

Os dados do Sentinel-2 são gratuitos e abertos (Copernicus, União Europeia).

---

## 3. O que continua simulado, e está marcado como tal

| Peça | Situação |
|---|---|
| Sensor de solo do talhão | Sem equivalente real. Cadastrado como fonte, sem série, até existir o hardware |
| `oraculo/src/fonteSimulada.js` | Série sintética determinística, dos três cenários da HU04. Continua no projeto para os testes rodarem sem depender de arquivo externo |
| Carteira simulada do aplicativo | Ferramenta de desenvolvimento, com faixa de aviso permanente na tela. Não usar em apresentação |

---

## 4. Regras que valem para qualquer dado novo

1. **Citar a fonte** no documento e no código que a lê.
2. **Conferir a licença** antes de usar, e registrar aqui.
3. **Não versionar** o arquivo baixado: script de download, sim; dado de terceiro, não.
4. **Não preencher buraco** de série com valor inventado. Falta de dado é informação.
5. **Declarar toda transformação** — a que o simulador faz aparece na tela quando ele roda.
