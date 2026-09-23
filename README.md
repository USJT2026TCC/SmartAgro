# AgroSmart

Seguros agrícolas automatizados com smart contracts, IoT e visão computacional.

Trabalho de Conclusão de Curso — Bacharelado em Engenharia de Computação, Universidade São Judas Tadeu, 2026.
Orientador: Prof. Nelson Oliveira.

Ana Victória Faria dos Santos · Beatriz Aarão de Melo · Bruno Henrique Volpini Stramasso · Gabriel Moreira Bittencourt · Lamys Bachir Fares

---

## O problema

Um contrato inteligente não consegue acessar nada fora da própria blockchain. Não é uma
limitação de biblioteca: é consequência do modelo de consenso. Se cada nó consultasse uma API
por conta própria, cada um poderia receber uma resposta diferente e a rede deixaria de
convergir para o mesmo estado.

Contorna-se isso com um **oráculo**: um serviço que obtém o dado do ambiente, valida e submete
à cadeia. A solução resolve um problema e cria outro — o oráculo concentra justamente a
confiança que a arquitetura descentralizada tentou eliminar.

Este repositório investiga esse problema em um domínio concreto: seguro agrícola indexado, em
que a condição de pagamento é uma função computável sobre grandezas medidas na lavoura.

## O que já está implementado

| Módulo | Situação | Conteúdo |
|---|---|---|
| [`contratos/`](contratos) | **Pronto** | Apólice, registro de oráculos e fábrica em Solidity, com 94 testes e 100% de cobertura |
| [`oraculo/`](oraculo) | **Pronto** | Consolidação dos índices, assinatura, publicação, fila de retomada e registro de custos, com 65 testes |
| [`app/`](app) | **Pronto** | Aplicativo do produtor, painel da seguradora e revisão do perito, em React, integrados ao backend e aos contratos |
| [`backend/`](backend) | **Pronto** | API, PostgreSQL + PostGIS, ingestão assinada, indexador de eventos e notificações, com 87 testes |
| [`simulador/`](simulador) | **Pronto** | Estações em Python + MQTT, enviando a série histórica real do INMET, assinada, com 19 testes |
| `visao/` | A fazer | Modelo de visão computacional e API de inferência (HU11) |

O simulador envia dados **reais**: a série horária da estação automática A770 do INMET, em São
Simão/SP, que registra uma estiagem de 39 dias em julho e agosto de 2024. A fonte simulada
determinística (`oraculo/src/fonteSimulada.js`) continua no projeto para os testes rodarem sem
depender de arquivo externo. As fontes de dados e suas licenças estão em
[docs/DADOS.md](docs/DADOS.md).

O backend já define o formato que o simulador e o módulo de visão precisam seguir — ver
[docs/BACKEND.md](docs/BACKEND.md), seções 5 e 6. Apólice, índices e pagamento continuam vivendo
na cadeia, e é de lá que o aplicativo os lê; o banco é espelho, não autoridade.

## A fronteira

A decisão central do projeto é onde cada coisa roda.

```
                    FORA DA CADEIA  (pesado, probabilístico, muda com frequência)
  ┌──────────────────────────────────────────────────────────────────────┐
  │  leituras de campo → validação → consolidação do índice              │
  │  imagens → modelo de visão → índice de dano + confiança + hash       │
  └──────────────────────────────────┬───────────────────────────────────┘
                                     │
   ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ │ ~ ~ ~ ~ ~ ~ ~ ~  FRONTEIRA  ~ ~ ~ ~
                                     │   assinatura do oráculo
                                     │   só números e resumos criptográficos
  ┌──────────────────────────────────▼───────────────────────────────────┐
  │  confere a origem → avalia a condição → transfere a indenização      │
  └──────────────────────────────────────────────────────────────────────┘
                     NA CADEIA  (imutável, auditável, caro)
```

O contrato **não verifica se o índice está correto**, apenas se quem publicou tinha
autorização. A confiança na inferência vem do registro do resumo criptográfico das evidências,
da versão do modelo e da possibilidade de reexecutar a análise depois.

## Começando

Pré-requisitos: Git, Node.js 20 ou superior (e Python 3.10+ para o simulador de estações).

```bash
git clone https://github.com/USJT2026TCC/SmartAgro.git
cd SmartAgro
```

Demonstração dos contratos em rede local, sem configurar nada:

```bash
cd contratos && npm install && npx hardhat run scripts/demo-estiagem.js
```

Para ver a coisa inteira — contratar pelo aplicativo, o oráculo publicando e o pagamento
acontecendo sozinho na tela — siga [docs/COMO-RODAR.md](docs/COMO-RODAR.md), seção 5A.

## Documentação

| Documento | Para quê |
|---|---|
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Como as peças se encaixam e por que a fronteira fica onde fica |
| [docs/CONTRATOS.md](docs/CONTRATOS.md) | Referência dos contratos, tabela de gas e rastreabilidade de requisitos |
| [docs/ORACULO.md](docs/ORACULO.md) | Referência do serviço de oráculo, módulo por módulo |
| [docs/APLICATIVO.md](docs/APLICATIVO.md) | Referência do aplicativo, tela por tela |
| [docs/BACKEND.md](docs/BACKEND.md) | API, banco, segurança, contrato de ingestão e indexador |
| [docs/SIMULADOR.md](docs/SIMULADOR.md) | Estações em Python, MQTT e o que o simulador faz com os dados |
| [docs/DADOS.md](docs/DADOS.md) | De onde vem cada dado, sob que licença e como citar |
| [docs/COMO-RODAR.md](docs/COMO-RODAR.md) | Passo a passo, da instalação à demonstração na Sepolia |
| [docs/ANALISE-ESTATICA.md](docs/ANALISE-ESTATICA.md) | Triagem do Slither, achado por achado (RNF13) |
| [docs/DECISOES.md](docs/DECISOES.md) | Decisões de projeto, alternativas descartadas e defeitos encontrados |
| `docs/AgroSmart_Documentacao_Software.docx` | Documentação acadêmica: requisitos, UML, planejamento |
| `docs/AgroSmart_Manual_da_Equipe.docx` | Manual interno da equipe |

## Estado dos testes

```
contratos   94 testes · 100% de statements, branches, funções e linhas
oraculo     67 testes
backend     84 testes + 4 de integração com um nó real
simulador   19 testes
```

Nenhum deles depende de rede externa para rodar. Sete dos testes de contrato comparam, caso a
caso, a regra de acionamento do contrato com a reimplementação em JavaScript que o aplicativo usa
na tela de cotação — para que a tela não prometa um valor que o contrato não vai pagar.

## Segurança

Chave privada e frase de recuperação **nunca** entram no repositório. Cada integrante mantém o
próprio arquivo `.env`, que está no `.gitignore`. Os modelos ficam em `oraculo/.env.example` e
`contratos/.env.example` e `backend/.env.example`.

O backend não guarda chave privada de ninguém: só confere assinaturas. Senhas ficam em bcrypt,
o segredo do segundo fator é cifrado em repouso, e as leituras de campo só são aceitas com a
assinatura da fonte que as produziu.

Todo o trabalho acontece em rede de teste. Nenhum valor com lastro monetário real é
movimentado.
