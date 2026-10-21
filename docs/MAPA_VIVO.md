# Memórias / Mapa Vivo

A memória da Aurora como um universo navegável. Cada ponto é uma memória guardada, cada linha é uma relação
real ou uma similaridade medida, e cada pulso é um evento real. Não há dado de demonstração: sem memórias, o
mapa diz isso.

## Arquitetura

| Camada | Arquivo | O que faz |
|---|---|---|
| Eventos reais | `app/memoryEvents.js` | Registra quando uma memória é **criada**, **atualizada**, **arquivada**, **restaurada** ou **apagada** (`app/store.js`) e quando é **consultada**. Uma memória conta como consultada quando a Aurora a põe no contexto de um turno (`app/chatTurn.js`, onde o contexto é montado). Guarda os últimos 200 eventos. |
| Retrato | `app/memoryGraph.js` → `GET /api/memories/graph` | Mostra o que existe de fato: as memórias (sem o texto inteiro; nas sensíveis, sem trecho), as relações explícitas (`memory_relations`), o atlas semântico (`app/memoryAtlas.js`: k-means, PCA e vizinhos por similaridade de embedding), os projetos, as conversas, as últimas 30 respostas que usaram memória (`messages.memory_access`) e os eventos recentes. |
| Ao vivo | `GET /api/memories/live` | SSE com cada evento. O frontend lê por `fetch` em streaming, para mandar o token da sessão no cabeçalho (sem token na URL), e reconecta sozinho. |
| Adaptador | `frontend/src/livemap/adapter.ts` | O **MemoryGraphAdapter**, TypeScript puro e testado. Transforma o retrato em nós, arestas, agrupamentos, arcos agregados e indicadores, conforme o modo (visão geral, por pasta/projeto, por conversa) e os filtros. Também aplica cada evento ao vivo de forma incremental (`applyEvent`) e mantém o atlas estável na sessão (`steadyAtlas`). |
| Layout | `frontend/src/livemap/layout.ts` | Calcula posições determinísticas. Os agrupamentos ficam numa espiral de ângulo áureo em volta do núcleo, com a memória geral junto dele e uma relaxação contra sobreposição. Dentro de cada agrupamento, metade da posição vem do atlas semântico e metade de um disco uniforme calculado pelo id. |
| Desenho | `frontend/src/livemap/LiveMapScene.tsx` | Three.js com React Three Fiber, que já fazia parte do projeto. Cada camada é um único buffer na GPU: a nebulosa estática de cada agrupamento, a poeira de cada memória, as arestas internas (curvas finas), os arcos entre agrupamentos, os raios do núcleo, as ramificações do agrupamento em foco e os pulsos. Também desenha o núcleo Aurora, os rótulos com prevenção de colisão (um por fatia angular, crescendo para fora) e a câmera com foco suave. |
| Página | `frontend/src/livemap/LiveMapView.tsx`, `livemap.css` | Abas de modo, busca, filtros, controles, painel lateral da memória, faixa de indicadores, estados de carregando/vazio/erro e alternativa sem WebGL. |
| Menu | `Sidebar.tsx`, `AppShell.tsx` | **Memória → Mapa Vivo**, em tela cheia, com "voltar para a memória". |

## Decisões

- **Nada simulado.** Os pulsos acontecem só com eventos reais (consultada, criada, busca). A deriva ambiente é
  mínima e não é apresentada como atividade. A poeira e a nebulosa são proporcionais ao número real de memórias
  e nunca entram nas contagens.
- **Estabilidade.** O servidor refaz o k-means e o PCA a cada memória nova, o que mudaria tudo de lugar. O mapa
  guarda o agrupamento e a posição de cada memória da sessão. Uma memória nova entra no agrupamento da maioria dos
  seus vizinhos semânticos. O botão **reorganizar** refaz tudo quando a pessoa pede.
- **Nível de detalhe (LOD).** As ligações entre agrupamentos diferentes viram um arco longo por par de
  agrupamentos, mais forte quanto mais ligações há. As ligações individuais aparecem só para a memória em foco.
  Com mais de 2.500 memórias, a qualidade cai sozinha para "média".
- **Nomes dos agrupamentos.** Um grupo semântico com 60% ou mais das memórias vindas de um projeto ou conversa
  recebe o nome dele. Senão, fica com as palavras-chave do atlas, que continuam no subtítulo.
- **Paleta.** Turquesa é a memória geral, rosa as conversas, âmbar os projetos e pastas, violeta o conhecimento
  importado e verde a atividade real recente. As cores estão nas variáveis do `livemap.css` e em `CATEGORY_COLOR`.

