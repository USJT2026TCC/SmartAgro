# Backend

API do AgroSmart: Node.js + Express 5, sobre PostgreSQL com PostGIS. Código em
[`backend/`](../backend).

Este documento explica **o que o backend faz, o que ele deliberadamente não faz** e por quê. A
referência de comandos está no [README do módulo](../backend/README.md).

---

## 1. O papel do backend na arquitetura

O backend fica inteiro **fora da cadeia**. Ele guarda o que a blockchain não deve guardar:
cadastro, geometria, leituras brutas, imagens, sessões e o texto dos termos. Também serve de
ponto de encontro entre as peças fora da cadeia: aplicativo, estações, oráculo e visão.

```
   estações / simulador ──(lote assinado)──►┐
   módulo de visão ─────(chave de serviço)─►│
                                            │   BACKEND   ◄──(sessão)── aplicativo
   oráculo ◄──────(chave de serviço)────────┤  (Postgres
                                            │  + PostGIS)
                              indexador ◄───┘
                                  ▲
                                  │ lê eventos
   ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~│~ ~ ~ ~ ~ ~ ~ ~  FRONTEIRA  ~ ~ ~ ~ ~ ~ ~ ~ ~
                                  │
                   contratos (apólice, registro, fábrica)
```

Três regras orientam o desenho:

1. **O backend não tem chave privada de ninguém.** Quem emite a apólice é a carteira da
   seguradora; quem publica índices é o oráculo; quem assina lotes de leitura é a fonte. O
   backend só confere assinaturas. Um servidor invadido não consegue emitir apólice nem mover
   valor.
2. **A cadeia é a autoridade, o banco é espelho.** Situação da apólice, valor pago e publicações
   estão no banco para consulta rápida, mas são atualizados pelo indexador a partir dos eventos.
   Onde uma decisão depende do estado (emissão, por exemplo), o backend relê o contrato.
3. **Tudo que atravessa a fronteira pode ser conferido sem confiar no backend.** O resumo dos
   termos é recalculado no navegador; a linha do tempo da apólice é lida da rede, não do banco.

## 2. Banco de dados

### PGlite em desenvolvimento, PostgreSQL em produção

Sem `DATABASE_URL`, o backend usa o **PGlite**: o próprio PostgreSQL compilado para
WebAssembly, rodando dentro do processo Node, com a extensão **PostGIS 3.6** de verdade. Os
dados ficam em `backend/dados/pg/` (fora do git).

Com `DATABASE_URL`, o backend conecta a um PostgreSQL comum pelo driver `pg`. **O SQL é o mesmo
nos dois motores.** A camada de conexão (`src/banco/conexao.js`) só normaliza pequenas
diferenças de retorno, como o nome do campo de linhas afetadas.

Consequência prática: ninguém da equipe precisa instalar banco para rodar o projeto, e a banca
vê o PostGIS funcionando, não uma imitação dele.

### Tabelas

A migração [`001_inicial.sql`](../backend/src/banco/migracoes/001_inicial.sql) cria:

| Grupo | Tabelas | Observação |
|---|---|---|
| Identidade | `usuarios`, `sessoes`, `desafios_carteira`, `auditoria` | senha em bcrypt; segredo TOTP cifrado; sessão guardada como SHA-256 do token |
| Cadastro | `propriedades`, `talhoes`, `produtos` | talhão com `geometry(Polygon, 4326)` e `CHECK (ST_IsValid)` |
| Contratação | `propostas`, `apolices` | proposta guarda o texto canônico dos termos e o resumo |
| Cadeia | `eventos_cadeia`, `estado_indexador` | `UNIQUE (tx_hash, indice_log)`: reprocessar não duplica |
| Dados de campo | `fontes`, `lotes_de_leitura`, `leituras` | `UNIQUE (fonte_id, instante)`: reenvio não duplica |
| Visão | `lotes_de_imagens`, `imagens`, `analises_de_imagem` | decisão do perito com autor e parecer |
| Oráculo | `publicacoes_oraculo` | gas, latência e procedência de cada índice |
| Avisos | `notificacoes` | `UNIQUE (usuario_id, tipo, tx_hash)` |

As restrições dos produtos (limiares, prazos, percentuais) **espelham as do construtor do
contrato**. Um produto que o contrato recusaria nem chega a ser gravado.

Valores em wei usam `numeric(78,0)`, que cabe um `uint256` inteiro. Trafegam como string no
JSON e são tratados com `BigInt` no código: nenhum valor monetário passa por ponto flutuante.

## 3. Segurança

