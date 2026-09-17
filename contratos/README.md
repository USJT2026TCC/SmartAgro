# Contratos

A metade em cadeia do AgroSmart, em Solidity 0.8.24 com Hardhat.

```
contracts/
├── OracleRegistry.sol    lista de enderecos autorizados a publicar (RF18)
├── ApolicePolicy.sol     termos, avaliacao da condicao e liquidacao
├── ApoliceFactory.sol    implanta e indexa as apolices (RF07)
└── mocks/                contratos hostis, usados so em teste
```

## Comandos

| Comando | O que faz |
|---|---|
| `npx hardhat compile` | Compila |
| `npx hardhat test` | Roda os 81 testes |
| `npx hardhat clean && npx hardhat coverage` | Cobertura (o `clean` é necessário) |
| `npx cross-env REPORT_GAS=true npx hardhat test` | Relatório de gas por função |
| `npx hardhat node` | Sobe uma rede local |
| `npx hardhat run scripts/demo-estiagem.js` | Demonstração completa, sem configurar nada |
| `npx hardhat run scripts/implantar.js --network localhost` | Implanta registro e fábrica |
| `npx hardhat run scripts/emitir-apolice.js --network localhost` | Emite uma apólice e deposita a garantia |

## Configuração

Só é necessária para rede de teste pública. Copie `.env.example` para `.env` e preencha.
Chaves privadas **nunca** vão para o repositório (RNF16).

## Documentação

- [docs/CONTRATOS.md](../docs/CONTRATOS.md) — referência, tabela de gas, rastreabilidade
- [docs/ARQUITETURA.md](../docs/ARQUITETURA.md) — por que a fronteira fica onde fica
- [docs/COMO-RODAR.md](../docs/COMO-RODAR.md) — passo a passo
