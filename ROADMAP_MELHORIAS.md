# Roadmap de Melhorias — UI, Layout, Qualidade de Vida e Performance da LLM Local

Este roadmap é diferente do `ROADMAP.md` (execução do MVP) e do `ROADMAP_MASTER.md` (visão original do Atlas 3D): os dois já estão, na prática, superados pelo que o projeto virou — um harness completo com três provedores, memória real por escopo, correção por professor, sandbox de execução e agora setup automático do modelo local. Este documento parte do estado real do código hoje (2026-09-19, v0.1.9) e olha pra frente.

## Como ler isto

As quatro dimensões pedidas — UI, layout, qualidade de vida e performance da LLM local — não evoluem isoladas neste projeto. A maior parte dos marcos abaixo mexe em mais de uma ao mesmo tempo, e isso é proposital: melhorar a busca de memória (performance) só importa se a interface mostrar por que uma resposta ficou melhor (UI); um modelo local mais confiável só reduz atrito de verdade se o usuário não precisar abrir um painel de configuração enterrado pra ajustar nada (QoL). Cada marco abaixo é rotulado com as dimensões que toca, e o texto explica a conexão, não só a tarefa isolada.

Cada marco tem: o que foi observado no código real (não suposição), a proposta, e um critério de conclusão verificável — no mesmo padrão que `PROJECT_LOG.md` já usa pra registrar o que foi feito.

## Visão geral de prioridade

| # | Marco | Dimensões | Esforço | Status | Por quê agora |
|---|-------|-----------|---------|--------|----------------|
| 1 | Sidebar sumindo em janela estreita, sem volta | UI, Layout | Baixo | ✅ Feito (2026-09-19) | Trava a navegação inteira — bug, não melhoria |
| 2 | Central de Configurações unificada | UI, QoL | Médio | ✅ Núcleo feito (2026-09-19)¹ | Hoje configuração está espalhada em 3 lugares diferentes |
| 3 | Busca de memória por similaridade (embeddings via Ollama) | Performance, QoL | Médio-Alto | Pendente | Reduz corrigir manualmente, que é o maior custo hoje |
| 4 | Expectativa de tempo e cancelamento no modelo local | UI, Performance | Baixo-Médio | Pendente | "Pensando…" sem noção de 1–4 min reais frustra |
| 5 | Onboarding de primeira abertura | UI, QoL | Médio | Pendente | Usuário leigo não sabe o que Codex/Claude/Local significam |
| 6 | Gerenciamento de conversas: mover, arquivar, buscar por conteúdo | QoL | Baixo-Médio | Pendente | Backend já suporta parte disso; falta só a UI |
| 7 | Tema claro e revisão de contraste/tipografia | UI, Layout | Baixo | Pendente | Item já previsto desde o `ROADMAP_MASTER.md`, nunca resolvido |
| 8 | Corrigir código via diff/patch em vez de reescrever tudo | Performance | Alto | Pendente | Já identificado no `PROJECT_LOG.md` como próximo passo, não feito |
| 9 | Carregamento sob demanda do Atlas 3D/Three.js | Performance, UI | Baixo | Pendente | Chunk de 874 kB carregado mesmo quando o usuário só quer conversar |
| 10 | Painel de latência do time-to-first-token | Performance, UI | Médio | Pendente | Sem instrumentação hoje, difícil saber se uma mudança ajudou de verdade |

¹ Feito: provedor/professor padrão, seletor de modelo local e URL da comunidade, tudo persistido e com indicador de pronto/pendente. Pendente dentro do próprio Marco 2: atalho de captura rápida configurável pela UI e a seção de Aparência (depende do Marco 7). Ver `PROJECT_LOG.md` (2026-09-19) para o detalhe de cada um.

---

## Marco 1 — Sidebar sumindo em janela estreita, sem forma de voltar

**Dimensões:** UI, Layout.

**O que existe hoje:** em `frontend/src/styles.css`, a media query `@media (max-width: 900px)` aplica `display: none` direto na `.app-sidebar` inteira. Abaixo de 900px de largura — comum em notebook com o app dividido na tela, ou numa janela redimensionada — toda a navegação (projetos, conversas, aba Memória, Atlas 3D, indicador de economia) desaparece sem nenhum botão substituto pra reabri-la. Isso não é uma limitação menor: é um estado em que o app fica preso na conversa atual sem forma de trocar de conversa.

**Proposta:** abaixo do breakpoint, trocar a sidebar por um drawer deslizante acionado por um botão de menu (☰) fixo no topo do `ChatView`/`MemoryView`. Reaproveitar a mesma `.app-sidebar` (evita duplicar HTML), só mudando de "sempre visível numa coluna" pra "painel sobreposto que fecha ao selecionar algo ou tocar fora".

