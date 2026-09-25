# Fotos de demonstração

Para testar e apresentar a tela **Fotos da lavoura** do aplicativo.

**As imagens são reais; as coordenadas, não.** Cada foto é um recorte da validação da base de
referência (Suiçmez, Yilmaz e Kahraman, 2026, v2.1, DOI 10.5281/zenodo.22062459, CC BY 4.0),
ampliado, com um GPS inventado gravado no EXIF para cair no talhão-01 da demonstração, em São
Simão/SP. Não são fotos da lavoura segurada.

| Arquivo | O que mostra |
|---|---|
| `demo-01` a `demo-06` | GPS dentro do talhão: o aplicativo lê o local da própria foto |
| `demo-07-fora-do-talhao` | GPS a 1 km do talhão: aparece em vermelho no mapa e o servidor recusa |
| `demo-08-sem-gps` | Sem GPS: localizar pelo aparelho ou marcando no mapa (fica registrado como manual) |

Gerado por `visao/treino/gerar_fotos_de_demonstracao.py`.
