# Aurora como agente local que aprende

O chat do desktop é um agente. O modelo local decide se responde direto ou se age: navegador, web, programas, arquivos do projeto, terminal, memória e skills. Ele age passo a passo até concluir. Quando erra, ou quando a entrega alterou algo, um professor pago (Codex ou Claude CLI) revisa, ensina e a própria local refaz. Uma bateria fixa de tarefas mede se ela está melhorando.

Revisão e roadmap: [`REVISAO_2026-09-27.md`](REVISAO_2026-09-27.md).

## Peças

| Arquivo | Papel |
|---|---|
| `app/chatAgent.js` | Loop do agente. Limite de 15 ações; detecção de repetição; um empurrão quando a resposta só anuncia a ação; compactação dos resultados antigos; devolve a conversa e o motivo de parada. |
| `app/local.js` → `runLocalChat` | Ollama `/api/chat` com tool calling nativo e `keep_alive` de 30 min. Um modelo sem suporte a ferramentas cai no pipeline de texto antigo. |
| `app/agentTools/` | 26 ferramentas: `browser_*` (DOM/refs, abas, OCR de reserva), `web_search`/`web_fetch`, `open`, `list_dir`/`search_files`/`grep`/`read_file`/`write_file`/`edit_file`, `run_command` (ao vivo e em segundo plano) com `command_output`/`command_stop`, `memory_search`/`memory_save`, `skill_search`/`skill_use`/`skill_create` e `update_plan`. |
| `app/agentPolicy.js` | Modos **Auto** (livre na pasta do projeto; pergunta ao apagar, instalar, usar a rede, mexer no sistema ou sair da pasta), **Manual** (pergunta toda alteração) e **Plano** (só olha). "Sempre permitir" por prefixo de comando, nunca para comandos perigosos. |
| `app/agentTools/netGuard.js` | O agente nunca alcança a UI/API da própria Aurora, o Ollama nem a ponte XR, nem por link ou redirecionamento. |
| Projeto (`workspace_dir`) | Pasta de trabalho do projeto; `AURORA.md`, `AGENTS.md` ou `CLAUDE.md` dentro dela viram instruções permanentes. |
| `app/teacher.js` + `app/teachingLoop.js` | Professor automático (ver abaixo). |
| `app/agentEval.js` + `agentEvalRuns.js` | Avaliação contínua (ver abaixo). |

## Professor automático

1. **Sinais de erro, sem custo:**
   - ação que falhou e não foi recuperada;
   - limite de ações atingido;
   - repetição da mesma ação;
   - o agente admite que não conseguiu;
   - o usuário reclama ("não funcionou", "tá errado", "de novo").
2. **Quando revisa**, no modo padrão "Erros e entregas": em todo sinal de erro e em toda entrega que alterou arquivos, rodou comandos, clicou ou digitou em páginas ou abriu programas. Só navegar ou ler não dispara revisão.
3. **Como revisa:** o professor recebe a trajetória (pedido, ações, resultados, resposta) e roda **dentro da pasta do projeto**, podendo ler os arquivos para conferir. Ele devolve um veredito JSON: `ok` ou `fix`, com problemas, orientação, lições e uma skill opcional.
4. **Com `fix`:**
   - as lições viram memórias (deduplicadas);
   - uma skill proposta pelo professor é ativada;
   - a **local refaz** sobre a própria tentativa;
   - se a nova tentativa sai limpa, as lições ganham "ajudou".
5. **Estatística das memórias:** memórias no contexto de uma entrega aprovada ganham "ajudou"; numa entrega corrigida, "falhou". As automáticas que falham 3 vezes sem nunca ajudar são arquivadas. As que você escreve nunca são arquivadas.
6. **Limites de custo:** limite diário configurável (padrão 30 chamadas). A falha do professor nunca bloqueia a resposta.

Exemplo real (Codex, 27/09):
- A local criou `soma.js` com `parseInt`.
- O Codex rodou `node soma.js 1.5 2.5` na pasta, viu 3 em vez de 4 e ensinou: "use uma conversão que preserve decimais e verifique um exemplo com casas decimais".
- A local trocou por `Number()` e conferiu os dois casos.
- Tempo total: 21 s.

## Avaliação contínua

Configurações → "A IA local está aprendendo?":
- **Bateria:** 12 tarefas com verificação determinística (arquivos, busca, terminal, script, correção de bug, renomear, navegador em site de teste local, memória, conversa).
- **Isolamento:** roda numa **cópia** do banco, em processo separado, sem o professor.
- **Comparação:** com ou sem as memórias aprendidas.
- **Histórico:** fica na tabela `agent_eval_runs`.

Pela linha de comando:

```
HARNESS_DB_FILE=<cópia.db> node app/agentEvalRunner.mjs [--no-memories]
```

## Medições (27/09, qwen3.5:4b, RTX 4090)

| Medida | Resultado |
|---|---|
| Pedido simples ("oi") | ~2–3 s |
| Abrir o YouTube no navegador | ~5 s |
| Pesquisar a cotação do dólar (busca + leitura) | ~3 s |
| Entrega com ação + revisão do Codex | 17–21 s (revisão ~10–16 s) |
| Bateria de 12 tarefas | 24–37 s sem memórias; ~30 s com memórias (uma rodada levou ~158 s por um comando que esperava stdin, corrigido) |
| Acertos com as 93 memórias | 11/12 e 10/12 |
| Acertos sem memórias | 9/12 e 10/12 |

A amostra ainda é pequena para afirmar ganho das memórias. É para isso que existe a curva contínua.

A lentidão do primeiro teste de 27/09 (20–60 s por pedido) era ambiental: a geração estava a ~4 tokens/s, velocidade de CPU, porque a GPU estava ocupada. O código também eliminava recargas desnecessárias do modelo: mesmo `num_ctx` em todas as chamadas e `keep_alive` de 30 min.
