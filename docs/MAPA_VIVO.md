# Memórias / Mapa Vivo

A memória da Aurora como uma árvore viva, desenhada como um instrumento. Cada folha é uma memória guardada,
cada galho é um agrupamento real, e cada onda ou caminho luminoso é um evento real. Não há dado de demonstração: sem memórias, o
mapa diz isso.

## Arquitetura

| Camada | Arquivo | O que faz |
|---|---|---|
| Eventos reais | `app/memoryEvents.js` | Registra quando uma memória é **criada**, **atualizada**, **arquivada**, **restaurada** ou **apagada** (`app/store.js`) e quando é **consultada**. Uma memória conta como consultada quando a Aurora a põe no contexto de um turno (`app/chatTurn.js`, onde o contexto é montado). Guarda os últimos 200 eventos. |
| Retrato | `app/memoryGraph.js` → `GET /api/memories/graph` | Mostra o que existe de fato: as memórias (sem o texto inteiro; nas sensíveis, sem trecho), as relações explícitas (`memory_relations`), o atlas semântico (`app/memoryAtlas.js`: k-means, PCA e vizinhos por similaridade de embedding), os projetos, as conversas, as últimas 30 respostas que usaram memória (`messages.memory_access`) e os eventos recentes. |
| Ao vivo | `GET /api/memories/live` | SSE com cada evento. O frontend lê por `fetch` em streaming, para mandar o token da sessão no cabeçalho (sem token na URL), e reconecta sozinho. |
| Adaptador | `frontend/src/livemap/adapter.ts` | O **MemoryGraphAdapter**, TypeScript puro e testado. Transforma o retrato em nós, arestas, agrupamentos, arcos agregados e indicadores, conforme o modo (visão geral, por pasta/projeto, por conversa) e os filtros. Também aplica cada evento ao vivo de forma incremental (`applyEvent`) e mantém o atlas estável na sessão (`steadyAtlas`). |
| Layout | `frontend/src/livemap/tree.ts` | A árvore: raiz, seções em leque, divisões onde o sentido muda mais, folhas numa copa larga (as mais novas no alto). Posições determinísticas; caminhos raiz → memória e memória A → B pelos galhos. |
| Desenho | `frontend/src/livemap/LiveMapScene.tsx`, `gfx.ts` | Three.js com React Three Fiber. Cada camada é um buffer escrito a cada quadro: galhos (linhas finas), folhas e estrelas (pontos em pixels), ondas (zigue-zagues), caminhos luminosos (fitas com degradê), arbustos das últimas perguntas, rótulos e a caixa de destaque. |
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

## A árvore viva — o Mapa Vivo como instrumento (21/10)

O mar vivo (células, coral, água-viva) deu lugar a uma **árvore de busca desenhada como um instrumento**,
na linguagem de um painel científico: fundo quase preto, linhas de um pixel, letras monoespaçadas pequenas,
um gráfico no topo e um código de barras de eventos embaixo.

- **A forma é o dado** (`frontend/src/livemap/tree.ts`, testado em `frontend/test/tree.test.mjs`): a **raiz**
  embaixo é a Aurora; cada **seção** sai dela em leque, com largura proporcional às memórias que tem; cada
  memória é uma **folha** (um ponto de luz) numa copa larga, e as mais novas ficam mais no alto. Dentro da
  seção as memórias ficam lado a lado no eixo semântico principal (atlas de embeddings), e a seção se divide
  **onde o sentido muda mais**: memórias quase iguais se juntam num galho alto e diferentes se separam perto da
  base. Determinístico; 3000 memórias em ~35 ms.
- **Uma pergunta** é uma **onda de busca** que sai da raiz e varre a copa (as memórias avaliadas acendem
  quando ela passa). As memórias realmente usadas são alcançadas por um **caminho luminoso** que sobe pelos
  galhos, com degradê do branco ao verde e ao laranja, e uma centelha que continua correndo. Na melhor delas
  aparece uma **caixa de destaque**: profundidade, memória, seção e similaridade. As criadas na resposta têm
  caminho verde.
- **A Zeladora** é uma onda menor, verde-água, que anda pela copa de memória em memória. Cada passo desenha o
  **caminho de A até B** pelos galhos (desce até o galho comum e sobe). Uma ligação que ela faz é um arco
  entre as duas folhas. Uma seção que ela ainda não visitou na ronda fica apagada. Quando começa uma ronda,
  uma onda verde-água varre a árvore inteira.
- **As últimas perguntas** ficam na base como **arbustos**, com um galho por memória usada. Passar o mouse
  mostra a pergunta; um clique **refaz o caminho** dela na árvore. Sem nada acontecendo, o caminho da
  **última pergunta** fica desenhado.
