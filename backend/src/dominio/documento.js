/**
 * CPF e CNPJ do produtor (RF03).
 *
 * Confere os digitos verificadores pela regra da Receita Federal, e nao so a
 * quantidade de numeros: "111.111.111-11" tem onze digitos e nao e CPF de
 * ninguem. Devolve o documento ja formatado, para que o banco guarde sempre o
 * mesmo jeito de escrever o mesmo numero.
 *
 * O aplicativo tem uma copia desta regra para mascarar o campo e avisar antes
 * de enviar (app/src/cadastro/documento.js); quem decide e esta.
 */

function digito(numeros, pesos) {
  const soma = numeros.reduce((total, n, i) => total + n * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function cpfValido(d) {
  const n = [...d].map(Number);
  const d1 = digito(n.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(n.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return n[9] === d1 && n[10] === d2;
}

function cnpjValido(d) {
  const n = [...d].map(Number);
  const d1 = digito(n.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(n.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return n[12] === d1 && n[13] === d2;
}

/**
 * @param {string} valor CPF ou CNPJ, com ou sem pontuacao
 * @returns {{valido: true, formatado: string, tipo: "cpf"|"cnpj"} | {valido: false, motivo: string}}
 */
export function conferirDocumento(valor) {
  const d = String(valor ?? "").replace(/\D/g, "");

  if (d.length !== 11 && d.length !== 14) {
    return { valido: false, motivo: "CPF tem 11 digitos e CNPJ tem 14." };
  }
  // Todos os digitos iguais passam na conta dos verificadores, mas nao existem.
  if (/^(\d)\1+$/.test(d)) {
    return {
      valido: false,
      motivo: "Numero com todos os digitos iguais nao e um documento valido.",
    };
  }

  if (d.length === 11) {
    return cpfValido(d)
      ? {
          valido: true,
          tipo: "cpf",
          formatado: d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4"),
        }
      : { valido: false, motivo: "CPF invalido: os digitos verificadores nao conferem." };
  }

  return cnpjValido(d)
    ? {
        valido: true,
        tipo: "cnpj",
        formatado: d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5"),
      }
    : { valido: false, motivo: "CNPJ invalido: os digitos verificadores nao conferem." };
}
