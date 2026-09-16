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
