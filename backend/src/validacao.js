import { ethers } from "ethers";

import { pedidoInvalido } from "./erros.js";

/**
 * Validacao de entrada.
 *
 * Funcoes pequenas, sem biblioteca de esquema: a API tem poucas rotas, e cada
 * validacao fica legivel ao lado da regra que ela protege. Toda falha vira 400
 * com a mensagem dizendo qual campo corrigir.
 */

export function texto(valor, campo, { max = 500, obrigatorio = true } = {}) {
  if (valor === undefined || valor === null || String(valor).trim() === "") {
    if (!obrigatorio) return null;
    throw pedidoInvalido(`O campo "${campo}" e obrigatorio.`);
  }

  const limpo = String(valor).trim();
  if (limpo.length > max) throw pedidoInvalido(`O campo "${campo}" excede ${max} caracteres.`);

  return limpo;
}

export function inteiro(
  valor,
  campo,
  { min = -Infinity, max = Infinity, obrigatorio = true } = {},
) {
  if (valor === undefined || valor === null || valor === "") {
    if (!obrigatorio) return null;
    throw pedidoInvalido(`O campo "${campo}" e obrigatorio.`);
  }

  const numero = Number(valor);

  if (!Number.isInteger(numero) || numero < min || numero > max) {
    throw pedidoInvalido(`O campo "${campo}" deve ser um inteiro entre ${min} e ${max}.`);
  }

  return numero;
}

/** Decimal positivo como texto, preservando as casas: "180.5" continua "180.5". */
export function decimalPositivo(valor, campo, { casas = 4 } = {}) {
  const limpo = String(valor ?? "")
    .trim()
    .replace(",", ".");
  const padrao = new RegExp(`^\\d+(\\.\\d{1,${casas}})?$`);

  if (!padrao.test(limpo) || Number(limpo) <= 0) {
    throw pedidoInvalido(`O campo "${campo}" deve ser um numero positivo com ate ${casas} casas.`);
  }

  return limpo;
}

export function endereco(valor, campo) {
  if (!ethers.isAddress(String(valor ?? ""))) {
    throw pedidoInvalido(`O campo "${campo}" nao e um endereco valido.`);
  }

  return String(valor).toLowerCase();
}

export function uuid(valor, campo) {
  const limpo = String(valor ?? "");

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(limpo)) {
    throw pedidoInvalido(`O campo "${campo}" nao e um identificador valido.`);
  }

  return limpo.toLowerCase();
}

export function hashDeTransacao(valor, campo = "txHash") {
  const limpo = String(valor ?? "");

  if (!/^0x[0-9a-fA-F]{64}$/.test(limpo)) {
    throw pedidoInvalido(`O campo "${campo}" nao e um identificador de transacao valido.`);
  }

  return limpo.toLowerCase();
}

/** Periodo no formato AAAAMMDD. */
export function periodo(valor, campo = "periodo") {
  const numero = inteiro(valor, campo, { min: 19000101, max: 29991231 });
  const texto = String(numero);
  const mes = Number(texto.slice(4, 6));
  const dia = Number(texto.slice(6, 8));

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
    throw pedidoInvalido(`O campo "${campo}" deve estar no formato AAAAMMDD.`);
  }

  return numero;
}

export function umDe(valor, campo, opcoes) {
  if (!opcoes.includes(valor)) {
    throw pedidoInvalido(`O campo "${campo}" deve ser um de: ${opcoes.join(", ")}.`);
  }

  return valor;
}
