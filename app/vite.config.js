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
