# Decisões de projeto

Registro do que foi decidido, do que foi descartado e do que deu errado durante a
implementação do sistema. Serve a dois propósitos: sustentar as respostas na
defesa e evitar que alguém refaça uma escolha já examinada.

---

## 1. Decisões de arquitetura

### 1.1 Lista de oráculos em contrato separado

**Decidido:** o `OracleRegistry` é um contrato próprio, consultado por cada apólice.

**Alternativa descartada:** guardar o endereço autorizado dentro de cada `ApolicePolicy`, como
no esqueleto do manual da equipe.

**Por quê:** revogar um oráculo comprometido passa a ser uma transação só, em vez de uma por
apólice. Com uma carteira de dez mil talhões, a diferença é entre possível e
inviável. Também barateia a implantação de cada apólice, que passa a guardar só a referência.

**O que custa:** uma chamada externa de leitura por publicação. Está medido e documentado na
tabela de gas.

### 1.2 Fábrica de apólices

**Decidido:** uma `ApoliceFactory` implanta as apólices e mantém o índice de quais existem.

**Por quê:** o RF07 pede a implantação na contratação. Sem a fábrica, a lista de endereços
implantados viveria só no banco do back-end, e deixaria de ser auditável na cadeia — o que
contraria o RNF18.

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

**Por quê:** o RNF20 diz que indisponibilidade do oráculo ou da rede não pode causar perda de
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


### 1.14 A origem da localização da foto é registrada, e não usada para recusar

O servidor sempre conferiu se a foto cai dentro do talhão. Não sabia **quanto confiar** no ponto:
GPS gravado na foto, posição do aparelho no envio ou ponto marcado à mão no mapa provam coisas
muito diferentes. A partir da migração 002, cada imagem guarda a origem da coordenada.

A alternativa — recusar foto sem GPS — puniria o produtor cuja foto passou por um aplicativo de
mensagem, que apaga o EXIF. A foto continua sendo evidência; o que muda é que o perito vê quantas
fotos de cada lote tiveram o local informado à mão.

**Decidido pela equipe (25/09/2026): a origem é só informada, e não altera a confiança.** Um lote
com fotos de local manual pode ser liberado direto ao oráculo, se a confiança do modelo passar do
limiar — o teste da tela fez isso, com 1 de 7 fotos marcada à mão. A alternativa considerada foi
derrubar a confiança pela fração de fotos com local manual, mandando esses lotes ao perito; ficou
registrada como melhoria possível, para o caso de a fraude por localização se mostrar um problema
na prática. Até lá, o controle é a informação visível ao perito e à seguradora na lista de lotes.

### 1.15 Cancelamento (RF10): só antes da vigência, e a garantia volta inteira

**Decidido:** `cancelar()` aceita o produtor titular ou a seguradora, só enquanto
`block.timestamp < vigenciaInicio`, e devolve à seguradora todo o saldo do contrato. A apólice
passa à situação `CANCELADA` (4), da qual nenhuma função sai.

**Por quê só antes da vigência:** depois do início, o produtor já sabe como o clima está indo.
Cancelar uma apólice quando a chuva voltou, e mantê-la quando não voltou, é seleção adversa — a
seguradora pagaria pelo risco sem receber por ele.

**Por quê a garantia volta à seguradora, e não ao produtor:** a garantia é dinheiro da seguradora
reservado para a indenização. O prêmio pago pelo produtor não passa pelo contrato; a devolução dele
é assunto do contrato comercial, fora da cadeia. Misturar os dois exigiria o contrato saber quanto
foi pago, e por quem.

**Para isso existir, a proposta ganhou a data de início** (`propostas.inicio_desejado`, migração
003): sem vigência futura, não há janela de cancelamento. Na Sepolia, em 08/10/2026: apólice com
início em 10 dias, cancelada pela seguradora, 0,002 ETH devolvidos em 43.055 de gas
([resultados/sepolia-2026-10-08](resultados/sepolia-2026-10-08/README.md)).