| Mecanismo | Onde | Requisito |
|---|---|---|
| Senha com bcrypt (custo 12) e comparação com hash fictício para usuário inexistente | `seguranca/cripto.js` | RF01, RNF15 |
| Segundo fator TOTP opcional, ativado só após o primeiro código válido | `rotas/autenticacao.js` | RF01 |
| Segredo TOTP cifrado em repouso (AES-256-GCM) | `seguranca/cripto.js` | RNF16 |
| Token de sessão opaco; o banco guarda só o SHA-256; expira em 8 h | `seguranca/sessoes.js` | RNF15 |
| Perfis produtor, seguradora e perito, conferidos em cada rota | `exigirPerfil` | RF04 |
| Limite de tentativas no login e na ingestão | `express-rate-limit` | RNF15 |
| Chave de serviço para oráculo e visão, comparada em tempo constante | `exigirServico` | RNF19 |
| Lotes de leitura assinados pela chave da fonte | `dominio/assinaturaDeLote.js` | RNF19 |
| Trilha de auditoria de ações sensíveis | tabela `auditoria` | RNF20 |

Em produção (`NODE_ENV=producao`), o backend **recusa subir** sem `CHAVE_DE_SERVICO` e
`SEGREDO_DE_CIFRA` definidos. Os valores padrão de desenvolvimento nunca vão para produção por
descuido.

### Vínculo de carteira (RF02)

O produtor prova que controla a carteira assinando uma mensagem, sem gastar gas:

1. o servidor gera um desafio com número único e prazo de cinco minutos;
2. a carteira assina (EIP-191);
3. o produtor envia desafio, assinatura **e o endereço que declara possuir**;
4. o servidor recupera o endereço da assinatura e exige que seja igual ao declarado;
5. o desafio é consumido de forma atômica e não serve duas vezes.

O passo 3 corrige um defeito real, descrito em [DECISOES.md §2.11](DECISOES.md).

## 4. Rotas

Todas sob `/api`. Formato de erro único: `{ "erro": { "codigo", "mensagem" } }`.

### Sessão e conta

| Método e caminho | Quem | O que faz |
|---|---|---|
| `POST /autenticacao/entrar` | público | senha → token (ou token parcial, se houver segundo fator) |
| `POST /autenticacao/segundo-fator` | sessão parcial | código TOTP → sessão completa |
| `POST /autenticacao/sair` · `GET /autenticacao/eu` | sessão | encerra / identifica |
| `POST /autenticacao/totp/{iniciar,ativar,desativar}` | sessão | configura o segundo fator |
| `POST /carteira/desafio` · `POST /carteira/vincular` · `DELETE /carteira` | produtor | vínculo de carteira |

### Cadastro

| Método e caminho | Quem | O que faz |
|---|---|---|
| `GET /produtores` | seguradora | produtores e carteiras vinculadas |
| `GET/POST/DELETE /talhoes` | leitura: todos; escrita: seguradora | polígono validado e área geodésica pelo PostGIS |
| `GET/POST/DELETE /produtos` | leitura: todos; escrita: seguradora | produtos de seguro com as restrições do contrato |
| `GET/POST/PATCH /fontes` | seguradora (leitura também perito) | estações e sensores, com endereço da chave e escore |

### Contratação e apólices

| Método e caminho | Quem | O que faz |
|---|---|---|
| `POST /cotacoes` | produtor | prêmio e limite, calculados em `BigInt` |
| `POST /propostas` · `GET /propostas` | produtor cria; ambos listam | proposta com área declarada |
| `POST /propostas/:id/preparar` | seguradora | gera o texto canônico, o resumo keccak e a struct pronta para `emitirApolice` |
| `POST /propostas/:id/emissao` | seguradora | recebe o `txHash` e **confere na cadeia**: recibo da fábrica oficial, resumo, produtor e valor |
| `POST /propostas/:id/recusar` | seguradora | recusa com motivo |
| `GET /apolices` · `GET /apolices/:endereco` | participantes | espelho, texto dos termos para conferência, linha do tempo e publicações |

### Dados de campo e visão

