# Registro do Projeto — AI Harness

Este arquivo registra decisões, alterações e testes para manter o contexto de execução do projeto.

## Estado atual

- **Fase:** Fase 1 — Primeiro agente.
- **Versão interna:** 0.1.0.
- **Modo disponível:** Individual.
- **Provedor disponível:** Codex CLI com autenticação salva localmente.
- **Provedores adicionais:** ainda não implementados; continuam opcionais.

## Alterações realizadas

### 2026-09-15

- Criado `package.json` com scripts `start`, `test` e `check`.
- Criado backend local em `app/server.js`.
- Criada interface mínima em `app/public/index.html`.
- Criado `.env.example` para documentar a configuração local.
- Criados testes unitários iniciais em `test/server.test.js`.
- O backend mantém a chave da OpenAI fora do navegador.
- A integração utiliza `POST /v1/responses` com `store: false`.

## Decisões

- O uso individual é o caminho padrão.
- Codex é o primeiro provedor suportado.
- Novos provedores devem entrar por adaptadores, sem alterar a interface principal.
- O primeiro protótipo evita dependências externas obrigatórias e usa APIs nativas do Node.js.
- O app escuta apenas em `127.0.0.1` por padrão.
- O harness executa `codex exec --ephemeral --json` e não acessa diretamente os tokens do Codex.

## Testes planejados

- [x] Verificar sintaxe do backend com `npm run check`.
- [x] Verificar configuração padrão sem API key.
- [x] Verificar configuração com modelo customizado.
- [ ] Executar chamada real com a sessão autenticada do Codex CLI.
- [ ] Validar instalação limpa.
- [ ] Adicionar launcher Pinokio.
- [ ] Adicionar persistência SQLite.
- [ ] Adicionar segundo provedor opcional.

## Como continuar

1. Executar `npm test`.
2. Executar `npm run check`.
3. Confirmar que `codex` está instalado e autenticado.
4. Executar `npm start`.
5. Abrir `http://127.0.0.1:8787`.

## Pendências conhecidas

- Ainda não existe carregamento automático de arquivo `.env`.
- O histórico ainda não é persistido.
- A interface ainda não permite selecionar provedores.
- Não há streaming de resposta.
- Ainda não existe instalação/atualização via Pinokio.
- A autenticação via Codex CLI ainda não foi validada com uma tarefa real pelo harness.

## Resultados dos testes

### 2026-09-15

- `npm run check`: **passou**.
- `npm test`: a execução padrão encontrou `spawn EPERM` no ambiente Windows restrito.
- `node --test --test-isolation=none`: **passou — 4 testes**.
- O script `npm test` foi ajustado para usar `--test-isolation=none`, permitindo repetir o teste neste ambiente.
- O teste de fumaça do servidor passou; há **4 testes** cobrindo configuração, parser JSONL e endpoint local de saúde.
- O backend foi migrado para o Codex CLI; a chamada real com a conta autenticada permanece como validação manual.
- Como os repositórios antigos não estão disponíveis, o frontend novo foi adicionado ao projeto atual sem apagar o protótipo anterior.
- Criada aplicação React + TypeScript + Vite em `frontend/` usando Three.js, React Three Fiber e Drei.
- Criados módulos separados para dados sintéticos/importação, geração geométrica dos neurônios, cena 3D e interface.
- A carga inicial contém exatamente 1.000 registros sintéticos, marcados como `kind: demo` e identificados como demonstração.
- Incluída importação de JSON para dados reais, preservando `scope`, `source`, `project`, `folder`, `conversation`, `tags` e relações.
- Adicionados mapa/lista, busca, contagens calculadas, filtro preparado, painel de inspeção, câmera ortográfica/perspectiva, gizmo, grade/eixos CAD e wireframe.
- A interface foi redesenhada com sidebar, cabeçalho, cartões de status, área de conversa premium, composer responsivo e estados visuais de conexão/carregamento.
- Mantida a funcionalidade de chat, envio com Enter e nova linha com Shift + Enter.
- Adicionado popup de configurações com ícone animado, limite de contexto ajustável e visualização da rede de memória.
- Adicionada memória local em `app/data/memory.json`, com nós, relações e categorias básicas.
- O prompt enviado ao Codex agora inclui memórias locais e é limitado pelo tamanho configurado.
- A rede de memória foi promovida para o workspace principal com estética CAD/3D: grade em perspectiva, órbitas, conexões animadas e nós com profundidade visual.
- O retorno do backend agora informa `memoryAccess`, permitindo destacar em laranja as memórias consultadas durante a execução.

## Resultados de testes — interface

### 2026-09-15

- `npm run check`: **passou**.
- `npm test`: **passou — 4 testes**.
- A alteração visual não modificou o contrato do backend.
- `npm test`: **passou — 5 testes** após adicionar a validação do limite de contexto.
- Após a rede 3D e o rastreamento de acesso, `npm run check` e `npm test` continuam passando com **5 testes**.
- `frontend/npm install`: **passou**, 146 pacotes instalados, 0 vulnerabilidades; houve aviso de pacote transitivo depreciado (`three-mesh-bvh@0.7.8`).
- `frontend/npm run build`: **passou**, 616 módulos transformados e bundle de produção gerado.
- O build reportou aviso de chunk principal acima de 500 kB; otimização por code-splitting fica pendente.
- Validação visual no navegador confirmou WebGL real, 1.000 registros, seleção em lista com painel de inspeção e destaque do neurônio selecionado; o navegador ficou indisponível ao repetir a captura após o último ajuste de foco.
## 2026-09-15 — Histórico e distribuição para testers

- Adicionado histórico persistente de conversas em `frontend/src/history.ts`, com título automático, mensagens de usuário/assistente, provedor e memórias acessadas.
- A barra lateral agora lista conversas recentes; é possível criar uma nova conversa e reabrir qualquer conversa salva no navegador.
- Criada tela de conversa com composer, envio por Enter, estados de carregamento e preservação automática em `localStorage`.
- Configurado proxy Vite de `/api` para a API local em `frontend/vite.config.ts`.
- Adicionado `README.md` com execução, distribuição, atualização e checklist de validação.
- `update.cmd`/`scripts/update.ps1` agora atualizam checkout Git, reinstalam dependências e validam o build sem apagar dados locais; fora de Git, exibem orientação de distribuição do novo pacote.
- Validação: `npm test` passou com 5/5, `npm run check` passou e `frontend npm run build` passou com 618 módulos transformados.
- API local validada em `127.0.0.1:8787`: `/api/health` retornou 200 e `/api/memories` retornou 200.
- Interface validada em `127.0.0.1:5173`: 1.000 registros exibidos, tela de conversa acessível e console sem erros/avisos.
- Limitação conhecida: o bundle de produção do Three.js gera aviso de chunk acima de 500 kB; o histórico permanece local por navegador/dispositivo e ainda não sincroniza entre testers.
- Adicionado `start-test.cmd` para abrir API, frontend e navegador em um passo no Windows.

## 2026-09-15 — Instalador Windows e preparação do GitHub

- Criado instalador sem administrador em `installer/Install-AIHarness.ps1` e atalho `installer/install.cmd`.
- O instalador verifica Node.js, npm e Codex CLI, copia o projeto para `%LOCALAPPDATA%\AI-Harness`, instala dependências, executa o build e cria atalho na área de trabalho.
- Criado desinstalador em `installer/Uninstall-AIHarness.ps1`, sem remover histórico do navegador.
- O repositório Git local será inicializado nesta etapa; o push depende da URL do repositório GitHub e da autenticação do usuário.

## 2026-09-16 — Fluxo visual de pensamento

- A rede de relações passou a ficar visível em toda a cena, com curvas espaciais entre memórias relacionadas.
- Adicionados pulsos animados em uma amostra de conexões e em todas as relações diretas da memória selecionada.
- Neurônios acessados agora exibem emissividade quente, halo pulsante e alteração de escala; a seleção reduz a intensidade dos demais.
- No modo demonstrativo, uma sequência local percorre os registros para ilustrar atividade; eventos reais podem alimentar `memoryAccess` pela API.
- Build frontend validado novamente com 618 módulos transformados. A captura visual foi conferida no navegador local em 16/09/2026.

## 2026-09-16 — Refatoração completa da morfologia 3D

- Substituído o modelo radial por uma morfologia neural hierárquica: soma irregular, núcleo, dendritos primários/secundários/terciários e axônio com colaterais.
- Adicionadas espinhas sinápticas na inspeção, materiais CAD wireframe reutilizados e eixos técnicos locais no neurônio selecionado.
- Mantida a otimização por nível de detalhe: visão geral simplificada e geometria completa apenas no neurônio selecionado/inspecionado.
- Build Vite validado com 618 módulos e cena conferida no navegador local após recarregamento, sem erros/avisos novos no console.


## 2026-09-16 — Reconstrução: chat estilo ChatGPT/Claude + memória funcional

Pedido do usuário: deixar a experiência de chat "premium" (organização de conversas/projetos, igual ChatGPT/Claude), e tornar a memória **funcional de verdade** — cada conversa com sua própria memória, lida de fato pela IA, mais uma aba "Memória" unificando tudo. Combinado explicitamente com o usuário: o diferencial visual (Atlas 3D) fica para uma fase seguinte; hoje o foco foi organização de chat + memória real.

