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

## A Zeladora das memórias (20/10)

Conceito (imagens de referência do vídeo): **uma aranha andando pela teia**. Ela **não faz parte do
funcionamento do cérebro** — uma pergunta no chat nunca espera por ela; ela cuida da memória.
`app/memoryKeeper.js` no servidor; `Creature` em `LiveMapScene.tsx` no mapa.

- **Ronda por seções**: cada seção é um pensamento (os agrupamentos semânticos do mapa; a memória geral é a
  primeira). Dentro da seção ela anda **pela teia**: começa perto do meio e vai sempre para a memória mais
  próxima ainda não lida (~1,2 s em cada). Depois da ronda descansa 15 min. Roda só no app instalado.
- **Lê e classifica** cada memória (valor, regra, preferência, combinado, fato) — o rótulo no mapa fica
  "título · tipo". Uma memória **vaga** (menos de 5 palavras) recebe a marca rosa "▶ vaga": uma pergunta para a
  pessoa, nada é alterado.
- **Compacta o pensamento**: memórias que a Aurora extraiu, na mesma pasta/conversa, que dizem a mesma coisa
  (com embedding: similaridade ≥ 0,9 e ≥ 50% das palavras; sem: ≥ 70% das palavras) viram **uma** memória com
  **todas as frases distintas** delas (uma frase dita por duas aparece uma vez; nada é reescrito nem perdido).
  As originais vão para o arquivo com relação "derivação" para a nova. Cópia exata: só arquiva a cópia.
  **Desfazer** traz as originais de volta, arquiva a compactada, e ela nunca mais compacta aquelas. Nunca
  compacta memória escrita à mão, guia importado, nem duas que discordam num valor.
- **Liga** duas memórias muito parecidas que nada conecta (≥ 0,88 ou ≥ 60% das palavras; 1 por memória lida).
- **Marca conflitos** de valor (com unidade, separador ou data: "263 mil" × "280 mil"; "nota 11" não conta).
- Medido na base real (196 memórias, 19 110 pares): guias diferentes da mesma família chegam a 0,93 de
  similaridade — por isso compactar exige o texto parecido, não só o embedding. Uma ronda sobre uma cópia da
  base real: 189 lidas, 10 ligações (todas entre memórias irmãs), 0 compactações, 0 conflitos.
- **No mapa** (referência: aranha com LEGS 16, TENTACLES 22):
  - o corpo oval com grade e núcleo rosa, **16 pernas** curtas que andam mais rápido quando ela caminha e
    **22 tentáculos** pontilhados que alcançam as últimas memórias lidas (várias de uma vez);
  - **seções**: na fila em cinza, a que ela lê acesa ("lendo"), as lidas com a cor de volta ("feito"); o
    painel **SEÇÕES** mostra lidas/total de cada uma, como o SECTIONS do vídeo; o título mostra a seção atual;
  - fio luminoso a cada ligação nova; marcas amarelas (conflito) e rosas (vaga);
  - topo: lidas x/total · ligações · compactadas · marcas; log: lê · liga · compacta · junta · marca · anda;
  - painel **ZELADORA**: contadores, compactações e junções com "desfazer", marcas com "ver"/"ok", ligar/desligar;
  - no modo atividade a câmera a mantém à vista (ao trocar de seção ou quando ela se afasta).
- **O cérebro trabalhando** (uma pergunta no chat) é outra coisa: o mapa desenha o **caminho de acesso** da
  memória A até a B (as memórias consultadas, na ordem da busca), um arco dourado com a cabeça brilhando,
  salto por salto, de um setor ao outro; as candidatas avaliadas aparecem como pontos fracos (`AccessPath`).
- API: `GET/PUT /api/memories/keeper`, `POST /api/memories/keeper/undo {id}` (compactação ou junção),
  `POST /api/memories/keeper/dismiss {id, otherId?}`; eventos `keeper` (round, walk, read com `kind`, link,
  join, compact com `merged`, flag, rest) em `/api/memories/live`.
- Testes: `test/memoryKeeper.test.js`, `frontend/test/livemap.test.mjs`; laboratório
  `scripts/livemap-lab/lab.mjs --keeper-pace 250 --no-chat` (planta cópias, um conflito e um pensamento a compactar).

### Zeladora viva e auto foco (21/10)

- **Auto foco** (botão `auto foco on/off`, salvo nas preferências do mapa): a câmera vai sozinha até o que está
  acontecendo (a Zeladora, as memórias de uma pergunta). Quando você arrasta ou dá zoom, o movimento automático
  em curso para na hora e só volta 10 s depois do último toque — a câmera nunca briga com você.
- **A aranha**: corpo com mola que vira na direção em que anda; **16 pernas articuladas** (joelho para fora e
  para cima) com os pés **plantados em memórias reais**, que dão passos alternados mirando um pouco à frente
  (`frontend/src/livemap/legs.ts`, testado: nenhum pé fica para trás); **22 tentáculos** que se estendem até a
  memória lida — ela ondula e um pacote de luz volta pelo tentáculo até o corpo; ligações disparam um fio com
  as pontas pulsando; compactação puxa as memórias umas para as outras até virarem uma, com um estouro de luz;
  **balão de fala** com o que ela está fazendo ("lendo «…» · regra", "ligando «…» ↔ «…»", "compactando 3…").
- **Memórias acendendo**: enquanto ela anda, as memórias que ainda não leu nesta ronda ficam apagadas e cada uma
  acende quando é lida — a seção vai se preenchendo.
- **Chamar a Zeladora**: o botão ⌖ em cada seção do painel SEÇÕES e "chamar a zeladora aqui" na memória
  selecionada. Ela larga a ronda (ou acorda do descanso), vai até lá, organiza aquelas memórias e depois volta.
  API `POST /api/memories/keeper/visit {ids, label}`; evento `called`.

### Teia viva (21/10)

- **Sem núcleo central**: o anel com raios no meio do mapa saiu, junto com os raios núcleo → seção e os
  tentáculos padrão da memória geral. Pulsos de evento partem do centro da seção da memória; o caminho de
  uma pergunta com uma só memória também.
- **Os laços vivem com a Zeladora** (`touch`/`amp` em `LiveMapScene.tsx`): cada **toque** numa memória — lida,
  ligada, consultada numa pergunta, criada, compactada, marcada, **cada pé da Zeladora que pousa nela**, e a
  memória que você passa o mouse ou seleciona — faz os fios dela **vibrarem como corda** e brilharem; um
  **sinal** corre por cada fio até a vizinha (650 ms), que treme também, até dois saltos (força × 0,55 a cada
  salto). Laços entre seções aparecem enquanto vibram. Em repouso, a teia respira (balanço leve de todos os fios).
- Nada é inventado: todo toque vem de um evento real ou de você. Com "pausar" ou movimento reduzido a teia
  fica parada.
