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
├── preparar_dados.py     extrai a base do Zenodo e divide treino/validacao no espaco
├── treinar.py            U-Net de 5 classes (RODE EM GPU)
└── avaliar_baseline.py   mede o estimador classico contra as mascaras de referencia
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

A base não vem no repositório (328 MB, CC BY 4.0). Baixe de
<https://doi.org/10.5281/zenodo.19385720> para `dados/milho-estresse-hidrico.zip`.

```bash
.venv/Scripts/python treino/preparar_dados.py
```

```bash
.venv/Scripts/python treino/avaliar_baseline.py --divisao validacao
```

O treino precisa de GPU. **Esta máquina não tem** — use Google Colab ou Kaggle:

```python
!pip install torch torchvision
!git clone https://github.com/USJT2026TCC/SmartAgro.git && cd SmartAgro/visao
# envie dados/milho-estresse-hidrico.zip para o ambiente, depois:
!python treino/preparar_dados.py
!python treino/treinar.py --epocas 20 --lote 16
```

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
