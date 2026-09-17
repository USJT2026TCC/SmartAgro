# Oráculo

O serviço que atravessa a fronteira: consolida os índices de campo, assina e publica nos
contratos da apólice.

```
src/
├── consolidador.js   valida leituras e consolida o indice climatico (RF12, RF19)
├── reputacao.js      escore por fonte de dados (RF13)
├── fila.js           retomada apos falha de rede ou queda do processo (RF21)
├── publicador.js     assinatura e submissao a cadeia (RF19, RF22)
├── registro.js       trilha de auditoria: gas, latencia, procedencia (RNF20)
├── fonteSimulada.js  leituras deterministicas ate o simulador oficial existir
├── oraculo.js        orquestrador
└── index.js          linha de comando
```

## Comandos

```bash
npm test                                      # 56 testes, nenhum precisa de rede
node src/index.js status                      # endereco, saldo, autorizacao
node src/index.js ciclo --cenario estiagem_severa
node src/index.js publicar --periodo 20261015
node src/index.js ouvir                       # eventos em tempo real
node src/index.js fila                        # publicacoes pendentes
node src/index.js estatisticas                # gas e latencia coletados
```

## Configuração

Copie `.env.example` para `.env` e preencha `CHAVE_PRIVADA_ORACULO` e `ENDERECO_APOLICE`.
O `.env` está no `.gitignore` e **nunca** deve ir para o repositório (RNF16).

Os endereços dos contratos vêm de `contratos/implantacoes/<rede>.json`, gerado pelo script de
implantação — não precisam ser copiados à mão.

## Documentação

- [docs/ORACULO.md](../docs/ORACULO.md) — referência módulo por módulo
- [docs/ARQUITETURA.md](../docs/ARQUITETURA.md) — como as peças se encaixam
- [docs/COMO-RODAR.md](../docs/COMO-RODAR.md) — passo a passo
