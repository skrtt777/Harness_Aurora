# Harness Aurora

Harness de IA local no estilo ChatGPT/Claude: conversas organizadas em projetos, memória real (não apenas visual) por conversa/projeto/geral, e um atlas de memória em WebGL 3D como aba secundária/experimental. Empacotado como app desktop (Electron) — instala, abre e atualiza como um programa comum, sem terminal.

## Arquitetura atual (2026-09-16)

- **Backend** (`app/`): servidor HTTP nativo do Node + **SQLite** via `node:sqlite` (embutido no próprio Node, sem dependência nativa pra compilar) em `app/data/harness.db` (ou em `%APPDATA%\Harness Aurora\` quando rodando pelo app instalado). Persiste projetos, conversas, mensagens e memórias.
- **Frontend** (`frontend/`): React + Vite. `AppShell.tsx` é a casca principal: `Sidebar.tsx` (projetos/conversas, estilo ChatGPT), `ChatView.tsx` (conversa), `MemoryView.tsx` (aba **Memória**, unificada). `NeuralAtlas.tsx` é o protótipo visual 3D, preservado como aba **Atlas 3D (beta)**, hoje já lendo a memória real (ver seção própria abaixo).
- **Desktop** (`electron/main.js`): sobe o backend acima internamente e abre uma janela apontando pra ele — é o app que o usuário final instala e abre.

## Para usuário final

1. Baixe o instalador (`Harness Aurora Setup.exe`) na página de [Releases do GitHub](https://github.com/skrtt777/Harness_Aurora/releases).
2. Rode o instalador — não pede administrador, instala só pro seu usuário e cria atalho no menu iniciar/desktop.
3. Abra o "Harness Aurora". Depois disso, o app verifica atualizações sozinho a cada abertura.

**Pré-requisito que continua existindo:** [Codex CLI](https://github.com/openai/codex) instalado e autenticado (`codex login`) na sua conta do Windows — é uma ferramenta externa da OpenAI, não dá pra embutir a sessão autenticada de outra pessoa dentro do instalador. Se o Codex não estiver disponível, o app avisa ao abrir e o chat não responde até isso ser resolvido; o resto da interface funciona normalmente.

Para desinstalar, use "Adicionar ou remover programas" do Windows normalmente — o histórico e a memória ficam em `%APPDATA%\Harness Aurora\` e não são apagados pelo desinstalador (apague essa pasta manualmente se quiser começar do zero).

## Para desenvolvedor

Requisitos: Node.js 22.5+ (traz `node:sqlite` embutido) e Codex CLI autenticado no terminal.

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

Conversas aparecem na barra lateral, agrupadas por **projeto** (opcional) ou soltas em "Conversas". É possível criar projeto, renomear/excluir projeto e conversa, e cada projeto pode ter instruções próprias (enviadas ao Codex em toda mensagem daquele projeto). Tudo é persistido no backend (SQLite), então sobrevive a reiniciar o app.

## Memória — funcional, não só visual

A memória tem três escopos: **geral** (`global`), **por projeto** (`project`) e **por conversa** (`conversation`). Toda conversa criada tem sua própria memória.

- **Leitura real:** a cada mensagem, o backend seleciona as memórias mais relevantes (conversa → projeto → geral, nessa ordem de prioridade) e injeta no prompt enviado ao Codex. É por isso que a IA "lembra" do assunto — ela lê essas memórias antes de responder.
- **Escrita automática:** depois de cada resposta, uma segunda chamada ao Codex (`app/memoryExtractor.js`) extrai fatos/decisões/preferências relevantes da troca e salva como memória da conversa (`kind: "extracted"`). Isso adiciona uma chamada extra por mensagem — validado de ponta a ponta em 2026-09-16 (chamada real ao Codex CLI autenticado, incluindo leitura e escrita de memória funcionando corretamente).
- **Escrita manual:** também dá para criar/editar/excluir memória à mão pela aba **Memória**.
- **Aba Memória unificada:** reúne todas as memórias (de todas as conversas e projetos, mais a geral) em um único lugar, com filtro por escopo/origem e busca.

## Validação rápida

```powershell
npm test
npm run check
npm run test:memory
npm run frontend:build
```

Na interface, valide: criação e reabertura de conversas, pesquisa/filtros, envio de mensagem real (com Codex autenticado) e memória extraída aparecendo na aba Memória.

## Atlas 3D (beta) — protótipo visual, agora lendo memória real

O Atlas 3D é uma aba separada (não é mais a tela inicial). Ao abrir, ele carrega as memórias reais do backend (mesmas da aba Memória) — se ainda não houver memória nenhuma, cai de volta para 1.000 registros sintéticos claramente marcados como demonstração. Use "↻ Sincronizar memória real" na barra lateral pra recarregar sob demanda, ou "Importar JSON" pra carregar uma coleção própria (formato em `frontend/src/data.ts`). Relações entre memórias reais ainda não são rastreadas pelo backend, então ficam vazias no atlas para dados reais — só a posição é fabricada.

A cena inclui grupos por projeto, neurônios volumétricos, inspeção técnica, relações de origem, vistas CAD, importação validada e exportação da coleção. Consulte [o guia da memória 3D](docs/MEMORY_CAD.md) para controles, formato JSON, limites e validações.