### 1.16 Contestação (RF28): a retificação fica ao lado da publicação original

**Decidido:** o produtor contesta o índice de dano de um período; o perito decide fora da cadeia,
com parecer escrito; se deferir, o oráculo publica `publicarRetificacao(periodo, indiceDanoBps, …,
hashParecer)`. O contrato guarda a retificação **em separado**, nunca sobrescreve a publicação
original, aceita uma só por período e reavalia a condição com o índice de dano novo e o índice
climático **original** daquele período.

**Alternativas descartadas:**

- *O perito publica direto.* Daria ao perito uma chave com poder de mover dinheiro, e uma segunda
  porta de entrada na apólice. Mantendo o oráculo como único autor de escrita, o RF18 continua
  valendo: quem pode publicar é a lista do registro, e só ela.
- *Sobrescrever o índice.* Apagaria a prova do que o modelo disse antes. Com os dois lado a lado, a
  linha do tempo mostra o índice automático, o retificado e o resumo do parecer que justificou a
  mudança.
- *Reavaliar com um índice climático novo.* A contestação é sobre a imagem; reabrir o clima por
  esse caminho permitiria contestar um período só para trocar os dois números.

**O resumo do parecer** é o keccak-256 de um texto canônico — contestação, apólice, período,
decisão, índice retificado e o parecer escrito —, calculado pelo backend (`textoDoParecer`). Quem
tiver o texto recalcula o resumo e confere que é o mesmo que foi para a cadeia. O autor fica
registrado no banco e na auditoria.

**A contestação é validada contra o evento da rede**, não contra o relato do oráculo ao backend: só
se contesta um período que tem `IndicesPublicados` registrado para aquela apólice. A primeira versão
exigia o relato do oráculo, e uma publicação feita por script ficava incontestável.

### 1.17 Histórico climático na cotação (RF06): a mesma regra do oráculo, ano a ano

**Decidido:** para cada ano de 2015 a 2025, a cotação recoloca a janela de vigência pedida
(mesmo dia e mês de início, mesma duração) e conta os dias secos **com a regra do oráculo**: chuva
somada por estação, média entre estações, menos de 1 mm é dia seco, dia sem medição interrompe a
contagem. Mostra em quantos anos o produto teria acionado e o pagamento médio.

**Estações:** as do INMET a até 100 km do talhão, escolhidas pelo PostGIS. Hoje A770 (São Simão) e
A747 (Pradópolis); o histórico de 5.610 dias fica versionado no backend, para a cotação não
depender do portal do INMET estar no ar.

**Ano com menos de 90% dos dias medidos não entra na conta.** Contar dia sem medição como dia
chuvoso subestimaria a seca; como dia seco, superestimaria. Melhor dizer que não se sabe.

**É um piso para produtos mistos.** Um produto que também aciona por dano tem frequência real maior
que a do clima sozinho, e a tela diz isso.

**O resultado depende muito da data de início** — e é o argumento mais forte para mostrá-lo. O
mesmo produto de 30 dias teria acionado em 1 de 9 anos começando em outubro, e em 8 de 8 começando
em maio, quando o inverno seco do interior paulista cai inteiro dentro da vigência.

### 1.18 E-mail (RF27): despachante separado, e caixa de saída em arquivo sem servidor

**Decidido:** os avisos continuam nascendo do indexador; um despachante separado envia por
Nodemailer (tabela de tecnologias da Entrega 3) os que têm destinatário com e-mail, marca o envio só
depois de o servidor aceitar e tenta de novo até 5 vezes. Sem `SMTP_URL`, cada mensagem vira um
`.eml` em `backend/dados/emails/`, que abre em qualquer cliente de e-mail.

**Por quê separado:** uma fila de e-mail parada não pode atrasar a indexação dos eventos, que é o
que alimenta todas as telas.

**Por quê o arquivo:** a demonstração não depende de conta em provedor de e-mail, e o que seria
enviado fica inspecionável.

