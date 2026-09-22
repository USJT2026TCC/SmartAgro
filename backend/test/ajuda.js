import { ethers } from "ethers";
import request from "supertest";

import { criarApp } from "../src/app.js";
import { abrirBanco } from "../src/banco/conexao.js";
import { migrar } from "../src/banco/migrar.js";
import { semear } from "../src/banco/semente.js";
import { interfaceFactory } from "../src/cadeia/rede.js";

/**
 * Infraestrutura comum dos testes.
 *
 * Cada teste recebe um banco PostgreSQL novo, em memoria, com PostGIS, migrado e
 * semeado. Nenhum estado passa de um teste para outro, e nada toca em disco.
 */

export const FABRICA = "0x610178da211fef7d417bc0e6fed39f05609ad788";
export const SEGURADORA_NA_CADEIA = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
export const PRODUTOR_NA_CADEIA = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

/**
 * Leitor da cadeia falso.
 *
 * Os testes da API conferem a regra de negocio — "so aceito a emissao se o hash
 * do contrato bater com o da proposta" — e nao a conversa com o no. O leitor
 * falso responde o que cada teste configurar em `recibos` e `termos`.
 */
export function cadeiaFalsa() {
  const estado = {
    instante: 1_790_000_000,
    recibos: new Map(),
    termos: new Map(),
  };

  return {
    estado,
    disponivel: () => true,
    enderecoDaFabrica: () => FABRICA,
    instanteAtual: async () => estado.instante,
    recibo: async (txHash) => estado.recibos.get(txHash) ?? null,
    termosDaApolice: async (endereco) => estado.termos.get(endereco),
    estadoDaApolice: async () => ({ situacao: 0, valorPago: "0", periodoAcionador: null }),
  };
}

/**
 * Monta um recibo com um evento `ApoliceEmitida` codificado de verdade, pelo
 * mesmo ABI que o backend usa para decodificar.
 */
export function reciboDeEmissao({
  apolice,
  produtor,
  talhao,
  valor,
  hashTermos,
  de = FABRICA,
  status = 1,
}) {
  const { topics, data } = interfaceFactory.encodeEventLog("ApoliceEmitida", [
    apolice,
    produtor,
    talhao,
    valor,
    hashTermos,
  ]);

  return {
    status,
    para: FABRICA,
    bloco: 42,
    logs: [{ endereco: de, topics, data }],
  };
}

/** Sobe a aplicacao com banco novo. */
export async function montar() {
  const banco = await abrirBanco({ emMemoria: true });
  await migrar(banco);
  await semear(banco);

  const cadeia = cadeiaFalsa();
  const app = criarApp({ banco, cadeia });

  return {
    banco,
    cadeia,
    app,
    api: () => request(app),
    async fechar() {
      await banco.fechar();
    },
  };
}

/** Faz login e devolve o token. */
export async function entrar(api, identificador, senha = "agrosmart") {
  const r = await api().post("/api/autenticacao/entrar").send({ identificador, senha });

  if (r.status !== 200)
    throw new Error(`login de ${identificador} falhou: ${r.status} ${JSON.stringify(r.body)}`);

  return r.body.token;
}

/** Cabecalho de autorizacao. */
export const com = (token) => ({ Authorization: `Bearer ${token}` });

/** Identificador de um talhao semeado. */
export async function idDoTalhao(banco, identificador = "talhao-01") {
  const { rows } = await banco.query("SELECT id FROM talhoes WHERE identificador = $1", [
    identificador,
  ]);
  return rows[0].id;
}

/** Identificador de um produto semeado, pelo nome. */
export async function idDoProduto(banco, parteDoNome = "Estiagem — soja") {
  const { rows } = await banco.query("SELECT id FROM produtos WHERE nome = $1", [parteDoNome]);
  return rows[0].id;
}

/** Carteira aleatoria, para testes que precisam de um assinante qualquer. */
export const carteiraAleatoria = () => ethers.Wallet.createRandom();
