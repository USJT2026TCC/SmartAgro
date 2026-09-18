# Aplicativo

Aplicativo do produtor e painel da seguradora, em React + Vite, integrados diretamente aos
contratos.

```
src/
├── cadeia/          tudo o que fala com a blockchain
│   ├── abis.js              interfaces dos contratos
│   ├── rede.js              redes e enderecos implantados
│   ├── contratos.js         leitura e escrita, eventos, linha do tempo
│   ├── regraDeGatilho.js    a regra de acionamento, espelhada do contrato
│   ├── formatos.js          wei, bps, datas e traducao de erros
│   ├── CarteiraContexto.jsx conexao com a MetaMask
│   └── carteiraSimulada.js  carteira falsa para desenvolvimento
├── sessao/          login e perfis (peca provisoria)
├── dados/           talhoes, produtos e propostas (peca provisoria)
├── componentes/     cabecalho, rota protegida e componentes pequenos
└── paginas/         uma por tela
```

## Rodar

Antes: `npx hardhat node` e `npx hardhat run scripts/implantar.js --network localhost` no
diretorio `contratos`.

```bash
npm install
```

```bash
npm run dev
```

O `npm run dev` roda `npm run enderecos` antes de subir, copiando os enderecos implantados de
`contratos/implantacoes/` para dentro do aplicativo. Nenhum endereco de contrato e digitado a
mao.

Abra `http://localhost:5173`. Usuarios de demonstracao: `produtor`, `seguradora` e `perito`,
todos com a senha `agrosmart`.

## Sem MetaMask

Para conferir a interface sem instalar a extensao:

```
http://localhost:5173/?carteira=simulada&conta=0
```

`conta` segue a convencao do projeto: 0 seguradora, 1 produtor, 2 oraculo. Funciona apenas em
modo de desenvolvimento e em rede local; o `npm run build` remove esse caminho do pacote. Uma
faixa de aviso fica visivel enquanto esta ativo — nao use em demonstracao.

## O que e real e o que e provisorio

| Peca | Situacao |
|---|---|
| Apolices, indices, pagamentos, eventos | **Reais**, lidos e escritos na cadeia |
| Emissao da apolice e deposito da garantia | **Reais**, assinados pela carteira da seguradora |
| Vinculo da carteira por assinatura | **Real**, verificado no navegador |
| Login e senhas | Provisorio — em `src/sessao/usuarios.js`, ate a API |
| Talhoes, produtos e propostas | Provisorios — `localStorage`, ate o banco |

As duas pecas provisorias aparecem marcadas na propria interface.

## Documentacao

- [docs/APLICATIVO.md](../docs/APLICATIVO.md) — tela por tela, com as decisoes
- [docs/COMO-RODAR.md](../docs/COMO-RODAR.md) — passo a passo da demonstracao completa
- [docs/ARQUITETURA.md](../docs/ARQUITETURA.md) — onde fica a fronteira