**Critério de conclusão:** em qualquer largura de janela, incluindo celular em paisagem, é sempre possível trocar de conversa, projeto ou view sem redimensionar a janela.

---

## Marco 2 — Central de Configurações unificada

**Dimensões:** UI, qualidade de vida.

**O que existe hoje:** não existe uma tela "Configurações". O que hoje seriam preferências está espalhado: o provedor/professor padrão da próxima conversa fica em controles soltos no topo da sidebar (`provider-picker`/`teacher-picker` em `Sidebar.tsx`); o modelo local escolhido fica atrás de um link "Trocar modelo" dentro do painel de setup, só visível quando se está numa conversa Local (`LocalSetupPanel.tsx`); o atalho de captura rápida só pode ser trocado editando `QUICK_CAPTURE_SHORTCUT_CANDIDATES` no código-fonte (`electron/main.js`) — o usuário final não tem nenhuma UI pra isso; a URL do manifesto de memória da comunidade só muda via variável de ambiente `COMMUNITY_MANIFEST_URL`.

A tabela `settings` que acabou de ser criada (para guardar o modelo local escolhido) já é o alicerce certo pra isso — hoje só guarda uma chave (`local_model`), mas o formato chave/valor genérico serve pra qualquer preferência futura sem precisar de outra migração de schema.

**Proposta:** uma view nova `Configurações` (mesmo nível de `chat`/`memory`/`atlas`/`test` em `AppShell.tsx`), com seções: Provedores (padrão + professor padrão, com indicador de qual está configurado/pronto — reaproveitando `GET /api/providers` e `GET /api/local/status`), Modelo local (o seletor que hoje mora escondido no `ChatView`, promovido pra cá, mantendo o atalho contextual também), Atalho de captura rápida (nova API pra ler/gravar o atalho preferido, Electron tentando registrar o novo e avisando se falhar — mesma lógica de fallback que já existe pros 4 candidatos), Comunidade (URL do manifesto, hoje só editável via `.env`), Aparência (liga com o Marco 7).

**Critério de conclusão:** qualquer preferência hoje só ajustável editando código ou variável de ambiente fica ajustável pela interface, persistida na tabela `settings`, sobrevivendo a reinício do app.

---

## Marco 3 — Busca de memória por similaridade em vez de sobreposição de palavras

**Dimensões:** performance da LLM local, qualidade de vida.

**O que existe hoje:** `selectRelevantMemories` em `app/store.js` rankeia memórias por contagem de palavras em comum entre a pergunta e o conteúdo salvo (`scoreMemory`, ponderado por escopo: conversa 1.6x, projeto 1.3x, geral 1x). Isso é exatamente o que o `ROADMAP_MASTER.md` já previa como provisório desde o início do projeto ("preparar camada futura para embeddings e busca semântica" — Fase 2, nunca implementada). Na prática, uma pergunta que usa sinônimos ou reformula o que uma memória diz sem repetir as mesmas palavras não recupera essa memória, mesmo sendo exatamente o que resolveria a pergunta — e o `PROJECT_LOG.md` documenta repetidas vezes o modelo local de 1.5B repetindo erros que já tinham memória ensinando o contrário.

**Proposta:** o Ollama que a Fase de zero-config (2026-09-19) já garante estar instalado e rodando também serve embeddings via `POST /api/embeddings` (mesma API HTTP, nenhuma dependência nova) — um modelo pequeno dedicado como `nomic-embed-text` (~274 MB, bem menor que o modelo de chat) é suficiente pra isso. Proposta concreta: nova coluna `embedding` (BLOB, vetor serializado) em `memories`, calculada uma vez ao criar/editar a memória; `selectRelevantMemories` passa a combinar similaridade de cosseno com o sobreposição de palavras atual (não substituir de uma vez — comparar as duas em paralelo primeiro, já que o `ROADMAP_MASTER.md` também deixa como princípio "preferir recursos locais e reversíveis durante o desenvolvimento").

**Por que isso conecta com qualidade de vida:** menos vezes em que o modelo local erra por não ter encontrado a memória certa significa menos cliques em "Corrigir", que é o que o contador de economia (`getSavingsStats`) já mede — dá pra validar objetivamente se a mudança ajudou comparando a % de economia antes/depois, não só perceber "parece melhor".

**Critério de conclusão:** numa bateria de teste repetindo o padrão que o `PROJECT_LOG.md` já usa (pedir a mesma classe de tarefa em conversas diferentes, reformulada), a taxa de correção manual cai de forma mensurável comparado ao baseline atual registrado.