| Método e caminho | Quem | O que faz |
|---|---|---|
| `POST /leituras` | fonte (assinatura) | ingestão de lote assinado |
| `GET /leituras` | seguradora, perito | consulta por talhão |
| `POST /talhoes/:id/lotes` · `POST /lotes/:id/imagens` · `POST /lotes/:id/fechar` | produtor, seguradora | upload de imagens; confere formato real do arquivo e se a coordenada cai **dentro** do talhão (`ST_Contains`); grava de onde veio a coordenada (`origemDaLocalizacao`: `exif`, `dispositivo` ou `manual`); fechar calcula o resumo das evidências |
| `GET /visao/pendentes` | serviço de visão | lotes fechados ainda sem análise, com as imagens |
| `GET /visao/imagens/:id/arquivo` | serviço de visão | o arquivo, conferido contra o sha256 registrado antes de ser entregue |
| `POST /visao/resultados` | serviço de visão | índice de dano e confiança; abaixo de 70% vai para o perito |
| `GET /perito/analises` · `POST /perito/analises/:id/parecer` | perito | libera ou rejeita, com parecer obrigatório |

### Oráculo (chave de serviço)

| Método e caminho | O que faz |
|---|---|
| `GET /oraculo/apolices-ativas` | apólices que podem receber publicação, com talhão e fontes |
| `GET /oraculo/leituras` | leituras válidas do talhão, no formato do consolidador do oráculo |
| `GET /oraculo/visao` | análise mais recente, com a indicação `liberadaPeloPerito` |
| `POST /oraculo/publicacoes` · `POST /oraculo/falhas` | relato de publicação (gas, latência, procedência) e de falha definitiva |

### Acompanhamento

| Método e caminho | Quem | O que faz |
|---|---|---|
| `GET /notificacoes` · `POST /notificacoes/:id/lida` · `POST /notificacoes/lidas` | sessão | avisos gerados pelos eventos da cadeia (RF27) |
| `GET /relatorios/carteira` | seguradora | exposição, prêmios, pagamentos, gas e latência (RF15) |
| `GET /auditoria` | seguradora | trilha de auditoria |
| `GET /saude` | público | banco, cadeia e indexador |

## 5. Contrato de ingestão — para o simulador (HU04)

Esta seção é a **especificação que o simulador em Python precisa seguir**. Já existem duas implementações: o simulador em Python ([`simulador/`](../simulador), que envia
dados reais do INMET) e o script
[`backend/scripts/enviar-leituras.js`](../backend/scripts/enviar-leituras.js), que envia a série
sintética.

Corpo (`POST /api/leituras`, `Content-Type: application/json`):

```json
{
  "lote": "uuid v4 novo a cada envio",
  "fonte": "estacao-inmet-a770",
  "enviadoEm": "2026-09-22T12:00:00Z",
  "leituras": [
    { "instante": "2026-09-21T00:00:00Z", "chuvaMm": 0, "temperaturaC": 31.2, "umidadePct": 38 }
  ]
}
```

Cabeçalho `X-Assinatura`: assinatura EIP-191 (`personal_sign`) da mensagem

```
AgroSmart:leituras:v1
sha256:<SHA-256 hexadecimal dos bytes exatos do corpo>
```

Em Python, com `eth_account`:

```python
corpo = json.dumps(lote).encode()
mensagem = f"AgroSmart:leituras:v1\nsha256:{hashlib.sha256(corpo).hexdigest()}"
assinatura = Account.sign_message(encode_defunct(text=mensagem), chave).signature.hex()
requests.post(url, data=corpo, headers={"Content-Type": "application/json", "X-Assinatura": assinatura})
```

**Por que assinar os bytes, e não o JSON:** Python e JavaScript serializam números de forma
diferente (`0.0` contra `0`). Assinando os bytes que de fato trafegaram, cada lado só precisa
calcular SHA-256 sobre o mesmo corpo.

A marca de tempo pode vir como `instante` (canônico) ou como `timestamp`, o nome usado pelo
consolidador do oráculo. Os dois são aceitos — ver [DECISOES.md §2.16](DECISOES.md).

A estação pode reportar de hora em hora, como uma estação automática real faz: o oráculo soma a
chuva das horas dentro de cada fonte antes de tirar a média entre fontes.

A API confere, nesta ordem: forma do corpo → fonte ativa → assinatura da chave registrada →
`enviadoEm` dentro de uma janela de 10 minutos → lote ainda não recebido → plausibilidade de
cada leitura. Leitura implausível **não derruba o lote**: é gravada como inválida, com o motivo,
e reduz a reputação da fonte (média móvel exponencial, α = 0,2). Descartar em silêncio apagaria
a evidência de que o sensor falhou.

## 6. Contrato do módulo de visão (HU11)

Quando o lote de imagens é fechado, o backend calcula o resumo das evidências (SHA-256 sobre os
resumos das imagens, em ordem). O serviço de visão devolve:

```json
POST /api/visao/resultados      X-Chave-De-Servico: ...
{ "loteId": "...", "versaoModelo": "resnet50-agrosmart-1.0.0", "indiceDano": 0.62, "confianca": 0.81 }
```

