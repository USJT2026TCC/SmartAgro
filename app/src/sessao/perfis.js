/**
 * Perfis de acesso (RF04).
 *
 * Quem decide o que cada perfil pode fazer e o backend: esta lista so serve para
 * a interface montar o menu certo e mostrar o rotulo legivel.
 */

export const PERFIS = {
  PRODUTOR: "produtor",
  SEGURADORA: "seguradora",
  PERITO: "perito",
};

export const ROTULOS_DE_PERFIL = {
  [PERFIS.PRODUTOR]: "Produtor rural",
  [PERFIS.SEGURADORA]: "Seguradora",
  [PERFIS.PERITO]: "Perito agronomo",
};

/**
 * Usuarios semeados pelo backend em desenvolvimento.
 *
 * Aparecem como atalho na tela de login apenas em `npm run dev`. A senha nao e
 * conferida aqui — quem confere e o backend, contra o hash bcrypt no banco.
 */
export const USUARIOS_DE_DEMONSTRACAO = [
  {
    identificador: "produtor",
    perfil: PERFIS.PRODUTOR,
    descricao: "Fazenda Santa Clara — Ribeirao Preto/SP",
  },
  {
    identificador: "seguradora",
    perfil: PERFIS.SEGURADORA,
    descricao: "AgroSeguro Mutua — mesa de subscricao",
  },
  {
    identificador: "perito",
    perfil: PERFIS.PERITO,
    descricao: "CREA 123456/SP — engenheiro agronomo",
  },
];

export const SENHA_DE_DEMONSTRACAO = "agrosmart";

/**
 * Para onde ir depois do login.
 *
 * O endereco guardado e o da ultima tela aberta, que pode ser de outro perfil:
 * quem sai como seguradora e entra como perito voltaria para uma tela da
 * seguradora e cairia em "Sem acesso". Tela de outro perfil vira a tela
 * inicial do perfil que acabou de entrar; telas comuns (apolice, avisos, conta)
 * continuam valendo.
 */
export function destinoAposEntrar(destino, perfil) {
  const dono = Object.values(PERFIS).find(
    (p) => destino === `/${p}` || destino.startsWith(`/${p}/`),
  );
  return dono && dono !== perfil ? "/" : destino;
}
