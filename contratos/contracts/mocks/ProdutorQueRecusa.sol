// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProdutorQueRecusa
 * @notice Beneficiario que rejeita qualquer transferencia. Usado apenas em teste.
 *
 * Serve para comprovar o RF26 e o RNF15: quando a transferencia falha, a apolice
 * reverte a transacao inteira, de modo que o periodo nao fica marcado como publicado
 * e a situacao nao muda para LIQUIDADA. Nao ha, portanto, pagamento parcial nem
 * estado inconsistente.
 */
contract ProdutorQueRecusa {
    error PagamentoRecusado();

    receive() external payable {
        revert PagamentoRecusado();
    }
}