Diagnóstico antes de mexer: o chat só existia como aba secundária do Atlas 3D, com histórico em `localStorage` (sem projetos). A memória tinha dois sistemas desconectados — uma real no backend (`app/data/memory.json`, injetada no prompt do Codex) e um atlas 3D 100% sintético/demo, explicitamente não sincronizado com a memória real (confirmado em `docs/MEMORY_CAD.md`).

Decisões tomadas com o usuário antes de codar:

- **Persistência: SQLite** (`better-sqlite3`), não mais JSON solto/localStorage.
- **Extração de memória: por IA**, com uma chamada extra ao Codex após cada resposta (mais lento, mais "real"), em vez de heurística ou só manual.

O que foi construído:

- `app/db.js` + `app/store.js`: schema SQLite (`projects`, `conversations`, `messages`, `memories`) com migração automática (best-effort) do `memory.json` legado para memória de escopo `global`. Ranking de memória relevante prioriza conversa → projeto → geral.
- `app/codex.js`: chamada ao Codex CLI extraída para módulo compartilhado (chat e extração de memória usam a mesma função).
- `app/memoryExtractor.js`: após cada resposta, pede ao Codex um JSON com fatos/decisões relevantes da troca e salva como memória da conversa (`kind: "extracted"`).
- `app/server.js`: API REST nova — `projects`, `conversations`, `conversations/:id/messages`, `memories` (CRUD completo) — mantendo um endpoint legado `/api/chat` para a página estática antiga (`app/public/index.html`) não quebrar.
- Frontend: `AppShell.tsx` (casca nova), `Sidebar.tsx` (projetos + conversas, busca, renomear/excluir), `ChatView.tsx` (chat com chips de memória usada/criada), `MemoryView.tsx` (aba Memória unificada, com filtros e CRUD manual), `api.ts` (cliente tipado). O antigo `App.tsx` virou `NeuralAtlas.tsx`, preservado como aba **Atlas 3D (beta)** — visualmente idêntico a antes, só sem a parte de chat que foi para o AppShell.
- `test/server.test.js` reescrito: 15 testes cobrindo prompt builder, parser do Codex, extrator de memória, e a API nova via HTTP real (incluindo que memória de uma conversa não vaza para outra, e que a mensagem do usuário sobrevive mesmo se o Codex falhar).

Resultados dos testes (sandbox de desenvolvimento, sem Codex CLI instalado — por isso os testes tratam a chamada ao Codex como indisponível, o que é o comportamento esperado e testado):

- `npm run check`: **passou**.
- `npm test` (backend): **passou — 15/15**.
- `npm run test:memory` (frontend/dados 3D): **passou — 6/6**, sem alteração de comportamento.
- `npm run frontend:build`: **passou**, 625 módulos. Mesmo aviso de chunk do Three.js (>500 kB) de antes.
- Validação visual com Playwright + Chromium local: sidebar com projetos/conversas, chat com estado de erro tratado (Codex CLI ausente no sandbox → mensagem de sistema exibida e persistida corretamente), aba Memória (contagens reais, filtros, formulário manual), e Atlas 3D abrindo normalmente como aba separada com o disclaimer visível. Sem erros de console além do 404 esperado.
- **Não foi possível validar uma chamada real ao Codex** nem a extração automática de memória fim a fim, porque este ambiente de desenvolvimento não tem o Codex CLI autenticado — isso só pode ser confirmado na máquina do usuário.

Limitações conhecidas desta rodada:

- A página estática legada (`app/public/index.html`) teve seu endpoint de memória (`GET /api/memories`) trocado de formato (`{nodes, edges}` → `{memories: [...]}`); o gráfico decorativo dela vai ficar vazio. Ela não é o app principal (o fluxo real é `frontend/`), então isso não foi corrigido nesta rodada.
- Atlas 3D continua desconectado da memória real — combinado que fica para a fase seguinte.
- Sem streaming de resposta; o chat espera a resposta completa do Codex (igual antes).
- Extração automática de memória adiciona uma chamada extra ao Codex por mensagem — não medimos a latência real porque o Codex não está disponível neste sandbox.
- Não foi feito commit/push: este ambiente clonou o repositório por HTTPS sem credenciais de escrita no GitHub do usuário.

### Perguntas para o usuário responder

1. **Confirma as duas decisões tomadas hoje** (SQLite + extração de memória por IA) ou prefere mudar alguma agora que viu funcionando?
2. Quer que eu **valide de fato uma chamada ao Codex** e a extração automática de memória na sua máquina (onde o Codex CLI está autenticado), ou prefere testar você mesmo primeiro?
3. A extração automática adiciona uma chamada extra ao Codex a cada mensagem (mais lenta). Se sentir o chat lento no uso real, quer que eu troque para: extração heurística (sem custo extra) ou extração assíncrona em segundo plano (resposta chega rápido, memória aparece um pouco depois)?
4. Para a **próxima fase (o "diferencial" do harness)**: a ideia é o Atlas 3D passar a visualizar a memória real (a mesma da aba Memória), ou o diferencial é outra coisa que você tinha em mente?
5. Quer que eu **suba essas mudanças para o GitHub**? Este ambiente não tem permissão de push no seu repositório — preciso que você rode `git pull`/aplique o patch localmente, ou me dê acesso (ex.: um token/branch) para eu abrir um PR diretamente.
6. A página estática antiga (`app/public/index.html`) ainda importa? Se não usa mais, posso removê-la; se usa, digo o que precisa para deixá-la 100% funcional de novo (hoje ela ainda manda mensagem e recebe resposta, só o gráfico decorativo de memória dela que ficou desatualizado).

## 2026-09-16 — Atlas 3D conectado à memória real + remoção da página legada

Respostas do usuário às perguntas da rodada anterior: confirmou SQLite + extração por IA; pediu validação da chamada real ao Codex mas "fácil e médio para não gastar muito token"; autorizou extração assíncrona; disse que tem outra ideia para o diferencial do harness mas pediu para eu seguir implementando a ideia da memória por enquanto; autorizou descartar a página estática legada. Caminho do projeto na máquina do usuário: `C:\Users\abraao.souza\Harness`.

O que foi feito nesta rodada:

- **Página legada removida**: `app/public/` (HTML estático antigo) excluída. Removidos do `app/server.js`: `getOrCreateLegacyConversation`, endpoint `POST /api/chat` legado, `GET /api/health-legacy`, e o fallback de arquivos estáticos para `app/public` (agora serve só `frontend/dist`).
- **Atlas 3D conectado à memória real**: `NeuralAtlas.tsx` agora carrega, ao abrir, as mesmas memórias reais da aba Memória (`loadRealMemoriesAsAtlas`, via `listMemories`/`listProjects`/`listConversations` do `api.ts`) — convertendo escopo (`global`→`general`), sempre marcando `kind: "context"` (nunca demo quando é real), resolvendo nome do projeto/conversa por id, e posicionando os neurônios deterministicamente (sem posição real persistida). Memórias de conversa herdam o projeto da conversa para fins de agrupamento visual. **Relações não são inventadas** — ficam vazias, porque o backend ainda não rastreia relações entre memórias; só a posição é fabricada, e isso já era assim antes para dados importados. Se não houver memória real ainda, cai de volta para a demonstração sintética de sempre. Botão "↻ Sincronizar memória real" na barra lateral para recarregar sob demanda. Disclaimer muda de aviso (laranja) para confirmação (verde) quando conectado.
- Validado com Playwright: 3 memórias de teste criadas via API (`global`, `project`, `conversation`) apareceram corretamente agrupadas no Atlas 3D (2 no grupo "Aurora" — a de projeto e a de conversa, que herdou o projeto — e 1 em "Contexto geral"), tanto no mapa 3D quanto na lista, com os escopos certos.
- `npm run check`, `npm test` (15/15), `npm run test:memory` (6/6) e `npm run frontend:build` continuam passando.

### Sobre a validação da chamada real ao Codex (pedido do usuário, barato em tokens)

Este ambiente de nuvem não tem o Codex CLI instalado/autenticado e não está vinculado ao computador do usuário (sem acesso a `C:\Users\abraao.souza\Harness`), então a validação fim-a-fim só pode ser feita na máquina do usuário. Para manter isso barato, a validação recomendada é manual, feita pelo próprio usuário, sem precisar de uma sessão do Claude rodando comandos:

1. Aplicar o patch/bundle/zip entregue no `C:\Users\abraao.souza\Harness`.
2. `npm install` (raiz) e `npm --prefix frontend ci`.
3. `npm start` em um terminal, `npm run frontend:dev` em outro (ou `start-test.cmd`).
4. Mandar uma mensagem no chat. Esperado: resposta real do Codex (não mais o erro "Codex CLI não encontrado" que apareceu neste sandbox).
5. Poucos segundos depois, abrir a aba Memória: deve aparecer pelo menos 1 memória nova com origem "Extraída pela IA", vinculada àquela conversa.
6. Se algo divergir disso, me colar aqui a mensagem de erro (ou um print) — aí eu já vou direto ao ponto em vez de reexplorar tudo de novo.

Isso evita gastar tokens numa sessão só para descobrir se o Codex CLI está instalado/autenticado na máquina do usuário.

### Extração assíncrona (autorizada, ainda não implementada)

