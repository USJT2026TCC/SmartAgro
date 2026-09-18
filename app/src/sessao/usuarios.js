/**
 * Cadastro de usuarios do prototipo.
 *
 * ATENCAO — esta e a peca provisoria do aplicativo.
 *
 * O RF01 pede login com identificador e senha, e o RNF24 exige senha guardada com
 * hash e sal (bcrypt ou Argon2). Nada disso pode ser feito de forma honesta apenas
 * no navegador: qualquer verificacao que rode no cliente pode ser contornada, e um
 * hash conferido no front-end nao protege nada, porque o que ele protegeria estaria
 * do lado do servidor.
 *
 * Entao a escolha aqui foi a menos enganosa: senhas em texto claro, visiveis no
 * codigo, num arquivo que diz com todas as letras que sao de demonstracao. Um
 * esquema de hash no navegador daria aparencia de seguranca sem nenhuma seguranca,
 * o que e pior do que a ausencia declarada.
 *
 * A autenticacao de verdade entra com a API, na Sprint 2, e e la que o RNF24 sera
 * atendido. O contrato inteligente nao depende disto: quem pode publicar indice e
 * quem pode mover valor e decidido na cadeia, por endereco, e nao por este login.
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

/** Usuarios de demonstracao. Trocados pela API na Sprint 2. */
export const USUARIOS = [
  {
    identificador: "produtor",
    senha: "agrosmart",
    nome: "Joao Ribeiro",
    perfil: PERFIS.PRODUTOR,
    documento: "Fazenda Santa Clara — Ribeirao Preto/SP",
  },
  {
    identificador: "seguradora",
    senha: "agrosmart",
    nome: "Marina Costa",
    perfil: PERFIS.SEGURADORA,
    documento: "AgroSeguro Mutua — mesa de subscricao",
  },
  {
    identificador: "perito",
    senha: "agrosmart",
    nome: "Carlos Nakamura",
    perfil: PERFIS.PERITO,
    documento: "CREA 123456/SP — engenheiro agronomo",
  },
];

/**
 * Confere as credenciais informadas.
 * @returns {object|null} O usuario, sem a senha, ou nulo se nao conferir.
 */
export function autenticar(identificador, senha) {
  const usuario = USUARIOS.find(
    (u) => u.identificador === String(identificador).trim().toLowerCase(),
  );

  if (!usuario || usuario.senha !== senha) return null;

  const { senha: _descartada, ...semSenha } = usuario;

  return semSenha;
}
