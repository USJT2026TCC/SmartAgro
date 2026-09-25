# Como rodar

Passo a passo, da instalação à demonstração. Testado em Windows 11 com Node.js 24.19 e Git 2.55.

---

## 1. Ferramentas

Você precisa de **Git** e **Node.js 20 ou superior**. Para o simulador de estações, também
**Python 3.10 ou superior**.

Conferir o que já está instalado:

```bash
git --version
node --version
npm --version
```

No Windows, se algum não estiver instalado:

```bash
winget install --id Git.Git -e --source winget
```

```bash
winget install --id OpenJS.NodeJS.LTS -e --source winget
```

```bash
winget install --id Python.Python.3.12 -e --source winget
```

Depois de instalar, **feche e abra o terminal** — o `PATH` só é atualizado em sessões novas.

## 2. Clonar e instalar

```bash
git clone https://github.com/USJT2026TCC/SmartAgro.git
```

```bash
cd SmartAgro/contratos && npm install
```

```bash
cd ../oraculo && npm install
```

```bash
cd ../app && npm install
```

```bash
cd ../backend && npm install
```

```bash
cd ../simulador && python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"
```

O simulador precisa de Python 3.10 ou superior. No Linux ou macOS, `.venv/bin/python`.

O backend não exige instalar banco: sem `DATABASE_URL`, usa o PGlite, que é o próprio
PostgreSQL com PostGIS rodando dentro do processo.

## 3. Rodar os testes

Os testes não precisam de rede nem de configuração.

```bash
cd contratos && npx hardhat test
```

Esperado: **94 passing**.

```bash
cd oraculo && npm run testar
```

Esperado: **65 testes, 0 falhas**.

```bash
cd backend && npm run testar
```

Esperado: **83 testes, 0 falhas** (banco em memória, cadeia simulada). O teste de integração do
indexador sobe um `hardhat node` próprio, na porta 8599:

```bash
cd backend && npm run testar:integracao
```

```bash
cd simulador && .venv/Scripts/python -m pytest
```

Esperado: **19 testes, 0 falhas**.

Cobertura dos contratos:

```bash
cd contratos && npx hardhat clean && npx hardhat coverage
```

Esperado: **100%** em statements, branches, functions e lines para os três contratos de
produção. O `npx hardhat clean` antes não é enfeite — sem ele, o `solidity-coverage` pode medir
uma compilação em cache e devolver números baixos sem motivo.

Relatório de gas:

```bash
cd contratos && npx cross-env REPORT_GAS=true npx hardhat test
```

---

## 4. Demonstração rápida, sem configurar nada

Roda o fluxo inteiro em uma rede em memória: implanta os três contratos, emite a apólice,
deposita a garantia, publica índices crescentes de dias sem chuva e mostra o pagamento
acontecendo sozinho.

```bash
cd contratos && npx hardhat run scripts/demo-estiagem.js
```

Saída esperada, resumida:

```
[4/5] Oraculo publica os indices do periodo

      periodo    dias sem chuva   acionou   gas       transacao
      ----------------------------------------------------------------
      20261001            6     nao      189265   0x14d7007aae9ed456...
      20261002           13     nao      172165   0x9f544de7979d7552...
      20261003           21     nao      172165   0xff6beece7edbe54f...
      20261004           28     nao      172165   0x7e8c397c6019cd6b...
      20261005           33     SIM      231216   0x1026481cb7e32d84...

[5/5] Resultado
      Situacao da apolice.: LIQUIDADA
      Valor pago..........: 1.0 ETH
      Garantia restante...: 0.0 ETH
```

Esse script exercita só os contratos. Para ver o **serviço de oráculo** funcionando, siga a
seção 5.

---

## 5. Fluxo completo com o serviço de oráculo

Precisa de **dois terminais**.

### Terminal 1 — a rede local

```bash
cd contratos && npx hardhat node
```

Deixe rodando. Ele imprime vinte contas com saldo e as respectivas chaves privadas. A convenção
do projeto é:

