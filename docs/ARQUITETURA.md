# Arquitetura

Este documento explica como as peças implementadas se encaixam e, principalmente, **por que a
fronteira entre computação externa e execução em cadeia fica onde fica**. É a decisão que
define o trabalho; tudo o mais decorre dela.

---

## 1. O critério da fronteira

A pergunta de pesquisa do TCC é como projetar uma ponte auditável entre uma computação
externa — não determinística e intensiva em processamento — e uma execução contratual em
cadeia, determinística e cara.

O critério adotado é direto:

> **Fora da cadeia** fica o que é pesado, probabilístico ou muda com frequência.
> **Na cadeia** fica o que precisa ser confiável sem depender de quem executa.

Aplicando:

| Operação | Onde | Por quê |
|---|---|---|
| Ingestão de leituras de sensores | Fora | Volume alto, custo por byte na cadeia é proibitivo |
| Validação de plausibilidade | Fora | Regra que muda conforme o instrumento e a cultura |
| Escore de reputação das fontes | Fora | Precisa de histórico longo; armazená-lo em cadeia seria caríssimo |
| Inferência do modelo de visão | Fora | Pesada, probabilística e dependente da versão do modelo |
| Consolidação do índice | Fora | Depende dos três itens acima |
| **Assinatura e submissão** | **Ponte** | É o ato que cruza a fronteira |
| Termos da apólice e resumo criptográfico | Na cadeia | Precisam ser imutáveis e verificáveis por terceiros |
| Lista de endereços autorizados | Na cadeia | É o controle de acesso que sustenta tudo |
| Avaliação da condição contratada | Na cadeia | É a decisão que ninguém pode contestar depois |
| Transferência da indenização | Na cadeia | É o ato que move valor |

## 2. O que atravessa a fronteira

Uma única chamada de função, com seis argumentos:

```solidity
publicarIndices(
    uint256 periodo,          // dia de referência, no formato AAAAMMDD
    uint32  indiceClimatico,  // dias consecutivos sem chuva
    uint16  indiceDanoBps,    // índice de dano do modelo, 0 a 10000
    uint16  confiancaBps,     // confiança do modelo, 0 a 10000
    bytes32 hashEvidencias,   // resumo criptográfico do lote de imagens
    bytes32 versaoModelo      // identificador da versão do modelo
)
```

Repare no que **não** atravessa: nenhuma imagem, nenhum peso de rede neural, nenhuma leitura
bruta de sensor. Apenas números e resumos criptográficos.

Essa é a resposta técnica do trabalho ao problema do oráculo. A inferência não é replicada na
cadeia — seria impossível. O que fica registrado é o suficiente para **reexecutá-la depois**:
o hash prova qual lote de imagens foi analisado, a versão diz qual modelo produziu o número, e
a confiança diz o quanto o próprio modelo acreditava no resultado.

O contrato não verifica se o índice está correto. Ele verifica se **quem publicou tinha
autorização**. A confiança no valor vem da possibilidade de auditoria posterior, não de uma
checagem em tempo de execução.

## 3. Os componentes implementados

### 3.1 Na cadeia — `contratos/`

```
  OracleRegistry                 ApoliceFactory
  ──────────────                 ──────────────
  lista de endereços             emite e indexa apólices
  autorizados a publicar         (uma por contrato firmado)
         ▲                                │
         │ consultado a cada              │ implanta
         │ publicação                     ▼
         └──────────────────────  ApolicePolicy
                                  ─────────────
                                  termos imutáveis + hash
                                  avaliação da condição
                                  transferência da indenização
```

**Por que o registro é um contrato separado?** Se a lista de oráculos vivesse dentro de cada
apólice, revogar um endereço comprometido exigiria uma transação por apólice. Com dez mil
apólices ativas, isso é inviável — e o RNF04 pede suporte a dez mil talhões monitorados. Com
o registro compartilhado, a revogação é uma transação só e passa a valer imediatamente para
toda a carteira.

O custo dessa escolha é uma chamada externa de leitura por publicação. Está medido: aparece na
diferença entre os 172 mil de gas de uma publicação comum e o que ela custaria com a lista
embutida. É um trade-off consciente, discutido em [DECISOES.md](DECISOES.md).

### 3.2 Fora da cadeia — `oraculo/`

```
  fonteSimulada ──► consolidador ──► fila ──► publicador ──► registro
   (leituras)       (RF12, RF13,    (RF21)   (RF19, RF22)   (RNF20)
                     RF19)             │
                       ▲               │
                       │               ▼
                   reputacao        disco: a entrada só sai
                    (RF13)          depois da confirmação
```

