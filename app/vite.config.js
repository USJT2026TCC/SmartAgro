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
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        // O ethers responde por quase todo o peso do pacote e quase nunca muda.
        // Separa-lo faz o navegador reaproveitar o arquivo entre versoes do app.
        manualChunks: { ethers: ["ethers"] },
      },
    },
  },
});
