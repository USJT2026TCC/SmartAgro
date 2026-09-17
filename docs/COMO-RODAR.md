# Como rodar

Passo a passo, da instalação à demonstração. Testado em Windows 11 com Node.js 24.19 e Git 2.55.

---

## 1. Ferramentas

Você precisa de **Git** e **Node.js 20 ou superior**.

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

## 3. Rodar os testes

Os testes não precisam de rede nem de configuração.

```bash
cd contratos && npx hardhat test
```

Esperado: **81 passing**.

```bash
cd oraculo && npm test
```

Esperado: **56 testes, 0 falhas**.

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
| `nonce has already been used` | Versão antiga, anterior ao `NonceManager` | Atualize o repositório |

---

## 9. Regras de trabalho da equipe

- Ninguém commita direto na branch principal. Sempre branch própria e pull request.
- Todo pull request precisa da revisão de pelo menos uma outra pessoa.
- Uma tarefa só está pronta quando: o código está na principal, tem teste, e outra pessoa
  conseguiu rodar na máquina dela.
- Chave privada e senha **nunca** entram no repositório. Só no `.env` local.
