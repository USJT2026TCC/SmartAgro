# Serviço de oráculo

Referência do serviço que consolida, assina e publica os índices na cadeia.

Código em [`oraculo/src/`](../oraculo/src). Testes em [`oraculo/test/`](../oraculo/test).

---

## 1. O que o serviço faz

```
  leituras                                                    cadeia
     │                                                          ▲
     ▼                                                          │
 consolidador ──► fila ──────────────────────► publicador ──────┘
 (valida e      (grava em disco             (assina e submete)
  consolida)     antes de publicar)                │
     ▲                                             ▼
     │                                          registro
 reputacao                                  (gas, latência, procedência)
```

A separação entre `consolidador` e `publicador` é deliberada: a regra que decide **quanto vale
o dado** é uma função pura, testável sem blockchain e reproduzível meses depois. O `publicador`
é a única peça que fala com a rede.

## 2. Módulo por módulo

### `consolidador.js` — a regra do dado (RF12, RF13, RF19)

Transforma leituras brutas em um índice climático publicável.

**Validação de plausibilidade (RF12).** Cada leitura passa por faixas físicas admissíveis:
chuva de 0 a 500 mm/dia, temperatura de −20 a 60 °C, umidade de 0 a 100%. Valor fora da faixa
indica sensor com defeito, não evento climático, e a leitura é descartada com o motivo
registrado.

**Contagem de dias secos.** Agrega a chuva por dia (média entre as fontes válidas) e caminha
para trás a partir do dia de referência, contando dias consecutivos abaixo do limiar.

Uma decisão importante: **a contagem para no primeiro dia sem dado**, e não só no primeiro dia
chuvoso. Não há como afirmar que não choveu em um dia do qual nenhuma fonte reportou nada.
Presumir seco inflaria o índice e comprometeria exatamente a auditabilidade que justifica todo
o sistema. Quando isso acontece, o resultado traz o alerta de que o número é um **piso**, não a
medida completa da estiagem.

**Alertas.** O resultado inclui avisos quando há menos de duas fontes independentes (RNF18),
quando não há leitura do próprio período, e quando a contagem parou por falta de dado.

### `reputacao.js` — escore por fonte (RF13)

Média móvel exponencial do acerto de cada fonte. Leitura plausível puxa o escore para cima,
leitura descartada puxa para baixo. Fonte abaixo do limiar tem as leituras ignoradas, ainda que
a leitura atual seja plausível.

**Por que média móvel e não razão acumulada.** Um sensor que funcionou por seis meses e quebrou
hoje precisa sair de operação rápido. Com razão entre acertos e total, ele levaria meses para
cair abaixo do limiar. Com média móvel (α = 0,2), duas semanas de defeito bastam — há teste
para isso.

O estado é persistido: o histórico da fonte é parte do que torna a decisão reconstituível
(RNF20).

### `fila.js` — retomada após falha (RF21, RNF22)

Fila persistente em disco. A publicação é gravada **antes** de qualquer tentativa de envio e só
sai da fila depois da confirmação em cadeia.

Estados: `pendente` → `publicando` → `concluida` ou `falha`.

Uma entrada em `publicando` que aparece no disco ao iniciar o serviço significa que o processo
morreu no meio de uma tentativa. Ela volta a ser candidata — retomar é justamente o
comportamento desejado.

Enfileirar a mesma apólice e período duas vezes não cria uma segunda entrada. O contrato
rejeitaria a duplicata de qualquer forma (RF20), e gastar gas para descobrir isso seria
desperdício.

Um arquivo de fila corrompido faz o serviço falhar de forma explícita, sem apagar nada: o
arquivo contém índices ainda não publicados e precisa ser inspecionado, não descartado.

### `publicador.js` — a travessia (RF19, RF22)

Única peça que fala com a rede. Assina com a chave carregada de variável de ambiente e submete
os dois índices em uma transação só.

**Ensaio antes do envio.** A chamada é simulada com `staticCall` antes de gastar gas. Isso
antecipa as rejeições previsíveis — endereço revogado, período duplicado, apólice fora de
vigência — sem custo, e devolve o erro customizado do contrato já decodificado, em vez de um
seletor de quatro bytes.

**Gestão de nonce.** O oráculo publica vários períodos em sequência. Consultar o nonce na rede a
cada envio não funciona: entre duas publicações seguidas, o nó ainda não contabilizou a
transação anterior e devolve o mesmo número, o que faz a segunda ser recusada. O `NonceManager`
do ethers mantém a contagem localmente. Em caso de erro, o contador é devolvido ao valor real.

