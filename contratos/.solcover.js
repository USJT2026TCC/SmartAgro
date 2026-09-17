/**
 * Configuracao do solidity-coverage.
 *
 * Os contratos em `mocks/` existem apenas para encenar ataques nos testes e nunca
 * sao implantados em rede. Inclui-los no relatorio diluiria o indicador exigido
 * pelo RNF14, que se refere aos caminhos condicionais dos contratos de producao.
 */
module.exports = {
  skipFiles: ["mocks/"],
  configureYulOptimizer: true,
};
