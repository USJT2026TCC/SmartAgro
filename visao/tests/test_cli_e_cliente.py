"""
Linha de comando, carga dos pesos e cliente do backend.

Os pesos usados aqui sao gerados na hora, com uma rede pequena e sem treino:
o que se testa e o caminho — carregar, classificar, recusar pesos de outra
lista de classes, cair para a heuristica avisando —, e nao a qualidade do
modelo. Os pesos de verdade nao vao para o repositorio.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
import torch

from visao import cli, modelo
from visao.clienteBackend import ClienteBackend, Imagem, ResumoDivergente
from visao.rede import UNet, carregar, criar, salvar

FOTOS = Path(__file__).resolve().parents[2] / "docs" / "demonstracao" / "fotos"
DUAS_FOTOS = [str(FOTOS / "demo-01-com-gps.jpg"), str(FOTOS / "demo-02-com-gps.jpg")]


@pytest.fixture
def sem_pesos(monkeypatch):
    monkeypatch.setattr(modelo, "CAMINHO_DOS_PESOS", "")


@pytest.fixture
def pesos_pequenos(tmp_path, monkeypatch):
    caminho = tmp_path / "pequena.pt"
    salvar(UNet(base=4), caminho, "visao-teste-0.0.1", entrada=64)
    monkeypatch.setattr(modelo, "CAMINHO_DOS_PESOS", str(caminho))
    return caminho


# ------------------------------------------------------------------ rede


def test_resnet18_monta_salva_e_carrega_sem_baixar_nada(tmp_path):
    rede = criar("unet-resnet18", pretreinado=False)
    assert tuple(rede(torch.randn(1, 3, 64, 64)).shape) == (1, 4, 64, 64)

    caminho = tmp_path / "r.pt"
    salvar(rede, caminho, "visao-teste-resnet")
    carregada, versao = carregar(caminho)

    assert type(carregada).__name__ == "UNetResNet18"
    assert versao == "visao-teste-resnet"
    assert carregada.entrada == 224


def test_arquitetura_desconhecida_e_recusada():
    with pytest.raises(ValueError, match="unet-resnet18"):
        criar("transformer")


# ------------------------------------------------------------------ cli


def test_analisar_sem_pesos_usa_a_heuristica_e_diz_isso(sem_pesos, capsys):
    assert cli.main(["analisar", *DUAS_FOTOS]) == 0
    saida = capsys.readouterr().out

    assert "heuristica de cor" in saida
    assert "Imagens............: 2" in saida
    assert "Indice de dano" in saida


def test_analisar_com_pesos_usa_o_modelo_e_a_versao_gravada_neles(pesos_pequenos, capsys):
    assert cli.main(["analisar", *DUAS_FOTOS]) == 0
    saida = capsys.readouterr().out

    assert "visao-teste-0.0.1" in saida
    assert "heuristica" not in saida


def test_pesos_de_outra_lista_de_classes_sao_recusados_com_aviso(tmp_path, monkeypatch, capsys):
    caminho = tmp_path / "doenca.pt"
    torch.save(
        {"arquitetura": "unet", "base": 4, "classes": ["solo", "ferrugem"], "estado": {}, "versao": "x"},
        caminho,
    )
    monkeypatch.setattr(modelo, "CAMINHO_DOS_PESOS", str(caminho))

    assert cli.main(["analisar", DUAS_FOTOS[0]]) == 0
    saida = capsys.readouterr().out

    assert "recusados" in saida
    assert "heuristica de cor" in saida


def test_servico_exige_a_chave_de_servico(sem_pesos, monkeypatch):
    monkeypatch.delenv("CHAVE_DE_SERVICO", raising=False)
    with pytest.raises(SystemExit, match="CHAVE_DE_SERVICO"):
        cli.main(["servico", "--uma-vez", "--api", "http://x"])


def test_servico_roda_um_ciclo_com_o_estimador_escolhido(sem_pesos, monkeypatch, capsys):
    chamadas = {}

    def servir_falso(cliente, estimador, intervalo_s, uma_vez):
        chamadas.update(url=cliente.url, versao=estimador.versao, uma_vez=uma_vez)

    monkeypatch.setattr(cli, "servir", servir_falso)

    assert cli.main(["servico", "--uma-vez", "--api", "http://backend/api", "--chave", "k"]) == 0
    assert chamadas["url"] == "http://backend/api"
    assert chamadas["uma_vez"] is True


def test_api_sobe_o_fastapi_com_o_estimador(sem_pesos, monkeypatch, capsys):
    import uvicorn

    subiu = {}
    monkeypatch.setattr(uvicorn, "run", lambda app, host, port: subiu.update(app=app, host=host, port=port))

    assert cli.main(["api", "--porta", "8123"]) == 0
    assert subiu["port"] == 8123
    assert {r.path for r in subiu["app"].routes} >= {"/saude", "/modelo", "/analisar"}


# ------------------------------------------------------------- cliente


class Resposta:
    def __init__(self, json=None, content=b"", status=200):
        self._json, self.content, self.status_code = json, content, status

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def test_cliente_le_os_lotes_pendentes_com_a_chave_de_servico(monkeypatch):
    cliente = ClienteBackend("http://backend/api/", "segredo")
    pedidos = []

    def get(url, timeout):
        pedidos.append(url)
        return Resposta(
            {
                "lotes": [
                    {
                        "id": "l1",
                        "talhao": "talhao-01",
                        "hash_evidencias": "0xabc",
                        "imagens": [{"id": "i1", "sha256": "f" * 64, "lon": -47.58, "lat": -21.46}],
                    }
                ]
            }
        )

    monkeypatch.setattr(cliente.sessao, "get", get)
    [lote] = cliente.pendentes()

    assert cliente.sessao.headers["X-Chave-De-Servico"] == "segredo"
    assert pedidos == ["http://backend/api/visao/pendentes"]
    assert lote.talhao == "talhao-01"
    assert lote.imagens[0].lat == -21.46


def test_cliente_recusa_arquivo_que_nao_bate_com_o_resumo(monkeypatch):
    cliente = ClienteBackend("http://backend/api", "k")
    conteudo = b"bytes da imagem"
    monkeypatch.setattr(cliente.sessao, "get", lambda url, timeout: Resposta(content=conteudo))

    certa = Imagem(id="i1", sha256=hashlib.sha256(conteudo).hexdigest(), tipo="", lon=0, lat=0, capturada_em="")
    assert cliente.baixar(certa) == conteudo

    adulterada = Imagem(id="i2", sha256="0" * 64, tipo="", lon=0, lat=0, capturada_em="")
    with pytest.raises(ResumoDivergente):
        cliente.baixar(adulterada)


def test_cliente_envia_o_resultado(monkeypatch):
    cliente = ClienteBackend("http://backend/api", "k")
    enviado = {}
    monkeypatch.setattr(
        cliente.sessao, "post", lambda url, json, timeout: enviado.update(url=url, corpo=json) or Resposta({"ok": True})
    )

    assert cliente.enviar_resultado({"loteId": "l1"}) == {"ok": True}
    assert enviado["url"] == "http://backend/api/visao/resultados"
