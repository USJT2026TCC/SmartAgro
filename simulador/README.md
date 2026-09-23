# Simulador de estações

Faz o papel das estações e sensores do talhão (HU04). Em vez de inventar o clima, envia a
**série histórica real** de uma estação automática do INMET, assinada, pelo mesmo caminho que um
equipamento em campo usaria.

Fonte dos dados: INMET — <https://portal.inmet.gov.br/dadoshistoricos>

```
src/simulador/
├── inmet.py        le o CSV do INMET (latin-1, ';', decimal com virgula, campo vazio)
├── serie.py        recorte, deslocamento de datas, agregacao diaria
├── assinatura.py   assinatura EIP-191 do lote (o outro lado do backend)
├── envio.py        POST /api/leituras
├── mqtt.py         publicacao no broker e ponte MQTT -> API
└── cli.py          linha de comando
```

## Instalar

```bash
python -m venv .venv
```

```bash
.venv/Scripts/python -m pip install -e ".[dev]"
```

## Usar

```bash
.venv/Scripts/python -m simulador baixar --ano 2024
```

```bash
.venv/Scripts/python -m simulador analisar --estacao A770 --ano 2024
```

```bash
.venv/Scripts/python -m simulador enviar --estacao A770 --ano 2024 --de 2024-06-25 --ate 2024-08-09 --fonte estacao-inmet-a770 --ate-hoje
```

O backend precisa estar rodando, e a fonte precisa estar cadastrada com o endereço da chave que
assina. As fontes de demonstração já vêm cadastradas.

## Testes

```bash
.venv/Scripts/python -m pytest
```

## Chaves

Copie `.env.example` para `.env` e preencha `CHAVE_<FONTE>` com a chave privada de cada estação.
O `.env` está no `.gitignore` e **nunca** vai para o repositório (RNF16).

## Documentação

- [docs/SIMULADOR.md](../docs/SIMULADOR.md) — comandos, MQTT, decisões
- [docs/DADOS.md](../docs/DADOS.md) — fontes de dados, licenças e como citar
- [docs/BACKEND.md](../docs/BACKEND.md) — seção 5: o formato exato do lote assinado