O usuário autorizou trocar a extração de memória de síncrona (o chat espera a segunda chamada ao Codex terminar antes de responder) para assíncrona (resposta do chat chega rápido; a memória aparece um pouco depois). **Isso ainda não foi implementado nesta rodada** — ficou registrado aqui como próximo passo, porque primeiro fazia sentido confirmar que a extração síncrona funciona de verdade na máquina do usuário (item acima) antes de mudar o timing dela.

### Em aberto

- Usuário mencionou ter "outra ideia" para o diferencial do harness, diferente de plugar o Atlas 3D na memória real — ele pediu para eu implementar a ideia da memória por enquanto (feito acima) e vai compartilhar a outra ideia depois.
- Extração assíncrona de memória: implementar quando o usuário confirmar que a versão síncrona funciona na máquina dele.

## 2026-09-16 — Atlas neural CAD no Harness Aurora

- Cena reformulada com núcleo visual Aurora, grupos coloridos por projeto e 1.000 memórias demonstrativas. Nenhum dado pessoal da referência visual foi incluído no código.
- Geometria volumétrica determinística com soma, núcleo, dendritos em três níveis, axônio e terminações; seis variantes instanciadas na visão geral e geometrias detalhadas combinadas na inspeção.
- Conexões agrupadas e pulsos instanciados, explicitamente identificados como ilustrativos. Sem rotação automática da coleção.
- Foco da câmera por comando, com alvo do OrbitControls atualizado e interrupção por interação; enquadramento geral e vistas CAD; coordenadas e cotas reais da geometria em unidades da cena.
- Busca, filtros, projetos, assuntos, lista paginada, relações de entrada/saída, rede de origem e atalhos conectados à interface.
- Importador preserva relações/posições, valida IDs e referências, distribui registros sem posição e salva a coleção visual no navegador. Exportação completa em JSON.
- Movimento reduzido, pausa com renderização sob demanda, qualidade gráfica e fallback para lista em falha WebGL.
- Build 3D separado da interface; aviso de chunk 3D acima de 500 kB permanece.
- Validação: 5 testes de servidor, 6 testes de memória/grafo/geometria, sintaxe do servidor e build TypeScript/Vite passaram.
- Limitação desta execução: política do navegador remoto bloqueou localhost e arquivo de prévia; visual, interações WebGL e FPS ainda precisam de validação no computador de destino.
- A coleção importada no atlas é local ao navegador; a memória do backend usada pelo chat não foi alterada.

## 2026-09-16 — Commit do trabalho pendente + correção de autoria git

Sessão rodando diretamente na máquina do usuário (`C:\Users\abraao.souza\Harness`), não mais num sandbox de nuvem — primeira vez que isso acontece neste projeto.

- Todo o trabalho da rodada anterior (reconstrução SQLite + chat + memória real + Atlas 3D conectado) estava commitado apenas no `PROJECT_LOG.md` mas nunca chegou a virar commit git de verdade nem foi enviado ao GitHub. Revisado arquivo por arquivo, removidas duas sobras órfãs que ninguém tinha apagado (`app/public/index.html` e `frontend/src/App.tsx`, ambos sem nenhuma referência no código atual) e commitado tudo (`dd95fd1`) + push pra `origin/main`.
- E-mail do autor dos commits corrigido para `lucaspedral2010@gmail.com` (era um e-mail de trabalho autodetectado da máquina).

## 2026-09-16 — App Electron: instalador único, sem terminal

Pedido do usuário: a experiência de instalar/atualizar estava "complicando demais" pra um usuário comum (exigia Python + Visual Studio Build Tools só pra compilar o `better-sqlite3`, além de dois terminais/duas portas). Pediu algo do tipo "app em Chromium", fácil de instalar/atualizar/modificar. Confirmado explicitamente: partir direto para empacotamento Electron nesta mesma rodada, não só remover a dependência nativa.

**Passo 1 — trocado `better-sqlite3` por `node:sqlite`** (módulo embutido no Node, sem compilação):
- `app/db.js`: `DatabaseSync` no lugar do construtor do `better-sqlite3`; `.pragma()` virou `.exec("PRAGMA ...")`; o único uso de `.transaction()` (migração best-effort do `memory.json` legado) virou `BEGIN`/`COMMIT` manual com parâmetros posicionais em vez de nomeados.
- `app/store.js` não precisou de nenhuma mudança — já usava só `prepare().get()/.all()/.run()` com `?` posicional.
- `better-sqlite3` removido do `package.json`; `npm install` na raiz agora é instantâneo (zero pacotes de produção, zero compilação nativa).
- Confirmado que o Node embutido no Electron 44 (v24.21.0) também expõe `node:sqlite` sem flag nenhuma, antes de seguir pro passo 2.

**Passo 2 — empacotado como app Electron:**
- Novo `electron/main.js`: sobe o backend existente (`createServer()` de `app/server.js`, reaproveitado sem alterações) internamente, aponta `HARNESS_DB_FILE`/`CODEX_CWD` pra `app.getPath("userData")` antes de qualquer chamada ao banco/Codex, abre uma `BrowserWindow` só depois do servidor confirmar que subiu, mostra um aviso nativo (não bloqueante) se o `codex` CLI não for encontrado, e integra `electron-updater` checando releases do GitHub quando empacotado.
- Como o frontend já fazia só fetch relativo (`/api/...`) e o backend já servia `frontend/dist` estaticamente, **não precisou mudar nada no frontend nem usar IPC/preload** — a janela do Electron simplesmente carrega `http://127.0.0.1:8787/`.
- Novos scripts: `electron:start` (produção, aponta pro backend embutido), `electron:dev` (backend + Vite + Electron com hot-reload via `concurrently`/`wait-on`/`cross-env`), `dist` (gera o instalador com `electron-builder`, alvo NSIS, sem exigir admin, publicando em GitHub Releases do próprio repositório).
- Removida a ferramentaria antiga, substituída pelo instalador único: `installer/` (PowerShell), `start-test.cmd`, `update.cmd`, `scripts/update.ps1`.
- `ROADMAP.md` atualizado: as antigas Fase 5 (launcher Pinokio) e Fase 6 (Tauri) foram unificadas e marcadas como concluídas via Electron — desvio consciente do plano original, registrado no próprio roadmap.

**Dois bugs reais encontrados e corrigidos durante a validação** (não introduzidos nesta rodada, só nunca tinham sido expostos porque ninguém tinha testado uma chamada real ao Codex CLI até hoje):
1. `app/codex.js` chamava `execFile` sem nunca fechar o `stdin` do processo filho; o `codex exec` fica esperando input extra por `stdin` indefinidamente quando não é um terminal interativo, então **toda mensagem de chat travava até o timeout de 120s**. Corrigido fechando `pending.child.stdin.end()` logo após disparar a chamada (confirmado que `execFile` promisificado expõe `.child`, mas ignora silenciosamente uma opção `stdio` passada nas options — só fechar o stream manualmente resolve).
2. `frontend/vite.config.ts` não fixava `server.host`, e o Vite nesta máquina só escuta em `::1` (IPv6) por padrão — `wait-on`/Electron apontando pra `127.0.0.1:5173` nunca conectavam. Corrigido com `server.host: '127.0.0.1'`, consistente com o resto do app.

**Validação de ponta a ponta (primeira vez no histórico deste projeto, com Codex CLI real autenticado na máquina do usuário):**
- `npm install`/`npm run check`/`npm test` (15/15) — sem nenhuma etapa de compilação nativa.
- `npm run frontend:build` — 625 módulos, inalterado.
- `npm run electron:start`: janela real aberta ("Aurora · Memória 3D"), backend embutido respondendo em `127.0.0.1:8787`.
- Mensagem real enviada ao Codex CLI autenticado: resposta em ~15s. Mensagem com fatos ("minha cor favorita é verde, meu cachorro se chama Thor") gerou duas memórias extraídas automaticamente e corretas. Pergunta de acompanhamento ("qual o nome do meu cachorro?") leu a memória certa (`memoryAccess`) e respondeu "Thor" — confirma leitura **e** escrita de memória funcionando de ponta a ponta pela primeira vez.
- `npm run electron:dev`: backend + Vite + janela Electron com hot-reload, todos coordenados, janela real carregando o dev server.
- Dados de teste (conversas/memórias criadas durante a validação, pastas `%APPDATA%\ai-harness` e `%APPDATA%\Harness Aurora`) removidos ao final para o primeiro uso real do usuário começar limpo.

Pendências conhecidas desta rodada:

- Ícone customizado do app ainda não existe — `electron-builder` usa o ícone padrão dele.
- Nenhuma release foi publicada no GitHub ainda; o auto-update do `electron-updater` não tem o que buscar até a primeira `npm run dist` + publicação.
- Bundle do Atlas 3D (`three`/`@react-three/fiber`/`@react-three/drei`) continua grande (874 kB no chunk `MemoryScene`) — candidato a `React.lazy()` numa fase futura, não afeta o fluxo principal de chat.
- A "outra ideia" do usuário para o diferencial do harness (mencionada em 2026-09-16, ainda não compartilhada) continua em aberto.

## 2026-09-16/17 — Dois bugs reais encontrados na instalação de verdade + v0.1.1 a v0.1.3

Usuário instalou o app de verdade e reportou dois erros em sequência, ambos corrigidos e republicados no mesmo ciclo:

