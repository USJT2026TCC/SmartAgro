# Aplicativo

Referência do front-end: como ele conversa com os contratos, o que cada tela faz e quais
decisões foram tomadas.

Código em [`app/src/`](../app/src).

---

## 1. Como o aplicativo fala com a cadeia

Não há back-end. O aplicativo lê e escreve **diretamente nos contratos**, por dois caminhos que
existem de propósito separados:

| Caminho | O que faz | Precisa de carteira? |
|---|---|---|
| `provedorLeitura` | Fala com o nó RPC configurado | Não |
| `signatario` | Vem da MetaMask; assina transações | Sim |

Manter os dois separados tem uma consequência prática: **as telas de consulta funcionam sem
carteira instalada**. Quem só quer acompanhar uma apólice não precisa de MetaMask. Só quem vai
mover valor ou alterar estado precisa assinar.

### Os endereços dos contratos

Vêm de `contratos/implantacoes/<rede>.json`, copiado para dentro do aplicativo pelo script
`npm run enderecos`, que roda automaticamente antes do `dev` e do `build`.

Nenhum endereço é digitado à mão. Um endereço desatualizado no front-end produz o pior tipo de
erro: a tela carrega, as consultas devolvem vazio, e nada indica qual é o problema.

---

## 2. A regra de gatilho, e por que ela é testada contra o contrato

A tela de cotação precisa mostrar ao produtor o que aciona e o que não aciona o pagamento
**antes de existir qualquer contrato implantado** — não há o que consultar. Então a regra está
reimplementada em JavaScript, em `app/src/cadeia/regraDeGatilho.js`.

Reimplementar uma regra é um risco conhecido: as duas cópias divergem com o tempo. E aqui a
divergência seria grave, porque o produtor aceitaria a apólice com base num número que o
contrato não vai honrar — o oposto do que o RNF06 pretende.

Duas coisas impedem isso:

1. **Depois que a apólice existe**, a tela usa `simularPercentual` do próprio contrato. A regra
   em JavaScript só entra na cotação.

2. **`contratos/test/RegraDeGatilho.test.js`** importa o arquivo do aplicativo e compara a saída
   dele com a do contrato, caso a caso: cinco configurações de apólice × 13 valores de índice
   climático × 11 de índice de dano, em torno dos limiares onde a divergência apareceria. Mexer
   em um dos lados sem mexer no outro quebra a suíte.

```
cd contratos && npx hardhat test test/RegraDeGatilho.test.js
```

---

## 3. As telas

### Entrar — RF01, HU13

Login com identificador e senha, três perfis. Mostra também, antes de o usuário entrar, se não
houver contrato implantado na rede configurada — evita que alguém entre e encontre telas vazias
sem entender por quê.

### Produtor · Minhas apólices — UC06

Lista vinda de `apolicesDoProdutor(endereco)`, na cadeia. Exige carteira conectada porque é o
endereço dela que identifica o produtor. Mostra também quantas propostas ainda aguardam emissão.

### Produtor · Simular e contratar — RF06, RNF06, HU10

O coração da tela é a tabela de exemplos numéricos:

| Dias seguidos sem chuva | Aciona? | Percentual | Você recebe |
|---|---|---|---|
| 20 dias | Não | 0% | 0 ETH |
| 29 dias | Não | 0% | 0 ETH |
| 30 dias | Sim | 50% | 0,54 ETH |
| 45 dias | Sim | 75% | 0,81 ETH |
| 60 dias | Sim | 100% | 1,08 ETH |

Os pontos escolhidos são deliberados: um pouco abaixo do gatilho, exatamente no gatilho, e dois
acima — porque é no limite que o produtor costuma se surpreender depois.

A condição também aparece em uma frase, sem jargão: *"Se o talhão passar 30 dias seguidos sem
chuva, o contrato paga metade do limite, e o valor cresce até o limite integral quando a
estiagem chega a 60 dias."*

**A conta do dinheiro é feita em BigInt, sobre wei.** Ver a seção 5.

### Produtor · Minha carteira — RF02, HU07

Vincula a carteira ao cadastro por assinatura de mensagem. O aplicativo monta um desafio com um
número único, a carteira assina, e a assinatura é conferida recuperando o endereço que a
produziu. A chave privada nunca sai da carteira (RNF17).

O número único impede que uma assinatura capturada de uma sessão anterior seja reapresentada
como nova.

### Seguradora · Carteira — RF15, UC15

Indicadores calculados sobre o que está na cadeia: apólices emitidas, exposição atual (soma das
garantias retidas), indenizações pagas e taxa de acionamento. A seguradora vê exatamente o mesmo
que o produtor e a fiscalização veriam.

### Seguradora · Propostas — RF07, UC05

**É aqui que o contrato nasce.** A transação é assinada pela carteira da seguradora, porque
`emitirApolice` é restrita a ela.

O fluxo tem duas transações, de propósito: emitir e depois depositar a garantia. Poderiam ser
uma só, mas então a fábrica precisaria custodiar valor, e o endereço pagador deixaria de ser o da
seguradora.

O endereço da apólice recém-implantada é lido do evento `ApoliceEmitida` — uma transação não
devolve valor de retorno ao cliente.

A tela também confere se a carteira conectada é mesmo a seguradora da fábrica, e explica que
qualquer outro endereço teria a transação revertida com `NaoEhSeguradora`.

### Seguradora · Talhões e produtos — RF03, RF05, UC02, UC03

Polígono em GeoJSON, **área calculada a partir dele** e não digitada: área informada à mão é área
que diverge do que foi delimitado, e o limite da apólice sai dessa conta. Polígono com
autointerseção é recusado (critério de aceite 3 da HU09).

