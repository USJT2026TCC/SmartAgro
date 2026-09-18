import { Navigate, useLocation } from "react-router-dom";

import { useSessao } from "../sessao/SessaoContexto";
import { Carregando } from "./ui";

/**
 * Controle de acesso por perfil (RF04, e o criterio de aceite 4 da HU13).
 *
 * Esconder o link no menu nao protege nada: qualquer pessoa pode digitar o
 * endereco na barra do navegador. E aqui que a rota de outro perfil e recusada.
 *
 * Vale registrar o limite disso. Esta verificacao roda no navegador, e um cliente
 * adulterado pode ignora-la. Ela protege contra o acesso acidental, nao contra o
 * mal-intencionado. O controle que resiste a adversario esta na cadeia, por
 * endereco: mesmo que alguem force a tela da seguradora, a transacao seria
 * revertida com `NaoEhSeguradora`, porque quem decide la e o contrato.
 */
export default function RotaProtegida({ perfis, children }) {
  const { autenticado, perfil, carregando } = useSessao();
  const local = useLocation();

  if (carregando) return <Carregando>Verificando a sessao…</Carregando>;

  if (!autenticado) {
    // Guarda o destino para voltar a ele depois do login.
    return <Navigate to="/entrar" replace state={{ de: local.pathname }} />;
  }

  if (perfis && !perfis.includes(perfil)) {
    return <Navigate to="/sem-acesso" replace />;
  }

  return children;
}
