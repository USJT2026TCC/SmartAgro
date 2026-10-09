# Simulador de estações

Módulo em Python que faz o papel das estações e sensores do talhão (HU04). Código em
[`simulador/`](../simulador).

A diferença para o simulador previsto no planejamento é que **ele não inventa o clima**: envia a
série histórica real de uma estação do INMET, assinada, pelo mesmo caminho que um equipamento em
campo usaria. As fontes estão em [DADOS.md](DADOS.md).

---

## 1. O que ele faz

```
   INMET (CSV horário)
        │
        ├── recorta a janela de datas
        ├── descarta as horas sem medição (ou envia, com --incluir-falhas)
        ├── desloca as datas para a vigência da apólice, se pedido
        ├── põe em cada leitura a posição da estação, lida do próprio CSV
        ├── assina cada lote com a chave privada da estação  (EIP-191)
        │
        ├──► POST /api/leituras                    (--destino api)
        └──► broker MQTT ──► ponte ──► POST /api/leituras   (--destino mqtt)
                    (os dois caminhos podem ir cifrados, com --tls-ca: RNF17)
```

Cada leitura leva data e hora (`instante`), a medida e a coordenada da estação (`lon`, `lat`); o
identificador da fonte vai no lote assinado — o critério 4 da HU04. O backend confere a coordenada
contra a posição cadastrada da fonte.

A assinatura é feita **na estação**, nunca na ponte. Uma ponte comprometida pode deixar de
entregar leituras — o que aparece como falta de dado, e o oráculo sabe lidar com isso — mas não
consegue forjar uma leitura, porque não tem a chave. É a mesma razão pela qual o backend também
não guarda chave de ninguém.

## 2. Instalação

```bash
cd simulador && python -m venv .venv
```

```bash
.venv/Scripts/python -m pip install -e ".[dev]"
```

No Linux ou macOS, `.venv/bin/python`.

## 3. Comandos

| Comando | O que faz |
|---|---|
| `baixar --ano 2024` | Baixa o ZIP anual do INMET para `simulador/dados/` |
| `estacoes --uf SP --perto=-21.46,-47.58` | Lista as estações mais próximas de um ponto |
| `analisar --estacao A770 --ano 2024` | Qualidade da série e maior estiagem, pela regra do oráculo |
| `enviar --estacao A770 ...` | Envia a série assinada para a API ou para o MQTT |
| `ponte --api http://localhost:3001/api` | Repassa do broker MQTT para a API |
| `endereco --fonte estacao-inmet-a770` | Endereço público da chave, que a seguradora cadastra |
| `historico --estacoes A770,A747 --de 2015 --ate 2025 --saida ...` | Chuva diária de vários anos (100 MB por ano de ZIP viram um CSV de 100 KB), para a cotação com histórico do backend (RF06); `--apagar-zip` libera o disco |

Opções de `enviar`:

| Opção | Para quê |
|---|---|
| `--cenario` | Janela real pré-configurada (HU04, critério 3): `estiagem_severa` (39 dias secos em 2024), `estiagem_moderada` (20) ou `safra_normal` (0) |
| `--de` / `--ate` | Janela de datas, em AAAA-MM-DD |
| `--fonte` | Identificador da fonte cadastrada no backend |
| `--chave` | Chave privada da estação. Prefira o `.env` (`CHAVE_<FONTE>`) |
| `--ate-hoje` | Desloca as datas para a série terminar ontem, **sem alterar os valores** |
| `--incluir-falhas` | Envia também as horas sem medição, para exercitar RF12 e RF13 |
| `--destino mqtt` | Publica no broker em vez de chamar a API |
| `--intervalo` / `--leituras-por-envio` | Transmite aos poucos, como uma estação de verdade: um envio (por padrão, um dia de leituras) a cada tantos segundos (HU04, critério 1) |
| `--tls-ca` | Certificado da autoridade que assinou a API em HTTPS ou o broker em TLS. O certificado é **sempre** conferido; sem a autoridade certa, a conexão é recusada (RNF17) |

### Por que `--ate-hoje` termina ONTEM

O dia de hoje ainda não acabou. Um dia com menos de 20 horas medidas **interrompe** a contagem
de dias secos, em vez de contar como seco — é a regra do consolidador. Terminar a série no dia
de hoje zerava o índice, e foi exatamente o que aconteceu na primeira execução.

