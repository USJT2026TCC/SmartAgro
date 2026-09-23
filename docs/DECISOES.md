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

### 1.11 O denominador do índice de dano é a lavoura, não a foto

O percentual de dano é calculado sobre a área de **lavoura**, descontando o solo exposto:

```
dano = área de lavoura em estresse / área de lavoura
```

A alternativa — dividir pela área total da imagem — parece mais simples e é errada de dois
jeitos ao mesmo tempo. Uma foto com muito carreador diluiria o dano e faria a seguradora pagar
menos do que deve; e uma lavoura recém-plantada, quase toda solo à vista, poderia acusar dano
sem ter planta nenhuma prejudicada.

Pelo mesmo motivo, estresse leve entra com peso 0,5 e severo com peso 1,0. Somar os dois trataria
folha murcha que se recupera na próxima chuva como perda total. O peso é escolha **atuarial**, da
seguradora, e fica configurável e registrado junto do resultado — não é constante escondida no
código.

### 1.12 O estimador clássico tem confiança abaixo do limiar, de propósito

Enquanto não há modelo treinado, o módulo de visão usa uma heurística de cor. A confiança dela é
fixa em 45%, abaixo do limiar de 70% — então **toda** análise que ela produz vai para o perito, e
nenhuma aciona pagamento sozinha.

Não é cautela genérica: a heurística não distingue milho seco de milho maduro, nem palha seca de
solo. A alternativa seria deixá-la assinar índices que movem dinheiro, que é exatamente o que
este trabalho argumenta que não se deve fazer com um número que ninguém conferiu.

Quando o modelo treinado entrar, ele reporta a própria confiança — média da probabilidade da
classe escolhida, só nos pixels de lavoura — e o limiar volta a ter o significado que deveria ter.


### 1.13 Cada imagem é padronizada antes de entrar no modelo

A rede não recebe os valores de cor como vieram: cada imagem tem a própria média subtraída e é
dividida pelo próprio desvio, canal a canal.

O motivo é a diferença entre o equipamento do treino e o do uso. As imagens da base vêm de
câmera de drone, com normalização própria — são mais escuras e menos saturadas que uma foto de
celular da mesma lavoura. Sem padronizar, o modelo aprenderia também o brilho típico daquela
câmera, e no celular veria outra lavoura.

A padronização **não** resolve a diferença entre os equipamentos; só um conjunto de fotos reais
da lavoura resolveria. Ela tira a parte mais grosseira, que é o nível de exposição.

Treino e inferência usam a mesma função, em `visao/rede.py`, e há teste fixando isso. Padronizar
de um lado e não do outro produziria um modelo com validação boa e desempenho ruim em produção —
e sem nenhum erro aparecer, porque o número continuaria plausível.


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

### 2.11 Vínculo de carteira aceitava qualquer assinatura

**Sintoma:** nenhum, e é isso que o torna grave. A primeira versão do vínculo recebia desafio e
assinatura, recuperava o endereço com `ecrecover` e o gravava como carteira do produtor.

**Causa:** `ecrecover` **sempre** devolve um endereço, para qualquer assinatura bem formada —
inclusive uma produzida sobre outra mensagem. O servidor gravaria um endereço aleatório, de que
ninguém tem a chave, e as indenizações daquele produtor iriam para lá.

**Correção:** o produtor passou a enviar também o endereço que declara possuir, e o servidor exige
que o endereço recuperado seja igual ao declarado (o mesmo princípio do *Sign-In with Ethereum*).
Um teste assina outra mensagem e confere a recusa.

**Por que importa:** o erro não aparecia em nenhum teste de caminho feliz. Só uma revisão
perguntando "o que acontece se a assinatura estiver errada?" o encontrou.

### 2.12 Área do talhão 7% maior que a real

**Sintoma:** um polígono de 459,9 ha aparecia com 492,8 ha na tela de cadastro.

**Causa:** o aplicativo calculava a área tratando longitude e latitude como coordenadas planas,
com um fator de conversão fixo. Longe do equador, isso infla a área.

**Correção:** a área passou a ser calculada pelo PostGIS, sobre o elipsoide
(`ST_Area(geometria::geography)`), e o limite da apólice usa esse número.

**Por que importa:** o limite da apólice é área × valor por hectare. Com 7% de área a mais, a
seguradora emitiria cobertura sem lastro correspondente em terra.

### 2.13 Desafio de carteira que voltava a valer

**Causa:** o consumo do desafio (`UPDATE ... SET usado_em`) estava dentro da mesma transação do
vínculo. Quando o vínculo falhava — endereço já usado por outro produtor, por exemplo — a
transação era desfeita e o desafio voltava a valer.

**Correção:** o desafio é consumido primeiro, com um `UPDATE ... RETURNING` atômico fora da
transação. Tentativa falha gasta o desafio, como deve.

### 2.14 Revisão do perito anulada pelo limiar do oráculo

**Sintoma:** o perito liberava uma análise de baixa confiança, e mesmo assim o índice de dano não
era publicado.

**Causa:** o oráculo aplicava o próprio limiar de confiança sem saber que a análise já tinha sido
revisada. O humano decidia, e a máquina desfazia a decisão.

**Correção:** o backend envia `liberadaPeloPerito`, e o oráculo não reaplica o limiar nesse caso.
Uma análise **rejeitada**, ao contrário, nunca chega ao oráculo — por isso a decisão do perito é
uma coluna própria, e não apenas "revisada sim ou não".

### 2.15 Chuva do dia dividida pelo número de leituras