### 1.19 O modelo de visão em operação continua sendo o 2.0.0

A U-Net com codificador ResNet-18 pré-treinado (3.0.0) foi treinada como pede a tabela de
tecnologias, e empata em precisão com a 2.0.0, treinada do zero: erro médio de 3,2 contra 3,3
pontos; dano da área 4,7% contra 4,6% (real: 4,3%). Chegou ao melhor resultado na época 7, contra
18 — a transferência de aprendizado barateou o treino, como a Entrega 3 previa.

**Não entrou em operação porque a confiança dela não discrimina nada:** fica entre 39% e 50% em
todos os 79 recortes de validação, e o limiar do perito é 70%. Com ela, todo lote iria ao perito. Na
2.0.0, o único recorte abaixo do limiar é justamente o de maior erro. Calibrar a confiança da 3.0.0
(uma temperatura ajustada na validação) é o passo que falta; baixar o limiar só para ela esconderia
o problema. Detalhes em
[resultados/visao-unet-resnet18-3.0.0](resultados/visao-unet-resnet18-3.0.0/README.md).

### 1.20 Contratação (UC05): o produtor propõe, a seguradora assina a emissão

O caso de uso descreve a contratação pelo produtor. Na implementação, o produtor faz a cotação e
envia a **proposta**; a transação que implanta a apólice é assinada pela seguradora, que deposita a
garantia logo depois.

**Por quê:** a fábrica só aceita emissão da seguradora, e é isso que impede um terceiro de criar
apólices em nome dela, com limites que ela não aprovou. O produtor continua sendo o único
beneficiário possível — o endereço dele vai nos termos, que ele confere no aplicativo contra o
resumo gravado no contrato (RF08). Do ponto de vista do produtor, o fluxo é o do caso de uso:
cotar, aceitar, acompanhar.

### 1.21 Seca anterior à vigência entra na contagem — limitação conhecida

O índice climático é a sequência de dias secos que **termina** no dia publicado, contada para trás
sem olhar o início da vigência. O contrato só aceita publicações dentro da vigência, mas uma
apólice que começa no meio de uma estiagem herda os dias secos anteriores: com 25 dias sem chuva
antes do início, a condição de 30 dias seria atingida no quinto dia de cobertura.

**Não foi alterado, por decisão:** o termo contratado é "30 dias consecutivos sem chuva", e a
seguradora assina cada emissão (1.20), vendo a data de início e o histórico da localidade (1.17).
**A correção, se a seguradora quiser**, é o oráculo parar a contagem no início da vigência —
`vigenciaInicio` já está nos termos que ele lê — ou o produto ter carência, como os seguros
agrícolas costumam ter. Fica registrado para a defesa: é a pergunta natural de quem conhece seguro.

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

**Por que importa:** o RNF20 exige que a indisponibilidade da rede não cause perda de dados. Um
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

**Por que importa:** funcionava, mas destruía a separação de papéis do RNF10 justamente na
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

### 2.19 Produção e treino com tamanhos de imagem diferentes

**Sintoma:** nenhum. Esse é o problema.

**Causa:** o serviço de visão redimensionava cada imagem para 512×512 antes de classificar. O
modelo foi treinado em recortes de 224×224. Uma rede convolucional aceita qualquer tamanho sem
reclamar, então tudo rodava — mas as plantas chegavam 2,3 vezes maiores do que o modelo tinha
aprendido a ver.

**Medido com os pesos da primeira rodada no Colab**, nos 132 recortes de estresse hídrico:

| Caminho | Erro absoluto médio | Viés |
|---|---:|---:|
| Avaliação do treino (224) | 14,7 pontos | +3,3 |
| Serviço em produção (512) | **25,4 pontos** | **−25,4** |
| Heurística de cor, para comparar | 18,4 pontos | −16,3 |

Em produção, o modelo treinado era **pior que a heurística que ele veio substituir**, e o viés de
−25,4 pontos quer dizer que ele reportava dano perto de zero quase sempre.

