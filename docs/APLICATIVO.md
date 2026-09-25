# Aplicativo

Referência do front-end: como ele conversa com os contratos, o que cada tela faz e quais
decisões foram tomadas.

Código em [`app/src/`](../app/src).

---

## 1. Como o aplicativo fala com o backend e com a cadeia

O aplicativo tem **dois interlocutores**, e a divisão entre eles segue a fronteira do projeto:

| Com o backend (`src/api/cliente.js`) | Direto com a cadeia (`src/cadeia/`) |
|---|---|
| login, segundo fator, sessão | emitir apólice e depositar garantia (carteira da seguradora) |
| talhões, produtos, fontes, propostas | estado da apólice, índices publicados |
| cotação, texto dos termos | linha do tempo, reconstruída dos eventos |
| notificações, relatórios, revisão do perito | autorizar e revogar oráculos |

Tudo que move valor é assinado pela carteira no navegador; o backend nunca recebe chave nenhuma.
E tudo que decide pagamento é lido da rede, não do banco — o backend pode estar fora do ar e a
tela da apólice continua mostrando a verdade.

O cliente HTTP guarda o token de sessão no `sessionStorage` (some ao fechar a aba) e, quando o
servidor responde 401, avisa a aplicação para voltar ao login. Em desenvolvimento, o Vite
repassa `/api` para `http://localhost:3001`.

Na cadeia, o aplicativo fala por dois caminhos que existem de propósito separados:

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

Login com identificador e senha, três perfis, conferidos pelo backend (bcrypt). Se o usuário
ativou o segundo fator, a tela pede o código do aplicativo autenticador em seguida. Os usuários
de demonstração só aparecem na tela em modo de desenvolvimento. Mostra também, antes de o usuário entrar, se não
houver contrato implantado na rede configurada — evita que alguém entre e encontre telas vazias
sem entender por quê.

### Produtor · Minhas apólices — UC06

Lista vinda do backend (espelho mantido pelo indexador), com as propostas ainda em andamento.
Cada apólice leva à tela de detalhe, que lê tudo da cadeia.

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

### Produtor · Fotos da lavoura — RF14, RF16, HU11

O produtor fotografa o talhão, e as fotos seguem para o módulo de visão, que estima quanto da
lavoura foi afetado pela seca ([VISAO.md](VISAO.md)).

**Onde cada foto foi tirada.** O aplicativo lê o GPS gravado na própria foto (EXIF), no
navegador, antes de enviar, e mostra cada ponto num mapa do talhão desenhado em SVG — sem
biblioteca de mapas, que traria tiles, chave de API e dependência de rede para desenhar um
polígono e alguns pontos. A foto que cai fora aparece em vermelho, e o produtor pode descartá-la
antes de gastar a conexão, que no campo costuma ser ruim.

Foto sem GPS — encaminhada por aplicativo de mensagem, por exemplo, que apaga o EXIF — pode ser
localizada pela posição atual do aparelho ou marcando o ponto no mapa. As três origens são
enviadas ao servidor e **ficam registradas**:

| Origem | O que prova |
|---|---|
| GPS da foto | onde a foto foi **tirada** |
| localização do aparelho | onde a foto foi **enviada** — vale se a pessoa estiver no talhão |
| marcada no mapa | nada; é a mais fácil de forjar |

Nenhuma é recusada, porque uma foto sem GPS continua sendo evidência. Mas a lista de lotes e a
tela do perito mostram quantas fotos de cada lote tiveram o local marcado à mão (DECISOES.md 1.14).

A conferência de "dentro do talhão" no navegador é só uma prévia. **Quem decide é o servidor**,
com o PostGIS: uma conta no navegador pode ser adulterada por quem controla o navegador.

**O lote.** As fotos vão em lotes. Ao fechar, o servidor calcula o resumo criptográfico do
conjunto — o valor que vai para a blockchain com o índice de dano (RF16) — e o lote não aceita
mais nada. Por isso fechar pede confirmação: acrescentar uma foto depois mudaria o conjunto que o
resumo registrado descreve.

**No celular**, "Tirar foto" abre direto a câmera e "Escolher fotos" abre a galeria.

Para testar e demonstrar, há fotos com GPS em
[`docs/demonstracao/fotos/`](demonstracao/fotos/LEIAME.md): seis dentro do talhão-01, uma fora e
uma sem GPS. As imagens são recortes reais da base de referência; as coordenadas foram
inventadas para cair no talhão, e isso está escrito no nome dos arquivos e no LEIAME.

### Produtor · Minha carteira — RF02, HU07

Vincula a carteira ao cadastro por assinatura de mensagem. O **backend** gera o desafio com um
número único e prazo de cinco minutos, a carteira assina, e o backend confere que o endereço que
produziu a assinatura é o mesmo que o produtor declarou (ver [DECISOES.md §2.11](DECISOES.md)). A chave privada nunca sai da carteira (RNF17).

O número único impede que uma assinatura capturada de uma sessão anterior seja reapresentada
como nova.

### Seguradora · Carteira — RF15, UC15

Indicadores do relatório do backend: apólices emitidas, exposição atual (soma das garantias
retidas), prêmios, indenizações pagas, taxa de acionamento, e o custo em gas e a latência das
publicações do oráculo (RF15, RNF09). Mostra também a saúde do backend e do indexador. A seguradora vê exatamente o mesmo
que o produtor e a fiscalização veriam.

