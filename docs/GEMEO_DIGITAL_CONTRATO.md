# Gêmeo digital: contrato de dados (Power BI → VR / Unreal)

O estado que o Power BI mostra, em JSON, para qualquer outro visualizador (Unreal no Quest, WebXR, outro app).
Ele vem do **mesmo DAX das cenas** (`vehicleVars` em `app/powerbiScene.js`). Então o VR desenha exatamente o que o
relatório desenha: 5 caminhões na doca no Power BI são 5 caminhões na doca no VR.

- **Fonte:** `twinNow()` em `app/powerbi.js`, que chama `twinState()` em `app/powerbiTwin.js`. Lê o último relatório que a Aurora abriu e mantém atualizado.
- **Frequência:** o relatório se atualiza quando a planilha muda e no máximo a cada 10 minutos. Quem lê o estado não precisa ler mais de uma vez a cada 15 s.
- **Conferência:** `scripts/powerbi-lab/gemeo-lab.mjs` compara o estado com o gerador dos dados (CD: 11/11).
- **Onde ler:**
  - **Quest (app AuroraXR):** `GET /xr/v1/twin` na ponte XR (pareada, autenticada, só leitura). Ela repassa para `GET /api/powerbi/twin` no PC. A página **Operação** do painel mostra os números e o que mudou, e põe a maquete na mesa (`AuroraTwin.h/.cpp`).
  - **Navegador / WebXR:** `powerbi action=vr` sobe um servidor só de leitura com código aleatório no endereço (`app/twinServer.js`). Ele responde em HTTP neste computador e em HTTPS na rede, com certificado feito em memória. Serve `/<código>/` (página three.js com "Entrar em VR") e `/<código>/state`.

## Formato (version 1)

```json
{
  "version": 1,
  "title": "Operação dos CDs",
  "kind": "operacao",
  "updatedAt": "2026-10-11T23:10:00.000Z",
  "lastRefresh": "2026-10-11T23:05:00.000Z",
  "glyph": "veiculo",
  "noun": "caminhões",
  "placeLabel": "Doca",
  "environment": "armazem",
  "colorBy": null,
  "stages": [{ "key": "fila", "label": "Pedido recebido" }, { "key": "carregando", "label": "Carregando" }],
  "units": [
    {
      "name": "CD Contagem",
      "places": [
        { "name": "Doca 01", "serving": ["ABC-3P34"], "waiting": [] },
        { "name": "Doca 04", "serving": [], "waiting": [] }
      ],
      "queue": ["OPQ-1S11"],
      "road": ["JKL-4L56"],
      "counts": { "total": 17, "serving": 7, "waiting": 6, "road": 4, "late": 2 }
    }
  ],
  "entities": [
    { "name": "ABC-3P34", "id": "EMB-0412", "status": "Carregando", "where": "doca", "place": "Doca 01", "late": false, "unit": "CD Contagem", "waited": 42 }
  ],
  "numbers": { "Caminhões nas docas": "9", "Caminhões na fila": "7" },
  "highlight": { "values": ["Doca 03"], "note": "Doca 03 com dois caminhões" },
  "notes": [{ "when": "22:57", "text": "OPQ-1S11 saiu da fila para a Doca 04." }]
}
```

### Campos

| Campo | O que é |
|---|---|
| `kind` | `operacao`: tem lugares e entidades. `numeros`: só números (finanças, espaços…). `vazio`: nenhum relatório aberto. |
| `glyph` | Como desenhar cada entidade: `veiculo` (caminhão, carro), `pessoa` (cliente, paciente), `volume` (pedido, chamado). |
| `noun` | O nome das entidades no plural, para os textos ("caminhões", "clientes", "pedidos"). |
| `placeLabel` | O nome do lugar ("Doca", "Caixa", "Guichê", "Leito"…). |
| `units[]` | Uma por unidade (CD, loja, filial). Sem coluna de unidade vem uma só, com `name: null`. |
| `units[].places[]` | **Todos** os lugares que existem nos dados, inclusive os livres. A ordem é a natural (Doca 2 antes de Doca 10). `serving` são os sendo atendidos. `waiting` é a fila própria daquele lugar. |
| `units[].queue` | Fila geral: esperando sem lugar ainda. |
| `units[].road` | A caminho (em trânsito). |
| `entities[].where` | `doca` (sendo atendido num lugar), `filalocal` (na fila de um lugar), `fila` (fila geral), `estrada` (a caminho). |
| `entities[].late` | Passou do prazo: desenhe em vermelho. |
| `numbers` | Os números principais do painel, já formatados como no Power BI. |
| `environment` | O ambiente da área: `armazem` (docas), `loja` (caixas), `clinica` (consultórios, leitos), `salao` (guichês, balcões), `fabrica` (máquinas). Desenhe o lugar daquela área. |
| `colorBy` | Quando os dados têm classificação de risco ou prioridade: `{ column, values: [[valor, "#cor"], …] }`, na ordem de gravidade. A entidade veste essa cor (`entities[].color`); mostre também o número (1 = mais grave). |
| `stages` | As etapas em andamento (`key`, `label`): a cor de cada entidade vem da etapa quando não há `colorBy`. |
| `entities[].waited` | Minutos desde a chegada, quando os dados têm horário. Mostre "18 min", "2 h 10". |
| `highlight` | O que a Aurora foi pedida para mostrar ("mostra a doca 3"). Desenhe um anel roxo (#B04BFF) em lugares ou entidades com esses nomes e mostre a `note`. |
| `notes` | O que mudou nas últimas atualizações, da mais nova para a mais velha. |

## Regras de desenho (as mesmas do Power BI)

1. **Fidelidade:** cada entidade é **um** objeto, no lugar dado por `where` e `place`. Não desenhe objetos decorativos que pareçam dados.
2. Se precisar limitar a quantidade desenhada, escreva o resto ("+12 na fila") e mostre o selo "✓ N de N desenhados", com N desenhados e N em `counts`.
3. Mostre `lastRefresh` como "ao vivo · HH:MM". Se tiver mais de 10 minutos, mostre o selo em âmbar.
4. Não é preciso nenhum nome do exemplo (doca, caminhão): use `placeLabel`, `noun` e `glyph`. O mesmo visualizador serve para CD, supermercado, hospital ou guichê.
