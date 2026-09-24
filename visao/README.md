# Módulo de visão

Estima quanto por cento da lavoura foi prejudicado, a partir das imagens do talhão (HU11), e
entrega o número ao backend com uma confiança associada.

```
src/visao/
├── indice.py          da contagem de pixels ao percentual de dano (as regras que pagam)
├── baseline.py        estimador classico por cor: roda em CPU, confianca baixa de proposito
├── modelo.py          carrega a U-Net treinada, quando houver pesos
├── clienteBackend.py  busca lotes pendentes, baixa imagens, confere o sha256
├── servico.py         o laco: pendentes -> analise -> POST /visao/resultados
└── cli.py             linha de comando

treino/
├── preparar_dados.py     base v2.1, so estresse hidrico, RGB pelas bandas nomeadas
├── treinar.py            U-Net de 4 classes (RODE EM GPU)
├── avaliacao.py          a prova comum: mesmos recortes, mesmas metricas, referencia trivial
├── avaliar_baseline.py   mede a heuristica de cor
├── avaliar_modelo.py     mede o modelo treinado, pelo caminho de producao
└── AgroSmart_visao_colab.ipynb   o treino no Google Colab, de ponta a ponta
```

## Instalar

```bash
python -m venv .venv
```

```bash
.venv/Scripts/python -m pip install -e ".[dev]"
```

## Rodar

```bash
.venv/Scripts/python -m visao servico --uma-vez
```

Precisa do backend no ar e de `CHAVE_DE_SERVICO` no `.env` (a mesma do backend). Sem pesos
treinados, usa a heurística de cor — e avisa na tela.

```bash
.venv/Scripts/python -m visao analisar foto.jpg
```

## Treinar

A base não vem no repositório (545 MB, CC BY 4.0). Baixe `02_processed_patches.zip` da **v2.1**,
<https://doi.org/10.5281/zenodo.22062459>, para `dados/v2.1/`. Use a v2.1: no subconjunto v1.0,
as máscaras foram calculadas com bandas trocadas (docs/DECISOES.md 2.22).

```bash
.venv/Scripts/python treino/preparar_dados.py
```

```bash
.venv/Scripts/python treino/avaliar_baseline.py
```

O treino precisa de GPU. **Esta máquina não tem.** Use o notebook pronto para o Google Colab,
[`treino/AgroSmart_visao_colab.ipynb`](treino/AgroSmart_visao_colab.ipynb). Ele baixa o código e
a base, confere a integridade do download, treina e devolve os pesos e as figuras do TCC.

> No Colab, a importação do pacote nas células **não** pode depender só de `pip install -e`.
> O kernel só enxerga uma instalação editável depois de reiniciar, e até lá a pasta `visao/` do
> repositório é importada no lugar do pacote, dando `No module named 'visao.indice'`. A primeira
> célula do notebook já trata disso.

Baixe `pesos/unet.pt` ao final e aponte `VISAO_PESOS` para ele no `.env`.

Para um teste rápido de que o código roda, sem esperar horas:

```bash
.venv/Scripts/python treino/treinar.py --epocas 1 --lote 4 --limite 40
```

## Testes

```bash
.venv/Scripts/python -m pytest
```

## Documentação

- [docs/VISAO.md](../docs/VISAO.md) — como o percentual é calculado, os dois estimadores e a
  avaliação do TerraMind
- [docs/DADOS.md](../docs/DADOS.md) — a base de imagens, licença e como citar
- [docs/BACKEND.md](../docs/BACKEND.md) — seção 6: o contrato com o backend
