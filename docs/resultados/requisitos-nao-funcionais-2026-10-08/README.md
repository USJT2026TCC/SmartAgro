# Resultado: medição dos requisitos não funcionais

Medições de 08/10/2026 dos requisitos não funcionais que pedem número. Cada linha diz como
reproduzir; os scripts estão no repositório.

| Requisito | Pede | Medido | Situação |
|---|---|---|---|
| RNF01 | 95% das consultas de apólice pelo banco em até 2 s | p95 de 90 ms com 20 usuários simultâneos; 100% abaixo de 2 s | **Atende** |
| RNF01 | consultas que leem eventos na rede: medir e reportar | tela de detalhe em 0,8 s na Sepolia; eventos de 100 mil blocos em 1,6 s | **Reportado** |
| RNF02 | lote de até 50 imagens em até 10 min | 6,2 s com a rede treinada; 13,4 s com a heurística | **Atende** |
| RNF03 | cobertura de pelo menos 70% fora da cadeia | 81% a 93% por módulo | **Atende** |
| RNF05 | Chrome, Firefox e Edge, com carteira injetada | Chrome 154 e Edge 153 verificados; Firefox pela compatibilidade do pacote | **Atende** (Firefox: conferir à mão) |
| RNF08 | custo do ciclo até 1% do prêmio | 0,35% na Sepolia; acima de 1% na rede principal para apólices pequenas | **Atende na rede de teste** |
| RNF21 | indenização em até 72 h do acionamento | pagamento na mesma transação da publicação; 0,89 h do fim do dia acionador | **Atende** |

## RNF01 — consultas pelo banco

```bash
cd backend && node scripts/medir-consultas.js --usuarios 20 --segundos 30
```

Vinte usuários simultâneos, sem pausa entre pedidos, cada um listando as apólices e abrindo o
detalhe de uma — o que a tela faz. Backend com o banco embutido (PGlite), na mesma máquina:

| Rota | Pedidos | Erros | p50 | p95 | p99 | Máximo |
|---|---:|---:|---:|---:|---:|---:|
| `GET /apolices` | 4.317 | 0 | 68 ms | 89 ms | 105 ms | 139 ms |
| `GET /apolices/:endereco` | 4.317 | 0 | 69 ms | 91 ms | 108 ms | 147 ms |
| Todas | 8.634 | 0 | 68 ms | 90 ms | 108 ms | 147 ms |

**100% das consultas abaixo de 2 s.** Ressalva: o banco tinha 4 apólices. As consultas usam índice
por endereço e por carteira, então o crescimento esperado é pequeno, mas não foi medido com
milhares.

## RNF01 — leituras que vão à rede

```bash
cd app && node scripts/medir-leituras.mjs --rede sepolia --repeticoes 5 --blocos 100000
```

O detalhe da apólice lê estado e eventos direto da cadeia, sem passar pelo banco (RF09, RNF18). O
script roda as mesmas funções do aplicativo contra o nó público da Sepolia:

| Consulta | Média |
|---|---:|
| `lerApolice` — estado e termos | 0,18 s |
| `lerPublicacoes` — índices de cada período | 0,53 s |
| `lerLinhaDoTempo` — eventos | 0,57 s |
| `listarApolices` — toda a fábrica | 0,62 s |
| **Tela de detalhe, as três em paralelo** | **0,81 s** |
| Eventos sobre 100 mil blocos (cerca de 2 semanas) | 1,6 s, 10 pedidos |
| Eventos sobre 400 mil blocos (cerca de 2 meses) | 10,6 s, 40 pedidos |

**A medição achou um defeito.** A linha do tempo pedia todos os eventos desde a implantação em uma
consulta só, e o nó público recusa intervalos de 50 mil blocos — cerca de uma semana. A tela de uma
apólice pararia de abrir uma semana depois da emissão. A leitura passou a ir em trechos de 10 mil
blocos (DECISOES.md 2.29).

**E um limite que não é do sistema.** O nó público gratuito descarta o histórico antigo (EIP-4444)
e distribui os pedidos entre servidores com históricos de tamanhos diferentes: um trecho recusado
por um é respondido pelo seguinte, e o aplicativo tenta de novo. Blocos de cinco meses atrás já não
estavam em nenhum. Para acompanhar uma vigência inteira de 180 dias, a operação real precisa de um
nó com histórico completo, configurado em `VITE_RPC_SEPOLIA`.

## RNF02 — análise de um lote de 50 imagens

```bash
cd visao && .venv/Scripts/python treino/medir_lote.py --pesos pesos/unet.pt
```

Cinquenta fotos de celular (10,8 MB) enviadas de uma vez ao `POST /analisar`, CPU, pior de duas
execuções: **6,2 s** com a U-Net 2.0.0 ou a ResNet-18 3.0.0; 13,4 s com a heurística de cor. O
limite é 600 s. Detalhes em [visao-unet-resnet18-3.0.0](../visao-unet-resnet18-3.0.0/README.md).

