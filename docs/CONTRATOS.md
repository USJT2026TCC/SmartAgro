# Contratos inteligentes

Referência dos três contratos de produção, com a tabela de gas, a rastreabilidade de
requisitos e a explicação das proteções de segurança.

Código em [`contratos/contracts/`](../contratos/contracts). Testes em
[`contratos/test/`](../contratos/test).

---

## 1. `OracleRegistry.sol`

Lista dos endereços autorizados a publicar índices. Administrada pela seguradora.

| Função | Quem pode chamar | O que faz |
|---|---|---|
| `autorizar(address)` | seguradora | Inclui um endereço na lista |
| `revogar(address)` | seguradora | Remove um endereço da lista |
| `transferirSeguradora(address)` | seguradora | Passa a administração adiante |
| `ehAutorizado(address)` | qualquer um | Consulta de leitura, usada por cada apólice |

**Por que um contrato separado.** Revogar um oráculo comprometido vira uma única transação, e
não uma por apólice. Com a carteira de dez mil talhões prevista no RNF04, a diferença é entre
possível e inviável.

## 2. `ApolicePolicy.sol`

Uma instância por contrato firmado. É a peça central do trabalho.

### 2.1 Ciclo de vida

```
  AGUARDANDO_GARANTIA ──depositarGarantia()──► ATIVA
                                                 │
                    ┌────────────────────────────┴───────────────────┐
                    │                                                │
        condição atendida em                          vigência vencida sem
        publicarIndices()                             acionamento
                    │                                                │
                    ▼                                                ▼
                LIQUIDADA                                        ENCERRADA
             (indenização paga)                          (garantia devolvida)
```

Só o estado `ATIVA` aceita publicações. Essa restrição sozinha já resolve o RF26: depois da
liquidação, nenhuma publicação é aceita, então não existe acionamento duplicado.

### 2.2 A condição contratada

A condição combina dois índices por meio de um operador escolhido na implantação:

| Operador | Aciona quando |
|---|---|
| `CLIMATICO` | apenas o índice climático atinge o limiar |
| `DANO` | apenas o índice de dano atinge o limiar |
| `OU` | qualquer um dos dois atinge |
| `E` | os dois atingem no mesmo período |

E o valor devido segue um dos dois modos:

- **`INTEGRAL`** — atingido o gatilho, paga o limite contratado.
- **`ESCALONADO`** (RF25) — atingido o gatilho, paga 50% do limite, e o percentual cresce
  linearmente até 100% no "limiar integral". Com os dois índices acionando, vale o maior dos
  dois percentuais.

Exemplo do modo escalonado, com gatilho em 30 dias e limiar integral em 60:

| Dias sem chuva | Percentual devido |
|---|---|
| 29 | 0% (não aciona) |
| 30 | 50% |
| 45 | 75% |
| 60 ou mais | 100% |

A função `simularPercentual(indiceClimatico, indiceDanoBps)` é pública e de leitura. O aplicativo
a usa para mostrar ao produtor, antes do aceite, exatamente o que aciona e o que não aciona o
pagamento (RNF06).

Na tela de cotação, porém, ainda não existe contrato implantado para consultar, e a regra precisa
estar reimplementada em JavaScript. `contratos/test/RegraDeGatilho.test.js` compara as duas
implementações caso a caso — cinco configurações de apólice × 13 valores de índice climático × 11
de índice de dano — de modo que mexer em um dos lados sem mexer no outro quebre a suíte. Detalhes
em [APLICATIVO.md](APLICATIVO.md), seção 2.

### 2.3 O resgate da garantia

Há dois casos em que o lastro volta para a seguradora:

- **Apólice `ATIVA`, vigência vencida.** Até o fim da vigência a condição ainda pode ser acionada,
  e retirar a garantia deixaria a apólice sem como pagar. A apólice passa a `ENCERRADA`.

- **Apólice `LIQUIDADA` com saldo remanescente.** No modo escalonado o pagamento pode ser parcial;
  o que sobra fica retido sem finalidade, porque depois da liquidação nenhuma publicação é aceita.
  Sem esta porta, a diferença entre o limite e o valor pago ficaria presa no contrato para sempre.
  A apólice **continua `LIQUIDADA`**: trocar para `ENCERRADA` apagaria, da leitura do estado, o
  fato de ter havido pagamento.

Um segundo resgate é barrado pelo saldo zerado (`SemSaldoParaResgatar`).

### 2.4 Funções

| Função | Quem pode chamar | Situação exigida |
|---|---|---|
| `depositarGarantia()` | seguradora | `AGUARDANDO_GARANTIA` |
| `publicarIndices(...)` | oráculo autorizado | `ATIVA` |
| `resgatarGarantia()` | seguradora | `ATIVA` com vigência vencida, **ou** `LIQUIDADA` com saldo |
| `verTermos()` | qualquer um | leitura |
| `publicacao(periodo)` | qualquer um | leitura |
| `simularPercentual(...)` | qualquer um | leitura |

