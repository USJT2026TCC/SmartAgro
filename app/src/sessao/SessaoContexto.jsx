import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { autenticar } from "./usuarios";

/**
 * Sessao do usuario e controle de acesso por perfil (RF04).
 *
 * A sessao vive em `sessionStorage`, e nao em `localStorage`, para que fechar a
 * aba encerre a sessao — o criterio de aceite 3 da HU13 pede que sessao expirada
 * leve de volta ao login.
 */

const ContextoSessao = createContext(null);

const CHAVE = "agrosmart:sessao";

export function ProvedorSessao({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    try {
      const guardado = sessionStorage.getItem(CHAVE);
      if (guardado) setUsuario(JSON.parse(guardado));
    } catch {
      // Sessao corrompida nao pode impedir o login; simplesmente recomeca.
      sessionStorage.removeItem(CHAVE);
    } finally {
      setCarregando(false);
    }
  }, []);

  const entrar = useCallback((identificador, senha) => {
    const encontrado = autenticar(identificador, senha);

    if (!encontrado) return { ok: false, erro: "Identificador ou senha invalidos." };

    sessionStorage.setItem(CHAVE, JSON.stringify(encontrado));
    setUsuario(encontrado);

    return { ok: true, usuario: encontrado };
  }, []);

  const sair = useCallback(() => {
    sessionStorage.removeItem(CHAVE);
    setUsuario(null);
  }, []);

  const valor = useMemo(
    () => ({
      usuario,
      carregando,
      autenticado: Boolean(usuario),
      perfil: usuario?.perfil ?? null,
      entrar,
      sair,
    }),
    [usuario, carregando, entrar, sair],
  );

  return <ContextoSessao.Provider value={valor}>{children}</ContextoSessao.Provider>;
}

export function useSessao() {
  const contexto = useContext(ContextoSessao);

  if (!contexto) throw new Error("useSessao precisa estar dentro de ProvedorSessao.");

  return contexto;
}
