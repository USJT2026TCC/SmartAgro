/** O formato da foto e conferido pelo conteudo antes do envio (RF14). */
import { describe, expect, test } from "vitest";

import { problemaDoFormato } from "../src/fotos/formato.js";

const arquivo = (bytes, nome = "foto.jpg") => new File([new Uint8Array(bytes)], nome);
const ascii = (texto) => [...texto].map((c) => c.charCodeAt(0));

describe("problemaDoFormato", () => {
  test("JPEG e PNG passam, seja qual for o nome", async () => {
    expect(await problemaDoFormato(arquivo([0xff, 0xd8, 0xff, 0xe1, 0, 0]))).toBeNull();
    expect(
      await problemaDoFormato(arquivo([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a], "x.bin")),
    ).toBeNull();
  });

  test("WebP com nome de .jpg e recusado, explicando o motivo", async () => {
    const webp = arquivo([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")], ".JPEG");
    expect(await problemaDoFormato(webp)).toMatch(/WebP/);
  });

  test("HEIC do iPhone recebe a orientacao de como gravar em JPEG", async () => {
    const heic = arquivo([0, 0, 0, 0x18, ...ascii("ftypheic")]);
    expect(await problemaDoFormato(heic)).toMatch(/Mais compativel/);
  });

  test("texto com nome de foto e recusado", async () => {
    expect(await problemaDoFormato(arquivo(ascii("nao sou imagem")))).toMatch(/nao e uma imagem/);
  });
});
