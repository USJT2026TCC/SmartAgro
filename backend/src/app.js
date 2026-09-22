import express from "express";

import { config } from "./config.js";
import { naoEncontrado, tratarErros } from "./erros.js";
import { rotasDeAutenticacao } from "./rotas/autenticacao.js";
import { rotasDeCarteira } from "./rotas/carteira.js";
import { rotasDeCadastro } from "./rotas/cadastro.js";
import { rotasDePropostas } from "./rotas/propostas.js";
import { rotasDeApolices } from "./rotas/apolices.js";
import { rotasDeLeituras } from "./rotas/leituras.js";
import { rotasDoOraculo } from "./rotas/oraculo.js";
import { rotasDeImagens } from "./rotas/imagens.js";
import { rotasDeAcompanhamento } from "./rotas/acompanhamento.js";

/**
 * Monta a aplicacao Express.
 *
 * Recebe o banco e o leitor da cadeia como dependencias, em vez de cria-los: os
 * testes passam um banco em memoria e um leitor falso, e a mesma aplicacao roda
 * sem no, sem disco e sem estado compartilhado entre um teste e outro.
 *
 * @param {object} deps
 * @param {import("./banco/conexao.js").Banco} deps.banco
 * @param {ReturnType<import("./cadeia/leitor.js").criarLeitorDaCadeia>} deps.cadeia
 * @param {object} [deps.indexador]
 */
export function criarApp({ banco, cadeia, indexador = null }) {
  const app = express();

  app.locals.banco = banco;
  app.locals.cadeia = cadeia;
  app.locals.indexador = indexador;

  // Atras de um proxy reverso, o IP real vem no cabecalho X-Forwarded-For. Sem
  // isso, o limitador de requisicoes veria todo mundo com o IP do proxy.
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");

  // O corpo bruto e guardado junto com o JSON interpretado: a ingestao de
  // leituras confere a assinatura sobre os bytes exatos que chegaram (RNF19).
  app.use(
    express.json({
      limit: "2mb",
      verify: (req, _res, buffer) => {
        req.corpoBruto = buffer;
      },
    }),
  );

  // CORS restrito a origem do aplicativo. Em desenvolvimento o Vite faz proxy de
  // /api e nem chega a haver requisicao entre origens; isto cobre quem rodar o
  // aplicativo apontando direto para a API.
  app.use((req, res, proximo) => {
    const origem = req.get("origin");

    if (origem && origem === config.origemDoAplicativo) {
      res.set("Access-Control-Allow-Origin", origem);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Assinatura");
      res.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    }

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    proximo();
  });

  // Cabecalhos de seguranca basicos. Uma API JSON nao serve HTML, entao a
  // politica de conteudo pode ser a mais restritiva possivel.
  app.use((_req, res, proximo) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.set("Referrer-Policy", "no-referrer");
    proximo();
  });

  const api = express.Router();

  api.use(rotasDeAutenticacao());
  api.use(rotasDeCarteira());
  api.use(rotasDeCadastro());
  api.use(rotasDePropostas());
  api.use(rotasDeApolices());
  api.use(rotasDeLeituras());
  api.use(rotasDoOraculo());
  api.use(rotasDeImagens());
  api.use(rotasDeAcompanhamento());

  app.use("/api", api);

  app.use((req, _res) => {
    throw naoEncontrado(`Rota ${req.method} ${req.path}`);
  });

  app.use(tratarErros);

  return app;
}