**Correção:** o tamanho de entrada passou a viajar no arquivo de pesos, e a inferência lê dele,
nunca de uma constante. Um teste compara, pixel a pixel, a máscara do caminho de produção com a da
avaliação do treino para a mesma imagem. Forçando o tamanho errado de volta, o teste falha.

**Por que importa:** é o mesmo tipo de defeito da padronização (decisão 1.13) — treino e uso
divergindo sem erro nenhum aparecer —, e aconteceu mesmo depois de a decisão estar escrita. A
lição é que regra escrita não basta: o acordo entre treino e produção precisa de um teste que
falhe quando ele for quebrado.

### 2.20 A métrica do treino media a prova errada

**Sintoma:** o treino reportou erro de **7,4 pontos** no índice de dano, contra 18,4 da
heurística — uma melhora aparente de 60%.

**Causa:** o 7,4 era calculado sobre a validação inteira: 132 recortes de estresse hídrico e 130
de ferrugem. Nos de ferrugem, o dano por seca verdadeiro é zero, e acertar zero é fácil — o erro
ali foi 0,0. A heurística, por outro lado, tinha sido medida só nos de estresse hídrico. Eram duas
provas diferentes.

**Na mesma prova:** 14,7 pontos contra 18,4. Melhora de 20% no erro médio, e o viés cai de −16,3
para +3,3.

**Correção:** `treino/avaliar_modelo.py` mede o modelo exatamente como
`avaliar_baseline.py` mede a heurística; o treino passou a escolher a melhor época pelo erro nos
recortes de estresse hídrico; e o notebook mostra as duas medições lado a lado.

**Por que importa:** o número errado era o que entraria no TCC, e era o mais bonito. Ninguém teria
questionado — a curva descia, o valor era plausível.

### 2.21 O modelo aprendeu a reconhecer o voo, e não a doença

**Sintoma:** nos recortes de ferrugem, o modelo classificou como doença 88% da lavoura
**saudável**. Nos de estresse hídrico, 13% da lavoura virou doença.

**Causa:** a base tem dois voos, um sobre uma lavoura com estresse hídrico e outro sobre outra
lavoura, com ferrugem. Luz, data, talhão e câmera diferem entre os dois, e o modelo usou essa
diferença: aprendeu "parece o voo da ferrugem, então é ferrugem". Como doença tinha peso zero no
índice de seca, cada pixel de estresse chamado de doença sumia da conta.

**Correção:** doença saiu do modelo. O trabalho trata de dano por estiagem e não fala em doença, e o
voo da ferrugem não entra mais no treino. O modelo tem quatro classes: solo, saudável, estresse
leve e estresse severo.

**Por que importa:** quando cada classe vem de uma única fonte, o modelo pode aprender a fonte em
vez da classe — e a métrica fica boa mesmo assim, porque a validação tem o mesmo atalho. Só apareceu
porque a figura de comparação mostrava lavoura inteira pintada de doença.

### 2.22 O gabarito do primeiro treino estava calculado com as bandas trocadas

**Sintoma:** nenhum, no nosso código. Apareceu lendo a documentação da versão completa da base,
publicada depois do subconjunto que usamos.

**Causa:** as máscaras da base não são anotação de agrônomo, são **pseudo-rótulos** gerados por
índices de vegetação (NDVI, NDRE, SAVI, GCI), que usam as bandas de red-edge e infravermelho. No
subconjunto v1.0, os autores calcularam esses índices com as duas bandas trocadas, e corrigiram na
v2.1:

| Máscaras | Lavoura rotulada como estresse |
|---|---:|
| v1.0 (bandas trocadas), usada no primeiro treino | 56,2% |
| v2.1 (corrigida) | 5,8% |

O primeiro modelo aprendeu a reproduzir o rótulo errado, e foi medido contra o mesmo rótulo errado.
Os números da primeira rodada — 14,7 pontos contra 18,4 da heurística — **não valem**.

