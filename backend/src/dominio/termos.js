import { ethers } from "ethers";

/**
 * Termos da apolice e o resumo criptografico deles (RF08).
 *
 * O contrato guarda `hashTermos`, o keccak256 de um texto que descreve tudo o que
 * foi acordado. Para esse resumo servir de prova, tres coisas precisam valer:
 *
 *  1. o texto e deterministico — os mesmos termos produzem sempre o mesmo texto;
 *  2. o texto e guardado, para que o resumo possa ser recalculado depois;
 *  3. o resumo gravado no contrato e conferido contra o que foi gerado aqui.
 *
 * Antes do backend, o aplicativo montava o texto no navegador, e ninguem conferia
 * o terceiro ponto. Agora o texto nasce aqui, fica no banco, e a emissao so e
 * aceita depois que o `hashTermos` lido do contrato implantado bate com ele.
 */

/** Texto em bytes32, como o contrato espera para cultura e talhao. */
export function paraBytes32(texto) {
  const valor = String(texto);

  if (ethers.toUtf8Bytes(valor).length > 31) {
    throw new Error(`"${valor}" excede os 31 bytes de um bytes32.`);
  }

  return ethers.encodeBytes32String(valor);
}

/**
 * Descricao canonica dos termos.
 *
 * Campo por campo, em ordem fixa, separados por "|". Nada de JSON: a ordem das
 * chaves de um objeto e um detalhe de implementacao, e um resumo que muda porque
 * alguem reordenou um objeto nao prova nada.
 */
export function descreverTermos(t) {
  return [
    "AgroSmart:v1",
    `apolice-de-proposta:${t.propostaId}`,
    `produtor:${t.carteiraProdutor.toLowerCase()}`,
    `talhao:${t.talhao}`,
    `cultura:${t.cultura}`,
    `area-ha:${t.areaHa}`,
    `operador:${t.operador}`,
    `modo:${t.modoPagamento}`,
    `limiar-climatico:${t.limiarClimatico}`,
    `limiar-climatico-integral:${t.limiarClimaticoIntegral}`,
    `limiar-dano-bps:${t.limiarDanoBps}`,
    `limiar-dano-integral-bps:${t.limiarDanoIntegralBps}`,
    `limite-wei:${t.valorIndenizacaoWei}`,
    `premio-wei:${t.premioWei}`,
    `vigencia-inicio:${t.vigenciaInicio}`,
    `vigencia-fim:${t.vigenciaFim}`,
  ].join("|");
}

export function resumirTermos(descricao) {
  return ethers.keccak256(ethers.toUtf8Bytes(descricao));
}

/**
 * Struct `Termos` exatamente como `ApoliceFactory.emitirApolice` espera.
 *
 * Valores grandes vao como texto decimal: o JSON nao representa BigInt, e um
 * Number perderia precisao acima de 2^53. O ethers aceita o texto e converte.
 */
export function montarStructDeTermos(t, hashTermos) {
  return {
    produtor: ethers.getAddress(t.carteiraProdutor),
    registry: ethers.ZeroAddress, // a fabrica sobrescreve com o registro oficial
    cultura: paraBytes32(t.cultura),
    talhao: paraBytes32(t.talhao),
    operador: t.operador,
    modoPagamento: t.modoPagamento,
    limiarClimatico: t.limiarClimatico,
    limiarClimaticoIntegral: t.limiarClimaticoIntegral,
    limiarDanoBps: t.limiarDanoBps,
    limiarDanoIntegralBps: t.limiarDanoIntegralBps,
    vigenciaInicio: t.vigenciaInicio,
    vigenciaFim: t.vigenciaFim,
    valorIndenizacao: String(t.valorIndenizacaoWei),
    hashTermos,
  };
}
