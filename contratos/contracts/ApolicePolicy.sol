// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OracleRegistry} from "./OracleRegistry.sol";

/**
 * @title ApolicePolicy
 * @notice Apolice de seguro agricola indexado. Uma instancia por contrato firmado.
 *
 * Esta e a metade em cadeia do sistema AgroSmart. Ela guarda os termos, confere a
 * origem do dado, avalia a condicao contratada e transfere a indenizacao, sem
 * intervencao humana em nenhum dos passos.
 *
 * Requisitos atendidos:
 *  RF07 - implantacao parametrizada com condicao, carteira do produtor e oraculo autorizado;
 *  RF08 - resumo criptografico dos termos gravado e legivel por consulta publica;
 *  RF16 - confianca, versao do modelo e resumo das evidencias registrados junto ao resultado;
 *  RF18 - publicacao restrita a enderecos autorizados (delegado ao OracleRegistry);
 *  RF20 - publicacao duplicada para o mesmo periodo e rejeitada;
 *  RF23 - a condicao e avaliada automaticamente a cada publicacao;
 *  RF24 - a transferencia ocorre na mesma transacao do acionamento;
 *  RF25 - pagamento integral ou escalonado por faixa do indice;
 *  RF26 - acionamento duplicado impedido e falha de transferencia nao deixa estado inconsistente;
 *  RNF08 - nenhuma decisao depende de aleatoriedade ou de marca de tempo como entropia;
 *  RNF11 - imune a reentrancia: verificar, atualizar estado, so entao interagir;
 *  RNF12 - controle de acesso por funcao (seguradora, oraculo, produtor);
 *  RNF15 - toda operacao e atomica: ou a publicacao e o pagamento completam, ou a
 *          transacao inteira e revertida.
 *
 * O contrato NAO verifica se o indice esta correto, apenas se quem publicou tinha
 * autorizacao. A confianca na inferencia vem do registro do resumo criptografico das
 * evidencias, da versao do modelo e da possibilidade de reexecutar a analise depois
 * (secao 3.2 da documentacao de software).
 */
