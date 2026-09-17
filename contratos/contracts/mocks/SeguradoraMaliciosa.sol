// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ApolicePolicy} from "../ApolicePolicy.sol";

/**
 * @title SeguradoraMaliciosa
 * @notice Seguradora hostil usada apenas em teste.
 *
 * O caminho de saida de valor da apolice tem duas pontas: a indenizacao para o
 * produtor e a devolucao da garantia para a seguradora. A primeira e exercitada
 * pelo AtacanteReentrancia; esta cobre a segunda, que de outro modo ficaria sem
 * teste de reentrancia e sem teste de falha na transferencia.
 *
 * Dois modos, selecionados antes do resgate:
 *  - recusar: rejeita a devolucao, forcando a apolice a reverter a transacao;
 *  - reentrar: chama `resgatarGarantia` de novo durante o proprio recebimento.
 */
contract SeguradoraMaliciosa {
    ApolicePolicy public apolice;

    bool public recusar;
    bool public reentrar;

    uint256 public vezesRecebido;
    bool public reentradaFalhou;
    bytes public ultimoErro;

    error DevolucaoRecusada();

    function configurar(address apolice_) external {
        apolice = ApolicePolicy(payable(apolice_));
    }

    function definirModo(bool recusar_, bool reentrar_) external {
        recusar = recusar_;
        reentrar = reentrar_;
    }

    /// @notice Encaminha o deposito da garantia, ja que a apolice exige o endereco da seguradora.
    function depositar() external payable {
        apolice.depositarGarantia{value: msg.value}();
    }

    function resgatar() external {
        apolice.resgatarGarantia();
    }

    receive() external payable {
        vezesRecebido += 1;

        if (recusar) revert DevolucaoRecusada();

        if (reentrar) {
            try apolice.resgatarGarantia() {
                reentradaFalhou = false;
            } catch (bytes memory erro) {
                reentradaFalhou = true;
                ultimoErro = erro;
            }
        }
    }
}