---

## Marco 4 — Expectativa de tempo e cancelamento no modelo local

**Dimensões:** UI, performance (percebida).

**O que existe hoje:** o `PROJECT_LOG.md` já documenta com transparência que "o pipeline completo (...) pode levar de 1 a 4+ minutos por turno numa conversa local complexa" nesse hardware sem GPU — mas isso nunca chegou na interface. Hoje, `ChatView.tsx` mostra só "pensando…" com três pontinhos animados, indistinguível entre uma resposta que sai em 3 segundos e uma que vai levar 4 minutos porque disparou dois retries de sintaxe mais uma auto-revisão. Também não existe como cancelar um turno em andamento — o único limite é o timeout interno (`LOCAL_TIMEOUT_MS`, hoje fixo em `runLocal`).

**Proposta:** guardar a duração real de cada turno local (já dá pra derivar de `created_at` de mensagens consecutivas, sem nova coluna) e usar a mediana observada por modelo como estimativa exibida ("normalmente leva ~40s neste computador"); depois de um tempo sem resposta, trocar a mensagem por algo honesto tipo "ainda processando — modelos locais sem GPU podem levar alguns minutos, principalmente em respostas com código"; adicionar um botão "Cancelar" que aborta a requisição do lado do cliente (o backend já usa `AbortController` internamente em `runLocal` — falta só expor esse cancelamento pra fora).

**Critério de conclusão:** o usuário nunca fica sem saber se o app travou ou só está demorando, e consegue cancelar um turno sem fechar o app.

---

## Marco 5 — Onboarding de primeira abertura

**Dimensões:** UI, qualidade de vida.

**O que existe hoje:** na primeira execução, `AppShell.tsx` só cria uma conversa vazia com o provedor Codex e mostra o chat direto. Não existe nenhuma explicação do que diferencia Codex/Claude (exigem CLI instalado e autenticado) de Local/Ollama (agora configurado sozinho, mas ainda assim um conceito novo pra quem nunca usou). É exatamente esse ponto cego que gerou a pergunta original que motivou a Fase de zero-config: o usuário não sabia por onde começar com o Ollama.

**Proposta:** uma tela de boas-vindas de 3 passos na primeiríssima abertura (guardada como `onboarding_seen` na tabela `settings`), mostrando o status real de cada provedor (usando `GET /api/providers` + `GET /api/local/status`, que já existem): Codex/Claude "prontos" ou "precisa autenticar o CLI"; Local "prepara sozinho quando você usar pela primeira vez". Sem bloquear o uso — só orientar.

**Critério de conclusão:** um usuário novo entende, sem sair do app, qual provedor pode usar já e o que cada um exige, antes de mandar a primeira mensagem.

---

## Marco 6 — Gerenciamento de conversas: mover, arquivar, buscar por conteúdo

**Dimensões:** qualidade de vida.

**O que existe hoje, por partes:**
- Mover uma conversa entre projetos: o backend já aceita (`PATCH /api/conversations/:id` com `projectId`, usado hoje só internamente por `updateConversation`), mas não existe nenhum controle na UI pra isso — a única forma de "mudar de projeto" é excluir e recriar.
- Arquivar: não existe — só excluir (`deleteConversation`), que é permanente.
- Busca: `Sidebar.tsx` filtra `conversations` só por `title.toLowerCase().includes(q)` — não busca dentro do conteúdo das mensagens, então uma conversa com título genérico ("Nova conversa" truncado) é praticamente impossível de reencontrar por assunto.
- Exportar/importar: existe pra memórias (`MemoryView.tsx`, formato `harness-aurora-memories`), não existe pra uma conversa inteira.

**Proposta:** menu de contexto por conversa com "Mover para projeto…" (dropdown dos projetos existentes, chama a API que já existe); "Arquivar" como estado novo (`archived_at` nullable em `conversations`, filtrado por padrão das listas, com uma view "Arquivadas"); busca expandida pra full-text simples sobre `messages.content` via novo endpoint (`GET /api/conversations/search?q=`, já que `node:sqlite` suporta `LIKE`/FTS5).

**Critério de conclusão:** nenhuma conversa é "perdida" por título genérico, e organizar não depende de excluir e recomeçar.

---

## Marco 7 — Tema claro e revisão de contraste/tipografia

**Dimensões:** UI, layout.