1. **`Cannot find package 'electron-updater'`** ao abrir o app instalado — `electron-updater` estava em `devDependencies`; `electron-builder` só empacota dependências de produção dentro do `.exe` final. Corrigido movendo pra `dependencies` (`package.json`). Publicado como **v0.1.2**.
2. **`ENOTDIR, not a directory`** ao mandar a primeira mensagem — `app/db.js` calculava o caminho do banco (`dbFile`) como `const` no topo do módulo, mas o `electron/main.js` só define `HARNESS_DB_FILE` dentro de `app.whenReady()`; como o `import` de `app/server.js` é estático, ele já roda antes disso, então o valor padrão (dentro do `app.asar`, somente leitura) ficava travado pra sempre. Corrigido resolvendo `HARNESS_DB_FILE` dentro de `getDb()` (por chamada, não por import). Publicado como **v0.1.3**, testado localmente (health check + criação de conversa real gravando em `%APPDATA%\Harness Aurora\harness.db`) antes de publicar.
3. Ajuste menor: a mensagem de erro de boot do frontend ainda mandava "confirme que `npm start` está rodando" — texto de antes do empacotamento Electron, sem sentido pro usuário final (não tem terminal nenhum). Trocado por uma mensagem genérica de "feche e abra de novo".

**Processo de publicação (registrado porque se repete a cada release):** `electron-builder --publish always` tem uma condição de corrida conhecida na primeira publicação de uma tag nova — cria **duas** releases-rascunho duplicadas no GitHub (uma só com o `.blockmap`, outra com `.exe`+`latest.yml`). Correção manual necessária toda vez: apagar a release incompleta via API do GitHub, rodar `electron-builder --publish always` de novo (dessa vez ele completa a release existente em vez de criar outra), depois `PATCH` pra tirar do modo draft. Assim que a v0.1.3 ficou publicada e corrigida, o `electron-updater` do app 0.1.2 (rodando localmente) checou e confirmou a versão nova disponível.

Aprendizado de segurança: o classificador automático do Claude Code bloqueou um comando por reutilizar o token do GitHub em texto puro repetidas vezes na mesma sessão — sinal de que não se deve colar token em linha de comando repetidamente; usar variável de ambiente definida uma única vez por chamada de ferramenta (`$env:GH_TOKEN` no PowerShell) é mais seguro. Token revogado pelo usuário depois de usado.

## 2026-09-17 — Relações reais entre memórias + Atlas 3D com modo Fluxograma 2D

Depois de estabilizar o Electron, o usuário pediu pra começar os "diferenciais" discutidos (relações de memória, bandeja do sistema, acesso a arquivos, comparação entre provedores, memória com decaimento, exportação, auto-log) mais um novo layout do Atlas 3D. Combinado: ir por fases. **Fase 1** (esta rodada): relações reais entre memórias + um modo "Fluxograma 2D" dentro da própria tela do Atlas 3D (alternando com a cena 3D via botão).

Descoberta que simplificou tudo: o tipo `Memory` do frontend (`frontend/src/data.ts`) **já tinha** `relations`/`relationTypes` e `graph.ts`/`MemoryScene.tsx` já sabiam desenhar conexões — só que `NeuralAtlas.tsx` forçava esses campos vazios porque o backend nunca tinha rastreado relações de verdade. Bastou o backend passar a fornecer dados reais.

**Backend:**
- Nova tabela `memory_relations` (`app/db.js`): `from_id`, `to_id`, `type` (`belonging`/`thematic`/`derivation`/`correction`), `UNIQUE(from_id, to_id, type)`.
- `app/store.js`: `createRelation()` (idempotente via `INSERT OR IGNORE`), `attachRelations()` (preenche `relations`/`relationTypes` só do lado que declara a relação — unidirecional, pra casar com o jeito que `graph.ts` já constrói o grafo no frontend usando um mapa `incoming` separado pro sentido inverso; populei bidirecional na primeira tentativa e geraria arestas duplicadas, corrigido antes de testar), `listNearbyMemories()` (pool de memórias já existentes da mesma conversa/projeto/geral, oferecidas como candidatas de relação).
- `app/memoryExtractor.js`: a extração de memória existente (uma chamada ao Codex por turno, não uma nova) passou a também pedir um campo opcional `relatesTo` por item extraído, com uma lista curta de memórias existentes (id + título) oferecida no prompt — o modelo nunca pode inventar um id fora dessa lista (validado em `parseMemoryCandidates`). Relações neste v1 só apontam pra memórias já existentes antes da extração (não liga itens novos do mesmo lote entre si).
- 18 testes de backend (15→18): 2 unitários pra validação de `relatesTo` e 1 HTTP confirmando que a relação aparece em `GET /api/memories` do lado certo.

**Frontend:**
- `frontend/src/api.ts`: `MemoryEntry` ganhou `relations?`/`relationTypes?`.
- `frontend/src/NeuralAtlas.tsx`: `loadRealMemoriesAsAtlas` para de zerar `relations`/`relationTypes` e passa a usar os dados reais da API — nenhuma mudança em `MemoryScene.tsx`/`graph.ts` foi necessária, eles já sabiam desenhar isso.
- Novo `frontend/src/MemoryFlow.tsx`: modo "⌗ Fluxograma" (terceiro botão ao lado de "Mapa 3D"/"Lista"), usa `@xyflow/react` + `dagre` (2 dependências novas, nenhuma nativa) pra layout hierárquico 2D do mesmo grafo (`buildGraph`) que já alimenta a cena 3D — carregado via `React.lazy`, mesmo padrão do `MemoryScene`, fica num chunk separado (277 kB) sem inflar o bundle principal.

**Validação de ponta a ponta com Codex real:** mandei "Guarde este fato: o projeto Aurora usa SQLite" (criou 1 memória) e depois "na verdade decidimos trocar pra PostgreSQL" na mesma conversa — a segunda memória extraída declarou sozinha uma relação `correction` apontando pra primeira, confirmada via `GET /api/memories` (`relations: ["<id-sqlite>"], relationTypes: {"<id-sqlite>": "correction"}`). Backend (18/18), frontend (`test:memory`, 6/6) e build (`frontend:build`) passando.

Fases seguintes (ainda não implementadas): bandeja do sistema/atalho global, acesso a arquivos locais pro Codex, comparação lado a lado entre provedores, memória com confiança/decaimento, exportação/importação de "pacotes de memória", auto-geração de `PROJECT_LOG.md` pra outros projetos do usuário.

## 2026-09-17 — Bandeja do sistema + atalho global de captura rápida

Fase 2, primeiro item (dos seis combinados): ícone na bandeja do Windows + atalho de teclado global pra capturar uma memória de qualquer lugar do Windows sem abrir o app inteiro. Descoberta: **não existia nenhum ícone no projeto** (nem favicon, nem ícone de app) — gerado um PNG simples (256×256, tema teal/escuro) via script Node usando só `zlib` (sem dependência nova), servindo tanto pro `Tray` quanto pro `build.icon` do `electron-builder` (que converte PNG→ICO automaticamente no Windows, confirmado funcionando).

`electron/main.js`:
- **Mudança de comportamento avisada ao usuário:** fechar a janela principal (X) agora minimiza pra bandeja em vez de encerrar o app (igual Discord/Slack/Spotify) — só "Sair" no menu da bandeja encerra de verdade. Implementado interceptando o evento `close` da janela (`event.preventDefault()` + `hide()`) com uma flag `isQuitting` setada só em `before-quit`.
- Atalho global via `globalShortcut.register`, tentando uma lista de combinações em ordem até uma registrar com sucesso (`Ctrl+Shift+H` → `Ctrl+Alt+M` → `Ctrl+Shift+K` → `Alt+Shift+M`) em vez de uma única combinação fixa — necessário na prática: `Ctrl+Shift+H` já estava em uso por outro programa nesta máquina, confirmado nos testes, e o fallback pegou `Ctrl+Alt+M` sozinho sem travar nada. O atalho realmente ativo aparece no menu da bandeja.
- Janela de captura rápida (420×220, sem moldura, sempre no topo, sem ícone na barra de tarefas) carrega um HTML estático novo (`electron/quick-capture.html`) — sem build/React, é só um formulário. Comunicação com o processo principal via **IPC** (`electron/preload-quick-capture.cjs`, `contextBridge`), não HTTP — evita problema de CORS entre a janela `file://` e o backend, e é mais rápido. `ipcMain.handle("quick-capture:save", ...)` chama `createMemory` direto de `app/store.js` (mesmo processo), salvando como `scope: "global", kind: "manual", source: "Captura rápida (atalho global)"`.

Validação (sem suíte automatizada pra Tray/IPC/globalShortcut — fora do escopo dos testes HTTP/unit existentes):
- Simular o atalho global via `SendKeys` do PowerShell não funcionou de forma confiável neste ambiente de automação (input sintético não chega no `RegisterHotKey` do Windows do jeito esperado) — contornado testando a janela de captura via um gatilho de debug temporário (`HARNESS_DEBUG_QUICK_CAPTURE`, removido antes do commit) que chama `openQuickCapture()` direto na inicialização.
- Janela de captura abriu de verdade com o título certo, confirmando toda a sequência de inicialização (janela principal → atalho → bandeja → captura) sem erros.
- `POST /api/memories` com o mesmo formato usado pelo handler de IPC criou o registro certo (`scope: global`, `kind: manual`, `source` certo) — memória de teste apagada depois.
- Fechar a janela principal via `WM_CLOSE` (enviado por P/Invoke do PowerShell, equivalente a clicar no X) confirmou o comportamento de bandeja: a janela sumiu da lista de janelas visíveis, mas o processo e o backend continuaram respondendo.
- `npm run check`, `npm test` (18/18) e `npm run frontend:build` continuam passando (mudanças ficaram isoladas em `electron/`).