A ordem importa e não é acidental. **A consolidação grava em disco antes de qualquer tentativa
de publicação.** Entre consolidar um índice e vê-lo confirmado na cadeia existe uma janela em
que tudo pode dar errado: a rede congestiona, o nó RPC cai, o processo morre. Se o índice
existisse apenas na memória do processo, ele se perderia — e o RNF22 diz que indisponibilidade
do oráculo ou da rede não pode causar perda de dados.

Com a fila em disco, reiniciar o serviço retoma exatamente de onde parou, **preservando o
período de referência original**. Isso é o RF21, e está validado por teste e por execução real
contra um nó derrubado de propósito.

### 3.3 Fora da cadeia — `backend/`

API em Node.js + Express sobre PostgreSQL com PostGIS. Guarda o que a cadeia não deve guardar
(cadastro, geometria, leituras, imagens, sessões, texto dos termos) e liga as peças fora da
cadeia entre si. **Não tem chave privada de ninguém**: só confere assinaturas — do produtor ao
vincular carteira, da fonte ao enviar leituras, e da seguradora ao emitir, relendo a transação
na cadeia. Um indexador acompanha os eventos e mantém um espelho consultável, mas a autoridade
continua sendo o contrato. Detalhes em [BACKEND.md](BACKEND.md).

### 3.4 Fora da cadeia — `app/`

Aplicativo React que fala com o backend (sessão, cadastro, propostas) e **diretamente com a
cadeia** para tudo que envolve valor: a carteira da seguradora assina a emissão e o depósito, e
a tela da apólice lê estado, índices e linha do tempo da rede. A conferência dos termos (RF08)
recalcula o resumo no navegador, sem confiar no backend. Detalhes em [APLICATIVO.md](APLICATIVO.md).

## 4. O fluxo completo, do sensor ao pagamento

Correspondente ao diagrama de sequência da documentação de software (Figura 8, UC07 a UC13):

```
 1. sensores          →  lote de leituras assinado pela chave da fonte
    backend           →  confere a assinatura e a plausibilidade; grava
 2. consolidador      →  descarta implausíveis, atualiza reputação,
                         conta dias consecutivos sem chuva
 3. modelo de visão   →  índice de dano + confiança + hash do lote
                         (módulo ainda a implementar; o backend já recebe
                          o resultado e retém baixa confiança para o perito)
 4. fila              →  grava a publicação em disco
 ─────────────────────── FRONTEIRA ────────────────────────────────
 5. publicador        →  assina e submete em uma única transação
 6. ApolicePolicy     →  confere no OracleRegistry se o remetente pode publicar
 7. ApolicePolicy     →  rejeita se o período já foi publicado
 8. ApolicePolicy     →  grava índices, hash e versão; emite IndicesPublicados
 9. ApolicePolicy     →  avalia a condição; emite CondicaoAvaliada
10. ApolicePolicy     →  se atendida: marca LIQUIDADA e transfere
11. ApolicePolicy     →  emite PagamentoExecutado
 ───────────────────────────────────────────────────────────────────
12. registro          →  grava txHash, gas, bloco e latência
13. fila              →  marca a entrada como concluída
14. backend           →  recebe o relato do oráculo; o indexador lê os eventos
                         e notifica produtor e seguradora
```

Os passos 6 a 11 acontecem **dentro de uma única transação**. Ou todos completam, ou nenhum
acontece. Não existe estado intermediário em que o índice ficou publicado mas o pagamento
falhou: nesse caso a transação inteira é revertida e o período volta a ficar disponível.

Essa é a garantia de atomicidade do RNF15, e ela é testada com um contrato beneficiário que
rejeita transferências de propósito.

## 5. Onde a intervenção humana entra — e onde não entra

Entra na configuração: a seguradora cadastra o produto, define o limiar, autoriza o oráculo e
deposita a garantia. Um perito entra nas contestações e nos casos de baixa confiança do modelo.

**Não entra na decisão de pagar.** A mensagem 10 do fluxo acima é a única que movimenta valor,
e não passa por aprovação. É o principal benefício do sistema e também o seu principal risco —
o que justifica o rigor dos requisitos RNF08 a RNF17 e a cobertura de 100% dos caminhos
condicionais exigida pelo RNF14.

## 6. O que ainda falta

| Peça | Sprint | Nota |
|---|---|---|
| Simulador em Python + MQTT | 1 | O oráculo já roda com uma fonte simulada própria |
| Modelo de visão computacional | 3 | O backend já recebe o resultado em `POST /visao/resultados` |
| Implantação em Sepolia | 4 | Exige endpoint RPC e ETH de teste; ver COMO-RODAR §7 |

Ingestão e banco (PostgreSQL + PostGIS) e o aplicativo React já estão implementados.

A interface com essas peças já está definida. O simulador precisa seguir o contrato de ingestão
de [BACKEND.md §5](BACKEND.md), e o módulo de visão o de [BACKEND.md §6](BACKEND.md).
