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

    assert set(pacote) == {"arquitetura", "base", "classes", "entrada", "versao", "estado"}
    assert all(isinstance(v, torch.Tensor) for v in pacote["estado"].values())


def test_padronizacao_deixa_media_zero_e_desvio_um_por_canal():
    from visao.rede import padronizar

    x = torch.rand(3, 32, 32) * 0.4 + 0.3
    p = padronizar(x)

    assert torch.allclose(p.mean(dim=(-2, -1)), torch.zeros(3), atol=1e-5)
    assert torch.allclose(p.std(dim=(-2, -1)), torch.ones(3), atol=1e-3)


def test_padronizacao_ignora_brilho_e_contraste_da_camera():
    # A mesma cena, uma foto mais escura e menos contrastada que a outra —
    # a diferenca entre a camera do drone e a do celular. Depois de padronizar,
    # as duas precisam chegar iguais ao modelo.
    from visao.rede import padronizar

    cena = torch.rand(3, 32, 32)
    escura = cena * 0.4 + 0.05

    assert torch.allclose(padronizar(cena), padronizar(escura), atol=1e-4)


def test_imagem_de_cor_uniforme_nao_explode():
    # Foto do ceu, ou lente tampada: desvio zero. Sem a protecao, viraria
    # divisao por zero e NaN percorrendo a rede inteira.
    from visao.rede import padronizar

    p = padronizar(torch.full((3, 16, 16), 0.5))

    assert torch.isfinite(p).all()


def test_producao_classifica_igual_a_avaliacao_do_treino(tmp_path):
    """
    O caminho que o servico usa (modelo.classificar_com) precisa produzir
    EXATAMENTE a mesma mascara que a avaliacao do treino, para a mesma imagem.

    Este teste existe por causa de um defeito real: o servico redimensionava
    para 512 um modelo treinado em 224. Rede convolucional aceita qualquer
    tamanho sem reclamar, e o erro do indice foi de 14,7 para 25,4 pontos em
    silencio (DECISOES.md 2.19).
    """
    from io import BytesIO

    import numpy as np
    from PIL import Image

    from visao.modelo import classificar_com
    from visao.rede import padronizar

    caminho = tmp_path / "unet.pt"
    salvar(UNet(base=4), caminho, "v1", entrada=224)
    modelo, _ = carregar(caminho)

    gerador = np.random.default_rng(7)
    pixels = gerador.integers(0, 256, (224, 224, 3), dtype=np.uint8)
    memoria = BytesIO()
    Image.fromarray(pixels).save(memoria, format="PNG")

    # Como a avaliacao do treino faz:
    entrada = torch.from_numpy(pixels.astype(np.float32) / 255.0).permute(2, 0, 1)
    with torch.no_grad():
        previsto = modelo(padronizar(entrada)[None]).argmax(dim=1)[0].numpy()
    esperado = {nome: int((previsto == i).sum()) for i, nome in enumerate(CLASSES)}

    # Como o servico faz:
    contagem, _ = classificar_com(modelo, memoria.getvalue())

    assert contagem == esperado
    assert sum(contagem.values()) == 224 * 224


def test_tamanho_de_entrada_viaja_com_os_pesos(tmp_path):
    caminho = tmp_path / "unet.pt"
    salvar(UNet(base=4), caminho, "v1", entrada=160)

    modelo, _ = carregar(caminho)

    assert modelo.entrada == 160


def test_pesos_antigos_sem_o_campo_assumem_o_tamanho_do_treino(tmp_path):
    # Os pesos treinados antes deste campo existir foram todos treinados em 224.
    caminho = tmp_path / "unet.pt"
    salvar(UNet(base=4), caminho, "v1")
    pacote = torch.load(caminho, map_location="cpu", weights_only=True)
    del pacote["entrada"]
    torch.save(pacote, caminho)

    modelo, _ = carregar(caminho)

    assert modelo.entrada == 224