| Conta | Papel |
|---|---|
| #0 | Seguradora |
| #1 | Produtor |
| #2 | **Oráculo** — é esta chave que você vai copiar |

> Essas chaves são públicas e conhecidas. Servem só para rede local. Nunca envie valor real
> para elas.

### Terminal 2 — implantar e emitir a apólice

```bash
cd contratos && npx hardhat run scripts/implantar.js --network localhost
```

Implanta o `OracleRegistry` e a `ApoliceFactory`, autoriza o endereço do oráculo e grava tudo em
`contratos/implantacoes/localhost.json`. Nenhum endereço precisa ser copiado à mão: o serviço de
oráculo lê esse arquivo.

```bash
cd contratos && npx hardhat run scripts/emitir-apolice.js --network localhost
```

Emite a apólice, deposita a garantia de 1 ETH e imprime, ao final, a linha pronta para colar no
`.env` do oráculo.

### Terminal 2 — configurar o oráculo

```bash
cd oraculo && copy .env.example .env
```

No Linux ou macOS, `cp .env.example .env`.

Preencha duas linhas:

```
CHAVE_PRIVADA_ORACULO=<a chave da conta #2 impressa pelo hardhat node>
ENDERECO_APOLICE=<o endereço impresso por emitir-apolice.js>
```

Confira que está tudo no lugar:

```bash
cd oraculo && node src/index.js status
```

A linha `Autorizado a publicar` precisa dizer **sim**.

### Terminal 2 — rodar o cenário

```bash
cd oraculo && node src/index.js ciclo --cenario estiagem_severa --com-falhas
```

O oráculo consolida o índice de cada período, descarta as leituras defeituosas, publica na
cadeia e para quando o pagamento acontece.

Para acompanhar os eventos em tempo real, em um terceiro terminal antes de rodar o ciclo:

```bash
cd oraculo && node src/index.js ouvir
```

E para ver os números coletados:

```bash
cd oraculo && node src/index.js estatisticas
```

---

## 5A. A demonstração completa, pelo aplicativo

Este é o roteiro de cinco minutos do capítulo 1 do manual da equipe. Precisa de **quatro
terminais** e do navegador.

### Terminal 1 — a rede local

```bash
cd contratos && npx hardhat node
```

### Terminal 2 — implantar

```bash
cd contratos && npx hardhat run scripts/implantar.js --network localhost
```

Não é preciso emitir a apólice por script: ela será contratada pelo aplicativo.

### Terminal 3 — o backend

```bash
cd backend && npm run iniciar
```

Na primeira execução, cria o banco em `backend/dados/pg/` com os usuários, talhões, produtos e
fontes de demonstração. O indexador começa a acompanhar a fábrica implantada no passo anterior.

> Se a rede local foi reiniciada, o banco guarda apólices de uma cadeia que não existe mais.
> Apague `backend/dados/pg/` para começar do zero.

### Terminal 4 — o aplicativo

```bash
cd app && npm run dev
```

Abra `http://localhost:5173`. Sem MetaMask instalada, use
`http://localhost:5173/?carteira=simulada&conta=1` — a faixa de aviso deixa claro que a carteira
é simulada, então isso serve para desenvolvimento, não para a apresentação.

### No navegador

1. **Entrar como produtor** (`produtor` / `agrosmart`). Em *Minha carteira*, conectar e assinar
   o vínculo.
2. **Simular e contratar**: escolher o talhão, o produto escalonado e conferir a tabela de
   exemplos. Enviar a proposta.
3. **Sair e entrar como seguradora** (`seguradora` / `agrosmart`), com a carteira da conta 0.
4. Em *Propostas*: **Emitir apólice na rede** e depois **Depositar garantia**. O backend confere
   a emissão na cadeia antes de registrá-la.
5. Abrir a apólice pelo link **Ver apólice** e deixar essa tela visível. O cartão *Conferência
   dos termos* deve dizer que o texto corresponde ao resumo gravado no contrato.

### Terminal 2 — as estações enviam leituras reais

Na primeira vez, baixe o ano de 2024 do INMET (~100 MB):