### Seguradora · Propostas — RF07, UC05

**É aqui que o contrato nasce.** A transação é assinada pela carteira da seguradora, porque
`emitirApolice` é restrita a ela.

O fluxo tem duas transações, de propósito: emitir e depois depositar a garantia. Poderiam ser
uma só, mas então a fábrica precisaria custodiar valor, e o endereço pagador deixaria de ser o da
seguradora.

O fluxo completo: o backend **prepara** a proposta (texto canônico dos termos e resumo keccak),
a carteira da seguradora assina `emitirApolice` com esses termos, e o aplicativo envia o hash
da transação ao backend. O backend não acredita na palavra do aplicativo: busca o recibo na rede
e confere se veio da fábrica oficial, com o mesmo resumo, o mesmo produtor e o mesmo valor.

A tela também confere se a carteira conectada é mesmo a seguradora da fábrica, e explica que
qualquer outro endereço teria a transação revertida com `NaoEhSeguradora`.

### Seguradora · Talhões e produtos — RF03, RF05, UC02, UC03

Polígono em GeoJSON, validado pelo PostGIS (`ST_IsValid`) e com **área calculada sobre o
elipsoide** a partir dele, não digitada: área informada à mão é área
que diverge do que foi delimitado, e o limite da apólice sai dessa conta. Polígono com
autointerseção é recusado (critério de aceite 3 da HU09).

As validações de produto espelham as do construtor do contrato — melhor recusar aqui do que
gastar gas para descobrir na emissão.

### Seguradora · Oráculos — RF18, UC10, HU02

A tela mais sensível do aplicativo. Autorizar um endereço dá a ele o poder de acionar o pagamento
de **todas** as apólices da carteira.

A lista é montada dos eventos `OraculoAutorizado` e conferida contra o estado atual do contrato:
o evento diz quem já foi autorizado algum dia, só o estado diz quem ainda pode publicar.

### Seguradora · Fontes — RF11, RF13, RNF19

Estações e sensores cadastrados, cada um com o endereço da chave que assina seus lotes e o escore
de reputação atualizado a cada lote recebido. A seguradora pode desativar uma fonte suspeita.

### Apólice · Detalhe — UC06, RF08, RF09, RF16

Termos contratados, índices publicados e a **linha do tempo reconstruída dos eventos da rede** —
não de um banco de dados. É o que permite a qualquer parte auditar a decisão de pagamento, sem
depender da palavra da seguradora.

**Conferência dos termos (RF08).** O texto dos termos vem do backend, mas o resumo não: é
recalculado no navegador com keccak256 e comparado ao `hashTermos` gravado no contrato. Se o
texto guardado tivesse sido alterado depois da emissão, a tela mostraria a divergência. A prova
não depende de confiar em quem guarda o documento.

Ao lado de cada índice publicado aparece a **procedência** relatada pelo oráculo: quantas fontes
foram usadas ou descartadas, o gas e a latência.

A tela escuta os eventos ao vivo. Durante a demonstração, o oráculo publica em outro terminal e a
linha do tempo cresce sozinha, sem recarregar.

O RF09 constava como item de reserva (HU12). Com os eventos já emitidos pelos contratos, montar a
linha do tempo custou pouco e entrega a parte do RNF20 que é visível ao usuário.

### Perito · Revisão técnica

O perito atua por exceção (RF17). Quando o módulo de visão devolve uma análise com confiança
abaixo do limiar, o backend a retém e ela aparece aqui. O perito escreve um parecer e decide:
**liberar** (o índice segue ao oráculo, que não reaplica o limiar) ou **rejeitar** (o índice de
dano fica retido; o climático segue normalmente). A decisão fica gravada com autor e parecer.

### Avisos — RF27

Notificações geradas pelo indexador a partir dos eventos da cadeia (emissão, garantia,
pagamento) e pelo oráculo quando uma publicação falha de vez. Cada aviso traz a transação que o
originou. O cabeçalho mostra o número de não lidos.

### Minha conta — RF01

Configuração do segundo fator: o backend gera o segredo, a tela mostra o código QR, e o segundo
fator só é ligado depois de o usuário digitar um código válido. Desligar também exige o código.

---

## 4. As peças provisórias, substituídas

A primeira versão do aplicativo tinha duas peças provisórias, marcadas na própria interface:
login com senhas em texto claro no código e cadastro guardado no `localStorage`. As duas foram
substituídas pelo backend:

| Antes | Agora |
|---|---|
| senhas em `usuarios.js`, conferidas no navegador | bcrypt no servidor, sessão com expiração, segundo fator opcional |
| talhões, produtos e propostas no `localStorage` | PostgreSQL + PostGIS, visíveis para produtor e seguradora em qualquer máquina |
| desafio de carteira gerado no navegador | desafio gerado e consumido pelo servidor |
| área do talhão por aproximação plana | área geodésica pelo PostGIS (7% de diferença; DECISOES §2.12) |

O que continua como ferramenta de desenvolvimento é a **carteira simulada**, descrita na seção 5.

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

Depois da integração com o backend, o percurso foi refeito (22/09/2026) com login, vínculo,
proposta e emissão passando pela API, leituras assinadas entrando pela ingestão e o oráculo em
modo `servico`. A tela da apólice mostrou a conferência dos termos batendo com o contrato e a
procedência de cada índice. Detalhes em [BACKEND.md §9](BACKEND.md).