Pendência conhecida: não foi possível validar visualmente o clique no ícone da bandeja nem o disparo real do atalho global por teclado físico neste ambiente — o usuário deve confirmar isso na própria máquina.

## 2026-09-17 — Exportar/importar memória (Fase 2, item 2 de 6)

Botões "Exportar"/"Importar" na aba Memória, pra levar a memória real (com relações) de uma instalação pra outra ou fazer backup.

- **Backend:** uma rota nova só, `POST /api/memories/:id/relations` (`{toId, type}` → chama `store.js#createRelation`, que já existia mas não tinha rota HTTP nenhuma até agora — só era usada internamente pelo extrator). `GET /api/memories` já devolvia relações completas, então exportar não precisou de nenhuma mudança no backend.
- **Frontend (`MemoryView.tsx`):** exportar empacota as memórias filtradas em tela num envelope JSON versionado (`{format: "harness-aurora-memories", version: 1, ...}`) via Blob + `<a download>` (mesmo mecanismo que o Atlas 3D já usava pra dados sintéticos). Importar lê o arquivo, valida o formato, e faz em duas passadas: 1) cria cada memória (`createMemory` sempre gera id novo — guarda um mapa id-antigo→id-novo), rebaixando pra `scope: "global"` quando o projeto/conversa referenciado não existe localmente (evita falhar o import inteiro por causa de uma constraint de chave estrangeira); 2) recria as relações usando os ids novos via a rota nova, ignorando relações que apontam pra fora do lote importado.
- 19 testes de backend (18→19, cobrindo a rota nova, incluindo um caso de tipo de relação inválido retornando 400).
- Validação de ponta a ponta via API direta (sem clicar na UI, mesma limitação de sempre neste ambiente): criei duas memórias com uma relação, "exportei" (`GET /api/memories`), simulei a reimportação com um script batendo na API exatamente como o `MemoryView.tsx` faria — as duas memórias novas foram criadas com ids diferentes e a relação foi recriada corretamente traduzida pros ids novos.
- `npm run check`, `npm test` (19/19), `npm run test:memory` (6/6) e `npm run frontend:build` passando.

Pendência: confirmar visualmente na sua máquina (clicar Exportar, conferir o arquivo, clicar Importar com ele).

Com isso, a Fase 2 pausa aqui (2 de 6 itens feitos: bandeja+atalho, exportar/importar) — próximo passo combinado é testar o auto-update de verdade pelo app instalado antes de continuar com o resto da lista (acesso a arquivos, comparação entre provedores, memória com decaimento, auto-log).

## 2026-09-17 — v0.1.4 publicada, auto-update confirmado, bug crítico de `package.json` evitado

Publicada e testada a v0.1.4 (empacota tudo desta sessão: relações, Fluxograma, bandeja/atalho, exportar/importar), com o ícone customizado aplicado pela primeira vez no instalador. **Auto-update confirmado funcionando de verdade**: o usuário já tinha a v0.1.3 instalada, abriu o app, e o `electron-updater` buscou/aplicou a v0.1.4 sozinho — quando checamos, o processo do usuário já respondia `version: "0.1.4"` no health check.

**Incidente evitado**: um comando `npx asar extract-file` (rodado pra checar a versão do app instalado) sobrescreveu o `package.json` do repositório com uma versão antiga/truncada (faltando `scripts`, `build`, `devDependencies`) — mesmo bug de resolução de caminho que já tinha corrompido um `db.js` perdido numa rodada anterior. Percebido imediatamente pelo aviso do próprio Claude Code de que o arquivo mudou no disco fora de uma edição normal; restaurado na hora via `git checkout -- package.json` (só esse arquivo, sem perder nada). **Lição registrada**: nunca mais usar `asar extract-file` neste ambiente — o comando não respeita o caminho de destino de forma confiável no Windows/git-bash daqui. Pra inspecionar um app.asar instalado, preferir `asar extract <archive> <pasta-nova>` (extrai tudo pra uma pasta, que já funcionou antes) ou simplesmente não inspecionar e confiar em outros sinais (ex.: `/api/health` já diz a versão rodando).

**Primeira verificação visual de verdade da sessão inteira**: como o backend serve o frontend como uma página HTML normal, usei a skill `claude-in-chrome` pra abrir `http://127.0.0.1:<porta>` num Chrome de verdade (numa porta isolada, sem mexer no app real do usuário que estava rodando em 8787) e navegar pela interface — coisa que nunca tinha sido possível com o Electron diretamente neste ambiente. Confirmado visualmente que o app renderiza corretamente.

## 2026-09-17 — Separar aba "Teste" do Atlas 3D real

Primeiro dos três ciclos pedidos nesta rodada (depois vêm Claude como provedor e polimento visual do Atlas 3D). Até agora o Atlas 3D caía sozinho pra 1.000 registros sintéticos quando não havia memória real — o usuário pediu pra isso parar, e separar o sandbox sintético numa aba própria.

- `frontend/src/NeuralAtlas.tsx` ganhou uma prop `variant: "real" | "test"` em vez de virar dois componentes duplicados — ~570 linhas de lógica compartilhada (grafo, cena 3D, fluxograma, filtros, inspetor) continuam uma cópia só; só ~5 pontos mudam por variante (dado inicial, efeito de montagem, aviso da barra lateral, botões do rodapé, textos de cabeçalho).
- `variant="real"`: nunca mais cai pra dado sintético — memória vazia mostra aviso pra conversar no chat ou visitar a aba Teste. Botões de Importar/Exportar JSON removidos daqui (ficaram redundantes com o exportar/importar de memória real feito na rodada anterior); só resta "Sincronizar memória real".
- `variant="test"`: sandbox sintético de sempre (1.000 registros, importar/exportar JSON, `localStorage`), agora deixado explícito que "não afeta sua memória real" — nunca chama a API de sincronização.
- `AppShell.tsx`/`Sidebar.tsx`: nova entrada de navegação "Teste" (ícone ⚗), ao lado do "Atlas 3D".
- **Validado visualmente de verdade** (primeira vez usando `claude-in-chrome` nesta sessão): Atlas 3D real mostrando "Nenhuma memória encontrada"/"0/0" com o aviso certo; aba Teste mostrando os 1.000 registros sintéticos, 6 grupos, 994 conexões, renderizando a cena 3D normalmente, com os botões certos em cada aba.
- `npm run frontend:build`, `npm run test:memory` (6/6), `npm run check` e `npm test` (19/19) passando.

Próximos ciclos combinados: Claude Code CLI como segundo provedor (mesma autenticação via CLI local que já usamos com o Codex), depois um passe de polimento visual no Atlas 3D.

## 2026-09-17 — Claude Code CLI como segundo provedor

Segundo dos três ciclos combinados. Pedido do usuário: reaproveitar a autenticação do Claude Code CLI local, no mesmo padrão já usado com o Codex CLI (sem chave de API).

Descoberta que simplificou o trabalho: **o schema já previa múltiplos provedores desde o início** — a coluna `conversations.provider` já existia (`DEFAULT 'codex'`) e `store.js#createConversation` já aceitava um provider arbitrário, só ninguém tinha ligado os pontos até agora.

- Testado o `claude` CLI direto nesta máquina antes de codar: `claude -p "<prompt>" --output-format json --no-session-persistence` devolve um único objeto JSON (bem mais simples que o JSONL do Codex) com `result`/`session_id`/`usage`/`is_error`. Testado também via `execFile` do Node (mesmo mecanismo do `runCodex`) — **não tem o bug de stdin travado que o Codex tinha** (respondeu em ~7s sem fechar o stdin manualmente); fechei o stdin mesmo assim por segurança/consistência.
- Novo `app/claude.js` espelha `app/codex.js` (`buildProviderConfig`, `parseClaudeOutput`, `runClaude`) com a mesma interface — o resto do backend não precisa saber qual provedor está respondendo.
- `app/server.js`: `POST /api/conversations` passa a repassar o `provider` escolhido (antes era ignorado); nova rota `GET /api/providers` lista os dois; `handleChatTurn` escolhe `runCodex`/`runClaude` conforme `conversation.provider`, e o rótulo salvo na mensagem (antes fixo em `"Codex"`) virou dinâmico — como o `ChatView.tsx` já mostrava `message.provider` por mensagem, isso sozinho já fez a UI funcionar certo pros dois provedores, **sem nenhuma mudança de frontend nessa parte**.
- `app/memoryExtractor.js`: a extração de memória agora usa o mesmo provedor da conversa.
- `electron/main.js`: `CLAUDE_CWD` aponta pra mesma pasta neutra (`userData`) já usada pelo `CODEX_CWD`, evitando que o `claude` CLI leia um `CLAUDE.md` de projeto aleatório.
- Frontend: par de botões "Codex"/"Claude" na barra lateral (acima do "+ Nova conversa", busca os nomes via `GET /api/providers`) define o provedor da próxima conversa nova.
- 23 testes de backend (19→23: 2 unitários pro parser do Claude, 2 de HTTP — `/api/providers` e conversa `provider: "claude"` indisponível no ambiente de teste).

