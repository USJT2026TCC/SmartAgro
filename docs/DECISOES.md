# Decisões de projeto

Registro do que foi decidido, do que foi descartado e do que deu errado durante a
implementação dos contratos e do oráculo. Serve a dois propósitos: sustentar as respostas na
defesa e evitar que alguém refaça uma escolha já examinada.

---

## 1. Decisões de arquitetura

### 1.1 Lista de oráculos em contrato separado

**Decidido:** o `OracleRegistry` é um contrato próprio, consultado por cada apólice.

**Alternativa descartada:** guardar o endereço autorizado dentro de cada `ApolicePolicy`, como
no esqueleto do manual da equipe.

**Por quê:** revogar um oráculo comprometido passa a ser uma transação só, em vez de uma por
apólice. Com a carteira de dez mil talhões prevista no RNF04, a diferença é entre possível e
inviável. Também barateia a implantação de cada apólice, que passa a guardar só a referência.

**O que custa:** uma chamada externa de leitura por publicação. Está medido e documentado na
tabela de gas.

### 1.2 Fábrica de apólices

**Decidido:** uma `ApoliceFactory` implanta as apólices e mantém o índice de quais existem.

**Por quê:** o RF07 pede a implantação na contratação. Sem a fábrica, a lista de endereços
implantados viveria só no banco do back-end, e deixaria de ser auditável na cadeia — o que
contraria o RNF20.

A fábrica **sobrescreve** o campo `registry` dos termos recebidos. Sem isso, uma apólice poderia
ser emitida apontando para uma lista de oráculos diferente da acordada, e todo o controle de
acesso viraria decoração.

### 1.3 Índice de dano em pontos-base, não em 0–100

**Decidido:** o índice de dano e a confiança trafegam como inteiros de 0 a 10000, onde 10000 é
100,00%.

**Alternativa descartada:** inteiros de 0 a 100, como descrito no glossário do manual.

**Por quê:** a EVM não tem ponto flutuante. Com 0–100, o pagamento escalonado só conseguiria
distinguir um ponto percentual de cada vez, e a interpolação linear acumularia erro de
arredondamento a cada faixa. Com pontos-base, a precisão é de um centésimo de ponto percentual e
a aritmética continua inteira.

O glossário do manual continua válido para o produtor: a interface mostra 0 a 100.

### 1.4 Regra do pagamento escalonado

**Decidido:** atingido o gatilho paga-se 50% do limite, e o percentual cresce linearmente até
100% em um "limiar integral" fixado na implantação.

**Por quê:** é a regra mais simples que ainda é defensável atuarialmente e explicável ao
produtor em uma frase. Uma tabela de faixas arbitrárias exigiria armazenar vetores no contrato,
encarecendo a implantação, e seria mais difícil de justificar.

O construtor recusa `limiarIntegral <= gatilho` no modo escalonado — sem isso, a interpolação
dividiria por zero, e uma apólice implantada com esse defeito ficaria permanentemente quebrada.

### 1.5 `receive()` que reverte

**Decidido:** transferência direta para a apólice é rejeitada.

**Por quê:** o único caminho de entrada de valor é `depositarGarantia()`. Assim o saldo do
contrato sempre corresponde a um lastro identificado, e `garantiaRetida()` nunca mostra um
número que ninguém sabe explicar.

### 1.6 Resgate da garantia após a vigência

**Decidido:** acrescentado `resgatarGarantia()`, não previsto explicitamente nos requisitos.

**Por quê:** sem ele, o lastro de toda apólice que não aciona fica preso no contrato para
sempre. Nenhuma seguradora operaria assim, e a ausência chamaria atenção na defesa. Não é o RF10
(cancelamento antes da vigência), que segue como item de reserva.

### 1.7 ABI escrita à mão no oráculo

**Decidido:** `oraculo/src/abi.js` declara só as funções, eventos e erros que o serviço usa, em
vez de ler o artefato de compilação do Hardhat.

**Por quê:** o oráculo passa a depender do **contrato**, e não dos artefatos de compilação de
outro diretório. Se uma assinatura mudar, a falha aparece de forma explícita, em vez de surgir
como erro obscuro de decodificação em tempo de execução.

**O que custa:** disciplina. Qualquer mudança nas assinaturas precisa ser espelhada nos dois
lugares. Está anotado no cabeçalho do arquivo.

### 1.8 Contagem de dias secos para na falta de dado

**Decidido:** a contagem de dias consecutivos sem chuva para no primeiro dia chuvoso **e**
no primeiro dia sem dado.

**Alternativa descartada:** presumir que um dia sem leitura foi seco.

**Por quê:** não há como afirmar que não choveu em um dia do qual nenhuma fonte reportou nada.
Presumir seco inflaria o índice e comprometeria exatamente a auditabilidade que justifica o
sistema inteiro. Quando isso acontece, o resultado traz um alerta dizendo que o número é um
piso, não a medida completa da estiagem.

### 1.9 Reputação por média móvel

**Decidido:** média móvel exponencial com α = 0,2.

**Alternativa descartada:** razão entre leituras válidas e total.

