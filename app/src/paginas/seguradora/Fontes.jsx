import { useCallback, useEffect, useState } from "react";

import { api } from "../../api/cliente";
import { emDataHora } from "../../cadeia/formatos";
import { Aviso, Campo, Carregando, RodapeDaFronteira, Selo } from "../../componentes/ui";

/**
 * Fontes de dados de campo e a reputacao de cada uma (RF11, RF12, RF13, RNF19).
 *
 * Cada estacao ou sensor tem um par de chaves. Os lotes de leitura chegam
 * assinados, e o backend so aceita os que vieram da chave cadastrada aqui. A
 * reputacao e uma media movel do acerto da fonte: leituras implausiveis puxam o
 * escore para baixo, e abaixo de 0,5 as leituras dela deixam de entrar no indice.
 */
export default function Fontes() {
  const [fontes, setFontes] = useState(null);
  const [talhoes, setTalhoes] = useState([]);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [nova, setNova] = useState({
    id: "",
    talhaoId: "",
    tipo: "estacao",
    endereco: "",
    lon: "",
    lat: "",
  });

  const carregar = useCallback(async () => {
    try {
      const [f, t] = await Promise.all([api("/fontes"), api("/talhoes")]);
      setFontes(f.fontes);
      setTalhoes(t.talhoes);
      setNova((atual) => ({ ...atual, talhaoId: atual.talhaoId || t.talhoes[0]?.id || "" }));
    } catch (falha) {
      setErro(falha.message);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function registrar(evento) {
    evento.preventDefault();
    setErro(null);
    setAviso(null);

    try {
      await api("/fontes", { metodo: "POST", corpo: nova });
      setAviso(
        `Fonte ${nova.id} registrada. So lotes assinados pela chave informada serao aceitos.`,
      );
      setNova({ ...nova, id: "", endereco: "", lon: "", lat: "" });
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function alternar(fonte) {
    setErro(null);
    try {
      await api(`/fontes/${fonte.id}`, { metodo: "PATCH", corpo: { ativa: !fonte.ativa } });
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  return (
    <div className="pagina">
      <div className="entre">
        <h1>Fontes de dados</h1>
        <button className="secundario pequeno" onClick={carregar}>
          Atualizar
        </button>
      </div>
      <p className="silencioso">
        Estacoes e sensores de cada talhao. So leituras assinadas pela chave registrada aqui entram
        no sistema (RNF19).
      </p>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {aviso ? <Aviso tipo="sucesso">{aviso}</Aviso> : null}

      {fontes === null ? (
        <Carregando />
      ) : (
        <div className="cartao tabela-rolavel">
          <h2>Fontes registradas</h2>
          <table>
            <thead>
              <tr>
                <th>Fonte</th>
                <th>Talhao</th>
                <th className="numero">Reputacao</th>
                <th className="numero">Leituras</th>
                <th>Ultima leitura</th>
                <th>Situacao</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fontes.map((f) => {
                const escore = Number(f.escore);
                return (
                  <tr key={f.id}>
                    <td>
                      {f.id}
                      <div className="silencioso mono" title={f.endereco}>
                        {f.tipo} · {f.endereco.slice(0, 10)}…
                      </div>
                    </td>
                    <td>{f.talhao}</td>
                    <td className="numero">
                      {escore.toFixed(3)}{" "}
                      {escore < 0.5 ? <Selo tipo="erro">fora do indice</Selo> : null}
                    </td>
                    <td className="numero">{f.observacoes}</td>
                    <td>
                      {f.ultima_leitura_em
                        ? emDataHora(new Date(f.ultima_leitura_em).getTime() / 1000)
                        : "—"}
                    </td>
                    <td>
                      {f.ativa ? (
                        <Selo tipo="sucesso">ativa</Selo>
                      ) : (
                        <Selo tipo="neutro">desativada</Selo>
                      )}
                    </td>
                    <td>
                      <button
                        className={f.ativa ? "perigo pequeno" : "secundario pequeno"}
                        onClick={() => alternar(f)}
                      >
                        {f.ativa ? "Desativar" : "Reativar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <RodapeDaFronteira>
            A reputacao e uma media movel exponencial (α = 0,2) do acerto da fonte. Um sensor que
            funcionou meses e quebrou hoje sai do indice em poucos dias, em vez de levar meses
            (RF13).
          </RodapeDaFronteira>
        </div>
      )}

      <form className="cartao" onSubmit={registrar}>
        <h2>Registrar fonte</h2>

        <div className="grade">
          <Campo
            rotulo="Identificador"
            htmlFor="id-fonte"
            ajuda='Letras minusculas, numeros e "-".'
          >
            <input
              id="id-fonte"
              value={nova.id}
              onChange={(e) => setNova({ ...nova, id: e.target.value })}
              placeholder="estacao-milho-01"
            />
          </Campo>

          <Campo rotulo="Talhao" htmlFor="talhao-fonte">
            <select
              id="talhao-fonte"
              value={nova.talhaoId}
              onChange={(e) => setNova({ ...nova, talhaoId: e.target.value })}
            >
              {talhoes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.identificador}
                </option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Tipo" htmlFor="tipo-fonte">
            <select
              id="tipo-fonte"
              value={nova.tipo}
              onChange={(e) => setNova({ ...nova, tipo: e.target.value })}
            >
              <option value="estacao">Estacao meteorologica</option>
              <option value="sensor_solo">Sensor de solo</option>
            </select>
          </Campo>

          <Campo rotulo="Longitude" htmlFor="lon-fonte">
            <input
              id="lon-fonte"
              inputMode="decimal"
              value={nova.lon}
              onChange={(e) => setNova({ ...nova, lon: e.target.value })}
            />
          </Campo>

          <Campo rotulo="Latitude" htmlFor="lat-fonte">
            <input
              id="lat-fonte"
              inputMode="decimal"
              value={nova.lat}
              onChange={(e) => setNova({ ...nova, lat: e.target.value })}
            />
          </Campo>
        </div>

        <Campo
          rotulo="Chave publica (endereco)"
          htmlFor="endereco-fonte"
          ajuda="O endereco correspondente a chave com que o dispositivo assina os lotes. A chave privada fica no dispositivo, nunca aqui."
        >
          <input
            id="endereco-fonte"
            className="mono"
            placeholder="0x…"
            value={nova.endereco}
            onChange={(e) => setNova({ ...nova, endereco: e.target.value })}
          />
        </Campo>

        <button type="submit">Registrar</button>
      </form>
    </div>
  );
}