**O que existe hoje:** o app é inteiramente escuro (paleta teal/ciano sobre `#080d13`), e essa era uma das "Decisões necessárias ao final" listadas no `ROADMAP_MASTER.md` desde o início ("manter o tema escuro azul/ciano ou adotar outra paleta") — nunca revisitada porque o padrão foi usado direto. Vários textos secundários usam `font-size: 9px`/`10px` (labels de chip, meta de mensagem, rótulos de sidebar), o que é pequeno o suficiente pra incomodar em telas de alta densidade ou pra quem tem dificuldade de leitura.

**Proposta:** não é preciso redesenhar — extrair as cores já usadas (`#080d13`, `#65e2d4`, `#0c1821` etc., hoje espalhadas por `styles.css`) pra variáveis CSS (`:root`), criar uma segunda paleta clara sobre a mesma estrutura, e alternar via um atributo no `<html>` guardado na Central de Configurações (Marco 2). Revisar em paralelo a escala tipográfica mínima (piso de ~11px pra qualquer texto que carregue informação, não só decoração).

**Critério de conclusão:** o app é usável e legível tanto no tema escuro atual quanto num tema claro, com a preferência persistida entre sessões.

---

## Marco 8 — Corrigir código via diff/patch em vez de reescrever o arquivo inteiro

**Dimensões:** performance da LLM local (custo e velocidade), indiretamente qualidade de vida.

**O que existe hoje:** já identificado como próximo passo no `PROJECT_LOG.md` (entrada de 2026-09-18) e nunca implementado: cada correção (`correctLocalAnswer` em `app/correction.js`) faz o professor (Codex/Claude) reescrever a resposta inteira do zero, mesmo quando o problema é uma linha (`const` que devia ser `let`, um import faltando). Isso custa mais tokens/tempo do professor do que precisa, e mais superfície pra reintroduzir um bug novo enquanto reescreve o que já estava certo — exatamente o padrão que o `PROJECT_LOG.md` já registrou acontecendo ao vivo mais de uma vez.

**Proposta:** pedir ao professor um diff unificado (ou uma lista de substituições pontuais) em vez do arquivo completo, aplicado programaticamente sobre a resposta errada original. É o item mais arriscado tecnicamente desta lista — exige um parser de diff confiável e um plano de fallback pra quando o modelo não gerar um diff aplicável (nesse caso, cair pro comportamento atual de reescrever tudo, nunca travar).

**Critério de conclusão:** uma correção de bug pequeno e localizado custa visivelmente menos tokens/tempo de professor do que hoje, sem piorar a taxa de sucesso da correção.

---

## Marco 9 — Carregamento sob demanda do Atlas 3D

**Dimensões:** performance, UI.

**O que existe hoje:** `npm run frontend:build` já avisa: o chunk `MemoryScene` (Three.js + React Three Fiber) pesa 874 kB minificado — carregado mesmo quando o usuário só quer conversar e nunca abre o Atlas 3D nesta sessão. `NeuralAtlas.tsx` já é importado por `AppShell.tsx` de forma estática.

**Proposta:** trocar por `React.lazy`/`import()` dinâmico nas duas views que usam `NeuralAtlas` (`atlas` e `test`), carregando o bundle do Three.js só quando o usuário realmente navega pra lá. Ganho direto: tempo até a primeira mensagem poder ser enviada cai, sem tocar em nenhuma lógica da cena 3D em si.

**Critério de conclusão:** o bundle inicial carregado ao abrir o app não inclui Three.js; o Atlas 3D continua funcionando igual ao clicar.

---

## Marco 10 — Instrumentação de latência real (time-to-first-token e por estágio)

**Dimensões:** performance, UI (transparência).

**O que existe hoje:** nenhuma medição estruturada de quanto tempo cada etapa do pipeline local leva — só a duração total é observável manualmente. Isso torna qualquer mudança de performance (Marco 3, Marco 8, trocar de modelo no seletor) difícil de validar objetivamente além de "pareceu mais rápido".

**Proposta:** registrar, por turno local, a duração de cada etapa já existente no pipeline (resposta inicial, cada retry de sintaxe, auto-revisão) — não precisa de infraestrutura nova, só timestamps ao redor das chamadas já feitas em `refineLocalAnswer`/`runLocal`, guardados junto da mensagem (reaproveitando o padrão que `getSavingsStats` já usa: derivar métricas de dados que já são salvos, sem tabela de contagem separada). Expor isso na Central de Configurações (Marco 2) como um painel simples "Desempenho do modelo local": mediana de tempo total, quantos turnos precisaram de retry, quantos de auto-revisão.

**Critério de conclusão:** dá pra responder "essa mudança deixou o modelo local mais rápido?" olhando um número no app, não relendo o `PROJECT_LOG.md` em busca de anotações manuais de uma bateria de teste.

---

