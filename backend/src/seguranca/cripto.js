import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import bcrypt from "bcryptjs";
import { generate, generateSecret, generateURI, verify } from "otplib";

import { config } from "../config.js";

/**
 * Primitivas criptograficas do backend, reunidas em um lugar so.
 *
 * Nenhuma delas e inventada aqui: bcrypt para senha, AES-256-GCM para cifrar em
 * repouso, SHA-256 para resumo, TOTP (RFC 6238) para o segundo fator. O codigo so
 * escolhe os parametros e documenta por que.
 */

// ------------------------------------------------------------------ senhas

/**
 * Custo do bcrypt. Cada incremento dobra o tempo de calculo.
 *
 * 12 custa algumas centenas de milissegundos por login — imperceptivel para quem
 * entra, caro para quem tenta adivinhar milhoes de senhas a partir de um banco
 * vazado. Nos testes cai para 4, porque a suite cria dezenas de usuarios e o que
 * se testa ali e a logica, nao a resistencia do hash.
 */
const CUSTO_BCRYPT = config.ambiente === "teste" ? 4 : 12;

/** RNF24: senha guardada com hash e sal. O bcrypt gera e embute o sal. */
export function gerarHashDeSenha(senha) {
  return bcrypt.hash(senha, CUSTO_BCRYPT);
}

export function conferirSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}

/**
 * Hash usado quando o usuario nao existe.
 *
 * Sem ele, o login responderia rapido para usuario inexistente e devagar para
 * usuario existente com senha errada — e a diferenca de tempo revelaria quais
 * identificadores estao cadastrados.
 */
export const HASH_FICTICIO = bcrypt.hashSync("senha-que-ninguem-tem", CUSTO_BCRYPT);

// ------------------------------------------------------------------ resumos

export function sha256Hex(dados) {
  return createHash("sha256").update(dados).digest("hex");
}

/** Token aleatorio de sessao: 32 bytes, suficiente para nao ser adivinhavel. */
export function gerarToken() {
  return randomBytes(32).toString("base64url");
}

/** Comparacao em tempo constante, para chaves de servico. */
export function iguaisEmTempoConstante(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));

  if (bufA.length !== bufB.length) return false;

  return timingSafeEqual(bufA, bufB);
}

// --------------------------------------------------- cifra em repouso

/**
 * Chave de cifra derivada do segredo configurado.
 *
 * Usada para o segredo do TOTP. Guarda-lo em texto claro significaria que um
 * vazamento do banco entregaria, junto, o segundo fator de todos os usuarios —
 * anulando exatamente a protecao que ele existe para dar.
 */
function chaveDeCifra() {
  const segredo =
    process.env.SEGREDO_DE_CIFRA ||
    (config.emProducao ? null : "desenvolvimento-apenas-nao-use-em-producao-chave-de-cifra");

  if (!segredo) throw new Error("SEGREDO_DE_CIFRA nao definido.");

  return createHash("sha256").update(segredo).digest();
}

/** AES-256-GCM. Saida: iv.tag.cifrado, em base64url. */
export function cifrar(textoClaro) {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chaveDeCifra(), iv);
  const cifrado = Buffer.concat([cifra.update(textoClaro, "utf8"), cifra.final()]);
  const tag = cifra.getAuthTag();

  return [iv, tag, cifrado].map((b) => b.toString("base64url")).join(".");
}

export function decifrar(pacote) {
  const [iv, tag, cifrado] = pacote.split(".").map((p) => Buffer.from(p, "base64url"));
  const decifra = createDecipheriv("aes-256-gcm", chaveDeCifra(), iv);
  decifra.setAuthTag(tag);

  return Buffer.concat([decifra.update(cifrado), decifra.final()]).toString("utf8");
}

// ---------------------------------------------------------------- TOTP

/** RF01: segundo fator. Gera um segredo novo e a URI para o aplicativo autenticador. */
export function novoSegredoTotp(identificador) {
  const segredo = generateSecret();
  const uri = generateURI({ secret: segredo, label: identificador, issuer: "AgroSmart" });

  return { segredo, uri };
}

export async function conferirCodigoTotp(segredo, codigo) {
  if (!/^\d{6}$/.test(String(codigo ?? ""))) return false;

  const resultado = await verify({ secret: segredo, token: String(codigo) });

  return Boolean(resultado?.valid);
}

/** Usado apenas pelos testes e pela semente de demonstracao. */
export function gerarCodigoTotp(segredo) {
  return generate({ secret: segredo });
}