```bash
cd simulador && .venv/Scripts/python -m simulador baixar --ano 2024
```

Depois, as duas estações enviam a estiagem real de São Simão:

```bash
cd simulador && .venv/Scripts/python -m simulador enviar --estacao A770 --ano 2024 --de 2024-06-25 --ate 2024-08-09 --fonte estacao-inmet-a770 --ate-hoje
```

```bash
cd simulador && .venv/Scripts/python -m simulador enviar --estacao A747 --ano 2024 --de 2024-06-25 --ate 2024-08-09 --fonte estacao-inmet-a747 --ate-hoje
```

As chaves das estações de demonstração vêm do `.env` do simulador. Cada lote é assinado pela
chave da estação, e a API confere a assinatura antes de aceitar. O comando imprime o período que
deve ser passado ao oráculo — anote.

> Para uma demonstração sem baixar dado nenhum, o caminho antigo continua valendo:
> `cd backend && npm run enviar-leituras -- --cenario estiagem_severa` usa a série sintética.

### Terminal 2 — o oráculo publica

Em `oraculo/.env`, além da chave da conta 2, defina:

```
API_URL=http://localhost:3001/api
CHAVE_DE_SERVICO=desenvolvimento-apenas-nao-use-em-producao
```

```bash
cd oraculo && node src/index.js servico --uma-vez --periodo <o periodo impresso acima>
```

O oráculo pergunta ao backend quais apólices estão ativas, busca as leituras do talhão,
consolida, publica e relata o resultado. Com a estiagem real de 39 dias, o pagamento acontece na
mesma transação, e **a linha do tempo na tela cresce sozinha**, sem recarregar, até
"Indenização transferida ao produtor sem intervenção humana". O link *Avisos*, no cabeçalho, mostra as
notificações de emissão, cobertura e pagamento.

Sem `--uma-vez`, o serviço repete o ciclo a cada minuto, como rodaria em produção.

Para o roteiro antigo, que mostra o índice subindo 28 → 29 → 30 um dia de cada vez, use
`node src/index.js ciclo --cenario estiagem_severa` com `ENDERECO_APOLICE` no `.env`.

No modo escalonado, o pagamento é parcial. A seguradora pode então resgatar a sobra pelo botão
que aparece na própria apólice.


### No navegador e no Terminal 2 — as fotos e o índice de dano

1. Como **produtor**, abrir **Fotos da lavoura**, escolher o talhão-01 e **Abrir lote de fotos**.
2. **Escolher fotos** e selecionar as oito de `docs/demonstracao/fotos/`. O mapa mostra seis
   pontos dentro do talhão, um fora, em vermelho, e a foto sem GPS pede localização: use
   **Marcar no mapa** e clique dentro do talhão.
3. **Enviar**: o servidor aceita sete e recusa a de fora do talhão, com o motivo na tela.
4. **Fechar lote e mandar para análise**. A tabela mostra "aguardando análise" e o resumo das
   evidências.
5. O módulo de visão analisa, com o modelo treinado:

```bash
cd visao && .venv/Scripts/python -m visao servico --uma-vez
```

Com `VISAO_PESOS=pesos/unet.pt` no `visao/.env`. Recarregando a tela, o lote mostra o dano
estimado — ou "com o perito", se a confiança ficou abaixo de 70%.

---

## 6. Verificar o comportamento sob falha (RF21)

Essa é uma das quatro medidas experimentais previstas no manual da equipe.

Com a rede local rodando e a apólice ativa, use um endpoint que não existe:

```bash
cd oraculo && node src/index.js publicar --periodo 20261020 --cenario estiagem_moderada
```

Antes, no `.env`, troque `RPC_URL` para `http://127.0.0.1:9999`. O serviço consolida o índice,
grava na fila e falha nas tentativas, registrando `ECONNREFUSED`.

Confira que o índice **não se perdeu**:

```bash
cd oraculo && node src/index.js fila
```

Devolva o `RPC_URL` ao valor correto, reabra a entrada e publique de novo:

