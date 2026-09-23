"""
Gravacao e leitura dos pesos.

Estes testes so rodam onde o PyTorch esta instalado — ele e dependencia do
extra `treino`, e nao do modulo em si, porque a maquina que roda a inferencia
com a heuristica de cor nao precisa dele.

O caso do meio existe por causa de um defeito real: a primeira versao salvava o
objeto Python inteiro, e os pesos so carregavam de dentro do script de treino
(ver DECISOES.md 2.18).
"""

import pytest

torch = pytest.importorskip("torch")

from visao.indice import CLASSES  # noqa: E402
from visao.rede import UNet, carregar, salvar  # noqa: E402


def test_a_rede_devolve_um_mapa_de_classes_do_tamanho_da_entrada():
    entrada = torch.zeros(1, 3, 64, 64)
    saida = UNet(base=4)(entrada)

    assert saida.shape == (1, len(CLASSES), 64, 64)


def test_pesos_salvos_carregam_fora_do_script_de_treino(tmp_path):
    caminho = tmp_path / "unet.pt"
    original = UNet(base=4)
    salvar(original, caminho, "visao-unet-teste-9.9.9")

    recuperado, versao = carregar(caminho)

    assert versao == "visao-unet-teste-9.9.9"

    entrada = torch.rand(1, 3, 64, 64)
    with torch.no_grad():
        assert torch.allclose(original.eval()(entrada), recuperado(entrada), atol=1e-6)


def test_pesos_de_outra_lista_de_classes_sao_recusados(tmp_path):
    # Carregar pesos de cinco classes em uma versao de seis produziria um indice
    # de dano silenciosamente trocado — plausivel e errado.
    caminho = tmp_path / "unet.pt"
    salvar(UNet(base=4), caminho, "v1")

    pacote = torch.load(caminho, map_location="cpu", weights_only=True)
    pacote["classes"] = ["solo", "saudavel"]
    torch.save(pacote, caminho)

    with pytest.raises(ValueError, match="outra lista de classes"):
        carregar(caminho)


def test_o_arquivo_de_pesos_e_dado_e_nao_codigo(tmp_path):
    # `weights_only=True` recusa arquivo que traga objeto Python serializado.
    # E o que impede um arquivo de pesos baixado de fora de executar codigo.
    caminho = tmp_path / "unet.pt"
    salvar(UNet(base=4), caminho, "v1")

    pacote = torch.load(caminho, map_location="cpu", weights_only=True)

    assert set(pacote) == {"arquitetura", "base", "classes", "versao", "estado"}
    assert all(isinstance(v, torch.Tensor) for v in pacote["estado"].values())