Duas conclusões nossas também estavam erradas e foram corrigidas em DADOS.md: que "a banda 0 é o
vermelho" (é o azul) e que "o caminho RGB não depende das bandas 4 e 5" (depende, pelo gabarito).

**Correção:**

- a base passou para a v2.1, só o voo do estresse hídrico, com o RGB montado pelas bandas nomeadas;
- o preparo **confere** a ordem de classes declarada pela base e para se ela mudar;
- a avaliação ganhou a **referência trivial** — o erro de responder sempre 0% —, porque com dano
  médio de 5% um erro de 5 pontos não quer dizer nada sozinho;
- heurística e modelo passaram a ser medidos pelo mesmo código (`treino/avaliacao.py`).

**Na base corrigida, a heurística de cor erra 13,9 pontos, e responder sempre 0% erraria 4,9.** A
heurística é pior que a resposta trivial.

**Por que importa:** o erro não estava em nenhuma linha de código nossa, e nenhum teste o pegaria.
Estava no dado de terceiro. O que o encontrou foi desconfiar de um resultado fisicamente impossível
— o NDVI invertido, encontrado ao abrir a base — e voltar à fonte, que já tinha publicado
uma versão corrigida. Para o TCC,
o ponto é que rótulo automático herda os erros do processo que o gerou, e que a documentação da
base precisa ser lida por inteiro, inclusive nas versões posteriores.

### 2.23 A data da foto trocada, em silêncio, pela data do arquivo

**Sintoma:** encontrado pelo teste escrito junto com a tela de fotos, antes de chegar ao
aplicativo.

**Causa:** a leitura do EXIF pedia os campos de data com a opção `pick`, que a versão enxuta da
biblioteca `exifr` não suporta. A chamada lançava erro, o erro era tratado como "foto sem data", e
a data da foto virava a data de modificação do arquivo — que muda a cada cópia.

**Correção:** a leitura passou a pedir os blocos do EXIF sem filtrar campos. O teste usa as fotos de
demonstração com uma data de arquivo propositalmente diferente, e falharia se a leitura voltasse a
cair nela.

**Por que importa:** o tratamento de erro estava certo — foto sem data não pode travar o envio —,
mas escondia um erro de programação atrás de um caso legítimo. Só um teste com o resultado
esperado, e não apenas "não quebrou", separa os dois.

### 2.24 A implantação na Sepolia pagou mil vezes o preço do gas

**Sintoma:** a primeira implantação na Sepolia (07/10/2026) consumiu 0,018 ETH dos 0,05 obtidos
no faucet — a estimativa era de menos de 0,01 ETH para a demonstração inteira.

**Causa:** duas coisas somadas. A quantidade de gas subiu de verdade, pelo Glamsterdam (ver
CONTRATOS.md §4). E o preço pago foi 1 gwei por unidade, quando a rede aceitava 0,001 gwei: sem
preço configurado, o Hardhat oferece 1 gwei de gorjeta, um padrão pensado para a rede principal.

**Correção:** `PRECO_GAS_GWEI` no `contratos/.env`, lido pelo `hardhat.config.js` (padrão do
exemplo: 0,01 gwei, dez vezes o que a rede pedia). A emissão seguinte, de 10,4 milhões de gas,
custou 0,0001 ETH. O serviço de oráculo não tinha o problema: usa o ethers direto, que pergunta o
preço à rede.

**Por que importa:** em rede de teste o ETH é gratuito, mas escasso — os faucets limitam a retirada
diária. Pagar mil vezes o preço esgotaria o saldo antes do fim da demonstração.

### 2.25 A rede local usava os endereços da Sepolia

**Sintoma:** depois de configurar a Sepolia, a demonstração local parou: o oráculo local recebia
`OrigemNaoAutorizada` em toda publicação.