## Backlog complementar (menor, não priorizado)

Itens reais observados durante esta análise que valem registro, mas não chegam a marco dedicado agora:

**UI/Layout**
- Indicador visual de status do provedor Local (pronto/preparando/erro) também na `provider-picker` da sidebar, não só dentro da conversa já aberta — hoje só descobre-se o estado depois de já ter entrado na conversa.
- Atalhos de teclado existentes (Enter pra enviar) não têm nenhuma dica visual na interface; considerar um rodapé discreto ou tooltip.

**Qualidade de vida**
- Exportar uma conversa individual (não só memórias) como Markdown/JSON, útil pra compartilhar um resultado sem abrir o app.
- Duplicar uma conversa (útil pra "tentar de novo do zero" mantendo o histórico anterior intacto como referência).
- Confirmação antes de excluir um projeto inteiro já existe para conversas — verificar se cobre também a exclusão em cascata de memórias de escopo `project` associadas (hoje `ON DELETE CASCADE` no schema cuida disso no banco, mas a UI não avisa quantas memórias serão perdidas junto).

**Performance da LLM local**
- Cache de resposta pra prompts idênticos ou quase idênticos dentro da mesma conversa (útil durante os retries do `refineLocalAnswer`, que já reenvia variações do mesmo prompt).
- Permitir configurar, pela Central de Configurações, o número de tentativas (`MAX_FIX_ATTEMPTS`, hoje fixo em 2 no código) — em hardware mais lento, menos tentativas trocam robustez por velocidade; em hardware mais rápido, o usuário pode querer mais.
- Avaliar expor `num_ctx`/parâmetros de contexto do Ollama pra modelos maiores (7b/8b) escolhidos no seletor curado, hoje enviados sem nenhum parâmetro além de `model`/`prompt`.

---

## Fora de escopo por agora

- Suporte a Linux/macOS como plataforma de distribuição oficial (o instalador `electron-builder` hoje só gera NSIS pra Windows) — a automação do Ollama já cobre Linux/macOS no backend (Marco de zero-config, 2026-09-19), mas empacotar o app inteiro pra essas plataformas é um esforço separado, não pedido ainda.
- Sincronização entre dispositivos/nuvem — contraria o princípio já registrado em `ROADMAP_MASTER.md` de manter tudo local.
- Fine-tuning do modelo local — a estratégia do projeto inteiro é "ensinar via memória", não retreinar pesos; mudar isso seria uma decisão de produto nova, não uma melhoria incremental.

---

## Fora dos 10 marcos originais: Agente de navegador (adicionado em 2026-09-19)

Este documento partiu do estado do código em 2026-09-19 e cobre UI/Layout/QoL/Performance da LLM local sobre o que já existia. O agente de navegador — pedido explícito do usuário nessa mesma data, depois da priorização inicial — é uma capacidade nova, não um ajuste de algo já existente, então não força um encaixe artificial na tabela de marcos acima.

**O que é:** o modelo local ganha uma forma de agir fora do chat — controlar um navegador de verdade (Playwright) pra realizar tarefas em apps web (o caso de uso citado foi PowerApps), do mesmo jeito que o usuário já orquestra manualmente com Claude/Codex. Em vez de acessibilidade/DOM (que exigiria integração mais profunda por site), a "visão" do modelo é OCR local via Tesseract.js — sem gastar tokens de IA paga — sobre screenshots da própria página, respondendo com uma ação JSON (clicar num texto, digitar, navegar, etc.) a cada passo, num loop até o próprio modelo decidir que terminou ou até um limite de passos.

**Por que capacidade interna, não um protocolo MCP de verdade:** o usuário descreveu o objetivo ("igual eu faço com Claude/Codex pra mexer em apps do PowerApps"), não a arquitetura; entre as opções, escolheu explicitamente "capacidade interna do Harness" em vez de expor um servidor MCP real — mais simples de manter e já resolve o objetivo (o modelo local ganha a mesma capacidade de ação, sem o overhead de um protocolo cliente/servidor separado).

**Detalhe completo do que foi implementado, testado e as limitações honestas de validação:** ver a entrada de `PROJECT_LOG.md` na mesma data ("Agente de navegador: controle via OCR local + Playwright, sem tokens de IA paga").

## Como usar este documento

Mesmo padrão que o projeto já segue: ao fechar um marco (ou parte dele), registrar o que foi feito de fato no `PROJECT_LOG.md` (o que mudou, o que foi validado, o que ficou como limite conhecido) — este arquivo é o plano, aquele é o registro do que realmente aconteceu, e os dois já se mostraram úteis juntos em todas as sessões anteriores deste projeto.
