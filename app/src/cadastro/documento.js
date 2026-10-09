/**
 * CPF e CNPJ no formulario do produtor (RF03).
 *
 * Copia da regra do backend (backend/src/dominio/documento.js), so para
 * mascarar o campo enquanto se digita e avisar antes de enviar. Quem decide e
 * o servidor: esta conta no navegador poderia ser contornada.
 */

/** Pontua enquanto se digita: ate 11 digitos como CPF, depois como CNPJ. */
export function mascararDocumento(valor) {
  const d = String(valor ?? "")
    .replace(/\D/g, "")
    .slice(0, 14);

  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }

  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

function digito(numeros, pesos) {
  const resto = numeros.reduce((total, n, i) => total + n * pesos[i], 0) % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Mensagem do problema, ou null se o documento e valido (ou esta vazio, porque e opcional). */
export function problemaDoDocumento(valor) {
  const d = String(valor ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length !== 11 && d.length !== 14) return "CPF tem 11 digitos e CNPJ tem 14.";
  if (/^(\d)\1+$/.test(d)) return "Numero com todos os digitos iguais nao e um documento valido.";

  const n = [...d].map(Number);
  if (d.length === 11) {
    const ok =
      n[9] === digito(n.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) &&
      n[10] === digito(n.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return ok ? null : "CPF invalido: os digitos verificadores nao conferem.";
  }
  const ok =
    n[12] === digito(n.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) &&
    n[13] === digito(n.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return ok ? null : "CNPJ invalido: os digitos verificadores nao conferem.";
}