## Interação

- **Navegação:** a roda do mouse faz zoom, arrastar move o mapa, a pinça funciona no toque e a rotação fica no
  botão direito. O botão **ajustar** (F) enquadra tudo.
- **Memórias:** passar o mouse mostra o tipo e as conexões. O clique abre o painel com trecho, origem, datas,
  uso, tags, id, conexões e os botões **abrir conversa de origem** e **ver na memória**.
- **Agrupamentos:** o clique expande e recolhe (ramificações), e o duplo clique foca. A faixa "agrupamentos"
  também foca.
- **Busca e filtros:** a busca (/) acende os resultados, e Enter leva ao melhor deles. Os filtros são pasta,
  conversa, período, relevância (já usadas, comprovadas) e categorias.
- **Atividade:** com o modo atividade ligado, a câmera segue o agrupamento das memórias consultadas.
- **Controles:** pausar (P), rótulos (L), qualidade alta/média/baixa e `prefers-reduced-motion`. Sem WebGL, ou
  se a GPU perder o contexto, as mesmas memórias aparecem em lista.

## Como testar

- `npm test`: o retrato e os eventos ao vivo (`test/memoryGraph.test.js`).
- `npm --prefix frontend test`: o adaptador e o layout (`frontend/test/livemap.test.mjs`): transformação dos
  dados, só arestas reais, os três modos, filtros e busca, estado vazio, eventos incrementais, atlas estável,
  arcos agregados e layout determinístico.
- `node scripts/livemap-lab/lab.mjs --memories 1000 --chrome <chrome.exe>`: um banco temporário com 1.000
  memórias de teste com embeddings reais, o servidor de teste e o Chromium tirando capturas (visão geral, foco,
  atividade ao vivo, busca com memória selecionada e por pasta). Nunca usa o banco nem o app da pessoa.
  Resultado de 20/10: nenhum erro no console, cerca de 170 quadros por segundo no Chromium de teste.

## Limites conhecidos

- **"Consultada"** quer dizer que a memória foi posta no contexto do turno. O sistema não sabe qual delas o
  modelo de fato usou na resposta, e o mapa não finge saber.
- **Memória nova** chega pelo evento com título e escopo. O texto, as tags e os vizinhos semânticos chegam com a
  atualização silenciosa 1,5 s depois, e ela só ganha vizinhos depois do embedding.
- **Memórias sem embedding** (embeddings desligados ou outro modelo) ficam num agrupamento por categoria,
  "sem posição semântica".
- **Desempenho:** o objetivo de 60 quadros por segundo com cerca de 1.000 memórias foi medido no Chromium de
  teste. Em máquinas fracas, use a qualidade média ou baixa.

## Interação em tempo real e chat dentro do mapa (20/10)

Inspirado no vídeo de referência (o "crawler" que percorre o mapa enquanto um prompt toma forma):

- **Chat ao lado do mapa** (`frontend/src/livemap/ChatDock.tsx`): as mesmas conversas do chat; uma conversa
  nova criada ali entra na pasta filtrada no mapa. Mostra a etapa real da resposta e, embaixo de cada resposta,
  chips "usou · …" / "criou · …" que levam à memória no mapa.
- **Etapas do turno** (faixa abaixo das abas): 01 pergunta → 02 busca na memória → 03 memórias no contexto →
  04 resposta. Cada etapa acende quando o evento real chega (`reduceTurn` em `adapter.ts`).
- **A Aurora no mapa** (`Agent` em `LiveMapScene.tsx`): sai do núcleo para o centro das memórias do turno e
  estende tentáculos pontilhados — fracos para as candidatas avaliadas (mais fortes quanto maior a nota),
  acesos para as consultadas, verdes para as criadas — e volta quando o turno termina. A câmera a segue no
  modo atividade. Os rótulos das consultadas mostram a nota da busca.
- **Eventos novos** (`app/memoryEvents.js`): `turn-start` (mensagem), `scanned` (até 24 candidatas com nota,
  emitido por `selectRelevantMemories`), `answered` (ids usados e criados, os mesmos gravados na mensagem),
  `turn-end`. Memórias extraídas logo após o fim do turno ainda contam para ele.
- Teste: `test/memoryGraph.test.js` (ordem real dos eventos num turno) e `frontend/test/livemap.test.mjs`
  (`reduceTurn`); laboratório `scripts/livemap-lab/lab.mjs` faz um turno real pelo chat do mapa (`--no-chat` pula).
