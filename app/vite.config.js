import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Configuracao do aplicativo do AgroSmart.
 *
 * A porta e fixa em 5173 porque o roteiro de demonstracao do manual da equipe
 * cita o endereco, e porque a MetaMask guarda a permissao de conexao por origem:
 * mudar de porta a cada execucao faria o navegador pedir autorizacao de novo.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // O aplicativo chama a API em /api, na mesma origem. Em desenvolvimento, o
    // Vite repassa ao backend; em producao, o proxy reverso faz o mesmo papel.
    // Mesma origem significa nenhuma requisicao entre origens, e o CORS deixa
    // de ser uma superficie de erro de configuracao.
    proxy: {
      "/api": {
        target: process.env.VITE_API_ALVO || "http://localhost:3001",
        changeOrigin: false,
      },
    },
  },
  // Testes (RNF03): Vitest no mesmo pipeline do Vite, com as telas renderizadas
  // em jsdom. A cobertura conta TODO o src, inclusive arquivos que nenhum teste
  // carrega; sem isso, o numero mediria so o que ja foi testado.
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{js,mjs,jsx}"],
    setupFiles: ["test/preparar.js"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{js,jsx}"],
      exclude: ["src/main.jsx", "src/cadeia/implantacoes.json"],
      reporter: ["text-summary", "text"],
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        // O ethers responde por quase todo o peso do pacote e quase nunca muda.
        // Separa-lo faz o navegador reaproveitar o arquivo entre versoes do app.
        // No Vite 8 (Rolldown) a opcao so aceita a forma de funcao.
        manualChunks: (id) => (/node_modules[\\/](ethers|@noble|@adraffy)[\\/]/.test(id) ? "ethers" : undefined),
      },
    },
  },
});
