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
| [`contratos/`](contratos) | **Pronto** | Apólice, registro de oráculos e fábrica em Solidity, com 81 testes e 100% de cobertura |
| [`oraculo/`](oraculo) | **Pronto** | Consolidação dos índices, assinatura, publicação, fila de retomada e registro de custos, com 56 testes |
| `backend/` | A fazer | API, ingestão e banco (Sprint 2–3) |
| `simulador/` | A fazer | Simulador de sensores em Python + MQTT (HU04) |
| `visao/` | A fazer | Modelo de visão computacional e API de inferência (HU11) |
| `app/` | A fazer | Aplicativo do produtor e painel da seguradora (Sprint 3) |

Enquanto o simulador oficial não existe, o oráculo usa uma fonte simulada própria
(`oraculo/src/fonteSimulada.js`), determinística, com os três cenários previstos na HU04.

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

Pré-requisitos: Git, Node.js 20 ou superior.

```bash
git clone https://github.com/USJT2026TCC/SmartAgro.git
cd SmartAgro
```

Demonstração completa em rede local, sem configurar nada:

```bash
cd contratos && npm install && npx hardhat run scripts/demo-estiagem.js
```

O roteiro passo a passo, incluindo o serviço de oráculo e a rede Sepolia, está em
[docs/COMO-RODAR.md](docs/COMO-RODAR.md).

## Documentação

| Documento | Para quê |
|---|---|
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Como as peças se encaixam e por que a fronteira fica onde fica |
| [docs/CONTRATOS.md](docs/CONTRATOS.md) | Referência dos contratos, tabela de gas e rastreabilidade de requisitos |
| [docs/ORACULO.md](docs/ORACULO.md) | Referência do serviço de oráculo, módulo por módulo |
| [docs/COMO-RODAR.md](docs/COMO-RODAR.md) | Passo a passo, da instalação à demonstração na Sepolia |
| [docs/DECISOES.md](docs/DECISOES.md) | Decisões de projeto, alternativas descartadas e defeitos encontrados |
| `docs/AgroSmart_Documentacao_Software.docx` | Documentação acadêmica: requisitos, UML, planejamento |
| `docs/AgroSmart_Manual_da_Equipe.docx` | Manual interno da equipe |

## Estado dos testes

```
contratos   81 testes · 100% de statements, branches, funções e linhas
oraculo     56 testes
```

Nenhum dos dois depende de rede externa para rodar.

## Segurança

Chave privada e frase de recuperação **nunca** entram no repositório. Cada integrante mantém o
próprio arquivo `.env`, que está no `.gitignore`. Os modelos ficam em `oraculo/.env.example` e
`contratos/.env.example`.

Todo o trabalho acontece em rede de teste. Nenhum valor com lastro monetário real é
movimentado.