**Tempo limite.** O padrão do ethers é de 300 segundos por requisição, com repetições na
detecção de rede. Com o nó fora do ar, o serviço simplesmente travaria em vez de devolver a
publicação à fila. O tempo limite foi reduzido para 10 segundos e a repetição desligada: o que
importa aqui é falhar rápido, porque a entrada continua na fila e a próxima tentativa vem com
espera crescente.

### `registro.js` — trilha de auditoria (RF22, RNF20)

Grava, para cada publicação: identificador da transação, gas consumido, custo em wei, bloco,
instante de envio, instante de confirmação, latência, se acionou o pagamento, e a **procedência
do índice** — quais fontes foram usadas, quais foram descartadas, e qual limiar de chuva valia.

Formato JSON Lines, uma linha por publicação, sempre acrescentada ao fim. Reescrever um JSON
inteiro a cada publicação abriria a chance de perder o arquivo em uma interrupção no meio da
escrita, e o que está em jogo aqui é justamente a trilha de auditoria.

O método `estatisticas()` devolve gas mínimo, máximo e médio, latência média e número de
acionamentos — no formato que o capítulo de resultados precisa.

### `fonteSimulada.js` — leituras para o protótipo

Substituto temporário do simulador em Python + MQTT previsto na HU04. Existe para que o oráculo
possa ser exercitado ponta a ponta desde a Sprint 1, sem esperar a outra trilha.

**A geração é determinística**: o mesmo cenário produz sempre a mesma série. Isso importa porque
o RNF21 exige reprodutibilidade, e porque um número de gas medido sobre uma série aleatória não
pode ser comparado com o da execução seguinte.

Três cenários, conforme a HU04:

| Cenário | Estiagem final | Aciona a condição de 30 dias? |
|---|---:|---|
| `safra_normal` | 0 dias | não |
| `estiagem_moderada` | 18 dias | não |
| `estiagem_severa` | 35 dias | **sim** |

Com `--com-falhas`, injeta três defeitos reais de instrumentação: sensor saturado (9999 mm de
chuva), termômetro descalibrado (−273 °C) e registro sem o campo medido.

### `oraculo.js` — o orquestrador

Amarra as peças. `prepararPublicacao` consolida e enfileira sem tocar na rede; `drenarFila`
publica tudo o que estiver pendente, com espera que dobra a cada tentativa.

Aqui também mora o RF17: quando o resultado do modelo de visão vem com confiança abaixo do
limiar, o índice de dano **não é publicado** e o lote é sinalizado para o perito. O índice
climático segue normalmente, porque não depende da inferência. A exceção é a análise que o
perito já revisou e liberou (`liberadaPeloPerito`): nela o limiar não é reaplicado, porque a
revisão humana que ele pedia já aconteceu.

### `clienteBackend.js` — a ponte com a API

Cliente HTTP do backend, autenticado pela chave de serviço (`X-Chave-De-Servico`). Busca as
apólices ativas, as leituras do talhão e a análise de visão; depois relata cada publicação (gas,
latência, procedência) e cada falha definitiva.

O relato é **melhor esforço**. Se o backend estiver fora do ar, a publicação na cadeia acontece
do mesmo jeito e o registro local continua sendo a trilha de auditoria: um componente auxiliar
indisponível não pode atrasar um pagamento.

---

## 3. Linha de comando

```bash
cd oraculo
node src/index.js <comando> [opções]
```

| Comando | O que faz |
|---|---|
| `status` | Endereço, saldo, autorização no registro, fila e reputação |
| `servico` | **Modo de produção.** A cada intervalo, busca no backend as apólices ativas e publica o período de cada uma. `--uma-vez` roda um único ciclo |
| `ciclo --apolice 0x...` | Roda um cenário climático até acionar ou esgotar os períodos |
| `publicar --apolice 0x...` | Consolida e publica um único período |
| `ouvir --apolice 0x...` | Acompanha os eventos da apólice em tempo real |
| `fila` | Mostra a fila; `--reabrir <chave>` devolve uma entrada esgotada ao estado pendente |
| `estatisticas` | Gas e latência das publicações já realizadas |

Opções de `ciclo` e `publicar`:

| Opção | Padrão | Para quê |
|---|---|---|
| `--cenario` | `estiagem_severa` | `safra_normal`, `estiagem_moderada` ou `estiagem_severa` |
| `--periodo` | hoje | Dia de referência, em AAAAMMDD |
| `--periodos` | 8 | Quantos períodos publicar no ciclo |
| `--com-falhas` | desligado | Injeta leituras defeituosas para exercitar RF12 e RF13 |
| `--fonte` | `simulada` | `backend` usa as leituras assinadas recebidas pela API, em vez da fonte simulada |

Opções de `servico`: `--intervalo <ms>` (padrão `INTERVALO_SERVICO_MS`, 60 s), `--periodo` e
`--uma-vez`.