contract ApolicePolicy {
    // ---------------------------------------------------------------------
    // Tipos
    // ---------------------------------------------------------------------

    /// @notice Como os dois indices se combinam para acionar o pagamento.
    enum Operador {
        CLIMATICO, // 0 - apenas o indice climatico aciona
        DANO, //      1 - apenas o indice de dano aciona
        OU, //        2 - qualquer um dos dois aciona
        E //          3 - os dois precisam ser atingidos no mesmo periodo
    }

    /// @notice Regra de calculo do valor devido quando a condicao e atendida.
    enum ModoPagamento {
        INTEGRAL, //   0 - paga o limite contratado
        ESCALONADO //  1 - paga proporcionalmente a severidade medida (RF25)
    }

    /// @notice Estado do ciclo de vida da apolice.
    enum Situacao {
        AGUARDANDO_GARANTIA, // 0 - implantada, ainda sem lastro depositado
        ATIVA, //               1 - garantida, apta a receber publicacoes
        LIQUIDADA, //           2 - indenizacao paga
        ENCERRADA //            3 - vigencia vencida sem acionamento, garantia devolvida
    }

    /**
     * @notice Termos imutaveis da apolice, fixados na implantacao.
     * @dev Agrupados em struct para nao estourar a pilha no construtor.
     */
    struct Termos {
        address produtor; // carteira que recebe a indenizacao
        address registry; // OracleRegistry consultado a cada publicacao
        bytes32 cultura; // identificador da cultura segurada
        bytes32 talhao; // identificador do talhao segurado
        Operador operador; // como os indices se combinam
        ModoPagamento modoPagamento; // integral ou escalonado
        uint32 limiarClimatico; // ex.: dias consecutivos sem chuva que acionam
        uint32 limiarClimaticoIntegral; // valor a partir do qual o modo escalonado paga 100%
        uint16 limiarDanoBps; // indice de dano que aciona, em centesimos de ponto percentual
        uint16 limiarDanoIntegralBps; // idem, para o teto do modo escalonado
        uint64 vigenciaInicio; // inicio da cobertura (unix timestamp)
        uint64 vigenciaFim; // fim da cobertura (unix timestamp)
        uint256 valorIndenizacao; // limite maximo indenizavel, em wei
        bytes32 hashTermos; // resumo criptografico dos termos completos (RF08)
    }

    /**
     * @notice Registro de uma publicacao de indices para um periodo.
     * @dev Os campos estao ordenados para caber em dois slots de 256 bits:
     *      slot 0 = oraculo(160) + indiceClimatico(32) + indiceDanoBps(16) +
     *               confiancaBps(16) + publicadoEm(32) = 256 bits exatos;
     *      slot 1 = hashEvidencias; slot 2 = versaoModelo.
     *      O empacotamento economiza uma operacao de escrita por publicacao.
     */
    struct Publicacao {
        address oraculo; // quem publicou
        uint32 indiceClimatico; // indice consolidado das leituras de campo
        uint16 indiceDanoBps; // indice de dano estimado pelo modelo de visao
        uint16 confiancaBps; // grau de confianca do modelo (RF16)
        uint32 publicadoEm; // marca de tempo do bloco, apenas para auditoria
        bytes32 hashEvidencias; // resumo criptografico do lote de imagens (RF16)
        bytes32 versaoModelo; // identificador da versao do modelo (RF16, RNF21)
    }

    // ---------------------------------------------------------------------
    // Constantes
    // ---------------------------------------------------------------------

    /// @notice Base de pontos: 10000 bps = 100,00%.
    uint16 public constant BPS = 10_000;

    /// @dev Piso do modo escalonado: atingido o gatilho, paga-se ao menos metade.
    uint16 private constant PISO_ESCALONADO_BPS = 5_000;

    // ---------------------------------------------------------------------
    // Estado
    // ---------------------------------------------------------------------

    /// @notice Endereco que emitiu a apolice e deposita a garantia.
    address public immutable seguradora;

    /**
     * @notice Termos fixados na implantacao. Nenhuma funcao os altera.
     * @dev Declarado como `private` e exposto por `verTermos()`. O getter que o
     *      compilador geraria para uma struct publica de 14 campos devolve os campos
     *      um a um e estoura o limite de pilha da EVM ("stack too deep"); devolver a
     *      struct inteira de uma vez evita o problema e ainda gasta menos gas na
     *      leitura pelo back-end, que precisa de todos os campos juntos.
     */
    Termos private termos;

    /// @notice Estado atual do ciclo de vida.
    Situacao public situacao;

    /// @notice Valor efetivamente pago ao produtor, em wei.
    uint256 public valorPago;

    /// @notice Periodo que acionou o pagamento. Valido apenas quando LIQUIDADA.
    uint256 public periodoAcionador;

    /// @dev Periodo de referencia => ja publicado (RF20).
    mapping(uint256 => bool) public periodoPublicado;

    /// @dev Periodo de referencia => registro completo da publicacao.
    mapping(uint256 => Publicacao) private _publicacoes;

    /// @notice Periodos publicados, na ordem em que chegaram.
    uint256[] public periodos;

    /// @dev Guarda de reentrancia (RNF11). 1 = livre, 2 = em execucao.
    uint256 private _trava = 1;

    // ---------------------------------------------------------------------
    // Eventos
    // ---------------------------------------------------------------------

    event ApoliceImplantada(
        address indexed seguradora,
        address indexed produtor,
        bytes32 indexed talhao,
        uint256 valorIndenizacao,
        bytes32 hashTermos
    );

    event GarantiaDepositada(address indexed seguradora, uint256 valor);

    event IndicesPublicados(
        uint256 indexed periodo,
        address indexed oraculo,
        uint32 indiceClimatico,
        uint16 indiceDanoBps,
        uint16 confiancaBps,
        bytes32 hashEvidencias,
        bytes32 versaoModelo
    );

    event CondicaoAvaliada(uint256 indexed periodo, bool atendida, uint16 percentualBps);

    event PagamentoExecutado(address indexed produtor, uint256 indexed periodo, uint256 valor);

    event GarantiaResgatada(address indexed seguradora, uint256 valor);

    // ---------------------------------------------------------------------
    // Erros
    // ---------------------------------------------------------------------

    error EnderecoInvalido();
    error ParametroInvalido(string campo);
    error OrigemNaoAutorizada(address chamador);
    error PeriodoJaPublicado(uint256 periodo);
    error SituacaoInvalida(Situacao atual, Situacao esperada);
    error ForaDaVigencia(uint64 agora, uint64 inicio, uint64 fim);
    error GarantiaIncorreta(uint256 enviado, uint256 esperado);
    error VigenciaEmCurso(uint64 agora, uint64 fim);
    error FalhaNaTransferencia(address destino, uint256 valor);
    error ReentranciaDetectada();
    error SemSaldoParaResgatar();
    error DepositoDireto();

    // ---------------------------------------------------------------------
    // Modificadores
    // ---------------------------------------------------------------------

    /**
     * @dev Guarda de reentrancia. Nao usa booleano por economia de gas: alternar
     *      entre 1 e 2 evita o custo mais alto de escrever em um slot zerado.
     */
    modifier naoReentrante() {
        if (_trava != 1) revert ReentranciaDetectada();
        _trava = 2;
        _;
        _trava = 1;
    }

    modifier somenteSeguradora() {
        if (msg.sender != seguradora) revert OrigemNaoAutorizada(msg.sender);
        _;
    }

    /**
     * @dev Controle de acesso do RF18. A lista fica no OracleRegistry, de modo que
     *      revogar um oraculo comprometido nao exige tocar em cada apolice.
     */
    modifier somenteOraculoAutorizado() {
        if (!OracleRegistry(termos.registry).ehAutorizado(msg.sender)) {
            revert OrigemNaoAutorizada(msg.sender);
        }
        _;
    }

    modifier naSituacao(Situacao esperada) {
        if (situacao != esperada) revert SituacaoInvalida(situacao, esperada);
        _;
    }

    // ---------------------------------------------------------------------
    // Construcao
    // ---------------------------------------------------------------------

    /**
     * @param seguradora_ Endereco que emite a apolice e deposita a garantia.
     * @param t Termos completos da cobertura.
     *
     * A validacao e feita aqui porque, depois da implantacao, nada mais pode ser
     * corrigido: uma apolice com limiar invertido ficaria permanentemente quebrada.
     *
     * O Slither aponta complexidade ciclomatica alta (15). Cada ramo e uma
     * validacao independente de um campo dos termos, e todas precisam acontecer
     * antes de o contrato se tornar imutavel. Dividir em funcoes auxiliares so
     * mudaria o numero de lugar, sem reduzir o que precisa ser conferido
     * (Slither: cyclomatic-complexity).
     */
    // slither-disable-next-line cyclomatic-complexity
    constructor(address seguradora_, Termos memory t) {
        if (seguradora_ == address(0)) revert EnderecoInvalido();
        if (t.produtor == address(0)) revert EnderecoInvalido();
        if (t.registry == address(0)) revert EnderecoInvalido();
        if (t.produtor == seguradora_) revert ParametroInvalido("produtor igual a seguradora");
        if (t.valorIndenizacao == 0) revert ParametroInvalido("valorIndenizacao");
        if (t.vigenciaFim <= t.vigenciaInicio) revert ParametroInvalido("vigencia");
        if (t.hashTermos == bytes32(0)) revert ParametroInvalido("hashTermos");
        if (t.limiarDanoBps > BPS) revert ParametroInvalido("limiarDanoBps");
        if (t.limiarDanoIntegralBps > BPS) revert ParametroInvalido("limiarDanoIntegralBps");

        bool usaClimatico = t.operador != Operador.DANO;
        bool usaDano = t.operador != Operador.CLIMATICO;

        if (usaClimatico && t.limiarClimatico == 0) revert ParametroInvalido("limiarClimatico");
        if (usaDano && t.limiarDanoBps == 0) revert ParametroInvalido("limiarDanoBps");

        // No modo escalonado o teto precisa ficar acima do gatilho, senao a
        // interpolacao linear dividiria por zero.
        if (t.modoPagamento == ModoPagamento.ESCALONADO) {
            if (usaClimatico && t.limiarClimaticoIntegral <= t.limiarClimatico) {
                revert ParametroInvalido("limiarClimaticoIntegral");
            }
            if (usaDano && t.limiarDanoIntegralBps <= t.limiarDanoBps) {
                revert ParametroInvalido("limiarDanoIntegralBps");
            }
        }

        seguradora = seguradora_;
        termos = t;
        situacao = Situacao.AGUARDANDO_GARANTIA;

        emit ApoliceImplantada(seguradora_, t.produtor, t.talhao, t.valorIndenizacao, t.hashTermos);
    }

    // ---------------------------------------------------------------------
    // Ciclo de vida
    // ---------------------------------------------------------------------

    /**
     * @notice A seguradora deposita o lastro da indenizacao e ativa a apolice.
     * @dev Sem esta etapa a apolice nao aceita publicacoes: nao faz sentido avaliar
     *      uma condicao cujo pagamento nao teria fundos, porque a transferencia
     *      falharia e reverteria a transacao inteira.
     */
    function depositarGarantia()
        external
        payable
        somenteSeguradora
        naSituacao(Situacao.AGUARDANDO_GARANTIA)
    {
        if (msg.value != termos.valorIndenizacao) {
            revert GarantiaIncorreta(msg.value, termos.valorIndenizacao);
        }

        situacao = Situacao.ATIVA;

        emit GarantiaDepositada(msg.sender, msg.value);
    }

    /**
     * @notice Devolve a seguradora o lastro que nao tem mais destino.
     *
     * @dev Ha duas portas de entrada, e cada uma cobre um caso diferente:
     *
     *  - situacao ATIVA: so depois do fim da vigencia. Ate la a condicao ainda pode
     *    ser acionada, e retirar a garantia deixaria a apolice sem como pagar.
     *
     *  - situacao LIQUIDADA: de imediato. No modo escalonado o pagamento pode ser
     *    parcial, e o que sobra fica retido sem finalidade — depois da liquidacao
     *    nenhuma publicacao e mais aceita, entao esse saldo jamais sera devido a
     *    ninguem. Sem esta porta, a diferenca entre o limite e o valor pago ficaria
     *    presa no contrato para sempre.
     *
     * A apolice liquidada continua LIQUIDADA depois do resgate: trocar para
     * ENCERRADA apagaria, da leitura do estado, o fato de ter havido pagamento.
     * Um segundo resgate e barrado pelo saldo zerado.
     */
    function resgatarGarantia() external naoReentrante somenteSeguradora {
        if (situacao == Situacao.ATIVA) {
            uint64 agora = uint64(block.timestamp);
            // A marca de tempo do bloco e usada como relogio, nao como fonte de
            // aleatoriedade — o RNF08 proibe a segunda, nao a primeira. O
            // validador consegue desviar alguns segundos, o que e irrelevante
            // diante de uma vigencia de meses (Slither: timestamp).
            // slither-disable-next-line timestamp
            if (agora <= termos.vigenciaFim) revert VigenciaEmCurso(agora, termos.vigenciaFim);
        } else if (situacao != Situacao.LIQUIDADA) {
            revert SituacaoInvalida(situacao, Situacao.ATIVA);
        }

        uint256 saldo = address(this).balance;

        // O Slither alerta que o saldo de um contrato pode ser inflado a forca
        // (por selfdestruct de outro contrato), o que quebraria comparacoes de
        // igualdade estrita. Aqui a comparacao so decide se ha algo a devolver:
        // saldo inflado apenas faz a seguradora receber tambem o valor forcado,
        // que de outro modo ficaria preso. Nao ha caminho em que isso prejudique
        // o produtor ou a seguradora (Slither: incorrect-equality).
        // slither-disable-next-line incorrect-equality
        if (saldo == 0) revert SemSaldoParaResgatar();

        // Efeitos antes da interacao (RNF11). A apolice liquidada nao muda de
        // situacao; nela, a protecao contra repeticao e o proprio saldo, que ja
        // esta zerado quando a chamada reentrante chegaria.
        if (situacao == Situacao.ATIVA) situacao = Situacao.ENCERRADA;

        // Evento antes da transferencia, pela mesma razao de publicarIndices: se
        // a transferencia falhar, a reversao leva o evento junto.
        emit GarantiaResgatada(seguradora, saldo);

        // slither-disable-next-line low-level-calls
        (bool ok, ) = seguradora.call{value: saldo}("");
        if (!ok) revert FalhaNaTransferencia(seguradora, saldo);
    }

    // ---------------------------------------------------------------------
    // Travessia: publicacao, avaliacao e liquidacao
    // ---------------------------------------------------------------------

    /**
     * @notice Ponto unico de entrada de dados externos na cadeia.
     *
     * Publica os indices do periodo, avalia a condicao contratada e, se atendida,
     * transfere a indenizacao — tudo na mesma transacao (RF23, RF24).
     *
     * @param periodo Identificador do periodo de referencia (ex.: 20261015 = 15/10/2026).
     * @param indiceClimatico Indice consolidado das leituras de campo.
     * @param indiceDanoBps Indice de dano do modelo de visao, 0 a 10000 (0% a 100%).
     * @param confiancaBps Grau de confianca do modelo, 0 a 10000.
     * @param hashEvidencias Resumo criptografico do lote de imagens analisado.
     * @param versaoModelo Identificador da versao do modelo que produziu o indice.
     *
     * @dev A ordem das operacoes e deliberada e segue verificar, atualizar estado e
     *      so entao interagir. O RNF11 exige as duas protecoes, entao a guarda
     *      `naoReentrante` aparece como primeiro modificador: assim ela e a checagem
     *      mais externa e uma reentrada e barrada antes de qualquer outra validacao.
     */
    function publicarIndices(
        uint256 periodo,
        uint32 indiceClimatico,
        uint16 indiceDanoBps,
        uint16 confiancaBps,
        bytes32 hashEvidencias,
        bytes32 versaoModelo
    ) external naoReentrante somenteOraculoAutorizado naSituacao(Situacao.ATIVA) {
        // ---------- Verificacoes ----------
        if (periodoPublicado[periodo]) revert PeriodoJaPublicado(periodo);
        if (indiceDanoBps > BPS) revert ParametroInvalido("indiceDanoBps");
        if (confiancaBps > BPS) revert ParametroInvalido("confiancaBps");

        uint64 agora = uint64(block.timestamp);
        // Relogio, nao entropia: ver o comentario equivalente em resgatarGarantia.
        // slither-disable-next-line timestamp
        if (agora < termos.vigenciaInicio || agora > termos.vigenciaFim) {
            revert ForaDaVigencia(agora, termos.vigenciaInicio, termos.vigenciaFim);
        }

        // ---------- Efeitos ----------
        periodoPublicado[periodo] = true;
        periodos.push(periodo);
        _publicacoes[periodo] = Publicacao({
            oraculo: msg.sender,
            indiceClimatico: indiceClimatico,
            indiceDanoBps: indiceDanoBps,
            confiancaBps: confiancaBps,
            publicadoEm: uint32(block.timestamp),
            hashEvidencias: hashEvidencias,
            versaoModelo: versaoModelo
        });

        emit IndicesPublicados(
            periodo,
            msg.sender,
            indiceClimatico,
            indiceDanoBps,
            confiancaBps,
            hashEvidencias,
            versaoModelo
        );

        uint16 percentualBps = _percentualDevido(indiceClimatico, indiceDanoBps);
        bool atendida = percentualBps > 0;

        emit CondicaoAvaliada(periodo, atendida, percentualBps);

        if (!atendida) return;

        uint256 valor = (termos.valorIndenizacao * percentualBps) / BPS;

        // Situacao muda ANTES da transferencia. Esta linha e a protecao efetiva
        // contra reentrancia: uma reentrada cairia no modificador naSituacao e
        // seria revertida, porque a apolice ja nao esta ATIVA.
        situacao = Situacao.LIQUIDADA;
        valorPago = valor;
        periodoAcionador = periodo;

        // O evento sai ANTES da transferencia. Pode parecer que anuncia um
        // pagamento que ainda nao aconteceu, mas a atomicidade garante o
        // contrario: se a transferencia falhar, a transacao inteira reverte e o
        // evento some junto. Emitir antes fecha a ordem verificar-efeitos-
        // interacao por completo, porque evento tambem e efeito (Slither:
        // reentrancy-events).
        emit PagamentoExecutado(termos.produtor, periodo, valor);

        // ---------- Interacao ----------
        // `call` e nao `transfer`: `transfer` repassa so 2300 de gas, e falha com
        // produtor que use carteira de contrato, como uma multisig. A protecao
        // contra reentrancia nao depende do limite de gas, e sim da ordem acima
        // e da guarda `naoReentrante` (Slither: low-level-calls).
        // slither-disable-next-line low-level-calls
        (bool ok, ) = termos.produtor.call{value: valor}("");
        if (!ok) revert FalhaNaTransferencia(termos.produtor, valor);
    }

    /**
     * @notice Calcula o percentual devido para um par de indices.
     * @return Percentual em bps. Zero significa condicao nao atendida.
     *
     * @dev Funcao pura e publica de proposito: a aplicacao do produtor a usa para
     *      mostrar, antes do aceite, exatamente o que aciona e o que nao aciona o
     *      pagamento (RNF06), com a garantia de ser a mesma regra da liquidacao.
     */
    function simularPercentual(
        uint32 indiceClimatico,
        uint16 indiceDanoBps
    ) external view returns (uint16) {
        return _percentualDevido(indiceClimatico, indiceDanoBps);
    }

    /**
     * @dev Avalia a condicao contratada e devolve o percentual devido.
     *
     * Regra do modo ESCALONADO (RF25): atingido o gatilho paga-se 50% do limite, e
     * dai em diante o percentual cresce linearmente ate 100% no limiar integral.
     * Com os dois indices acionando, vale o maior dos dois percentuais.
     *
     * Toda a aritmetica e inteira e sem divisao por zero: o construtor ja garantiu
     * que o limiar integral e maior que o gatilho no modo escalonado.
     */
    function _percentualDevido(
        uint32 indiceClimatico,
        uint16 indiceDanoBps
    ) private view returns (uint16) {
        Termos memory t = termos;

        bool climaticoAtingido =
            (t.operador != Operador.DANO) && indiceClimatico >= t.limiarClimatico;
        bool danoAtingido = (t.operador != Operador.CLIMATICO) && indiceDanoBps >= t.limiarDanoBps;

        bool atendida;
        if (t.operador == Operador.CLIMATICO) {
            atendida = climaticoAtingido;
        } else if (t.operador == Operador.DANO) {
            atendida = danoAtingido;
        } else if (t.operador == Operador.OU) {
            atendida = climaticoAtingido || danoAtingido;
        } else {
            atendida = climaticoAtingido && danoAtingido;
        }

        if (!atendida) return 0;
        if (t.modoPagamento == ModoPagamento.INTEGRAL) return BPS;

        // Inicializado explicitamente. O valor padrao da EVM ja seria zero, mas
        // depender disso esconde a intencao: zero aqui significa "nenhum indice
        // escalonou ainda", e o leitor nao deveria ter de lembrar a regra da
        // linguagem para entender o calculo (Slither: uninitialized-local).
        uint16 percentual = 0;

        if (climaticoAtingido) {
            percentual = _interpolar(indiceClimatico, t.limiarClimatico, t.limiarClimaticoIntegral);
        }

        if (danoAtingido) {
            uint16 pd = _interpolar(indiceDanoBps, t.limiarDanoBps, t.limiarDanoIntegralBps);
            if (pd > percentual) percentual = pd;
        }

        return percentual;
    }

    /**
     * @dev Interpolacao linear entre o piso (no gatilho) e 100% (no limiar integral).
     */
    function _interpolar(
        uint256 valor,
        uint256 gatilho,
        uint256 teto
    ) private pure returns (uint16) {
        if (valor >= teto) return BPS;

        uint256 excedente = valor - gatilho;
        uint256 faixa = teto - gatilho;
        uint256 acrescimo = ((BPS - PISO_ESCALONADO_BPS) * excedente) / faixa;

        return uint16(PISO_ESCALONADO_BPS + acrescimo);
    }

    // ---------------------------------------------------------------------
    // Consultas
    // ---------------------------------------------------------------------

    /**
     * @notice Devolve os termos contratados.
     * @dev Consulta publica exigida pelo RF08: qualquer interessado pode ler o
     *      `hashTermos` gravado e compara-lo com o resumo do documento que assinou.
     */
    function verTermos() external view returns (Termos memory) {
        return termos;
    }

    /// @notice Devolve o registro completo de uma publicacao (RNF20).
    function publicacao(uint256 periodo) external view returns (Publicacao memory) {
        return _publicacoes[periodo];
    }

    /// @notice Quantidade de periodos ja publicados.
    function totalPeriodos() external view returns (uint256) {
        return periodos.length;
    }

    /// @notice Saldo de garantia ainda retido pelo contrato, em wei.
    function garantiaRetida() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @dev Rejeita transferencias avulsas. O unico caminho de entrada de valor e
     *      depositarGarantia(), de modo que o saldo do contrato sempre corresponde
     *      a um lastro identificado.
     */
    receive() external payable {
        revert DepositoDireto();
    }
}
