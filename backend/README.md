# Backend

API do AgroSmart em Node.js + Express, sobre PostgreSQL com PostGIS.

```
src/
├── index.js            ponto de entrada: banco, migracoes, semente, indexador, porta
├── app.js              aplicacao Express, montada com as dependencias injetadas
├── config.js           configuracao; segredos so por variavel de ambiente
├── banco/              conexao (PostgreSQL ou PGlite), migracoes, dados de demonstracao
├── seguranca/          bcrypt, TOTP, cifra em repouso, sessoes, perfis, auditoria
├── cadeia/             leitura da blockchain e indexador de eventos
├── dominio/            cotacao em BigInt, termos e resumo, assinatura de lote, geometria
└── rotas/              uma por area da API
```

## Rodar

```bash
npm install
```

```bash
npm run iniciar
```

Sobe em `http://localhost:3001/api`. **Nao ha banco para instalar**: sem `DATABASE_URL`, o backend
usa o PGlite — o proprio PostgreSQL, com PostGIS, rodando dentro do processo — e grava em
`backend/dados/pg/`. Na primeira execucao, cria as tabelas e os dados de demonstracao.

Usuarios de demonstracao: `produtor`, `seguradora` e `perito`, senha `agrosmart`.

Para o indexador acompanhar a cadeia, suba antes `npx hardhat node` e rode o script de
implantacao em `contratos/`. Sem contrato implantado, a API funciona normalmente e o indexador
fica em espera.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run iniciar` | Sobe a API |
| `npm run dev` | Sobe e reinicia a cada alteracao de arquivo |
| `npm run testar` | 83 testes, com banco em memoria e cadeia simulada |
| `npm run testar:integracao` | Indexador contra um `hardhat node` real, que o proprio teste sobe |
| `npm run enviar-leituras -- --cenario estiagem_severa` | Envia leituras assinadas, como uma estacao faria |
| `npm run migrar` | Aplica migracoes pendentes |

## Configuracao

Copie `.env.example` para `.env`. Em desenvolvimento nada e obrigatorio. Em producao
(`NODE_ENV=producao`), `CHAVE_DE_SERVICO` e `SEGREDO_DE_CIFRA` sao exigidos, e o backend recusa
subir sem eles.

Para usar um PostgreSQL de verdade, defina `DATABASE_URL`. O banco precisa ter a extensao PostGIS
disponivel. O SQL e o mesmo nos dois motores.

## Documentacao

- [docs/BACKEND.md](../docs/BACKEND.md) — arquitetura, rota por rota, e as decisoes
- [docs/ARQUITETURA.md](../docs/ARQUITETURA.md) — onde o backend fica em relacao a fronteira
