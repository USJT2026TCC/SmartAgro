# Resultado: cancelamento e contestação na Sepolia

Segunda implantação em rede pública, em 08/10/2026, com o contrato que ganhou o cancelamento antes
da vigência (RF10) e a contestação com índice retificado (RF28). O código-fonte de todos os
contratos está publicado e verificado no Etherscan: qualquer pessoa confere que o que roda na rede é
o que está no repositório.

A implantação anterior, de 07/10, continua na rede e documentada em
[sepolia-2026-10-07](../sepolia-2026-10-07/README.md) — lá estão os pagamentos pelo índice
climático e pelo índice de dano. Os endereços dela ficam em
`contratos/implantacoes/sepolia-2026-10-07.json`.

| | |
|---|---|
| Rede | Sepolia (chainId 11155111) |
| Endpoint | `https://ethereum-sepolia-rpc.publicnode.com` |
| Bloco da implantação | 11.871.430 |
| Preço do gas | 0,01 gwei nas transações do Hardhat; ~0,001 gwei nas do oráculo |
| Carteiras | as mesmas de 07/10: seguradora, oráculo e produtor distintos (RNF10) |

## Contratos

Todos com o código verificado (aba *Contract* do Etherscan):

| Contrato | Endereço |
|---|---|
| `OracleRegistry` | [`0x0e1e833cAdfAbCF046F8d8d0a78908225E15E134`](https://sepolia.etherscan.io/address/0x0e1e833cAdfAbCF046F8d8d0a78908225E15E134#code) |
| `ApoliceFactory` | [`0xb641011e692C7135aFE11c457665B2EB28426ceb`](https://sepolia.etherscan.io/address/0xb641011e692C7135aFE11c457665B2EB28426ceb#code) |
| Apólice cancelada (RF10) | [`0xBB873b0890D8bb14F95F3dDAfCFe8eA7613EE7Af`](https://sepolia.etherscan.io/address/0xBB873b0890D8bb14F95F3dDAfCFe8eA7613EE7Af#code) |
| Apólice contestada (RF28) | [`0x2c5d36d3428036eAa53B370d02cBd62be43ddA39`](https://sepolia.etherscan.io/address/0x2c5d36d3428036eAa53B370d02cBd62be43ddA39#code) |

```bash
cd contratos && npx hardhat verify --network sepolia <registro> <seguradora>
cd contratos && npx hardhat verify --network sepolia <fabrica> <registro> <seguradora>
```

As apólices recebem a struct de termos no construtor; `scripts/verificar-apolice.js` lê os termos
da própria cadeia e verifica (no PowerShell, `$env:ENDERECO_APOLICE="0x..."` antes).

## 1. Cancelamento antes da vigência (RF10)

| | |
|---|---|
| Termos | 30 dias sem chuva, talhão-01, 0,002 ETH, **vigência a partir de 18/10/2026** |
| Emissão | [`0xd91e87ac…d71e`](https://sepolia.etherscan.io/tx/0xd91e87ac34a33f5624cd95ea7fa4b490ed98e6116e9b7b125b4ffa69b19dd71e) — 14.225.539 de gas |
| Garantia depositada | [`0x5123117c…2944`](https://sepolia.etherscan.io/tx/0x5123117c4984ca4ebbaa58df0c25743e779f6b70986b8c2252ec1d5a08e32944) — 0,002 ETH |
| Cancelamento | [`0x7533007f…d1fd`](https://sepolia.etherscan.io/tx/0x7533007fe1871843a51970cd128abd6554cd3ce863720bdb41dd99182b1fd901) — 43.055 de gas |
| Resultado | situação `CANCELADA`; os 0,002 ETH voltaram à seguradora na mesma transação |

Cancelado pela seguradora, com `scripts/cancelar-apolice.js`. O produtor faz o mesmo pelo botão
**Cancelar apólice** do aplicativo, assinando com a carteira dele. Depois de 18/10, a mesma chamada
seria recusada com `VigenciaIniciada`.

## 2. Contestação com índice retificado (RF28)

| | |
|---|---|
| Termos | **dano de 20% da lavoura**, talhão-01, 0,003 ETH, vigência a partir de 08/10/2026 |
| Emissão | [`0xa25e621c…cb10`](https://sepolia.etherscan.io/tx/0xa25e621c59131a32675cc5038c8e46e3207e0bc23f4357de285ddb48784fcb10) — 13.931.815 de gas |
| Garantia depositada | [`0xac0c2703…e9ce`](https://sepolia.etherscan.io/tx/0xac0c27032fdf414f7670fb209ba1428e6b76b8a3abf4c2bc2c928f49cddde9ce) — 0,003 ETH |
| Evidências | as 8 fotos de demonstração: 7 aceitas, 1 recusada pelo PostGIS (fora do talhão); resumo `0x808c787f…38c8` |
| Análise | modelo `visao-unet-2.0.0-cpu`: 10,0% de dano, confiança 73% — liberada ao oráculo |
| Publicação original | [`0xbaa0b342…7d8d`](https://sepolia.etherscan.io/tx/0xbaa0b342535aeeb97f04d7efe6590899a31c3a52732ba641a7958605d3967d8d) — período 20261008, dano **9,98%**, abaixo dos 20%: **não aciona** (711.594 de gas) |
| Contestação do produtor | registrada pelo produtor titular, com a carteira `0xC8fd…3071` vinculada ao cadastro por assinatura na MetaMask; o backend conferiu que o período tinha `IndicesPublicados` na rede |
| Parecer do perito | **deferida**, índice retificado de **30%**; resumo do parecer `0xd0a02175…a2d0` |
| Retificação publicada | [`0xc9faf93f…9f06`](https://sepolia.etherscan.io/tx/0xc9faf93fd66e4420a2caf6fbd80fcc4987f556912e0c8057c139d128ffa39f06) — bloco 11.873.112, 856.184 de gas |

Uma única transação do oráculo emitiu, nesta ordem:

| Evento | Conteúdo |
|---|---|
| `IndiceRetificado` | período 20261008, índice original **998** (9,98%) → **3000** (30%), resumo das evidências e versão do modelo originais, resumo do parecer |
| `CondicaoAvaliada` | condição **atendida**, 100% do limite |
| `PagamentoExecutado` | **0,003 ETH** para o produtor `0xC8fd…3071` |

Depois dela, lido do contrato:

- situação `LIQUIDADA`, valor pago 0,003 ETH, saldo do contrato zerado;
- `publicacao(20261008)` continua com o índice **original, 9,98%**; `retificacao(20261008)`
  guarda os 30% e o resumo do parecer. Nada foi apagado: a linha do tempo mostra o índice do
  modelo, o do perito e o motivo da mudança;
- o saldo da carteira do produtor passou de 0,017 para **0,020 ETH**.

O perito decidiu fora da cadeia e não tem chave nenhuma: quem escreveu na apólice foi o oráculo, o
único endereço autorizado no registro (RF18; DECISOES.md 1.16).

## Gas da nova versão

| Operação | 07/10 (versão anterior) | 08/10 (com RF10 e RF28) |
|---|---:|---:|
| `emitirApolice` | 10,2 a 10,5 milhões | 13,9 a 14,2 milhões |
| `depositarGarantia` | 135.152 | 135.174 |
| Publicação sem acionar | — | 711.594 |
| `publicarRetificacao` que paga | — | 856.184 |
| `cancelar` | — | 43.055 |

A emissão ficou cerca de 35% mais cara porque a apólice ganhou duas funções e o armazenamento das
retificações: depois do Glamsterdam, cada byte de código implantado custa 1.530 de gas (CONTRATOS.md
§4). O efeito no RNF08 está em
[requisitos-nao-funcionais-2026-10-08](../requisitos-nao-funcionais-2026-10-08/README.md).