- **A pessoa**: o cursor é uma lente (galhos e folhas perto dele acendem) e a memória mais próxima mostra o
  caminho dela desde a raiz. Um clique numa memória a seleciona; um toque no vazio solta uma onda; um duplo
  clique numa seção a foca.
- **Painel**: o gráfico do topo mostra as maiores seções (memórias, uso e, durante a ronda, quanto foi lido).
  Embaixo ficam o código de barras dos eventos ao vivo (um traço por evento), a atividade por minuto, os
  quatro passos da pergunta e o crescimento da memória ao longo do tempo. Os indicadores detalhados ficam
  recolhidos e abrem com um clique.
- Tudo vem de memórias e eventos reais. Com "pausar" ou movimento reduzido, nada se move sozinho.

## A Zeladora cuida dos nódulos e poda o que ficou velho (21/10)

As seções do mapa deixaram de ser recalculadas do zero (k-means) a cada mudança: agora são os **nódulos da
Zeladora** (`app/memoryNodes.js`, puro e testado em `test/memoryNodes.test.js`), guardados na configuração
`memory_keeper_nodes`. O atlas (`memoryAtlas.js`) usa os nódulos dela quando existem (`atlas.nodes = true`), e
o mapa confia neles entre recargas. A memória geral também entra nos nódulos (ela também tem assuntos).

- **Plantar**: sem nódulos, ela planta os primeiros a partir de um agrupamento do que existe.
- **Adotar**: uma memória nova chama a Zeladora na hora (mesmo descansando, ou no meio de um chamado longo);
  ela vai até a memória, lê e coloca no nódulo de sentido mais próximo. No mapa, um caminho verde sobe da raiz.
- **Brotar** (nódulo novo, "assunto novo"): memórias mais longe de todos os nódulos do que a maioria dos
  próprios membros deles (25º percentil da similaridade ao centro) e mais perto umas das outras viram um
  nódulo próprio. Uma sozinha espera até 7 dias por outras parecidas, depois vai para o mais próximo. O limite
  é relativo porque, com o modelo real (nomic), até assuntos sem relação dão ~0,75 contra o centro de um
  nódulo. Na cópia do banco real, 4 memórias jurídicas brotaram "contrato · atlas".
- **Dividir** (nódulo novo, "saiu de …"): um nódulo maior que `2·√(3·N)` memórias se divide em dois pelo
  próprio sentido; o maior fica com o nódulo e o outro nasce com nome próprio. No mapa, o nódulo novo acende
  a partir da base, com um fio vindo do nódulo de onde saiu.
- **Recolher**: um nódulo que ficou com menos de 3 memórias (podadas, compactadas, apagadas) passa o que sobrou
  para o vizinho mais próximo e sai; no mapa ele se fecha em anéis lilás.
- **Podar** (arquivar, sempre reversível, só memórias que a própria Aurora extraiu, nunca as que a pessoa
  trouxe de volta): uma substituída por outra mais nova do mesmo lugar que diz que o fato mudou ("passou a",
  "agora", "revisada"…; vira relação `correction`); uma vaga e sem uso há 30 dias; uma sobre um momento que
  já passou ("hoje", "amanhã"…) sem uso há 14 dias. No máximo 12 por ronda. No mapa, a folha é cortada e cai
  até o chão; no painel da Zeladora aparece "✂ … · motivo" com **desfazer**.
- Eventos novos da Zeladora: `prune`, `arrival`, `adopt`, `plant`, `node-born`, `node-gone`.
- Laboratório: `scripts/livemap-lab/lab.mjs` cria uma memória vaga antiga, uma meta revisada e quatro
  memórias de um assunto novo e captura `14_zeladora_molda_*.png`.

## Nuvens de memória — o Mapa Vivo como o crawler da referência (21/10; em 3D desde 22/10)

Referência: gravação de tela da pessoa com três posts (Paper Lab, prompt-crawler e a árvore Opus × Astra). Ela
escolheu **misturar**: a cena de nuvens do prompt-crawler, o painel de instrumentos denso do Paper Lab e a
separação entre o que já foi comprovado e o que ainda espera revisão. A árvore saiu (`tree.ts` removido).

- **Cada nódulo da Zeladora é uma nuvem** (`frontend/src/livemap/clouds.ts`): fica onde o sentido das suas
  memórias a põe no atlas semântico, o tamanho cresce com √(memórias) e as nuvens nunca se sobrepõem. O campo é
  largo como a tela. Dentro da nuvem, cada memória mantém a direção que tem no atlas: memórias quase iguais
  ficam lado a lado.
- **A massa** são milhares de grãos e fibras estáticos na GPU, animados só por uniforms (cor e calor de cada
  nuvem, lente do cursor, ondas, deriva lenta): 45 mil grãos no máximo, ~160 fps em headless. O grão é
  decoração; as memórias são os pontos brilhantes.
