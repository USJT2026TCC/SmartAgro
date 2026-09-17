// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ApolicePolicy} from "./ApolicePolicy.sol";
import {OracleRegistry} from "./OracleRegistry.sol";

/**
 * @title ApoliceFactory
 * @notice Implanta apolices e mantem o indice de quais existem.
 *
 * Atende ao RF07 (implantar na rede, na contratacao, o contrato da apolice
 * parametrizado). Sem esta peca, o back-end precisaria guardar por conta propria a
 * lista de enderecos implantados, e essa lista deixaria de ser auditavel na cadeia.
 *
 * A fabrica nao custodia valor: a garantia e depositada pela seguradora diretamente
 * na apolice, para que o endereco pagador continue sendo o da seguradora.
 */
contract ApoliceFactory {
    /// @notice Registro de oraculos que toda apolice desta fabrica consulta.
    OracleRegistry public immutable registry;

    /// @notice Seguradora que opera a fabrica.
    address public immutable seguradora;

    /// @notice Todas as apolices implantadas, na ordem de emissao.
    address[] public apolices;

    /// @dev Produtor => apolices em que ele figura como beneficiario.
    mapping(address => address[]) private _apolicesPorProdutor;

    /// @dev Talhao => apolices emitidas para ele.
    mapping(bytes32 => address[]) private _apolicesPorTalhao;

    event ApoliceEmitida(
        address indexed apolice,
        address indexed produtor,
        bytes32 indexed talhao,
        uint256 valorIndenizacao,
        bytes32 hashTermos
    );

    error NaoEhSeguradora(address chamador);
    error EnderecoInvalido();

    modifier somenteSeguradora() {
        if (msg.sender != seguradora) revert NaoEhSeguradora(msg.sender);
        _;
    }

    constructor(address registry_, address seguradora_) {
        if (registry_ == address(0) || seguradora_ == address(0)) revert EnderecoInvalido();

        registry = OracleRegistry(registry_);
        seguradora = seguradora_;
    }

    /**
     * @notice Implanta uma apolice parametrizada.
     * @dev O campo `registry` dos termos e sobrescrito com o registro desta fabrica,
     *      para que nenhuma apolice emitida aqui aponte para uma lista de oraculos
     *      diferente da acordada.
     * @return apolice Endereco do contrato recem-implantado.
     */
    function emitirApolice(
        ApolicePolicy.Termos memory termos
    ) external somenteSeguradora returns (address apolice) {
        termos.registry = address(registry);

        ApolicePolicy nova = new ApolicePolicy(seguradora, termos);
        apolice = address(nova);

        apolices.push(apolice);
        _apolicesPorProdutor[termos.produtor].push(apolice);
        _apolicesPorTalhao[termos.talhao].push(apolice);

        emit ApoliceEmitida(
            apolice,
            termos.produtor,
            termos.talhao,
            termos.valorIndenizacao,
            termos.hashTermos
        );
    }

    /// @notice Quantidade total de apolices emitidas.
    function totalApolices() external view returns (uint256) {
        return apolices.length;
    }

    /// @notice Apolices em que o endereco figura como produtor beneficiario.
    function apolicesDoProdutor(address produtor) external view returns (address[] memory) {
        return _apolicesPorProdutor[produtor];
    }

    /// @notice Apolices emitidas para um talhao.
    function apolicesDoTalhao(bytes32 talhao) external view returns (address[] memory) {
        return _apolicesPorTalhao[talhao];
    }
}
