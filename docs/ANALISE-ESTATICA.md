# Análise estática dos contratos

Atende ao **RNF13**: submeter os contratos a análise estática antes de implantar, sem nenhum
achado de severidade alta sem tratamento.

Ferramenta: **Slither 0.11.6** (Trail of Bits), 102 detectores, sobre os três contratos de
produção. Os contratos em `mocks/` ficam de fora: existem apenas para encenar ataques nos testes.

---

## 1. Resultado

| Rodada | Alto | Médio | Baixo | Informativo | Total |
|---|---:|---:|---:|---:|---:|
| Primeira execução | **0** | 2 | 4 | 3 | 9 |
| Depois da triagem | 0 | 0 | 0 | 0 | **0** |

Nenhum achado de severidade alta, na primeira execução. Dos nove achados, **dois foram corrigidos
no código** e **sete foram aceitos com justificativa**, escrita no próprio contrato, na linha
imediatamente anterior ao trecho apontado.

A escolha de justificar no código, e não só neste documento, é deliberada. Uma supressão sem
explicação ao lado é indistinguível de alguém silenciando um alerta incômodo; uma supressão com a
explicação ao lado pode ser conferida por quem ler o contrato, inclusive a banca.

## 2. Como rodar

Pré-requisito: Python 3.11 ou superior.

```bash
pip install slither-analyzer
```

```bash
cd contratos && npm run analisar
```

O `slither.config.json` já define o que analisar e o que ignorar. Esperado:
`analyzed (6 contracts with 102 detectors), 0 result(s) found`.

## 3. Triagem, achado por achado

### Corrigidos

#### `uninitialized-local` — Médio

`uint16 percentual;` em `_percentualDevido` dependia do valor padrão da EVM, que é zero. Não era
um defeito — o resultado estava certo —, mas esconde a intenção: o leitor precisava lembrar a
regra da linguagem para entender o cálculo.

**Correção:** `uint16 percentual = 0;`, com um comentário explicando que zero significa "nenhum
índice escalonou ainda".

#### `reentrancy-events` — Baixo (2 ocorrências)

`PagamentoExecutado` e `GarantiaResgatada` eram emitidos **depois** da transferência de valor.

Não havia reentrância explorável: a guarda `naoReentrante` e a mudança de situação antes da
transferência já impediam. O ponto do detector é que evento também é efeito, e a ordem
verificar-efeitos-interação só está completa se todos os efeitos vierem antes da interação.

**Correção:** os eventos passaram para antes da chamada externa.

Pode parecer que isso anuncia um pagamento que ainda não aconteceu. Não anuncia: se a
transferência falhar, a transação inteira reverte e o evento some junto. Emitir antes ou depois é
observacionalmente idêntico — com a diferença de que antes fecha a ordem por completo. O teste de
atomicidade (`Seguranca.test.js`) continua passando, e é ele que garante isso.

### Aceitos com justificativa

#### `incorrect-equality` — Médio

`if (saldo == 0) revert SemSaldoParaResgatar();` em `resgatarGarantia`.

O detector alerta que o saldo de um contrato pode ser inflado à força — por `selfdestruct` de
outro contrato, que envia valor sem passar pelo `receive()` — e que isso quebra comparações de
igualdade estrita.

Aqui a comparação só decide se há algo a devolver. Saldo inflado faz apenas uma coisa: a
seguradora recebe também o valor forçado, que de outro modo ficaria preso no contrato. Não existe
caminho em que isso prejudique o produtor ou a seguradora. O pagamento ao produtor é calculado a
partir do limite contratado, e não do saldo, então valor forçado também não altera a indenização.

#### `timestamp` — Baixo (2 ocorrências)

Comparações com `block.timestamp` na checagem da vigência, em `publicarIndices` e
`resgatarGarantia`.

A marca de tempo do bloco é usada como **relógio**, não como fonte de aleatoriedade. O RNF08
proíbe a segunda, não a primeira — vigência é, por natureza, um intervalo de datas. O validador
consegue desviar a marca de tempo em alguns segundos, o que é irrelevante diante de uma vigência
de 180 dias.

#### `low-level-calls` — Informativo (2 ocorrências)

As transferências usam `call{value: ...}("")`.

É a forma recomendada. As alternativas, `transfer` e `send`, repassam apenas 2300 de gas, e
falham quando o destinatário é uma carteira de contrato — uma multisig, por exemplo, que é o que
uma seguradora de verdade usaria. A proteção contra reentrância não depende desse limite de gas, e
sim da ordem das operações e da guarda `naoReentrante`.

#### `cyclomatic-complexity` — Informativo

O construtor de `ApolicePolicy` tem complexidade 15.

Cada ramo é uma validação independente de um campo dos termos — endereço zero, vigência invertida,
limiar fora da faixa, teto do escalonado abaixo do gatilho —, e todas precisam acontecer antes de
o contrato se tornar imutável. Dividir em funções auxiliares só mudaria o número de lugar, sem
reduzir o que precisa ser conferido.

## 4. O que a análise estática não substitui

O Slither procura padrões conhecidos de defeito. Ele **não** encontrou — e não teria como
encontrar — o defeito mais grave que o projeto teve até agora: a sobra do pagamento escalonado
presa no contrato para sempre ([DECISOES.md](DECISOES.md), seção 2.9). Aquele era um erro de
regra de negócio, não de padrão de código, e só apareceu executando o fluxo completo pela
interface.

Análise estática, testes automatizados e execução de ponta a ponta cobrem classes diferentes de
problema. O projeto usa as três.