## RNF03 — cobertura de testes

Medida contando também os arquivos que nenhum teste abre — sem isso, o número mediria só o que já
foi testado.

| Módulo | Ferramenta | Testes | Linhas cobertas |
|---|---|---:|---:|
| Contratos (dentro da cadeia, referência) | `solidity-coverage` | 115 | 100% |
| Backend | `c8 --all` | 130 + 6 de integração | 81% |
| Oráculo | `c8 --all` | 70 + 7 de integração | 90% |
| Simulador | `pytest-cov` | 41 | 87% |
| Visão | `pytest-cov` | 66 | 93% |
| Aplicativo | Vitest + `@vitest/coverage-v8` | 72 | 83% |

O aplicativo é medido pelo Vitest 5, que conta por nó da sintaxe; no Vitest 2, que contava por
faixa de bytes, o mesmo código dava 89%.

## RNF05 — navegadores

```bash
cd app && node scripts/verificar-navegadores.mjs --rede sepolia --apolice <endereco>
```

Gera o pacote de produção, serve com `vite preview` e percorre, em cada navegador instalado, o
caminho da seguradora: entrar, ver a carteira com a conta reconhecida no cabeçalho, abrir o detalhe
de uma apólice lido da Sepolia. A carteira é um provedor EIP-1193 injetado antes de a página
carregar — o protocolo que a MetaMask injeta nos três navegadores.

| Navegador | Versão | Resultado |
|---|---|---|
| Chrome | 154.0.8037.98 | ok, sem erro no console; detalhe da apólice em 1,4 s |
| Edge | 153.0.4234.32 | ok, sem erro no console; detalhe da apólice em 2,0 s |
| Firefox | — | não instalado na máquina de medição |

O pacote é gerado pelo Vite 8 para o alvo `baseline-widely-available` (Chrome e Edge 111, Firefox
114, Safari 16.4), abaixo das duas últimas versões estáveis dos três. A conferência no Firefox, com
a MetaMask, fica no roteiro da apresentação.

## RNF08 — custo por apólice sobre o prêmio

```bash
cd contratos && node scripts/custo-por-apolice.js
```

Ciclo de uma apólice de 180 dias: emissão, depósito da garantia, uma publicação por período e o
acréscimo da publicação que paga. Produto "Estiagem escalonada — soja" num talhão de 180 ha: 1,08
ETH segurados, prêmio de 3,8% = 0,041 ETH. A razão não depende da cotação do ETH, porque o prêmio
também é pago em ETH.

| Cenário | Publicação | Gas do ciclo | % do prêmio | RNF08 |
|---|---|---:|---:|---|
| Sepolia, ao preço pago (0,001 gwei) | diária | 142,4 mi | **0,35%** | atende |
| Sepolia, ao preço pago | a cada 3 dias | 57,0 mi | 0,14% | atende |
| Rede principal, 0,5 gwei | diária | 32,6 mi | 39,7% | não atende |
| Rede principal, 0,5 gwei | a cada 3 dias | 11,9 mi | 14,6% | não atende |
| Camada 2, ordem de 0,01 gwei | diária | 32,6 mi | 0,79% | atende |

**Na rede de teste, atende com folga. Na rede principal, só para apólices grandes**: ao preço de
0,5 gwei com publicação a cada 3 dias, a partir de cerca de 16 ETH segurados. Duas conclusões para o
TCC:

1. **A emissão é a maior parcela fixa.** Cada apólice implanta um contrato inteiro: 14 milhões de
   gas na Sepolia depois do Glamsterdam. Implantar cópias mínimas apontando para um contrato-modelo
   (EIP-1167) baixaria isso para algo da ordem de 0,5 milhão — é o trabalho futuro de maior efeito.
2. **A agregação que o RNF08 admite tem uma condição.** O índice climático é a sequência seca que
   termina no dia publicado, e uma chuva entre duas publicações a apagaria. Publicar a cada 3 dias
   só é seguro se o oráculo continuar calculando todo dia fora da cadeia e publicar no mesmo dia em
   que a condição for atingida. Três dias é também o máximo compatível com o RNF21. O serviço
   publica hoje todo dia.

## RNF21 — latência da indenização

O pagamento acontece **na mesma transação** que publica o índice acionador: não há etapa
intermediária. Medidas na Sepolia (07/10/2026): 26,7 s e 27,0 s do envio da publicação à segunda
confirmação. O painel da seguradora mostra o tempo do fim do dia acionador ao pagamento: 0,89 h na
demonstração, contra o limite de 72 h. O que domina o tempo real é a cadência do oráculo, não a
rede.