**Validado de ponta a ponta com o Claude CLI real** (porta isolada 8799, sem mexer no app real do usuário que estava rodando em 8787 na v0.1.4): criei uma conversa com `provider: "claude"`, mandei "guarde que meu carro favorito é um Fusca azul" — resposta real do Claude, rótulo "Claude" na mensagem, memória extraída corretamente ("Carro favorito"). Segunda mensagem "qual meu carro favorito?" leu a memória certa e respondeu "Volkswagen Fusca." — confirma leitura e escrita funcionando com Claude também, não só com Codex.

`npm run check`, `npm test` (23/23), `npm run test:memory` (6/6) e `npm run frontend:build` passando. Verificação visual do seletor de provedor via `claude-in-chrome` não foi possível nesta rodada (extensão do Chrome desconectada no momento) — vale conferir na próxima sessão ou pedir confirmação ao usuário.

Próximo ciclo combinado: polimento visual do Atlas 3D (materiais/iluminação/geometria da cena 3D em si).

## 2026-09-17 — Bug real: abrir o app uma segunda vez travava (falta de single-instance lock)

Usuário reportou "está dando erro ao abrir Aurora". Diagnóstico: `tasklist` mostrou **13 processos "Harness Aurora.exe"** rodando ao mesmo tempo, mas `/api/health` respondia normal na porta 8787 — ou seja, a instância original estava saudável, rodando em segundo plano na bandeja (comportamento introduzido na Fase 2, item 1). O usuário provavelmente clicou no atalho de novo sem perceber que o app já estava aberto (minimizado, não fechado).

Causa raiz confirmada no código: `electron/main.js` nunca chamava `app.requestSingleInstanceLock()`, e o `server.listen(PORT, HOST, resolve)` não tinha handler de `"error"`. Quando uma segunda instância tentava subir o próprio servidor na mesma porta 8787 já ocupada pela primeira, o `EADDRINUSE` virava um evento `"error"` sem listener no `http.Server` — que em Node.js **lança uma exceção não tratada**, derrubando o processo principal do Electron com uma tela de erro. É exatamente o "erro ao abrir" reportado.

Correção:
- `app.requestSingleInstanceLock()` logo no início do arquivo; se não conseguir o lock (já tem outra instância rodando), a segunda instância só chama `app.quit()` — todo o resto do arquivo (incluindo `app.whenReady()`) fica dentro de um `if (hasSingleInstanceLock)` pra garantir que nada mais tenta inicializar.
- `app.on("second-instance", ...)` na instância original mostra/foca a janela existente quando alguém tenta abrir de novo — em vez de travar, agora só traz a janela pra frente.
- `server.on("error", ...)` como defesa adicional (ex.: outro programa qualquer ocupando a porta 8787, não só uma segunda instância nossa): mostra uma caixa de erro nativa explicando o problema em vez de deixar a exceção derrubar o processo silenciosamente.

Validado localmente: build com a correção, abri a mesma instalação **duas vezes seguidas** — segunda tentativa não travou, não duplicou processos (voltou a 4 processos, uma janela normal, contra os 13 zumbis de antes), backend continuou respondendo normalmente o tempo todo.

Processos zumbis do usuário foram encerrados (dados no SQLite não foram afetados — só processos, nenhum dado apagado). Publicado como **v0.1.5**.

## 2026-09-17 — Dois bugs reportados testando o Claude: rótulo errado + erro de timeout confuso

Usuário testou autenticação com Claude e reportou dois problemas na mesma mensagem:

1. **Rótulo mostrando "Codex" e depois trocando pra "Claude"** após enviar mensagem numa conversa configurada pra Claude. Causa encontrada em `frontend/src/ChatView.tsx`: o indicativo "pensando…" mostrado enquanto a resposta não chega tinha o texto **fixo** `"CODEX · pensando…"` (linha 126), e o rótulo de fallback de cada mensagem também tinha `"CODEX"` fixo como padrão — nenhum dos dois olhava pra `conversation.provider` de verdade. Corrigido: `ChatView.tsx` agora deriva `providerLabel` do provider real da conversa (`conversation.provider === "claude" ? "Claude" : "Codex"`) e usa isso tanto no indicador de "pensando…" quanto no fallback por mensagem e no texto de conversa vazia.

2. **"Reading additional input from stdin..." aparecendo como mensagem de erro, com a IA demorando ~5 minutos pra responder.** Esse texto é uma mensagem informativa que o Codex/Claude CLI imprime no stderr quando não está anexado a um terminal interativo — não é um erro em si. Ela só vira uma mensagem de erro visível pro usuário quando a chamada ao CLI **estoura o timeout** (`CODEX_TIMEOUT_MS`/`CLAUDE_TIMEOUT_MS`, 120s por padrão) — nesse caso o `execFile` mata o processo e o texto capturado no stderr até aquele momento (que pode ser só essa linha informativa) vira o texto de erro exibido, o que é confuso porque não parece um erro de verdade. Hipótese mais provável pro atraso de ~5 minutos na primeira execução: o Windows Defender/SmartScreen verificando o executável (`codex.exe`/`claude.exe`) na primeira vez que ele roda nesta máquina — comportamento comum e fora do nosso controle, que ultrapassa os 120s de timeout. Corrigido tornando o erro **honesto e acionável** em vez de mostrar o texto de stderr cru: `app/codex.js` e `app/claude.js` agora detectam `error.killed` (como o Node sinaliza quando mata o processo por timeout, confirmado com um teste direto) e retornam "O Codex/Claude CLI demorou demais para responder e foi interrompido... tente enviar a mensagem de novo" em vez do texto de stderr confuso.

`npm run check`, `npm test` (23/23) e `npm run frontend:build` passando. Não foi possível confirmar visualmente a correção do rótulo (extensão do Chrome ainda desconectada) — mudança pequena e direta, validada por revisão de código. Publicando como **v0.1.6**.

## 2026-09-18 — Terceiro provedor: modelo local (Ollama) ensinado por Codex/Claude via memória

O "diferencial" que o usuário tinha guardado: um modelo pequeno **local** (de graça, offline, sem gastar chamada de Codex/Claude) pro dia a dia, e quando ele erra, Codex ou Claude corrigem a resposta **e** gravam uma memória específica do erro — assim uma conversa futura diferente já acerta sozinha, sem escalar de novo. Aprendizado via memória acumulada, não fine-tuning. Confirmado com o usuário: o gatilho de correção é **manual** (botão "Corrigir"), não verificação automática — verificar toda mensagem gastaria token e anularia o ganho.

Pesquisa feita na própria máquina antes de codar: Ollama já instalado e rodando (`127.0.0.1:11434`, API HTTP simples, não precisa de `execFile`). `qwen3.5:4b` levou 30+ segundos numa resposta trivial (máquina 100% CPU, sem GPU dedicada, modelo verboso). `qwen2.5-coder:1.5b` (986 MB, focado em código) respondeu em ~6s — virou o modelo padrão.

