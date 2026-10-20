# Visão 2.0: Aurora como um harness de ponta (20/10/2026)

**Mudança pedida pela pessoa (20/10):** deixar de mirar só em "melhorar a IA local" e fazer da Aurora um
**Hermes/OpenClaw 2.0** com tudo o que já existe. A IA local passa a ser **um dos motores**, não o produto.

## 1. O que Hermes e OpenClaw são

| | Hermes Agent (Nous Research) | OpenClaw |
|---|---|---|
| Ideia central | Agente que aprende: cria skills com a experiência, melhora as skills enquanto usa e lembra entre sessões | Agente pessoal persistente: um *gateway* que vive nos seus canais e trabalha sozinho |
| Modelos | Qualquer um (Nous Portal, OpenRouter, OpenAI, endpoint próprio), trocável com `/model` | Qualquer um, por provedor |
| Canais | Telegram, Discord, Slack, WhatsApp, Signal e CLI num só *gateway*, com a conversa continuando de um canal para outro | WhatsApp, Telegram, Discord, Slack, Signal, iMessage e outros (mais de 12) |
| Memória | Curada pelo agente e lembrada por ele, com busca FTS5 nas sessões e resumo | Arquivos: `MEMORY.md` e notas datadas em `memory/` |
| Skills | Padrão aberto agentskills.io (`SKILL.md`); `/learn` transforma um documento, uma URL ou um fluxo em skill | Pastas com `SKILL.md` |
| Trabalho sozinho | Cron com entrega em qualquer canal | *Heartbeat* (de tempos em tempos lê `HEARTBEAT.md`; se não há nada, fica quieto) e cron |
| Paralelo | Subagentes isolados (3 por padrão); scripts Python chamando ferramentas por RPC | Subagentes em segundo plano; roteamento para vários agentes |
| Onde roda | 7 *backends* de terminal: local, Docker, SSH, Modal, Daytona… | Um processo por máquina |
| Interface | TUI, Desktop | Os canais de mensagem |

## 2. O que a Aurora já tem (e eles não)

- **Privacidade de verdade com modelo pago:** o espelho com valores falsos, as marcas reversíveis e o professor
  cego (`app/mirror.js`, `app/blind.js`). Nenhum dos dois tem isso. Para empresa (LGPD), é o diferencial maior.
- **Funciona em computador fraco:** modelo local com llama.cpp, MoE e cache; a escolha do modelo é feita pelo hardware.
- **Empresa, não só pessoa:** base de conhecimento por setor, agentes de setor, orquestrador, RH (notas,
  advertência, demissão), Sede e Escritório visíveis.
- **Mexe no Office e no Power BI de verdade:** Word, Excel, PowerPoint com gráficos nativos, Power BI (relatório,
  gêmeo digital), automação de desktop e navegador.
- **Conferência de entrega:** guardas que pegam "disse que fez e não fez", cópias que votam, baterias medidas a
  cada versão.
- **Aprende com professor:** as lições viram memória, e a memória tem candidatura, prova e arquivamento.
- **XR:** a mesma mente no Quest (WebXR).

## 3. O que falta para ser "2.0"

| # | Lacuna | Por que importa | Base que já existe |
|---|---|---|---|
| 1 | **Qualquer modelo, por API** (Anthropic, OpenAI, OpenRouter, Gemini, endpoint próprio), além das CLIs Claude/Codex e do modelo local | Hoje o motor forte depende da assinatura de uma CLI; Hermes troca de modelo com um comando | `cliRuntime.js`, `engine.js` (ENGINES), `local.js` |
| 2 | **Gateway de canais:** WhatsApp, Discord e Slack além do Telegram, com a mesma sessão continuando entre canais | É onde o OpenClaw "vive" | `telegram.js` (aprovação por botão, anexos) |
| 3 | **Heartbeat:** a Aurora olha de tempos em tempos (e-mail, pastas, agenda, agentes) e só fala quando algo merece | O que faz o OpenClaw parecer vivo | `agentScheduler.js`, "Resumo da manhã", `scripts/heartbeat-eval.mjs` |
| 4 | **Skills no padrão aberto** (agentskills.io, `SKILL.md`): importar e exportar as do Hermes, do OpenClaw e do Claude Code; `/aprenda` cria skill a partir de documento, URL ou do que acabou de ser feito | Ecossistema pronto; a Aurora entra nele em vez de ficar isolada | `skills.js`, `skillCatalog.js`, `agentTools/learn.js` |
| 5 | **Migração:** `aurora importar hermes|openclaw` traz memória, skills e agendamentos | Quem já usa os dois pode vir sem perder nada | `memoryImport.js` |
| 6 | **CLI/TUI e API** (`aurora` no terminal, servidor local com token) | Harness de ponta é usado também por desenvolvedores e por outros programas | `server.js` (HTTP já existe), extensão do VS Code |
| 7 | **Execução isolada:** Docker/WSL para comandos e scripts (o do espelho também) | Segurança quando o agente roda sozinho ou com modelo pago | `sandboxCode.js`, `jsSandbox.js` |
| 8 | **Roteador de motores por custo, qualidade e sigilo:** cada passo vai ao motor certo (local para conversa e dado sigiloso, pago às cegas para entregas, pago livre só com autorização) | É o "Hermes" com a privacidade da Aurora | `proactiveFit`, `escalate`, `privacyMode` |

## 4. Andamento

- **20/10, fase 1 feita (commits 041548b e 2e34ed6):**
  - **Motores por API:** `app/apiEngines.js` (Anthropic pelo SDK oficial; API de chat da OpenAI para OpenAI, OpenRouter, Gemini e endpoint próprio) e Configurações → Modelos. Todos trabalham às cegas pelo espelho, entram na ajuda ativa, nos agentes e no Escritório.
  - **Gateway:** `app/gateway.js` dá uma conversa do celular para todos os canais, e a resposta volta pelo canal usado por último.
  - **Canais:** o Telegram passou a ser canal do gateway, e o WhatsApp (`app/whatsapp.js`) entrou pelo WhatsApp Web, com QR, a conversa "Mensagem para você" ou um número próprio por código.
  - **Testado com modelos reais:** o qwen3.5:4b pelo Ollama, como endpoint próprio, fez a soma às cegas certa. O WhatsApp Web gerou o QR, mas o pareamento com o celular ainda falta testar.
- **Próximo: fase 2** (heartbeat; skills no padrão aberto com `/aprenda`).

## 5. Proposta de roteiro

**Fase 1: motores e canais (fundação)**
1. Provedores por API com chave (Anthropic, OpenAI, OpenRouter, Gemini, compatível com OpenAI), atrás da
   mesma interface de `ENGINES`, com o espelho valendo para todos.
2. Gateway: o Telegram refeito como um canal entre vários; depois WhatsApp (WhatsApp Web ou Cloud API),
   Discord e Slack. A mesma conversa continua em qualquer canal.

**Fase 2: vida própria**
3. Heartbeat com `HEARTBEAT.md` por projeto e por pessoa: ela fica quieta quando não há nada e respeita horário e limite.
4. Skills no padrão aberto, com importação e exportação, `/aprenda`, e skill criada sozinha depois de uma tarefa difícil que deu certo.

**Fase 3: ecossistema**
5. Migração do Hermes e do OpenClaw.
6. CLI `aurora` e API local documentada.
7. Execução isolada em Docker/WSL.

Em todas as fases: baterias medidas antes de cada versão, privacidade por padrão (espelho) e o
Escritório mostrando quem faz o quê (local, Claude, Codex, GPT, um agente do WhatsApp…).