O comando imprime o período que deve ser passado ao oráculo.

## 4. Exemplo completo

```bash
python -m simulador analisar --estacao A770 --ano 2024
```

```
A770 SAO SIMAO/SP (-21.46111111, -47.57944443)
leituras horarias..: 8784
com medicao de chuva: 8460
dias com 20h ou mais: 366 de 366
chuva no periodo....: 1380.6 mm
maior estiagem......: 39 dias consecutivos, a partir de 20240702
```

```bash
python -m simulador enviar --estacao A770 --ano 2024 --de 2024-06-25 --ate 2024-08-09 \
       --fonte estacao-inmet-a770 --ate-hoje
```

```
Estacao A770 SAO SIMAO/SP — fonte 'estacao-inmet-a770'
Endereco que assina.: 0xBcd4042DE499D14e55001CcbB24a551F3b954096
Leituras............: 1104 de 1104 na janela
Periodo enviado.....: 2026-08-08 a 2026-09-22
ATENCAO: datas deslocadas em 774 dias para terminarem hoje. Os valores medidos sao os
originais do INMET; as datas, nao.
Dias secos no fim...: 39
Periodo para o oraculo: 20260922
Fonte dos dados.....: INMET — https://portal.inmet.gov.br/dadoshistoricos

  lote 1: 500 aceitas, 0 recusadas, 0 repetidas — reputacao 1.00
  lote 2: 500 aceitas, 0 recusadas, 0 repetidas — reputacao 1.00
  lote 3: 104 aceitas, 0 recusadas, 0 repetidas — reputacao 1.00
```

## 5. MQTT

O broker não vem no repositório. Para subir um local:

```bash
docker run -it --rm -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
```

Em um terminal, a ponte; em outro, a estação:

```bash
python -m simulador ponte --api http://localhost:3001/api
```

```bash
python -m simulador enviar --estacao A770 --fonte estacao-inmet-a770 --destino mqtt --ate-hoje
```

Com TLS no broker, `--porta 8883 --tls-ca <autoridade>` na estação e na ponte. O
`backend/scripts/gerar-certificados.sh` cria uma autoridade local para desenvolvimento.

O envelope que trafega no tópico `agrosmart/leituras/<fonte>` carrega o corpo em base64 e a
assinatura já prontos. A ponte decodifica e repassa **os mesmos bytes**: reserializar o JSON
quebraria a assinatura.

## 6. Chaves

Cada estação tem seu par de chaves. O endereço público é o que a seguradora cadastra em
*Fontes*; a chave privada fica no equipamento — aqui, no `.env` do simulador, que está no
`.gitignore` (RNF14).

```bash
python -c "from eth_account import Account; c=Account.create(); print(c.key.hex(), c.address)"
```

As fontes de demonstração do backend usam chaves derivadas da frase de teste pública do Hardhat,
para que a demonstração rode sem configuração. Em rede pública, cada fonte precisa da sua.

## 7. Testes

```bash
cd simulador && .venv/Scripts/python -m pytest
```

45 testes, nenhum deles precisa de rede nem de broker; 87% das linhas (RNF03).

| Arquivo | Testes | O que cobre |
|---|---:|---|
| `test_inmet.py` | 7 | Cabeçalho, decimal com vírgula, hora UTC, campo vazio, sentinela `-9999`, formato até 2018, posição da estação em cada leitura |
| `test_serie.py` | 10 | Recorte, deslocamento, soma horária, dia incompleto, formato da API com a coordenada, lotes |
| `test_assinatura.py` | 7 | Endereço recuperado, formato da mensagem, serialização única, envelope MQTT |
| `test_cenarios.py` | 5 | Cada cenário conferido na série real; envio cadenciado |
| `test_cli.py` | 14 | Todos os comandos, com um ZIP sintético no formato do INMET e um cliente MQTT falso que confere TLS, qos e intervalo |

Estilo (RNF03), com o `ruff` configurado no `pyproject.toml`:

```bash
cd simulador && .venv/Scripts/python -m ruff check . && .venv/Scripts/python -m ruff format --check .
```

O trecho de CSV usado nos testes foi copiado do arquivo real da A770, inclusive com a hora sem
medição de chuva — que é justamente o caso que não pode virar zero.