**Causa:** `implantar.js` lia `ENDERECO_ORACULO` do `contratos/.env`, e `emitir-apolice.js` lia
`ENDERECO_PRODUTOR`. Os dois tinham sido preenchidos para a Sepolia, e passaram a valer também na
rede local: o registro local autorizava o oráculo da Sepolia, e as apólices locais pagavam a uma
carteira que não existe no nó local.

**Correção:** na rede 31337, os dois scripts ignoram essas variáveis e usam as contas do Hardhat.

**Por que importa:** configuração de uma rede vazando para a outra é silenciosa — as transações
dão certo, só que para o endereço errado.

### 2.26 Anos antigos do INMET voltavam vazios, sem erro

**Sintoma:** o histórico da cotação (RF06) tinha 2019 a 2025 completos e 2015 a 2018 sem nenhum dia.

**Causa:** até 2018, os arquivos do INMET chamam as colunas `DATA (YYYY-MM-DD)` e `HORA (UTC)`; a
partir de 2019, `Data` e `Hora UTC`. O leitor procurava só os nomes novos, não achava nenhuma linha
válida e devolvia uma série vazia — que é um resultado legítimo para um ano sem medição.

**Correção:** o leitor aceita os dois cabeçalhos, e há teste com cada formato.

### 2.27 O oráculo repetia cinco vezes uma recusa definitiva do contrato

**Sintoma:** o registro do oráculo mostrava `unknown custom error` e cinco tentativas seguidas para
publicar numa apólice cuja vigência ainda não tinha começado.

**Causa:** duas. O ethers decodifica o erro próprio do contrato em `erro.revert`, mas a
`shortMessage` continua dizendo "unknown custom error" — e era ela que o oráculo registrava. E toda
falha era tratada como transitória, de rede, e voltava para a fila.

**Correção:** o registro usa o nome e os argumentos do erro decodificado (`ForaDaVigencia(…)`); uma
recusa do contrato é falha definitiva, sem nova tentativa; e o serviço pula, antes de enviar, a
apólice fora da vigência.

**Por que importa:** repetir uma transação que o contrato sempre vai recusar gasta gas a cada
tentativa — a estimativa falha antes, mas nem sempre.

### 2.28 A data de início sugerida era amanhã, à noite

**Sintoma:** depois das 21 h, a cotação sugeria como início da cobertura o dia seguinte.

**Causa:** a data padrão vinha de `new Date().toISOString().slice(0, 10)`, que é a data em UTC — três
horas à frente do horário de Brasília.

**Correção:** a data local, por `toLocaleDateString("sv-SE")`, que já sai no formato AAAA-MM-DD.
No relatório da seguradora (RF29) o cuidado foi o inverso: o tempo de liquidação é calculado em UTC,
como o oráculo define o período, com `AT TIME ZONE 'UTC'` explícito no banco.

### 2.29 A linha do tempo parava de abrir uma semana depois da emissão

**Sintoma:** encontrado medindo o RNF01 na Sepolia. Uma consulta de eventos sobre 50 mil blocos
falhava com `could not coalesce error`.

**Causa:** a linha do tempo (RF09) e a lista de oráculos pediam todos os eventos desde a implantação
em uma consulta só. O nó público recusa intervalos dessa ordem — cerca de uma semana de blocos —, e
uma vigência de 180 dias cobre 1,3 milhão.

**Correção:** leitura em trechos de 10 mil blocos, quatro por vez, uma consulta por trecho para todos
os eventos do contrato (oito vezes menos pedidos que um por tipo de evento), com nova tentativa
quando um servidor do nó responde `pruned history unavailable`. Os testes conferem que nenhum
evento se perde na emenda entre trechos. O indexador do backend já lia em trechos de 2 mil blocos.

**Limite que fica:** o nó público gratuito descarta o histórico com mais de alguns meses (EIP-4444).
Para uma vigência inteira, a operação precisa de um nó com histórico completo, em
`VITE_RPC_SEPOLIA`.

### 2.30 Dois defeitos de tela achados pelos testes de interface