As validações de produto espelham as do construtor do contrato — melhor recusar aqui do que
gastar gas para descobrir na emissão.

### Seguradora · Oráculos — RF18, UC10, HU02

A tela mais sensível do aplicativo. Autorizar um endereço dá a ele o poder de acionar o pagamento
de **todas** as apólices da carteira.

A lista é montada dos eventos `OraculoAutorizado` e conferida contra o estado atual do contrato:
o evento diz quem já foi autorizado algum dia, só o estado diz quem ainda pode publicar.

### Apólice · Detalhe — UC06, RF09, RF16

Termos contratados, índices publicados e a **linha do tempo reconstruída dos eventos da rede** —
não de um banco de dados. É o que permite a qualquer parte auditar a decisão de pagamento, sem
depender da palavra da seguradora.

A tela escuta os eventos ao vivo. Durante a demonstração, o oráculo publica em outro terminal e a
linha do tempo cresce sozinha, sem recarregar.

O RF09 constava como item de reserva (HU12). Com os eventos já emitidos pelos contratos, montar a
linha do tempo custou pouco e entrega a parte do RNF20 que é visível ao usuário.

### Perito · Revisão técnica

O perito atua por exceção. A tela reúne as publicações que trazem inferência de imagem com
confiança abaixo do limiar. O caminho preferido é outro: o serviço de oráculo já suspende a
publicação do índice de dano nesses casos, antes de gastar gas (RF17).

---

## 4. As duas peças provisórias

Estão marcadas na própria interface, e não só na documentação. Alguém — inclusive a banca —
poderia concluir que já está pronto o que ainda não está.

### Login e senhas

Em `app/src/sessao/usuarios.js`, em texto claro.

O RNF24 exige hash com sal (bcrypt ou Argon2). Nada disso pode ser feito de forma honesta apenas
no navegador: qualquer verificação que rode no cliente pode ser contornada. **Um esquema de hash
no front-end daria aparência de segurança sem nenhuma segurança, o que é pior do que a ausência
declarada.**

Isso não afeta a parte em cadeia: quem pode publicar índice e quem pode mover valor é decidido
pelo contrato, por endereço, e não por este login.

### Talhões, produtos e propostas

No `localStorage`. Consequências que precisam ficar explícitas:

- o dado existe apenas naquele navegador, naquela máquina;
- produtor e seguradora em computadores diferentes não veem a mesma proposta;
- limpar os dados do navegador apaga tudo.

Para a demonstração, basta sair de um perfil e entrar no outro no mesmo navegador.

O que **não** vive ali: a apólice, os índices e o pagamento. A fronteira do projeto continua
onde deveria.

---

## 5. Decisões que valem registro

### Dinheiro em BigInt, nunca em ponto flutuante

A primeira versão calculava o limite assim:

```js
const limiteEth = area * produto.valorPorHectareEth;   // 180 × 0,006
ethers.parseEther(limiteEth.toFixed(18));
```

Resultado gravado no contrato: **1080000000000000071 wei**, quando o correto é
1080000000000000000. Em binário, `180 × 0,006` dá 1,0800000000000000710.

São 71 wei — frações de centavo. Mas é um valor contratual que não fecha com o documento, e uma
vez implantado não há como corrigir. A conta passou a ser feita inteiramente em BigInt, sobre
wei, com a área convertida para centésimos de hectare para admitir fração sem sair dos inteiros.

### A tela espelha exatamente o que o contrato aceita

O botão de resgate da garantia só aparece nas situações em que `resgatarGarantia` não reverteria.
Oferecer um botão que o contrato recusaria é pior do que não oferecer nenhum: o usuário assina,
paga o gas e recebe um erro.

### Erros do contrato traduzidos

`mensagemDeErro` converte os erros customizados em frases úteis. Sem isso, a tela mostraria ao
produtor coisas como `execution reverted (unknown custom error)`.

### Carteira simulada, restrita ao desenvolvimento

`app/src/cadeia/carteiraSimulada.js` implementa a interface EIP-1193 e encaminha tudo para o nó
local, aproveitando que as contas do `hardhat node` estão destravadas. Serve para que os
integrantes que não mexem com contratos possam trabalhar na interface sem instalar a MetaMask.

Três condições simultâneas para ativar: modo de desenvolvimento, rede local e `?carteira=simulada`
no endereço. O `npm run build` remove o caminho inteiro do pacote. Enquanto está ativo, uma faixa
de aviso fica visível — uma demonstração em que a assinatura é simulada, sem ninguém perceber,
seria pior do que não ter demonstração.

---

## 6. O que foi verificado

O fluxo abaixo foi executado de ponta a ponta contra um nó local, pela interface:

1. Login como produtor, carteira conectada e vinculada por assinatura.
2. Cotação de 180 ha de soja: limite de 1,08 ETH, prêmio de 0,04104 ETH, tabela de exemplos.
3. Proposta enviada.
4. Login como seguradora, apólice **implantada na rede** (gas 1.516.953) e garantia depositada.
5. Serviço de oráculo publicando os índices 28 → 29 → **30**, com pagamento na terceira.
6. Linha do tempo crescendo **sozinha na tela**, sem recarregar, até 10 eventos.
7. Modo escalonado pagando 0,54 ETH de 1,08, e a seguradora resgatando a sobra.
8. Polígono com autointerseção recusado; área calculada a partir do polígono válido.

Dois defeitos foram encontrados nesse percurso e corrigidos. Estão em
[DECISOES.md](DECISOES.md), seções 2.8 e 2.9.
