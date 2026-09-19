# Harness Aurora

Harness de IA local no estilo ChatGPT/Claude: conversas organizadas em projetos, memória real (não apenas visual) por conversa/projeto/geral, e um atlas de memória em WebGL 3D como aba secundária/experimental. Empacotado como app desktop (Electron) — instala, abre e atualiza como um programa comum, sem terminal.

## Arquitetura atual (2026-09-16)

- **Backend** (`app/`): servidor HTTP nativo do Node + **SQLite** via `node:sqlite` (embutido no próprio Node, sem dependência nativa pra compilar) em `app/data/harness.db` (ou em `%APPDATA%\Harness Aurora\` quando rodando pelo app instalado). Persiste projetos, conversas, mensagens e memórias.
- **Frontend** (`frontend/`): React + Vite. `AppShell.tsx` é a casca principal: `Sidebar.tsx` (projetos/conversas, estilo ChatGPT), `ChatView.tsx` (conversa), `MemoryView.tsx` (aba **Memória**, unificada). `NeuralAtlas.tsx` é o visualizador de grafo de memória, compartilhado entre duas abas via uma prop `variant`: **Atlas 3D (beta)** (`variant="real"`, só memória real, nunca dado sintético) e **Teste** (`variant="test"`, sandbox sintético, nunca toca a memória real) — ver seções próprias abaixo.
- **Desktop** (`electron/main.js`): sobe o backend acima internamente e abre uma janela apontando pra ele — é o app que o usuário final instala e abre.

## Para usuário final

1. Baixe o instalador (`Harness Aurora Setup.exe`) na página de [Releases do GitHub](https://github.com/skrtt777/Harness_Aurora/releases).
2. Rode o instalador — não pede administrador, instala só pro seu usuário e cria atalho no menu iniciar/desktop.
3. Abra o "Harness Aurora". Depois disso, o app verifica atualizações sozinho a cada abertura.

**Pré-requisito que continua existindo:** pelo menos um dos dois CLIs instalado e autenticado — [Codex CLI](https://github.com/openai/codex) (`codex login`) e/ou [Claude Code CLI](https://claude.com/claude-code) (`claude` já autenticado). São ferramentas externas, não dá pra embutir a sessão autenticada de outra pessoa dentro do instalador. Se o provedor escolhido pra uma conversa não estiver disponível, o app avisa e o chat não responde até isso ser resolvido; o resto da interface funciona normalmente. Um terceiro provedor, **Local (Ollama)**, é opcional: só aparece disponível se o [Ollama](https://ollama.com) estiver instalado e rodando na própria máquina.

Para desinstalar, use "Adicionar ou remover programas" do Windows normalmente — o histórico e a memória ficam em `%APPDATA%\Harness Aurora\` e não são apagados pelo desinstalador (apague essa pasta manualmente se quiser começar do zero).

## Bandeja do sistema e captura rápida

O Harness Aurora roda em segundo plano com um ícone na bandeja do Windows — **fechar a janela pelo X minimiza pro sistema em vez de encerrar o app** (mesmo comportamento de Discord/Slack/Spotify). Pra encerrar de verdade, use "Sair" no menu da bandeja.

Um atalho de teclado global (funciona com o foco em qualquer outro programa) abre uma janelinha de captura rápida pra guardar uma memória sem precisar abrir o app inteiro. O app tenta `Ctrl+Shift+H` primeiro e cai pra outras combinações automaticamente se já estiver em uso por outro programa — o atalho realmente ativo aparece no menu da bandeja ("Capturar memória rápida (...)").

## Para desenvolvedor

Requisitos: Node.js 22.5+ (traz `node:sqlite` embutido) e Codex CLI e/ou Claude Code CLI autenticados no terminal. [Ollama](https://ollama.com) é opcional, só necessário para usar o provedor Local.

```powershell
npm install
npm --prefix frontend ci
```

Rodar com hot-reload (sobe backend + Vite + janela Electron apontando pro Vite):

```powershell
npm run electron:dev
```

Rodar sem Electron, só backend + navegador (fluxo antigo, ainda útil pra depurar a API isolada):

```powershell
npm start
# em outro terminal
npm run frontend:dev
```

Abra `http://127.0.0.1:5173`. O Vite encaminha `/api` para `http://127.0.0.1:8787`.

Gerar o instalador localmente:

```powershell
npm run dist
```

O instalador (`.exe`) e os arquivos de auto-update saem em `release/`. O `build.publish` do `package.json` aponta pro GitHub Releases do próprio repositório — publicar uma release lá é o que faz o `electron-updater` ter algo pra buscar quando um usuário abre um app já instalado.

## Conversas e projetos

Conversas aparecem na barra lateral, agrupadas por **projeto** (opcional) ou soltas em "Conversas". É possível criar projeto, renomear/excluir projeto e conversa, e cada projeto pode ter instruções próprias (enviadas ao provedor em toda mensagem daquele projeto). Tudo é persistido no backend (SQLite), então sobrevive a reiniciar o app.

## Provedores — Codex, Claude e Local (Ollama)

Cada conversa usa um provedor fixo, escolhido no momento em que ela é criada (seletor na barra lateral, acima do "+ Nova conversa"). Codex e Claude seguem o mesmo princípio: reaproveitam a sessão já autenticada do CLI correspondente na sua máquina (`codex`/`claude`) — sem pedir chave de API nem token. `app/codex.js` e `app/claude.js` implementam a mesma interface (`runX(prompt, env)`), então o resto do backend (prompt, memória, extração) não precisa saber qual dos dois está respondendo.

O terceiro provedor, **Local**, roda um modelo pequeno via [Ollama](https://ollama.com) (`app/local.js`, HTTP em `127.0.0.1:11434`, modelo padrão `qwen2.5-coder:1.5b`) — de graça, offline, sem gastar chamada de Codex/Claude. A ideia é usá-lo no dia a dia e, quando ele errar, corrigi-lo manualmente:

- Ao criar uma conversa **Local**, você também escolhe um **Professor** (Codex ou Claude), guardado em `conversations.teacherProvider`.
- Em qualquer resposta do modelo local, o botão **🔧 Corrigir** (com uma nota opcional explicando o erro) chama o professor escolhido numa única chamada que devolve a resposta corrigida **e** até 3 memórias de ensino (regras/fatos reutilizáveis, não um resumo da troca) — `app/correction.js`.
- Essas memórias de ensino são salvas em escopo **projeto** (se a conversa tiver projeto) ou **geral** — de propósito diferente da extração automática normal (que salva na própria conversa): o objetivo é que o modelo local acerte de primeira em **conversas futuras diferentes**, não só na mesma conversa. Validado de ponta a ponta: um erro corrigido numa conversa passou a ser citado em `memoryAccess` e respondido corretamente pelo modelo local numa conversa **nova**, sem precisar de correção de novo.
- **Conversas locais nunca chamam o professor num turno normal.** A extração automática de memória (que existe para Codex/Claude) é pulada inteiramente quando `provider === "local"` — só o clique em "Corrigir" gasta uma chamada real de Codex/Claude. Isso é de propósito: gastar token em toda mensagem anularia o ganho de usar um modelo local de graça.
- **O modelo local se revisa sozinho antes de responder** (`app/localRefine.js`, sempre com compute local/grátis, nunca Codex/Claude): quando a resposta parece código, três checagens tentam achar um problema antes do usuário ver a resposta — sintaxe (`node --check`), um heurístico para variáveis `const` reatribuídas, e (`app/jsSandbox.js`) executar o código de verdade num sandbox `node:vm` com um `THREE`/DOM falso e permissivo, que só deixa passar chamadas a classes de addon (`OrbitControls`, `GLTFLoader`, etc.) se a própria resposta importou aquele addon — reproduzindo a fronteira real do Three.js sem modelar a API inteira. Se algum problema for encontrado, o modelo local tenta de novo sozinho (até 2 vezes); depois, uma última chamada revisa a resposta contra as memórias relevantes e qualquer problema ainda pendente, adotando a revisão só se ela continuar sendo código de verdade e não reintroduzir o mesmo problema.
- **Correções também podem ensinar um esqueleto de código reutilizável**, não só regras em texto: ao usar "Corrigir", o professor pode gravar uma memória marcada como `template` com um boilerplate correto (setup de cena/câmera/loop) para o modelo local adaptar da próxima vez em vez de reescrever tudo do zero — `buildPrompt` renderiza essas memórias como bloco de código à parte das regras normais.
- **Contador de economia real** ("💰 X% de economia" na barra lateral): calculado a partir das mensagens já salvas, sem contador separado — turno local sem correção = 100% de economia (0 chamadas pagas vs. as 2 que Codex/Claude custariam), turno corrigido = 50% (1 chamada paga, já que a correção inclui a extração de memória).

## Memória — funcional, não só visual

A memória tem três escopos: **geral** (`global`), **por projeto** (`project`) e **por conversa** (`conversation`). Toda conversa criada tem sua própria memória.

- **Leitura real:** a cada mensagem, o backend seleciona as memórias mais relevantes (conversa → projeto → geral, nessa ordem de prioridade) e injeta no prompt enviado ao provedor da conversa. É por isso que a IA "lembra" do assunto — ela lê essas memórias antes de responder.
- **Escrita automática:** depois de cada resposta, uma segunda chamada ao mesmo provedor (`app/memoryExtractor.js`) extrai fatos/decisões/preferências relevantes da troca e salva como memória da conversa (`kind: "extracted"`). Isso adiciona uma chamada extra por mensagem — validado de ponta a ponta com Codex em 2026-09-16 e com Claude em 2026-09-17, incluindo leitura e escrita de memória funcionando corretamente nos dois.
- **Escrita manual:** também dá para criar/editar/excluir memória à mão pela aba **Memória**.
- **Relações reais:** a extração automática também propõe relações entre a memória nova e memórias já existentes (`belonging`/`thematic`/`derivation`/`correction`) — é o que alimenta as conexões do Atlas 3D e do Fluxograma.
- **Aba Memória unificada:** reúne todas as memórias (de todas as conversas e projetos, mais a geral) em um único lugar, com filtro por escopo/origem e busca.
- **Exportar/Importar:** os botões "↓ Exportar"/"↑ Importar" na aba Memória levam a memória (com relações) pra um arquivo JSON e de volta — útil pra backup ou pra levar o conhecimento acumulado de uma instalação pra outra. Ao importar, memórias de projeto/conversa cujo projeto/conversa não existe na instalação de destino caem automaticamente pra escopo geral em vez de falhar.
- **Memória compartilhada pela comunidade (só puxar, nunca enviar):** o botão "🌐 Comunidade" na aba Memória busca pacotes de memórias já revisadas do repositório público deste projeto (`community-memories/` no GitHub, mesmo formato do export/import manual) e permite importar com um clique. Nenhuma memória sua é enviada a lugar nenhum automaticamente — essa é uma via de mão única, de propósito, dado que memórias podem conter informação pessoal/de projeto. A URL do manifesto é configurável via `COMMUNITY_MANIFEST_URL`.

## Validação rápida

```powershell
npm test
npm run check
npm run test:memory
npm run frontend:build
```

Na interface, valide: criação e reabertura de conversas, pesquisa/filtros, envio de mensagem real (com Codex autenticado) e memória extraída aparecendo na aba Memória.

## Atlas 3D (beta) — só memória real, sem dados sintéticos

O Atlas 3D é uma aba separada (não é mais a tela inicial). Ele mostra **só a memória real do backend** (mesmos dados da aba Memória) — se ainda não houver memória nenhuma, mostra um aviso pra você conversar no chat primeiro, sem cair pra dados fabricados. Use "↻ Sincronizar memória real" na barra lateral pra recarregar sob demanda. As relações entre memórias reais vêm da extração automática do backend (`app/memoryExtractor.js`, tabela `memory_relations`) — só a posição no espaço continua sendo fabricada, já que não existe posição 3D persistida. Um terceiro modo, "⌗ Fluxograma", mostra o mesmo grafo em 2D (layout hierárquico via `dagre`) como alternativa mais simples à cena 3D.

A cena inclui grupos por projeto, neurônios volumétricos, inspeção técnica, relações de origem e vistas CAD. Consulte [o guia da memória 3D](docs/MEMORY_CAD.md) para controles e formato de dados.

## Teste — sandbox com dados sintéticos

Aba separada do Atlas 3D real, pensada pra experimentar a visualização sem depender de memória de verdade: abre com 1.000 registros sintéticos de demonstração (`createDemoMemories`), e deixa importar/exportar uma coleção JSON própria (formato em `frontend/src/data.ts`) pra brincar com dados personalizados. Nunca lê nem escreve na memória real do backend — é puramente local ao navegador (`localStorage`).