- Novo `app/local.js`: provedor HTTP (não CLI) — `fetch` em `/api/generate`, com timeout via `AbortController` e mensagens de erro específicas (Ollama não rodando vs. modelo lento demais).
- `app/db.js`: nova coluna `teacher_provider` em `conversations`. Primeira migração real de schema deste projeto — `CREATE TABLE IF NOT EXISTS` só afeta bancos novos, então o banco real do usuário (que já existe em disco) precisa de `ALTER TABLE`. Nova `migrateSchema(db)`, chamada em todo `getDb()`, checa `PRAGMA table_info(conversations)` e roda o `ALTER TABLE` só se a coluna ainda não existir.
- Novo `app/correction.js`: o professor (Codex ou Claude) corrige a resposta errada **e** destila até 3 memórias de ensino num único objeto JSON — uma chamada só, não duas.
- `app/server.js`: `/api/providers` lista os três; nova rota `POST /api/conversations/:id/messages/:messageId/correct`; a extração automática de memória em conversas locais usa sempre o professor (`teacherProvider`), nunca o modelo pequeno — 1.5B não segue com confiabilidade a instrução estruturada de extrair JSON. Memórias de correção salvas em escopo **projeto**/**geral** (nunca `conversation`) — de propósito, já que o objetivo é o modelo local melhorar em conversas futuras diferentes, não só na mesma conversa.
- Frontend: terceiro botão "Local" no seletor de provedor (automático, só por `/api/providers` já listar o terceiro — nenhuma mudança no loop que renderiza os botões); seletor extra "Professor" quando Local está selecionado; botão "🔧 Corrigir" em cada resposta de conversa local, com caixa de nota opcional.
- 30 testes de backend (23→30: parser/prompt/HTTP do fluxo de correção, mais 2 novos pro bug do Codex descrito abaixo).

**Bug real encontrado durante a verificação de ponta a ponta** (não relacionado à feature em si): `runCodex` só olhava `error.stderr` quando `codex exec` falhava, mas o motivo real de uma falha (ex.: `type: "error"` no stream JSON) vem no **stdout**, não no stderr — então o usuário via a linha genérica "Reading additional input from stdin..." em vez do motivo de verdade. Descoberto ao vivo: a conta de Codex CLI da máquina tinha batido o limite de uso diário (`"You've hit your usage limit... try again at Sep 19th, 2026 5:09 AM"`), e essa mensagem real ficava escondida atrás do texto genérico. Corrigido com `extractCodexError(stdout)`, que procura eventos `type:"error"`/`type:"turn.failed"` no stream e prioriza essa mensagem sobre qualquer fallback.

**Segundo ajuste motivado por um resultado real da verificação**: numa primeira rodada de teste de ponta a ponta, o modelo local recebeu as memórias corretas via `memoryAccess` mas ainda assim respondeu errado — o cabeçalho "Memórias relevantes:" no prompt (`app/server.js#buildPrompt`, compartilhado pelos três provedores) era discreto demais para um modelo de 1.5B tratar como regra a seguir, e não só como contexto de fundo. Trocado para "Memórias relevantes (fatos e regras aprendidos antes — siga-os ao responder):" — testado de novo com a mesma pergunta e o modelo local passou a citar `PRAGMA table_info`/`ALTER TABLE` corretamente, sem precisar de nova correção.

**Validado de ponta a ponta com Ollama de verdade** (porta isolada 8799, sem tocar no app real do usuário em 8787): conversa `provider:"local"`, pergunta de código real respondida em ~24s pelo `qwen2.5-coder:1.5b`. Pergunta sobre migração de schema deste próprio projeto, respondida errado (o modelo alucinou Sequelize com `sync({force:true})` — que apagaria a tabela de verdade). `/correct` com Claude como professor (Codex indisponível por limite de uso no momento) devolveu resposta corrigida e criou 2 memórias em escopo `global`. **Conversa nova**, pergunta relacionada: as 2 memórias apareceram em `memoryAccess` e, após o ajuste de wording acima, o modelo local acertou sem precisar de correção — confirma o ganho de aprendizado entre conversas, que é o ponto central da ideia.

Migração de schema também validada contra uma **cópia** do `harness.db` real do usuário (nunca o arquivo ao vivo): a coluna `teacher_provider` foi adicionada sem erro e sem perda de dados (as 2 conversas reais existentes continuaram intactas, com `teacher_provider: null`).

`npm run check`, `npm test` (30/30), `npm run test:memory` (6/6) e `npm run frontend:build` passando.

## 2026-09-18 — Bateria de testes reais: modelo local jogando Three.js, e um vazamento de token achado no processo

Pedido do usuário: uma bateria de testes de verdade com o modelo local — pediu pra ele criar jogos em Three.js, com o usuário no papel de "técnico" e eu auxiliando/corrigindo. Antes de começar, criei um projeto real ("Jogos Three.js (treino IA local)") no `harness.db` do próprio usuário, com 13 memórias de escopo `project` cobrindo os fundamentos de Three.js pra jogos (scene/camera/renderer, geometria+material, luzes, loop de animação, delta time, teclado, colisão por distância, spawn de obstáculos, placar via HTML, erros comuns).

**Descoberta operacional**: o app instalado (processo Electron rodando) tinha código de uma versão anterior (empacotada antes desta sessão) — pra testar o recurso de hoje contra o banco real, tive que fechar o app instalado (com autorização explícita do usuário, depois que o classificador do modo automático bloqueou eu mesmo matar o processo) e rodar `node app/server.js` na porta 8787 apontando pro mesmo `harness.db` real. App reinstalado ao final do teste.

**Três rodadas de "jogo → correção" com Claude como professor** (Codex ainda com limite de uso batido):
- Rodada 1 (desviar de cubos caindo): o modelo local gerou um jogo que quebrava por completo — usou `THREE.OrbitControls` sem importar (trava o módulo inteiro antes de `animate()` rodar, nada renderiza), câmera nunca posicionada, placar nunca incrementado, zero colisão. Corrigido via `/correct`, 3 memórias de ensino gravadas em escopo `project`.
- Rodada 2 (coletar esferas, conversa nova): mesmo com a memória certa sobre OrbitControls presente em `memoryAccess`, o modelo repetiu o erro, inventou um jeito novo de quebrar (`<script type="module" src="...">` seguido de `<script>` comum tentando ler `THREE` como global — não funciona), ignorou o pedido de WASD e trocou as cores pedidas. Corrigido de novo, mais 3 memórias.
- Rodada 3 (pular sobre espinhos, conversa nova): as 3 lições mais reforçadas (sem OrbitControls, câmera posicionada, estrutura de módulo correta) generalizaram de primeira — prova real de aprendizado via memória entre conversas. Mas apareceram problemas novos, incluindo a reincidência de um bug (listener de teclado dentro do loop de animação) que só tinha sido pego pela **extração automática** na rodada 1 (escopo `conversation`, nunca chega a novas conversas) — só memórias nascidas de `/correct` (escopo `project`/`global`) realmente ensinam conversas futuras. Corrigido pela 3ª vez; resultado final é um jogo completo e coerente (gravidade, pulo, spawn contínuo, colisão, placar, botão de reiniciar).

Todas as correções foram verificadas por leitura direta do código + `node --check` de sintaxe (extensão do `claude-in-chrome` desconectada nas duas tentativas, sem verificação visual real desta vez).

**Vazamento de token real encontrado a partir dessa bateria**: o usuário pediu, no fim da sessão anterior, que o gatilho de escalonamento fosse manual pra evitar gastar token de Codex/Claude em toda mensagem — mas isso só valia pro botão "Corrigir". A **extração automática de memória** (que roda depois de toda resposta, pra qualquer provedor) continuava, pras conversas `local`, despachando pro professor (Codex/Claude) a cada turno, silenciosamente furando essa regra: toda mensagem numa conversa local já gastava uma chamada real de API, mesmo sem o usuário pedir correção nenhuma.

Corrigido: `handleChatTurn` em `app/server.js` agora pula a extração inteiramente quando `conversation.provider === "local"` — `memoryCreated` fica `[]` nesses turnos, e a única forma de gerar memória de ensino numa conversa local volta a ser o clique manual em "Corrigir", como já era a intenção original. Novo teste HTTP com um Ollama de mentira (servidor HTTP local na própria suíte) confirma que um turno local bem-sucedido nunca cria memória.

Discussão em aberto com o usuário sobre economizar ainda mais token (não implementado ainda): a ideia dele de uma "notação tipo hash" pras memórias foi avaliada — o texto da memória não é o maior custo hoje (o código gerado/reescrito nas correções pesa mais), e aplicar uma notação não-natural pro modelo local especificamente arriscaria piorar a confiabilidade dele, que já é frágil com frases normais. Próximo passo sugerido (ainda não implementado): pedir ao professor um diff/patch em vez de reescrever o arquivo inteiro a cada correção.

`npm run check`, `npm test` (31/31) passando.

## 2026-09-18 — Três melhorias pro modelo local (template, auto-revisão, retry de sintaxe) + bateria A/B ao vivo

Pedido do usuário: melhorar o modelo local usando Codex/Claude ao mesmo tempo que se economiza token, com o objetivo de "mesmo um modelo fraquinho ter capacidade de fazer coisas que um modelo grande faz". Combinado: três mudanças, todas usando compute **local (grátis)** ou reaproveitando uma chamada ao professor que já ia acontecer de qualquer forma — nenhuma delas adiciona uma chamada nova a Codex/Claude:

1. **Esqueleto de código como memória** (`app/correction.js`): `buildCorrectionPrompt`/`parseCorrectionResponse` ganharam um campo opcional `template` — o professor pode, na mesma chamada de `/correct`, além de corrigir a resposta e ensinar regras, também gravar um esqueleto de código reutilizável (setup de cena/câmera/loop, sem a mecânica específica do pedido) marcado com a tag `template`. `buildPrompt` em `app/server.js` agora separa memórias com essa tag e as renderiza como bloco de código a **adaptar**, não como regra em prosa — o objetivo é o modelo pequeno copiar/editar em vez de reconstruir do zero.
2. **Auto-revisão local** (`app/localRefine.js`, novo): depois da resposta do modelo local, uma segunda chamada — ainda no Ollama, sem custo — pede pro próprio modelo revisar a resposta contra as mesmas memórias já selecionadas, e substituir por uma versão corrigida se achar problema.
3. **Retry automático com checagem de código**: `checkJsModuleSyntax` roda `node --check` no script embutido na resposta antes de mostrá-la; se falhar, o modelo local tenta de novo sozinho com o erro anexado.

**Bateria A/B ao vivo** (porta isolada 8799, projeto e memórias novos — mesmas 13 memórias base da bateria anterior, sem memórias de correção acumuladas, pra isolar o efeito das mudanças de código): rodei os mesmos prompts de "desviar de cubos" e "coletar esferas" usados na bateria anterior. Isso revelou **dois bugs reais no meu próprio código**, corrigidos ainda durante a bateria:

- **Regressão séria na auto-revisão**: numa das rodadas, o passo de revisão devolveu só um **texto em prosa confirmando que "tudo estava certo"**, sem nenhum código — o modelo não seguiu literalmente a instrução "repita a mesma resposta se estiver tudo certo" e a resposta final ficou sem jogo nenhum. Corrigido: `refineLocalAnswer` só adota a revisão se ela **ainda parecer código**; caso contrário mantém a versão anterior (que pelo menos tinha código, mesmo que com bugs).
- **`node --check` não pega bugs de runtime**: em duas rodadas seguidas, o modelo declarou variáveis com `const` e depois reatribuiu (`const score = 0; ...; score++;`, `const sphere = ...; ...; sphere = new THREE.Mesh(...)`) — sintaticamente válido, mas lança `TypeError: Assignment to constant variable` na primeira execução, e `node --check` não vê isso (é erro de runtime, não de parsing). Adicionado `findConstReassignments`, um heurístico linha-a-linha (não um parser de verdade) que detecta esse padrão especificamente e dispara o retry local com o erro explicado. Também adicionada uma memória **global** (não específica de Three.js) ensinando a regra "declare com `let` o que for reatribuído depois".
- **Terceiro gap encontrado e corrigido**: o checker só procurava `<script type="module">`, mas numa rodada o modelo carregou o Three.js via `<script src="...three.min.js">` clássico (build UMD, sem módulos) — nenhuma checagem rodava nesse caso. `extractModuleScript` (renomeado internamente, mesma função) agora pega qualquer `<script>` inline sem `src`, não só os `type="module"`.

**Limite honesto encontrado e não resolvido**: mesmo depois dessas correções, uma rodada ainda produziu uma variável (`cube`) usada sem nunca ter sido declarada — um `ReferenceError` de runtime que nem `node --check` nem `findConstReassignments` conseguem pegar (exigiria um analisador de escopo de verdade, fora do escopo razoável pra hoje). O modelo de 1.5B tem variância alta entre execuções mesmo com o mesmo prompt e a mesma memória — as melhorias reduzem a taxa de erro mas não eliminam a necessidade do "Corrigir" manual como rede de segurança confiável.

12 novos testes (`localRefine.js`: síntese, `findConstReassignments`, e 5 cenários de `refineLocalAnswer` incluindo a regressão da auto-revisão e o retry de `const`; `correction.js`: parsing do campo `template`; `buildPrompt`: renderização de template separada de fatos). `npm run check`, `npm test` (42/42), `npm run test:memory` (6/6), `npm run frontend:build` passando.

## 2026-09-19 — Fechando o limite anterior: sandbox de execução de verdade em vez de heurística

Pedido do usuário: "pode continuar iterando". O limite deixado em aberto na rodada anterior (`cube` usado sem nunca ter sido declarado — nem `node --check` nem `findConstReassignments` pegam esse tipo de erro de runtime) tinha um caminho real pra ser fechado sem virar um analisador de escopo completo: **rodar o código de verdade**, não adivinhar.

Novo `app/jsSandbox.js`: `runCodeInSandbox(js, sourceText)` executa o script gerado dentro de um contexto `node:vm` com um `THREE`/`document`/`window` falsos. A peça central é um objeto "permissivo" (via `Proxy`) que aceita qualquer propriedade/chamada e devolve mais de si mesmo — assim a suíte fake nunca lança erro só porque não modela algum método específico do Three.js; qualquer exceção que escapa é um erro de linguagem de verdade (`ReferenceError` de variável nunca declarada, `TypeError` de `const` reatribuído, TDZ, `SyntaxError` de identificador duplicado), exatamente a classe de bug que escapava antes.

**Refinamento adicional, motivado por outro achado ao vivo**: um `THREE` totalmente permissivo teria deixado passar `new THREE.OrbitControls(...)` mesmo sem import — justamente o bug mais recorrente do dia inteiro (apareceu em pelo menos 4 rodadas diferentes ao longo da sessão). `buildThreeStub` mantém uma lista de classes que só existem em addons separados do Three.js (`OrbitControls`, `GLTFLoader`, `EffectComposer`, etc.) e as deixa `undefined` a menos que a própria resposta referencie um `<script src>`/`import` cujo caminho contenha o nome daquele addon — assim o sandbox reproduz fielmente essa fronteira real do Three.js sem exigir uma lista de toda a API.

**Novo bug real encontrado testando ao vivo, corrigido na hora**: o loop de retry (`MAX_FIX_ATTEMPTS`) verifica o código *antes* de cada nova tentativa, mas nunca revalidava o resultado da *última* tentativa permitida — ela era aceita sem checagem só porque o orçamento de tentativas acabou. Numa rodada ao vivo, isso deixou passar uma resposta corrigida que trocou o bug do `OrbitControls` por um novo: `const spike` declarado duas vezes na mesma função (`SyntaxError: Identifier 'spike' has already been declared`). Corrigido: depois do loop, uma checagem extra (grátis, sem chamada de rede) roda de novo; se ainda houver problema, ele é passado explicitamente pra etapa de auto-revisão via um novo parâmetro `knownProblem` em `buildSelfReviewPrompt` — e a auto-revisão agora roda mesmo em conversas sem nenhuma memória salva (antes só rodava se `memories.length > 0`), dando mais uma chance gratuita de corrigir antes de desistir.

Validado contra o código real e quebrado das rodadas ao vivo desta sessão (não só exemplos sintéticos): `runCodeInSandbox` reproduziu exatamente `"ReferenceError: cube is not defined"` no bug do `cube`, e exatamente `"TypeError: THREE.OrbitControls is not a constructor"` no bug do `OrbitControls`, ambos extraídos diretamente das respostas reais salvas durante os testes.

9 novos testes (`jsSandbox.js`: bug de variável não declarada, `const`/TDZ, addon sem import vs. com import, e um jogo completo e correto sem falso positivo; `refineLocalAnswer`: retry disparado pelo sandbox, loop de múltiplas tentativas, rejeição de revisão que reintroduz problema, e o cenário exato do bug de hoje — problema persistente com zero memórias ainda ganhando uma última chance de auto-revisão). `npm run check`, `npm test` (51/51), `npm run test:memory` (6/6), `npm run frontend:build` passando.

**Custo em latência, registrado com transparência**: o pipeline completo (até 2 retries + 1 auto-revisão, cada chamada ao Ollama levando de 15s a mais de 100s neste hardware sem GPU dedicada) pode levar de 1 a 4+ minutos por turno numa conversa local complexa — um trade-off real de "mais lento, mas de graça e mais correto" que vale deixar explícito pro usuário, não só medir internamente.

## 2026-09-19 — Quanto estamos economizando de verdade, e memória compartilhada pela comunidade (pull-only)

Duas pedidas do usuário na mesma mensagem: "quero saber em % quanto conseguimos economizar em tokens", e a ideia de uma memória unificada no GitHub que todo mundo que instalar o app possa ajudar a construir.

**Contador de economia real** (`app/store.js#getSavingsStats`, `GET /api/savings`): calculado direto das linhas de `messages` já existentes, sem precisar de uma tabela de contagem separada — toda resposta local bem-sucedida já é salva com `provider: "Local"`, toda correção já é salva com `provider: "<Codex|Claude> (corrigindo)"`. A matemática: mandar a mesma mensagem direto pro Codex/Claude custaria 2 chamadas pagas (resposta + extração automática); um turno local custa 0; um turno corrigido custa exatamente 1 (a correção já inclui a extração de memória na mesma chamada). `baselineCalls = localTurns * 2`, economia = `1 - corrections/baselineCalls`. Isso da uma garantia estrutural, não uma estimativa: turno sem correção = 100% de economia, turno corrigido = 50%. Mostrado na barra lateral ("💰 X% de economia"), atualizado depois de cada mensagem/correção, com tooltip explicando a conta.

**Memória compartilhada da comunidade — só puxar, nunca enviar automaticamente** (decisão tomada com o usuário via pergunta direta, dado que isso envolve dados de outras pessoas e um repositório público de verdade): novo `community-memories/` no próprio repo do GitHub (já público, já usado pros releases), com um `manifest.json` listando pacotes e um `threejs.json` real (as 13 memórias base de Three.js + as melhores lições ensinadas via correção ao longo desta sessão: addon sem import, `const` reatribuído, checklist de mecânicas de jogo). `app/community.js` busca esses arquivos (URL configurável via `COMMUNITY_MANIFEST_URL`, com um default apontando pro repo real), validando o formato antes de confiar no conteúdo. Novo botão "🌐 Comunidade" na aba Memória reaproveita EXATAMENTE a mesma lógica de importação já usada pelo botão "Importar" de arquivo local (`importEnvelope`, extraído do que antes era só `importFile`) — mesmo formato de envelope (`harness-aurora-memories`), mesmo tratamento de relações e de escopo inválido.

Nenhuma memória do usuário é enviada a lugar nenhum automaticamente — decisão explícita do usuário. O lado de "contribuir" (gerar um pacote pra virar Pull Request) fica pra uma rodada futura, se fizer sentido.

Validado visualmente de ponta a ponta via `claude-in-chrome` (extensão instável nesta sessão, mas funcionou desta vez): servido o `community-memories/` local como se fosse o GitHub real, clicado "🌐 Comunidade", confirmado o pacote aparecendo com título/descrição/tags, clicado "Importar" e confirmado as 16 memórias entrando corretamente (contador foi de 0 para 16, memórias aparecendo na lista com badges "GERAL"/"IMPORTADA").

11 novos testes de backend (`getSavingsStats`: matemática de economia via delta antes/depois, já que a suíte inteira compartilha um banco; `fetchCommunityManifest`/`fetchCommunityBundle`: validação de formato, rejeição de nome de arquivo com path traversal, proxy HTTP com erro gracioso quando o upstream está fora do ar). `npm run check`, `npm test` (59/59), `npm run test:memory` (6/6), `npm run frontend:build` passando.
