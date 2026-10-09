/**
 * Confere, antes de enviar, se o arquivo e mesmo JPEG ou PNG.
 *
 * O servidor recusa qualquer outra coisa olhando os primeiros bytes do arquivo,
 * e nao o nome: um ".jpg" que na verdade e WebP (comum em imagem baixada da
 * internet) e recusado. Conferir aqui evita gastar a conexao do campo com um
 * envio que vai voltar recusado, e permite explicar o motivo na hora.
 *
 * Se o navegador nao conseguir ler o arquivo, deixa passar: quem decide e o
 * servidor, e esta conferencia e so uma cortesia.
 *
 * @param {Blob} arquivo
 * @returns {Promise<string|null>} o problema, ou null se parece JPEG ou PNG
 */
export async function problemaDoFormato(arquivo) {
  let bytes;
  try {
    bytes = new Uint8Array(await lerInicio(arquivo, 12));
  } catch {
    return null;
  }

  const comeca = (...b) => b.every((v, i) => bytes[i] === v);
  if (comeca(0xff, 0xd8, 0xff)) return null; // JPEG
  if (comeca(0x89, 0x50, 0x4e, 0x47)) return null; // PNG

  const texto = String.fromCharCode(...bytes);
  if (texto.startsWith("RIFF") && texto.slice(8, 12) === "WEBP") {
    return "Esta imagem esta em WebP, formato que o sistema nao aceita. Tire a foto pela camera ou salve como JPEG.";
  }
  if (texto.slice(4, 12).includes("ftyphei") || texto.slice(4, 12).includes("ftypmif")) {
    return "Esta foto esta em HEIC (padrao do iPhone). Em Ajustes > Camera > Formatos, escolha 'Mais compativel' para gravar em JPEG.";
  }
  return "O arquivo nao e uma imagem JPEG ou PNG, mesmo que o nome termine em .jpg. Escolha a foto original da camera.";
}

function lerInicio(arquivo, quantos) {
  const pedaco = arquivo.slice(0, quantos);
  if (typeof pedaco.arrayBuffer === "function") return pedaco.arrayBuffer();
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(leitor.result);
    leitor.onerror = () => rejeitar(leitor.error);
    leitor.readAsArrayBuffer(pedaco);
  });
}