```bash
cd oraculo && node src/index.js fila --reabrir <a chave mostrada acima>
```

```bash
cd oraculo && node src/index.js publicar --periodo 20261020 --cenario estiagem_moderada
```

A mensagem `Entrada ja existia na fila; retomando em vez de duplicar` confirma que o período de
referência original foi preservado.

---

## 7. Rede de teste pública (Sepolia)

### 7.1 Carteira

1. Instale a extensão **MetaMask** no navegador.
2. Crie uma carteira **nova** — não use nenhuma que já tenha valor real.
3. Troque a rede para **Sepolia**.
4. Pegue gas gratuito em um faucet de Sepolia. Cada integrante pega o seu.

Você vai precisar de três endereços distintos: seguradora, produtor e oráculo.

### 7.2 Configurar

```bash
cd contratos && copy .env.example .env
```

Preencha `RPC_SEPOLIA` (Infura, Alchemy ou outro provedor), `CHAVE_PRIVADA_SEGURADORA`,
`CHAVE_PRIVADA_ORACULO` e, opcionalmente, `ETHERSCAN_API_KEY`.

### 7.3 Implantar

```bash
cd contratos && npx hardhat run scripts/implantar.js --network sepolia
```

```bash
cd contratos && npx hardhat run scripts/emitir-apolice.js --network sepolia
```

### 7.4 Rodar o oráculo contra a Sepolia

No `oraculo/.env`:

```
REDE=sepolia
RPC_URL=<o mesmo endpoint usado em RPC_SEPOLIA>
CONFIRMACOES=2
```

`CONFIRMACOES=2` reduz o risco de uma reorganização de bloco desfazer uma publicação que o
serviço já deu por concluída. Em rede local, 1 basta.

```bash
cd oraculo && node src/index.js status
```

```bash
cd oraculo && node src/index.js ciclo --cenario estiagem_severa
```

Copie o identificador da transação de pagamento e cole em `https://sepolia.etherscan.io`. É esse
o momento da demonstração para a banca: o pagamento aconteceu de verdade, em uma rede pública,
e qualquer pessoa pode conferir sem depender da palavra de ninguém.

---

## 8. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `git`/`node` não reconhecido logo após instalar | O `PATH` do terminal é antigo | Feche e abra o terminal |
| `Implantacao nao encontrada` | O script de implantação não rodou nessa rede | Rode `implantar.js --network <rede>` |
| `Autorizado a publicar: NAO` | A chave do `.env` não é a do endereço autorizado | Confira que é a conta #2, ou autorize o endereço no registro |
| `SituacaoInvalida(2, 1)` ao publicar | A apólice já foi liquidada | Emita uma apólice nova com `emitir-apolice.js` |
| `PeriodoJaPublicado` | Esse período já entrou na cadeia | Use outro `--periodo`; é o RF20 funcionando |
| Cobertura com números baixos sem motivo | Cache do `solidity-coverage` | `npx hardhat clean` antes de `npx hardhat coverage` |
| O comando termina de imprimir e não devolve o terminal | Versão antiga, anterior ao `provider.destroy()` | Atualize o repositório |
| O aplicativo abre, mas nenhuma apólice aparece | Os endereços no app estão desatualizados | Rode `npm run enderecos` em `app` depois de reimplantar |
| `Nenhum contrato implantado nesta rede` na tela de login | O script de implantação não rodou | Rode `implantar.js` e depois `npm run enderecos` |
| Botão de emitir desabilitado | A carteira conectada não é a da seguradora | Troque para a conta 0 do `hardhat node` |
| `nonce has already been used` | Versão antiga, anterior ao `NonceManager` | Atualize o repositório |

---

## 9. Regras de trabalho da equipe

- Ninguém commita direto na branch principal. Sempre branch própria e pull request.
- Todo pull request precisa da revisão de pelo menos uma outra pessoa.
- Uma tarefa só está pronta quando: o código está na principal, tem teste, e outra pessoa
  conseguiu rodar na máquina dela.
- Chave privada e senha **nunca** entram no repositório. Só no `.env` local.
