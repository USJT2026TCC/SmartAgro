import { criarApp } from "./app.js";
import { config } from "./config.js";
import { abrirBanco } from "./banco/conexao.js";
import { migrar } from "./banco/migrar.js";
import { semear } from "./banco/semente.js";
import { criarIndexador } from "./cadeia/indexador.js";
import { criarLeitorDaCadeia } from "./cadeia/leitor.js";
import { encerrarProvedor } from "./cadeia/rede.js";

/**
 * Ponto de entrada do backend.
 *
 * Na ordem: abre o banco, aplica as migracoes, semeia a demonstracao (so em
 * desenvolvimento e com banco vazio), liga o indexador e abre a porta.
 */
async function iniciar() {
  const banco = await abrirBanco();
  const aplicadas = await migrar(banco);

  if (aplicadas.length > 0) console.log(`Migracoes aplicadas: ${aplicadas.join(", ")}`);

  if (!config.emProducao && (await semear(banco))) {
    console.log(
      "Dados de demonstracao criados. Usuarios: produtor, seguradora, perito (senha: agrosmart).",
    );
  }

  const cadeia = criarLeitorDaCadeia();
  const indexador = config.indexadorAtivo ? criarIndexador(banco) : null;

  const app = criarApp({ banco, cadeia, indexador });

  const servidor = app.listen(config.porta, () => {
    console.log(`AgroSmart backend em http://localhost:${config.porta}/api`);
    console.log(`Banco: ${banco.motor}${config.urlDoBanco ? "" : ` (${config.dirBanco})`}`);
    console.log(
      cadeia.disponivel()
        ? `Cadeia: ${config.rede}, fabrica ${cadeia.enderecoDaFabrica()}`
        : `Cadeia: nenhuma implantacao encontrada para "${config.rede}"; indexador em espera.`,
    );
  });

  indexador?.iniciar();

  // Encerramento limpo: para o indexador, fecha a porta e o banco. Sem isso, o
  // PGlite pode ficar com o diretorio de dados travado ate o proximo inicio.
  const encerrar = async (sinal) => {
    console.log(`\n${sinal} recebido, encerrando...`);
    indexador?.parar();
    servidor.close();
    encerrarProvedor();
    await banco.fechar();
    process.exit(0);
  };

  process.on("SIGINT", () => encerrar("SIGINT"));
  process.on("SIGTERM", () => encerrar("SIGTERM"));
}

iniciar().catch((erro) => {
  console.error("Falha ao iniciar o backend:", erro);
  process.exit(1);
});