`indiceDano` e `confianca` vão de 0 a 1 e são guardados em pontos-base, a mesma unidade do
contrato. Como o percentual é calculado a partir da classificação dos pixels está em
[VISAO.md §2](VISAO.md).

O serviço descobre o que analisar em `GET /visao/pendentes` e baixa cada arquivo em
`GET /visao/imagens/:id/arquivo`. O backend confere o resumo do arquivo em disco antes de
entregá-lo: se os bytes não produzem mais o sha256 registrado, a evidência foi corrompida ou
trocada, e analisar isso seria pior do que falhar — o hash do lote já foi para a cadeia.

Uma implementação completa está em [`visao/`](../visao). Confiança abaixo de `LIMIAR_CONFIANCA_BPS` (padrão 7000) retém a análise para o
perito. Liberada, ela segue ao oráculo com `liberadaPeloPerito: true`, e o oráculo não reaplica
o limiar, porque a revisão humana que ele pedia já aconteceu.

## 7. O indexador

`src/cadeia/indexador.js` varre os eventos da fábrica e das apólices com `getLogs`, em blocos,
a cada 4 segundos:

- cada evento é gravado com `(tx_hash, indice_log)` único, então reprocessar é inofensivo;
- depois de cada evento, o estado da apólice é **relido do contrato**, e não deduzido do evento;
- a emissão é registrada também por aqui. Se a seguradora fechar o navegador entre assinar a
  transação e avisar o backend, a apólice aparece mesmo assim;
- cada evento relevante vira notificação para as partes: emissão, garantia, pagamento.

Sem contrato implantado, o indexador fica em espera e a API funciona normalmente.

## 8. Integração com o oráculo

O oráculo continua sendo quem consolida o índice e assina a publicação. O backend só entrega a
matéria-prima e recebe o relato:

```
oraculo servico ──GET /oraculo/apolices-ativas──► backend
               ──GET /oraculo/leituras?talhao──►          (leituras válidas, 90 dias)
               ──GET /oraculo/visao?talhao────►           (análise + liberadaPeloPerito)
               consolida, assina, publica na cadeia
               ──POST /oraculo/publicacoes───►            (gas, latência, procedência)
```

O relato é **melhor esforço**: se o backend estiver fora do ar, a publicação na cadeia acontece
do mesmo jeito, e o registro local do oráculo continua sendo a trilha de auditoria. Um
componente auxiliar fora do ar não pode impedir o pagamento.

Comando: `node src/index.js servico` em `oraculo/`, com `API_URL` e `CHAVE_DE_SERVICO` no
`.env`. Veja [ORACULO.md](ORACULO.md).

## 9. Testes

```
npm run testar              91 testes · banco em memória, cadeia simulada
npm run testar:integracao    4 testes · indexador contra um hardhat node real
```

Os testes cobrem, entre outros: senha e segundo fator; perfil errado em cada rota sensível;
desafio de carteira reutilizado, expirado ou assinado por outra chave; polígono inválido;
produto fora dos limites do contrato; emissão com recibo de outra fábrica, resumo diferente,
produtor diferente ou valor diferente; lote com assinatura errada, repetido ou fora da janela;
imagem com extensão falsa ou fora do talhão; análise rejeitada que não pode chegar ao oráculo.

### Verificação ponta a ponta com dados reais (22/09/2026)

Com `hardhat node`, implantação, backend, aplicativo e oráculo rodando juntos:

1. login do produtor e da seguradora pela API;
2. vínculo da carteira com desafio assinado;
3. cotação, proposta, preparação dos termos;
4. emissão assinada pela carteira da seguradora e **conferida pelo backend na cadeia**;
5. depósito da garantia;
6. **2.208 leituras horárias reais** do INMET, das estações A770 (São Simão/SP) e A747
   (Pradópolis/SP), na janela da estiagem de julho e agosto de 2024, enviadas pelo simulador em
   Python em 6 lotes assinados — todas aceitas, reputação 1,00;
7. `oraculo servico --uma-vez`: índice de **39 dias secos** publicado, 248.949 de gas, 31 ms,
   com procedência registrando as duas fontes e as 2.208 leituras válidas;
8. pagamento escalonado transferido na mesma transação, sem intervenção humana;
9. o indexador gerou as três notificações (emissão, cobertura ativa, indenização paga);
10. na tela da apólice, o resumo recalculado no navegador bateu com o gravado no contrato, e a
    procedência (2 fontes, gas, latência) apareceu ao lado do índice.