1. **Dois cliques rápidos no mapa perdiam um vértice do talhão.** O tratador de clique do Leaflet
   partia da lista de vértices guardada na última renderização; dois cliques antes da renderização
   seguinte partiam da mesma lista, e o segundo apagava o primeiro. Correção: a referência é
   atualizada no próprio clique.
2. **A linha do tempo não mostrava cancelamento nem retificação.** A lista de eventos buscados era
   anterior ao RF10 e ao RF28. O teste foi escrito a partir dos eventos do contrato, e não da lista
   da tela, e por isso pegou a diferença.

### 2.31 A rede pré-treinada era mais precisa e inutilizável

Não é defeito de código, mas foi descoberto da mesma forma: medindo o que o sistema faz com o
número, e não só o número. A 3.0.0 tem o menor erro médio dos três modelos treinados e confiança
sempre abaixo do limiar do perito. Avaliar um modelo só pela precisão teria colocado em operação
um estimador que manda todo lote para revisão humana (ver 1.19).

---

## 3. Rede de teste pública (Sepolia)

| Item | Requisito | Situação |
|---|---|---|
| Análise estática dos contratos | RNF11 | **Feito.** Slither sem nenhum achado; ver [ANALISE-ESTATICA.md](ANALISE-ESTATICA.md) |
| Implantação em Sepolia | — | **Feito** em 07/10/2026 e refeito em 08/10/2026 com o RF10 e o RF28; endereços em `contratos/implantacoes/sepolia.json` |
| Verificação do código-fonte no Etherscan | — | **Feito** em 08/10/2026: registro, fábrica e apólices ([resultados/sepolia-2026-10-08](resultados/sepolia-2026-10-08/README.md)) |
| Pagamento pelos dois índices | RF23, RF24 | **Feito** em 07/10/2026: [resultados/sepolia-2026-10-07](resultados/sepolia-2026-10-07/README.md) |
| Cancelamento e contestação | RF10, RF28 | **Feito** em 08/10/2026: [resultados/sepolia-2026-10-08](resultados/sepolia-2026-10-08/README.md) |
| Latência em rede pública | RNF21 | **Medido**: ~27 s da publicação à segunda confirmação, contra ~170 ms na rede local |
| Custo em gas | RNF07, RNF08 | **Medido** (CONTRATOS.md §4; [requisitos não funcionais](resultados/requisitos-nao-funcionais-2026-10-08/README.md)) |

---

## 4. Itens de reserva

O Quadro 18 da documentação de software deixa fora das três sprints oito itens, que só entrariam
com folga. **Todos foram implementados.** O motivo de cada um ter saído da reserva:

| Item | Por que foi feito |
|---|---|
| HU08 (RF21) — retomada após indisponibilidade | A fila persistente do oráculo nasceu junto do serviço: sem ela, um nó fora do ar travava o ciclo (2.3) |
| HU12 (RF09) — linha do tempo dos eventos | Com os contratos já emitindo os eventos, montar a linha do tempo custou pouco, e entrega a parte do RNF18 que o usuário vê: o histórico remontado da rede, sem depender da palavra da seguradora |
| HU14 (RF27) — notificações | O indexador já lia os eventos; virar aviso custou uma tabela e uma tela, e o e-mail entrou com o Nodemailer (1.18) |
| RF10 — cancelamento antes da vigência | Uma função no contrato e a data de início na proposta (1.15) |
| RF17 — encaminhamento ao perito | A parte do oráculo era uma condição a mais na publicação; com o backend, o parecer passou a ter autor e justificativa registrados |
| RF25 — pagamento escalonado | Entrou com o contrato: o modo integral e o escalonado dividem a mesma avaliação, e testar só um deixaria a outra metade sem prova |
| RF28 — contestação | O mais caro: retificação em cadeia sem apagar o original, fila do perito e publicação pelo oráculo (1.16) |
| RF29 — relatórios da carteira | Os eventos indexados já tinham tudo; faltavam os filtros e a quebra por cultura e região |
