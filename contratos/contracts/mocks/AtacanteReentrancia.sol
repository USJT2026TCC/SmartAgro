// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ApolicePolicy} from "../ApolicePolicy.sol";

/**
 * @title AtacanteReentrancia
 * @notice Contrato malicioso usado apenas em teste (HU03, criterio de aceite 5).
 *
 * Encena o pior cenario possivel: o atacante e, ao mesmo tempo, o produtor
 * beneficiario da apolice e um endereco autorizado no OracleRegistry. Assim, no
 * instante em que recebe a indenizacao, ele ainda detem permissao para chamar
 * `publicarIndices` de novo e tentar sacar uma segunda vez.
 *
 * Se a apolice estiver correta, essa segunda chamada e revertida pela guarda
 * `naoReentrante`, e o contrato registra abaixo o motivo da falha para que o teste
 * possa verificar qual protecao atuou.
 */
contract AtacanteReentrancia {
    ApolicePolicy public apolice;

    /// @notice Quantas vezes o `receive` foi acionado.
    uint256 public vezesRecebido;

    /// @notice Verdadeiro se a tentativa de reentrada foi barrada.
    bool public reentradaFalhou;

    /// @notice Dados de erro devolvidos pela apolice na tentativa de reentrada.
    bytes public ultimoErro;

    /// @dev Periodo usado na tentativa de reentrada.
    uint256 private _periodoDeAtaque;

    function configurar(address apolice_) external {
        apolice = ApolicePolicy(payable(apolice_));
    }

    /**
     * @notice Dispara o ataque: publica um indice que aciona o pagamento.
     * @dev Exige que este contrato esteja autorizado no OracleRegistry.
     */
    function atacar(uint256 periodo, uint32 indiceClimatico, uint16 indiceDanoBps) external {
        _periodoDeAtaque = periodo + 1;

        apolice.publicarIndices(
            periodo,
            indiceClimatico,
            indiceDanoBps,
            10_000,
            keccak256("evidencias-do-atacante"),
            keccak256("modelo-do-atacante")
        );
    }

    /**
     * @dev Chamado pela apolice durante a transferencia da indenizacao. E aqui que a
     *      reentrada acontece, no exato ponto em que um contrato vulneravel ainda
     *      nao teria atualizado o proprio estado.
     */
    receive() external payable {
        vezesRecebido += 1;

        try
            apolice.publicarIndices(
                _periodoDeAtaque,
                type(uint32).max,
                10_000,
                10_000,
                keccak256("reentrada"),
                keccak256("reentrada")
            )
        {
            reentradaFalhou = false;
        } catch (bytes memory erro) {
            reentradaFalhou = true;
            ultimoErro = erro;
        }
    }
}
