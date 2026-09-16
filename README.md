# Harness Aurora

Harness de IA local no estilo ChatGPT/Claude: conversas organizadas em projetos, memória real (não apenas visual) por conversa/projeto/geral, e um atlas de memória em WebGL 3D como aba secundária/experimental.

## Arquitetura atual (2026-09-16)

- **Backend** (`app/`): servidor HTTP nativo do Node + **SQLite** (`better-sqlite3`) em `app/data/harness.db`. Persiste projetos, conversas, mensagens e memórias — não depende mais só do `localStorage` do navegador.
- **Frontend** (`frontend/`): React + Vite. `AppShell.tsx` é a casca principal: `Sidebar.tsx` (projetos/conversas, estilo ChatGPT), `ChatView.tsx` (conversa), `MemoryView.tsx` (aba **Memória**, unificada). `NeuralAtlas.tsx` é o antigo protótipo visual 3D, preservado como aba **Atlas 3D (beta)**, ainda desconectado da memória real — fica para a próxima fase (o "diferencial" do harness).

## Rodar localmente

Requisitos: Node.js 20+ e Codex CLI instalado e autenticado no terminal.

Em um terminal, inicie a API:

```powershell
npm install
npm --prefix frontend ci
npm start
```

Em outro terminal, inicie a interface:

```powershell
npm run frontend:dev
```

Abra `http://127.0.0.1:5173`. O Vite encaminha `/api` para `http://127.0.0.1:8787`.

No Windows, `start-test.cmd` abre a API, a interface e o navegador automaticamente.

## Instalação Windows

Execute `installer\install.cmd`. O instalador não exige administrador, copia o app para `%LOCALAPPDATA%\AI-Harness`, instala as dependências, valida o build e cria um atalho na área de trabalho. Node.js 20+ e Codex CLI autenticado são pré-requisitos.

Para remover a aplicação, execute `installer\Uninstall-AIHarness.ps1`. O histórico salvo no navegador não é apagado.

## Conversas e projetos

Conversas aparecem na barra lateral, agrupadas por **projeto** (opcional) ou soltas em "Conversas". É possível criar projeto, renomear/excluir projeto e conversa, e cada projeto pode ter instruções próprias (enviadas ao Codex em toda mensagem daquele projeto). Tudo é persistido no backend (SQLite), então sobrevive a reiniciar o app — deixou de ser um dado só do navegador.

## Memória — funcional, não só visual

A memória agora tem três escopos, igual ao modelo já usado no atlas visual: **geral** (`global`), **por projeto** (`project`) e **por conversa** (`conversation`). Toda conversa criada tem sua própria memória.

- **Leitura real:** a cada mensagem, o backend seleciona as memórias mais relevantes (conversa → projeto → geral, nessa ordem de prioridade) e injeta no prompt enviado ao Codex. É por isso que a IA "lembra" do assunto — ela lê essas memórias antes de responder.
- **Escrita automática:** depois de cada resposta, uma segunda chamada ao Codex (`app/memoryExtractor.js`) extrai fatos/decisões/preferências relevantes da troca e salva como memória da conversa (`kind: "extracted"`). Isso adiciona uma chamada extra por mensagem — mais lento, porém mais "real" (decisão tomada com o usuário em 2026-09-16).
- **Escrita manual:** também dá para criar/editar/excluir memória à mão pela aba **Memória**.
- **Aba Memória unificada:** reúne todas as memórias (de todas as conversas e projetos, mais a geral) em um único lugar, com filtro por escopo/origem e busca — a peça que faltava para "juntar tudo".

Isso é **separado** do atlas 3D (`Atlas 3D` na barra lateral): o atlas continua sendo um protótipo visual com dados sintéticos/importados, ainda não alimentado pela memória real acima. Unificar os dois é o próximo passo natural, já **fora do escopo desta rodada** (fica para a fase do "diferencial").

## Distribuir para testers

Entregue a pasta do projeto ou um pacote versionado e peça ao tester para executar os dois comandos acima. O modo atual é explicitamente local/demonstrativo e não declara sincronização online.

Para atualizar uma cópia que esteja em um checkout Git:

```powershell
.\update.cmd
```

O atualizador faz `git pull`, instala dependências do frontend e executa o build. Ele não remove `app/data/` nem o histórico salvo no navegador. Se a cópia não tiver `.git`, distribua a nova pasta/pacote e execute o mesmo comando para validar a instalação.

## Validação rápida

```powershell
npm test
npm run check
npm run test:memory
npm run frontend:build
```

Na interface, valide: criação e reabertura de conversas, pesquisa/filtros, rotação/zoom/pan, seleção de neurônio, modo CAD, wireframe, ortográfico, inspeção e fallback para lista quando WebGL não estiver disponível.

## Atlas 3D (beta) — protótipo visual, dados à parte

O Atlas 3D é uma aba separada (não é mais a tela inicial). Na ausência de dados importados, ele carrega 1.000 registros sintéticos claramente marcados como demonstração. Use “Importar JSON” para carregar dados reais; o formato aceito está em `frontend/src/data.ts`. **Esses dados não têm relação com a memória real** descrita acima — são independentes até a fase de unificação.

A cena inclui grupos por projeto, neurônios volumétricos, inspeção técnica, relações de origem, vistas CAD, importação validada e exportação da coleção. Consulte [o guia da memória 3D](docs/MEMORY_CAD.md) para controles, formato JSON, limites e validações.