**Sintoma:** encontrado ao ligar o simulador com dados reais, antes de chegar a produzir número
errado na cadeia.

**Causa:** o consolidador tirava a média da chuva entre **todas** as leituras do dia. Com uma
leitura diária por estação, que era o formato do script de demonstração, isso dá a média entre
as estações e está certo. Com uma estação automática real, que reporta de hora em hora, 24
leituras de 0,5 mm viravam 0,5 mm de chuva no dia em vez de 12 mm — e um dia chuvoso seria
contado como seco.

**Correção:** a agregação passou a ter dois passos: soma dentro de cada fonte, média entre
fontes. Dois testes fixam o comportamento, um deles com fontes de granularidades diferentes.

**Por que importa:** dia seco é o que aciona o pagamento. O erro empurrava o índice para cima,
ou seja, para pagar indenização que a chuva registrada não justificava.

### 2.16 O mesmo campo com dois nomes na fronteira

**Sintoma:** os primeiros 1.104 lotes enviados pelo simulador foram recusados, todos, com o
motivo "campo ausente".

**Causa:** a marca de tempo da leitura se chama `instante` na API e no banco, e `timestamp` no
consolidador do oráculo. O simulador foi escrito contra o segundo nome — e a especificação de
ingestão em BACKEND.md, escrita antes do simulador, também usava `timestamp`.

**Correção:** a API passou a aceitar os dois nomes, com `instante` como canônico, e há teste
para o sinônimo. A especificação foi corrigida.

**Por que importa:** o simulador é escrito por outra pessoa da equipe, em outra linguagem. Se um
detalhe de vocabulário derruba um lote inteiro de leituras de campo, o problema não é de quem
escreveu o cliente — é da fronteira, que precisa ser tolerante na entrada.

### 2.17 Série terminando em um dia que ainda não acabou

**Sintoma:** com os dados reais carregados e 39 dias de estiagem na série, o índice publicado
dava zero.

**Causa:** o simulador deslocava a série para terminar **na hora atual**. O último dia ficava com
poucas horas medidas, e dia incompleto interrompe a contagem de dias secos (decisão 1.8) em vez
de contar como seco. A contagem morria no primeiro dia.

**Correção:** o deslocamento passou a terminar às 23 h de ontem, o último dia completo, e o
comando imprime qual período deve ser passado ao oráculo.

**Por que importa:** a regra que protege contra sensor quebrado — não presumir dia seco sem dado
— também vale para o dia que ainda está acontecendo. O defeito estava no simulador, e não na
regra.

### 2.18 Pesos do modelo que só carregavam de dentro do script de treino

**Sintoma:** o treino terminava, salvava `unet.pt`, e a inferência falhava com
`AttributeError: Can't get attribute 'UNet' on <module 'visao.__main__'>`.

**Causa:** `torch.save(modelo)` grava uma referência ao módulo onde a classe foi definida. Como
a `UNet` morava em `treino/treinar.py`, os pesos só carregavam de dentro daquele script — ou
seja, em lugar nenhum que importasse.

**Correção:** a arquitetura foi para `visao/rede.py`, um caminho de importação estável, e o que
se salva passou a ser o `state_dict` — só os números —, lido com `weights_only=True`.

**Por que importa, além de fazer funcionar:** arquivo de pesos passa a ser **dado, e não
código**. Carregar um modelo serializado como objeto executa o que estiver dentro dele; com
`state_dict`, os números só podem ser usados com a arquitetura que já está no repositório, sob
revisão. O arquivo também passou a carregar a versão e a lista de classes, e pesos treinados com
outra lista são recusados — caso contrário o índice de dano sairia trocado, plausível e errado.

---

## 3. O que falta antes da implantação em Sepolia

| Item | Requisito | Situação |
|---|---|---|
| Análise estática dos contratos | RNF13 | **Feito.** Slither sem nenhum achado; ver [ANALISE-ESTATICA.md](ANALISE-ESTATICA.md) |
| Verificação do código-fonte no Etherscan | — | Permite que a banca leia o contrato implantado no explorador |
| Medição de latência em rede pública | Capítulo 7 do manual | Comparar com os ~170 ms da rede local |
| Custo em gas na Sepolia | RNF09, RNF10 | Confirmar se o custo médio por apólice fica abaixo de 1% do prêmio |

---

## 4. Requisitos ainda não atendidos, por decisão

Constam como itens de reserva no Quadro 19 da documentação de software.

| Requisito | Por que pode esperar |
|---|---|
| RF10 — cancelamento antes da vigência | Não participa do fluxo de apuração e liquidação |
| RF28 — contestação da avaliação automática | Exige retificação do índice em cadeia, de complexidade incompatível com o prazo |

O **RF09** (linha do tempo reconstruída dos eventos) também constava como reserva, e foi
implementado. Com os contratos já emitindo os eventos, montar a linha do tempo na tela de detalhe
da apólice custou pouco, e entrega a parte do RNF20 que o usuário efetivamente vê: o histórico
remontado da rede, auditável sem depender da palavra da seguradora.

O RF17 (encaminhamento ao perito por baixa confiança) também constava como reserva, mas a parte
que cabe ao oráculo — suspender a publicação do índice de dano abaixo do limiar de confiança —
já está implementada, porque era uma condição a mais na função que monta a publicação. Com o
backend, o fluxo de revisão pelo perito também foi implementado: a análise fica retida até o
parecer, e a decisão tem autor e justificativa registrados.

O **RF27** (notificações) saiu da reserva pelo mesmo motivo: o indexador do backend já lia os
eventos, e transformá-los em avisos para as partes custou uma tabela e uma tela.