### 2.5 As proteções

**Controle de acesso (RF18, RNF12).** `publicarIndices` consulta o `OracleRegistry` a cada
chamada. Endereço não autorizado é revertido com `OrigemNaoAutorizada`. Um oráculo revogado
deixa de conseguir publicar na transação seguinte à revogação — há teste para isso.

**Período duplicado (RF20).** `periodoPublicado[periodo]` barra a segunda publicação do mesmo
período, preservando o valor original. O teste confere não só a reversão, mas que o valor
gravado antes continuou intacto.

**Reentrância (RNF11).** Duas camadas, porque o requisito pede as duas:

1. A ordem *verificar → atualizar estado → interagir*. A linha `situacao = LIQUIDADA` vem antes
   da transferência, então uma reentrada cai no modificador `naSituacao` e é revertida.
2. A guarda `naoReentrante`, declarada como **primeiro** modificador da função, de modo que seja
   a checagem mais externa.

O teste encena o pior cenário possível: o contrato atacante é ao mesmo tempo o produtor
beneficiário **e** um oráculo autorizado. No instante em que recebe a indenização, ele ainda tem
permissão para chamar `publicarIndices` de novo. O teste verifica que a reentrada falhou, que o
erro devolvido foi especificamente `ReentranciaDetectada()`, e que o pagamento saiu uma única
vez.

A mesma proteção é testada na outra saída de valor, a devolução da garantia à seguradora, com um
contrato `SeguradoraMaliciosa`.

**Atomicidade (RF26, RNF15).** Se a transferência falhar, a função reverte a transação inteira.
O teste usa um beneficiário que rejeita qualquer transferência e verifica, depois da falha, que
o período **não** ficou marcado como publicado, que a apólice segue `ATIVA` e que a garantia
permanece íntegra. Não há pagamento parcial nem estado inconsistente.

**Depósito direto.** `receive()` reverte com `DepositoDireto`. O único caminho de entrada de
valor é `depositarGarantia()`, de modo que o saldo do contrato sempre corresponde a um lastro
identificado.

## 3. `ApoliceFactory.sol`

Implanta as apólices e mantém o índice de quais existem (RF07).

A fábrica **sobrescreve** o campo `registry` dos termos recebidos com o próprio registro. Sem
isso, uma apólice poderia ser emitida apontando para uma lista de oráculos diferente da
acordada — o que anularia todo o controle de acesso. Há teste para essa sobrescrita.

A fábrica não custodia valor: a garantia é depositada pela seguradora diretamente na apólice,
para que o endereço pagador continue sendo o da seguradora.

---

## 4. Tabela de gas

Medida com `hardhat-gas-reporter`, otimizador ligado (`runs: 200`), Solidity 0.8.24, rede
`hardhat`. Reproduzir com:

```bash
cd contratos && npx cross-env REPORT_GAS=true npx hardhat test
```

### Implantação

| Contrato | Gas | % do limite do bloco |
|---|---:|---:|
| `ApoliceFactory` | 2.241.625 | 3,7% |
| `ApolicePolicy` | 1.499.539 | 2,5% |
| `OracleRegistry` | 321.819 | 0,5% |

### Chamadas

| Contrato | Função | Mínimo | Máximo | Médio |
|---|---|---:|---:|---:|
| `ApoliceFactory` | `emitirApolice` | 1.482.606 | 1.517.046 | 1.507.069 |
| `ApolicePolicy` | `publicarIndices` | 172.165 | 249.094 | 219.826 |
| `ApolicePolicy` | `depositarGarantia` | — | — | 47.132 |
| `ApolicePolicy` | `resgatarGarantia` | 34.574 | 39.619 | 36.816 |
| `OracleRegistry` | `autorizar` | 52.947 | 70.059 | 69.812 |
| `OracleRegistry` | `revogar` | 28.678 | 31.059 | 29.278 |
| `OracleRegistry` | `transferirSeguradora` | — | — | 28.499 |

### Leitura dos números

Medidos na execução real da demonstração de estiagem severa, em rede local:

| Operação | Gas |
|---|---:|
| Primeira publicação de uma apólice (grava em slots zerados) | 189.241 |
| Publicação seguinte, sem acionar | 172.141 |
| Publicação que aciona e paga | 231.192 |

Três observações que interessam ao capítulo de resultados do TCC:

1. **A travessia custa muito mais que a lógica de negócio.** Uma publicação sem acionamento
   custa cerca de 172 mil de gas; a operação administrativa mais cara do registro custa 70 mil.
   A diferença está quase toda na escrita de estado e nos eventos, não no cálculo da condição.

2. **A publicação que aciona custa cerca de 35% a mais** que a que não aciona (231 mil contra
   172 mil). Esse acréscimo é a transferência de valor mais as escritas de `situacao`,
   `valorPago` e `periodoAcionador`.