**Por quê:** um sensor que funcionou seis meses e quebrou hoje precisa sair de operação rápido.
Com razão acumulada, levaria meses para cair abaixo do limiar. Há teste demonstrando que, com
média móvel, duas semanas de defeito bastam.

### 1.10 Fila em disco antes de publicar

**Decidido:** a consolidação grava em disco **antes** de qualquer tentativa de envio.

**Por quê:** o RNF22 diz que indisponibilidade do oráculo ou da rede não pode causar perda de
dados. Se o índice existisse só na memória do processo, uma queda entre consolidar e confirmar o
perderia.

Esse é o RF21, que consta como item de reserva (HU08) no planejamento. Foi implementado mesmo
assim porque é pequeno, e porque sem ele o comportamento sob falha — uma das quatro medidas
experimentais do capítulo 7 do manual — não teria o que medir.

---

## 2. Defeitos encontrados durante a implementação

Todos foram corrigidos. Ficam registrados porque são o tipo de coisa que volta a acontecer.

### 2.1 `stack too deep` no getter automático da struct de termos

**Sintoma:** o contrato não compilava. `CompilerError: Stack too deep`.

**Causa:** `Termos public termos` faz o compilador gerar um getter que devolve os quatorze
campos um a um, e isso estoura o limite de pilha da EVM.

**Correção:** a variável passou a `private`, com um `verTermos()` explícito devolvendo a struct
inteira. Além de compilar, gasta menos gas na leitura pelo back-end, que precisa de todos os
campos juntos.

### 2.2 `nonce has already been used` entre publicações consecutivas

**Sintoma:** a primeira publicação passava; a segunda falhava; a terceira, depois da espera da
fila, passava de novo.

**Causa:** entre duas publicações seguidas, o nó ainda não contabilizou a transação anterior e
devolve o mesmo `transactionCount`. A segunda transação sai com nonce repetido.

**Correção:** `ethers.NonceManager` em volta da carteira, mantendo a contagem localmente, com
`reset()` no tratamento de erro para não deixar o contador adiantado após uma tentativa que
nunca chegou à rede.

**Observação:** o sintoma só aparece quando as publicações são rápidas o bastante. Em rede local
com mineração instantânea, sempre. Em Sepolia, raramente — o que o tornaria um defeito
intermitente e difícil de diagnosticar se tivesse passado.

### 2.3 O serviço travava com o nó fora do ar

**Sintoma:** com o endpoint RPC inacessível, o comando ficava pendurado por vários minutos em
vez de falhar.

**Causa:** o tempo limite padrão do ethers para uma requisição é de **300 segundos**, e a
detecção automática de rede ainda repete a tentativa.

**Correção:** `FetchRequest` com tempo limite de 10 segundos, repetição desligada, e `chainId`
informado a partir do arquivo de implantação para dispensar a detecção automática.

**Por que importa:** o RNF22 exige que a indisponibilidade da rede não cause perda de dados. Um
serviço travado não perde dado, mas também não retoma — e o operador não tem como saber o que
está acontecendo. O comportamento correto é falhar rápido: a entrada continua na fila e a
próxima tentativa vem com espera crescente.

### 2.4 Os comandos não devolviam o terminal

**Sintoma:** o comando imprimia todo o resultado e o processo não terminava.

**Causa:** o provedor do ethers mantém um temporizador interno de sondagem, que segura o laço de
eventos do Node vivo.

**Correção:** `provider.destroy()` ao final de cada comando, exceto `ouvir`, que fica aberto de
propósito até o Ctrl+C.

### 2.5 Cobertura de testes reportada abaixo do real

**Sintoma:** o `OracleRegistry` aparecia com 54% de cobertura, embora os treze testes dele
passassem e exercitassem todos os caminhos.

**Causa:** o `solidity-coverage` reaproveitou artefatos em cache. A mensagem `Nothing to
compile` no início da execução era o único sinal.

**Correção:** `npx hardhat clean` antes de `npx hardhat coverage`. Está anotado em
[COMO-RODAR.md](COMO-RODAR.md) e em [CONTRATOS.md](CONTRATOS.md).

**Observação:** esse é o tipo de defeito que engana na direção perigosa. Um relatório que mostra
cobertura **menor** que a real faz alguém escrever testes redundantes; se o erro fosse na outra
direção, teria passado despercebido.

### 2.6 Oráculo e produtor no mesmo endereço

**Sintoma:** nos primeiros scripts de implantação, o endereço autorizado a publicar era o mesmo
que recebia a indenização.

**Causa:** os dois scripts pegavam a segunda conta da rede local.

**Correção:** convenção explícita — conta #0 seguradora, #1 produtor, #2 oráculo — documentada
no código e em [COMO-RODAR.md](COMO-RODAR.md).

**Por que importa:** funcionava, mas destruía a separação de papéis do RNF12 justamente na
demonstração. Um avaliador atento perguntaria por que quem publica o dado é quem recebe o
dinheiro, e a resposta certa não seria "foi sem querer".

### 2.7 Estiagem gerada maior que a declarada no cenário

