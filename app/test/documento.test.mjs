/** Mascara e conferencia de CPF e CNPJ no formulario do produtor (RF03). */
import { describe, expect, test } from "vitest";

import { mascararDocumento, problemaDoDocumento } from "../src/cadastro/documento.js";

describe("CPF e CNPJ", () => {
  test("a mascara pontua enquanto se digita, e vira CNPJ depois do 11o digito", () => {
    expect(mascararDocumento("529")).toBe("529");
    expect(mascararDocumento("5299822")).toBe("529.982.2");
    expect(mascararDocumento("52998224725")).toBe("529.982.247-25");
    expect(mascararDocumento("11222333000181")).toBe("11.222.333/0001-81");
    expect(mascararDocumento("abc11.222.333/0001-81999")).toBe("11.222.333/0001-81");
  });

  test("os digitos verificadores sao conferidos", () => {
    expect(problemaDoDocumento("")).toBeNull();
    expect(problemaDoDocumento("529.982.247-25")).toBeNull();
    expect(problemaDoDocumento("11.222.333/0001-81")).toBeNull();
    expect(problemaDoDocumento("529.982.247-26")).toMatch(/CPF invalido/);
    expect(problemaDoDocumento("11.222.333/0001-80")).toMatch(/CNPJ invalido/);
    expect(problemaDoDocumento("111.111.111-11")).toMatch(/iguais/);
    expect(problemaDoDocumento("123")).toMatch(/11 digitos/);
  });
});
