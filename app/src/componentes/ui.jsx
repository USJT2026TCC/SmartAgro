import { linkDoExplorador } from "../cadeia/rede";
import { enderecoCurto, hashCurto, rotuloSituacao } from "../cadeia/formatos";

/**
 * Componentes pequenos e sem estado, usados por varias telas.
 *
 * Ficam todos em um arquivo de proposito: sao peças de cinco a quinze linhas, e
 * espalha-las em um arquivo cada tornaria mais trabalhoso descobrir o que ja
 * existe do que escrever de novo.
 */

/** Caixa de aviso. `tipo` define a cor: informacao, sucesso, alerta ou erro. */
export function Aviso({ tipo = "informacao", titulo, children }) {
  return (
    <div className={`aviso ${tipo}`} role={tipo === "erro" ? "alert" : "status"}>
      {titulo ? <strong>{titulo}</strong> : null}
      {titulo ? <br /> : null}
      {children}
    </div>
  );
}

/** Selo colorido da situacao da apolice. */
export function SeloSituacao({ situacao }) {
  const cores = { 0: "alerta", 1: "informacao", 2: "sucesso", 3: "neutro" };

  return <span className={`selo ${cores[situacao] ?? "neutro"}`}>{rotuloSituacao(situacao)}</span>;
}

/** Selo generico. */
export function Selo({ tipo = "neutro", children }) {
  return <span className={`selo ${tipo}`}>{children}</span>;
}

/** Indicador numerico do painel. */
export function Indicador({ rotulo, valor, nota }) {
  return (
    <div className="indicador">
      <div className="rotulo">{rotulo}</div>
      <div className="valor">{valor}</div>
      {nota ? <div className="nota">{nota}</div> : null}
    </div>
  );
}

/** Campo de formulario com rotulo e texto de ajuda. */
export function Campo({ rotulo, ajuda, children, htmlFor }) {
  return (
    <div className="campo">
      <label htmlFor={htmlFor}>{rotulo}</label>
      {children}
      {ajuda ? <div className="ajuda">{ajuda}</div> : null}
    </div>
  );
}

/** Estado de carregamento. */
export function Carregando({ children = "Consultando a rede…" }) {
  return <div className="carregando">{children}</div>;
}

/**
 * Endereco ou hash com link para o explorador de blocos, quando a rede tiver um.
 *
 * Em rede local nao existe explorador, entao o componente mostra apenas o texto —
 * um link quebrado no meio da demonstracao seria pior do que nenhum link.
 */
export function LinkDaCadeia({ valor, tipo = "tx", curto = true }) {
  if (!valor) return <span className="silencioso">—</span>;

  const texto = curto ? (tipo === "address" ? enderecoCurto(valor) : hashCurto(valor)) : valor;
  const href = linkDoExplorador(valor, tipo);

  if (!href) {
    return (
      <span className="mono" title={valor}>
        {texto}
      </span>
    );
  }

  return (
    <a className="mono" href={href} target="_blank" rel="noreferrer" title={valor}>
      {texto}
    </a>
  );
}

/** Rodape que lembra de que lado da fronteira o dado da tela veio. */
export function RodapeDaFronteira({ children }) {
  return <p className="rodape-fronteira">{children}</p>;
}