**Sintoma:** o cenário `estiagem_severa` declarava 35 dias secos, mas a série gerada produzia
índices maiores, porque a janela seca se emendava por acaso com os dias sem chuva do padrão
regular anterior.

**Correção:** o dia imediatamente anterior à janela seca passou a ser sempre chuvoso, ancorando
a contagem. Há teste verificando que cada cenário mede exatamente o que declara.

**Por que importa:** o cenário é o instrumento do experimento. Um instrumento que mede diferente
do que diz medir invalida os números do capítulo de resultados.

### 2.8 Limite contratual com 71 wei a mais, por ponto flutuante

**Sintoma:** a tela de cotação mostrava 1,08 ETH, e a proposta gravava `1080000000000000071` wei
em vez de `1080000000000000000`.

**Causa:** `180 × 0,006` em ponto flutuante binário dá 1,0800000000000000710, e converter para
wei só no fim preserva o erro.

**Correção:** a conta passou a ser feita inteiramente em BigInt, sobre wei, com a área convertida
para centésimos de hectare para admitir fração sem sair dos inteiros.

**Por que importa:** são frações de centavo, mas é um valor contratual que não fecha com o
documento, e uma vez implantado não há como corrigir. É também o tipo de defeito que passa
despercebido em qualquer conferência visual, porque a tela arredonda e mostra o número certo.

### 2.9 Sobra do pagamento escalonado presa no contrato para sempre

**Sintoma:** no modo escalonado acionando em 50%, o contrato pagava metade do limite e retinha a
outra metade. `resgatarGarantia` exigia situação `ATIVA`, e a apólice já estava `LIQUIDADA` —
então a sobra ficava inacessível para sempre.

**Causa:** o RF25 foi implementado depois do resgate da garantia, e a interação entre os dois
passou despercebida. Todos os testes existentes usavam pagamento integral, em que a sobra é zero.

**Correção:** `resgatarGarantia` passou a ter duas portas — `ATIVA` com vigência vencida, e
`LIQUIDADA` de imediato, porque depois da liquidação nenhuma publicação é aceita e aquele saldo
jamais será devido a ninguém. A apólice liquidada continua `LIQUIDADA` depois do resgate: trocar
para `ENCERRADA` apagaria, da leitura do estado, o fato de ter havido pagamento.

**Por que importa:** é perda permanente de valor da seguradora, em um caminho que a suíte não
cobria porque nenhum teste exercitava pagamento parcial seguido de resgate. Foi encontrado
executando o fluxo completo pela interface, não pelos testes — o que justifica ter feito esse
percurso à mão antes de dar a integração por pronta.

### 2.10 Endereços autorizados sumindo da tela

**Sintoma:** a tela de oráculos dizia "Nenhum endereço jamais autorizado neste registro", embora
a implantação tivesse autorizado um.

**Causa:** `implantar.js` anotava o `blocoInicial` depois de tudo implantado. As consultas de
evento partem desse número, então o `OraculoAutorizado` emitido durante a própria implantação
ficava fora da janela de busca.

**Correção:** o bloco passou a ser anotado antes da primeira implantação.

**Por que importa:** não havia erro nenhum na tela — apenas uma lista vazia, que parecia estado
legítimo. Na demonstração, levaria à conclusão de que o registro não tinha oráculo autorizado.

---

## 3. O que falta antes da implantação em Sepolia

| Item | Requisito | Situação |
|---|---|---|
| Análise estática dos contratos | RNF13 | A rodar. `slither` ou `mythril`; nenhum achado de severidade alta pode ficar sem tratamento |
| Verificação do código-fonte no Etherscan | — | Permite que a banca leia o contrato implantado no explorador |
| Medição de latência em rede pública | Capítulo 7 do manual | Comparar com os ~170 ms da rede local |
| Custo em gas na Sepolia | RNF09, RNF10 | Confirmar se o custo médio por apólice fica abaixo de 1% do prêmio |

---

## 4. Requisitos ainda não atendidos, por decisão

Constam como itens de reserva no Quadro 19 da documentação de software.

| Requisito | Por que pode esperar |
|---|---|
| RF10 — cancelamento antes da vigência | Não participa do fluxo de apuração e liquidação |
| RF27 — notificação de acionamento e pagamento | Não afeta a decisão de pagamento, apenas a comunicação. Os eventos já são emitidos e capturáveis |
| RF28 — contestação da avaliação automática | Exige retificação do índice em cadeia, de complexidade incompatível com o prazo |

O **RF09** (linha do tempo reconstruída dos eventos) também constava como reserva, e foi
implementado. Com os contratos já emitindo os eventos, montar a linha do tempo na tela de detalhe
da apólice custou pouco, e entrega a parte do RNF20 que o usuário efetivamente vê: o histórico
remontado da rede, auditável sem depender da palavra da seguradora.

O RF17 (encaminhamento ao perito por baixa confiança) também constava como reserva, mas a parte
que cabe ao oráculo — suspender a publicação do índice de dano abaixo do limiar de confiança —
já está implementada, porque era uma condição a mais na função que monta a publicação. O fluxo de
revisão pelo perito, esse sim, continua fora do escopo.