- **Tudo cinza; a seção ativa acende na própria cor** (onde a Zeladora lê, onde a pergunta buscou, a seção em
  foco, um nódulo que nasceu). O mesmo tom aparece no título grande, na aba de cima e nas barras dos painéis.
- **Comprovada × em revisão** (`reviewOf` em `adapter.ts`): ponto cheio quando a memória já foi usada ou ajudou
  numa resposta, ou quando foi escrita/importada por uma pessoa; quadrado vazado quando foi extraída e ninguém
  usou ainda, ou quando a Zeladora a marcou.
- **A Zeladora é um leitor**: corpo elipsoide em grade que gira devagar, com um losango na cor da seção e
  pernas finas em volta. Tentáculos alcançam as memórias que ela leu, a mais nova como uma fita com uma faísca
  correndo. Um chip nomeia cada uma com o que ela achou ("fato", "regra", "⚑ vaga"). Ao trocar de seção, ela
  deixa um arco longo da viagem.
- **A pergunta da Aurora é uma sonda laranja**: onda a partir de onde a busca olhou, tentáculos finos (azuis)
  para tudo o que foi avaliado, fitas laranja para o que entrou no contexto e callout na melhor com a pontuação
  da busca. Durante a pergunta, os chips da Zeladora esperam.
- **Painel de instrumentos (aberto por padrão)**:
  - registro: o log de leitura;
  - nódulos: barras lidas/total;
  - cobertura: radar por nódulo;
  - calor: grade de 12 células por nódulo e contadores;
  - saúde: medidor 0–100 = % comprovadas − 2 por marca aberta, com histórico;
  - `zeladora.py`: o laço real dela, com a linha em execução acesa e os valores de agora;
  - revisão: podas, marcas e compactações com desfazer/ok, e o liga/desliga.
- A câmera enquadra o campo na parte do palco que o chat não cobre (`fitDistance`). Ao seguir a Zeladora, ela
  vai para a seção inteira em que ela entra.
- Testes: `frontend/test/clouds.test.mjs` cobre:
  - uma nuvem por seção, com cada memória dentro da sua;
  - nuvens sem sobreposição e na posição do atlas;
  - a direção das memórias preservada dentro da nuvem;
  - o layout sem atlas;
  - o orçamento de grão;
  - as regras de comprovada/em revisão.

### As nuvens em 3D e o arquivo vivo (22/10)

- **As nuvens agora são volumes 3D.** A posição vem dos três eixos do atlas: nuvens esticadas na largura, rasas
  na profundidade e sem sobreposição. Dentro de cada nuvem, as memórias ficam distribuídas por ∛rank.
- **A massa ganhou "baforadas"**: pontos grandes e suaves que dão brilho de nebulosa.
- **A lente do cursor é calculada na tela** e funciona de qualquer ângulo. As ondas viram esferas.
- **A câmera orbita**: arrastar gira, a roda dá zoom para dentro de uma nuvem, o botão direito move.
  - Parada há 20 s sem nada acontecendo, ela gira devagar.
  - "Ajustar" volta à vista de frente.
- **A Zeladora, os anéis e as cruzes da poda ficam sempre de frente para a câmera.** As curvas se arqueiam na tela.
- **Modo "arquivo 3D"** (`archive.ts`, `ArchiveScene.tsx`): torres-estante, livros e a Zeladora robô.

### O enxame — as nuvens feitas de partículas na GPU (22/10)
Terceira cena ("enxame", ao lado de "nuvens" e "arquivo 3D"), inspirada no Particle Love: as mesmas nuvens viram
até **1 milhão de partículas** (qualidade alta 1024², média 512², baixa 256²) simuladas na placa de vídeo
(`GPUComputationRenderer`: posição e velocidade em texturas float, um texel por partícula).
- `swarm.ts` (puro, testado): cada partícula tem uma casa — uma memória (um novelo em volta dela; todas recebem a
  mesma parte) ou uma seção (a névoa que enche a nuvem, 42% do total, dividida pelo volume).
- `SwarmField.tsx`: fluxo de curl noise (fumaça que nunca se repete, na escala de cada casa), mola para casa, vida e
  renascimento; pontos suaves + rastros ao longo da velocidade (motion blur) em média/alta.
- O que mexe nele é só evento real (a cena escreve o estado de cada casa a cada quadro): cor da seção, cor do evento,
  energia de quem acende; o que a Zeladora lê escorre para o corpo dela; o que a resposta usou flui para a sonda da
  Aurora; ondas (busca, ronda, toque, nódulo novo) empurram; o cursor é um vórtice que mexe a fumaça.
- Abertura: as partículas saem todas do centro e voam para casa (big bang da memória). Sem movimento, já nascem em casa.
- Tudo o mais da cena de nuvens continua por cima (pontos das memórias, Zeladora, sonda, chips, rótulos, câmera).
