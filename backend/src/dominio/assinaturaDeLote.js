import { ethers } from "ethers";

import { sha256Hex } from "../seguranca/cripto.js";

/**
 * Autenticacao das leituras na origem (RNF19).
 *
 * Cada fonte — estacao ou sensor — tem um par de chaves, do mesmo tipo usado na
 * cadeia. O lote de leituras chega assinado, e a API so o aceita se a assinatura
 * tiver sido produzida pela chave registrada para aquela fonte.
 *
 * POR QUE ASSINAR O CORPO BRUTO
 *
 * A assinatura cobre os bytes exatos da requisicao, e nao um JSON reconstruido.
 * Reconstruir e reserializar abre espaco para divergencia entre linguagens: o
 * simulador e escrito em Python, e `json.dumps(0.0)` produz "0.0" onde o
 * JavaScript produz "0". Assinando os bytes que de fato trafegaram, o problema
 * desaparece — cada lado so precisa calcular SHA-256 sobre o mesmo corpo.
 *
 * FORMATO DA MENSAGEM ASSINADA (EIP-191, personal_sign)
 *
 *     AgroSmart:leituras:v1
 *     sha256:<resumo hexadecimal do corpo>
 *
 * Em Python, com a biblioteca eth_account:
 *
 *     corpo = json.dumps(lote).encode()
 *     mensagem = f"AgroSmart:leituras:v1\nsha256:{hashlib.sha256(corpo).hexdigest()}"
 *     assinatura = Account.sign_message(encode_defunct(text=mensagem), chave).signature.hex()
 *
 * A assinatura vai no cabecalho `X-Assinatura`, e o corpo segue inalterado.
 */

export const PREFIXO_DA_MENSAGEM = "AgroSmart:leituras:v1";

/** Mensagem que a fonte assina para um corpo de requisicao. */
export function mensagemDoLote(corpoBruto) {
  return `${PREFIXO_DA_MENSAGEM}\nsha256:${sha256Hex(corpoBruto)}`;
}

/**
 * Recupera o endereco que assinou o corpo.
 * @returns {string|null} Endereco em minusculas, ou nulo se a assinatura for invalida.
 */
export function recuperarAssinante(corpoBruto, assinatura) {
  if (!assinatura || !/^0x[0-9a-fA-F]{130}$/.test(assinatura)) return null;

  try {
    return ethers.verifyMessage(mensagemDoLote(corpoBruto), assinatura).toLowerCase();
  } catch {
    return null;
  }
}

/** Assina um corpo. Usado pelo script de envio e pelos testes. */
export function assinarLote(corpoBruto, carteira) {
  return carteira.signMessage(mensagemDoLote(corpoBruto));
}
