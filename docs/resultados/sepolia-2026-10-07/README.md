# Resultado: pagamento automático na Sepolia

Primeira execução do fluxo completo em rede pública, em 07/10/2026: contratos implantados, duas
apólices emitidas e as duas pagas sem intervenção humana — uma pelo índice climático, com dados
reais do INMET, outra pelo índice de dano, com fotos analisadas pelo modelo de visão.

Qualquer pessoa pode conferir cada passo pelos links abaixo, sem depender da palavra da equipe.

| | |
|---|---|
| Rede | Sepolia (chainId 11155111), um dia depois da ativação do Glamsterdam |
| Endpoint | `https://ethereum-sepolia-rpc.publicnode.com` (público, sem conta) |
| Preço do gas pago | 0,01 gwei nas transações do Hardhat; ~0,001 gwei nas do oráculo (preço da rede) |
| Confirmações aguardadas pelo oráculo | 2 |

## Carteiras

| Papel | Endereço |
|---|---|
| Seguradora | [`0x95eA48b7BF91446CF12C156aC2FDeA75Af03fD70`](https://sepolia.etherscan.io/address/0x95eA48b7BF91446CF12C156aC2FDeA75Af03fD70) |
| Oráculo | [`0xeFCf4d0c3f22ac012896c2D9c6bA35e9fd7D691D`](https://sepolia.etherscan.io/address/0xeFCf4d0c3f22ac012896c2D9c6bA35e9fd7D691D) |
| Produtor | [`0xC8fdFcA3CfEc202D8BaBf4E89bEcaB5E57773071`](https://sepolia.etherscan.io/address/0xC8fdFcA3CfEc202D8BaBf4E89bEcaB5E57773071) (criada na MetaMask; a chave nunca passou pelo sistema) |

São três endereços distintos: quem publica o índice não é quem recebe a indenização (RNF10).

## Contratos

| Contrato | Endereço |
|---|---|
| `OracleRegistry` | [`0x58FD352da560c5555D0A1a0fe7e96e96d94f12Ee`](https://sepolia.etherscan.io/address/0x58FD352da560c5555D0A1a0fe7e96e96d94f12Ee) |
| `ApoliceFactory` | [`0x8992e277490BFcfC6BA2c251672f76441bc96b0B`](https://sepolia.etherscan.io/address/0x8992e277490BFcfC6BA2c251672f76441bc96b0B) |
| Apólice por chuva | [`0xB1691Ed23a824642FfB03fD91996075aC6e1ac54`](https://sepolia.etherscan.io/address/0xB1691Ed23a824642FfB03fD91996075aC6e1ac54) |
| Apólice por dano | [`0xCDaF8A03cD4b54145B28A5F00746dC58B7F2D830`](https://sepolia.etherscan.io/address/0xCDaF8A03cD4b54145B28A5F00746dC58B7F2D830) |

## 1. Pagamento pelo índice climático

| | |
|---|---|
| Condição | 30 dias consecutivos sem chuva (≥ 1 mm), talhão-01, indenização integral de 0,01 ETH |
| Dados | estações INMET A770 (São Simão) e A747 (Pradópolis), 25/06 a 09/08/2024 — 2.208 leituras horárias reais, assinadas por estação e aceitas pela API |
| Datas | deslocadas 788 dias para terminar ontem; os valores medidos são os originais |
| Índice publicado | **39** dias secos, período 20261006 |
| Transação | [`0x8111d260…7d1a`](https://sepolia.etherscan.io/tx/0x8111d260d9fead6712690593f2c9850ee422ee1b6bfafbb44a8e0807af217d1a) — publica e paga na mesma transação |

## 2. Pagamento pelo índice de dano

| | |
|---|---|
| Condição | dano de 5% da lavoura, talhão-01, indenização integral de 0,005 ETH |
| Evidências | as 8 fotos de `docs/demonstracao/fotos/`: 7 aceitas (6 com GPS da foto, 1 marcada à mão), 1 recusada pelo PostGIS por estar fora do talhão |
| Resumo das evidências | `0x808c787fc57d1da0dbfa502024f16a0a0019e5caf6e938dafac30df745aa38c8` |
| Modelo | `visao-unet-2.0.0-cpu` |
| Índice publicado | **9,98%** de dano, confiança 72,9% — acima do limiar de 70%, sem perito |
| Transação | [`0x818ea8b1…86ca`](https://sepolia.etherscan.io/tx/0x818ea8b15b0c4586ed1eff20b316f29df95f488808c3218e021a6e94f57586ca) |

As fotos são recortes reais da base de referência com coordenadas inventadas para cair no
talhão; não são fotos da lavoura segurada (ver o LEIAME da pasta de fotos).

## Gas e latência

| Operação | Gas na Sepolia | Gas na rede local | Custo pago |
|---|---:|---:|---:|
| Implantar `OracleRegistry` | 2.063.565 | 321.819 | 0,0021 ETH ¹ |
| Autorizar o oráculo | 240.099 | ~70.000 | 0,0002 ETH ¹ |
| Implantar `ApoliceFactory` | 15.885.657 | 2.241.625 | 0,0159 ETH ¹ |
| `emitirApolice` | 10.158.608 a 10.452.332 | ~1.507.000 | 0,0001 ETH |
| `depositarGarantia` | 135.152 | 47.132 | 0,0000014 ETH |
| Publicação que aciona e paga | 956.252 a 956.334 | 231.192 | 0,00000096 ETH |

¹ pago a 1 gwei, antes da correção do preço (DECISOES.md 2.24).

**Latência da publicação:** 26,7 s e 27,0 s, do envio à segunda confirmação. Na rede local, cerca
de 170 ms. Quase todo o tempo é a espera por dois blocos de ~12 s, e não processamento.

A quantidade de gas é de 3 a 7 vezes a da rede local por causa do Glamsterdam, ativado na
Sepolia em 06/10/2026, que encarece a criação de estado (EIP-8037). A explicação está em
[CONTRATOS.md §4](../../CONTRATOS.md).

## Como reproduzir

[COMO-RODAR.md §7](../../COMO-RODAR.md).