### Exemplo de execução

```
$ node src/index.js ciclo --cenario estiagem_severa --periodos 8 --com-falhas

Cenario: estiagem_severa
------------------------
Estiagem de 35 dias ao final da serie. Cruza o limiar de 30 e aciona.
Publicando os ultimos 8 periodos ate 20260917
Injetando leituras defeituosas para exercitar RF12 e RF13.

Publicacoes
-----------
  periodo    indice   gas       acionou   transacao
  ------------------------------------------------------------------
  20260910       28    189241     nao     0x3fcd8461519dd431e8...
  20260911       29    172141     nao     0xa4c43bfda74e38ce38...
  20260912       30    231192     SIM     0x39ae29a1585ba5064b...

Pagamento executado
-------------------
Transacao: 0x39ae29a1585ba5064b7a045edeba2b299eb190e96e1bff5e0eb186b2c5024433
Bloco....: 21
Latencia.: 173 ms
```

O índice sobe de 28 para 30, cruza o limiar, e a mesma transação que publicou o índice executou
o pagamento. Nenhum ser humano aprovou nada.

---

## 4. Configuração

Copie `oraculo/.env.example` para `oraculo/.env` e preencha. O `.env` está no `.gitignore` e
**nunca** deve ir para o repositório (RNF16).

| Variável | Padrão | Para quê |
|---|---|---|
| `REDE` | `localhost` | Precisa bater com o arquivo em `contratos/implantacoes/` |
| `RPC_URL` | `http://127.0.0.1:8545` | Endpoint JSON-RPC |
| `CHAVE_PRIVADA_ORACULO` | — | Chave do endereço autorizado no registro |
| `ENDERECO_APOLICE` | — | Evita passar `--apolice` em todo comando |
| `LIMIAR_CHUVA_MM` | 1 | Chuva diária abaixo da qual o dia conta como seco |
| `LIMIAR_REPUTACAO` | 0,5 | Escore mínimo para usar as leituras de uma fonte |
| `LIMIAR_CONFIANCA_MODELO` | 0,7 | Confiança mínima para publicar sem revisão do perito |
| `MAX_TENTATIVAS` | 5 | Tentativas antes de marcar a entrada como falha |
| `ESPERA_BASE_MS` | 2000 | Espera inicial entre tentativas; dobra a cada uma |
| `CONFIRMACOES` | 1 | Confirmações aguardadas. Use 2 na Sepolia |
| `TIMEOUT_MS` | 10000 | Tempo limite de cada requisição ao nó |
| `API_URL` | — | Endereço do backend, por exemplo `http://localhost:3001/api` |
| `CHAVE_DE_SERVICO` | — | Mesma chave configurada no backend. Sem ela e sem `API_URL`, o oráculo roda sozinho, com a fonte simulada |
| `INTERVALO_SERVICO_MS` | 60000 | Intervalo entre ciclos do comando `servico` |

Os endereços dos contratos **não** ficam no `.env`: vêm de
`contratos/implantacoes/<rede>.json`, gerado pelo script de implantação. Copiar endereço à mão
entre um terminal e um arquivo de configuração é uma das formas mais comuns de quebrar esse
tipo de projeto na véspera da apresentação.

---

## 5. Testes

```bash
cd oraculo && npm run testar
```

65 testes, nenhum deles precisa de rede.

| Arquivo | Testes | O que cobre |
|---|---:|---|
| `backend.test.js` | 9 | Cliente da API, conversão de pontos-base, relato de melhor esforço, liberação pelo perito |
| `consolidador.test.js` | 20 | Validação, agregação, contagem de dias secos, reputação |
| `fila.test.js` | 12 | Retomada, duplicatas, tentativas esgotadas, arquivo corrompido |
| `fonteSimulada.test.js` | 10 | Determinismo, cenários, injeção de defeitos |
| `registro.test.js` | 6 | Latência, serialização de BigInt, estatísticas, procedência |
| `reputacao.test.js` | 8 | Queda e recuperação do escore, persistência |

### Comportamento sob falha, verificado na prática

Além dos testes automatizados, o comportamento do RF21 foi verificado contra um nó real
derrubado de propósito:

1. Com o nó fora do ar, `publicar` consolidou o índice, gravou na fila e falhou nas duas
   tentativas, registrando `ECONNREFUSED`.
2. Com o nó de volta, `fila --reabrir <chave>` devolveu a entrada ao estado pendente.
3. `publicar` retomou a entrada existente — sem reconsolidar e **preservando o período de
   referência original** — e concluiu a publicação.

Nenhum dado se perdeu. É exatamente a medida "comportamento sob falha" prevista no capítulo 7
do manual da equipe.