3. **A primeira publicação é mais cara que as seguintes** (189 mil contra 172 mil). Escrever em
   um slot de armazenamento que estava zerado custa mais que sobrescrever um já usado. É um
   detalhe da EVM, não do contrato, mas aparece nos números e vale explicar na defesa.

O `struct Publicacao` foi ordenado deliberadamente para caber em três slots de 256 bits, com o
primeiro exatamente cheio: `oraculo(160) + indiceClimatico(32) + indiceDanoBps(16) +
confiancaBps(16) + publicadoEm(32) = 256`. O empacotamento economiza uma operação de escrita por
publicação.

---

## 5. Cobertura de testes

```
contracts/          100% statements · 100% branches · 100% functions · 100% lines
  ApoliceFactory.sol      100 / 100 / 100 / 100
  ApolicePolicy.sol       100 / 100 / 100 / 100
  OracleRegistry.sol      100 / 100 / 100 / 100
```

94 testes. Os contratos em `mocks/` são excluídos do relatório por `.solcover.js`: existem
apenas para encenar ataques nos testes e nunca são implantados em rede.

```bash
cd contratos && npx hardhat coverage
```

> **Atenção ao rodar a cobertura.** Se o relatório vier com números baixos sem motivo aparente,
> rode `npx hardhat clean` antes. O `solidity-coverage` reaproveita artefatos em cache e pode
> medir uma compilação antiga; a mensagem `Nothing to compile` no início da execução é o sinal.

### O que os testes cobrem

| Bloco | Testes | Requisitos |
|---|---|---|
| Implantação e parâmetros inválidos | 16 | RF07, RF08 |
| Depósito da garantia | 6 | RNF12 |
| Publicação de índices | 10 | RF16, RF18, RF20 |
| Avaliação da condição e liquidação | 5 | RF23, RF24, RF26 |
| Operadores da condição | 4 | — |
| Pagamento escalonado | 7 | RF25 |
| Resgate da garantia, incluindo a sobra do escalonado | 11 | RF25 |
| Registro de oráculos | 13 | RF18, RNF12 |
| Fábrica de apólices | 7 | RF07 |
| Segurança: reentrância e atomicidade | 8 | RNF11, RNF15 |
| Equivalência com a regra do aplicativo | 7 | RNF06 |

---

## 6. Rastreabilidade de requisitos

| Requisito | Onde é atendido |
|---|---|
| RF07 — implantar contrato parametrizado na contratação | `ApoliceFactory.emitirApolice` |
| RF08 — resumo criptográfico dos termos | `ApolicePolicy.termos.hashTermos`, lido por `verTermos()` |
| RF16 — confiança, versão do modelo e hash das evidências | `struct Publicacao`, lido por `publicacao(periodo)` |
| RF18 — lista de endereços autorizados | `OracleRegistry` + modificador `somenteOraculoAutorizado` |
| RF20 — rejeitar período duplicado | `mapping periodoPublicado` |
| RF23 — avaliar a condição a cada publicação | `_percentualDevido`, chamada dentro de `publicarIndices` |
| RF24 — transferir imediatamente após o acionamento | mesma transação de `publicarIndices` |
| RF25 — pagamento escalonado | `ModoPagamento.ESCALONADO` + `_interpolar` |
| RF26 — impedir acionamento duplicado, sem estado inconsistente | `naSituacao(ATIVA)` + reversão em falha de transferência |
| RNF08 — determinismo | nenhuma aleatoriedade; `block.timestamp` só para vigência e auditoria, nunca como entropia |
| RNF09 — medir e documentar o gas de cada função | tabela da seção 4 |
| RNF11 — imunidade a reentrância | ordem verificar/atualizar/interagir + guarda `naoReentrante` |
| RNF12 — controle de acesso por função | `somenteSeguradora`, `somenteOraculoAutorizado` |
| RNF14 — cobrir 100% dos caminhos condicionais | relatório da seção 5 |
| RNF15 — atomicidade | reversão total em qualquer falha |
| RNF16 — chaves fora do código-fonte | `hardhat.config.js` lê de variáveis de ambiente |
| RNF20 — decisão reconstituível | `publicacao(periodo)` + eventos + registro do oráculo |
| RNF21 — preservar a versão do modelo | campo `versaoModelo`, imutável após a publicação |

### Ainda não atendidos nos contratos

| Requisito | Situação |
|---|---|
| RF10 — cancelamento antes da vigência | Item de reserva (Quadro 19). Não participa do fluxo de apuração |
| RF28 — contestação da avaliação | Item de reserva. Exige retificação do índice em cadeia |
| RNF13 — análise estática antes de implantar | A rodar antes da implantação em Sepolia. Ver [DECISOES.md](DECISOES.md) |
