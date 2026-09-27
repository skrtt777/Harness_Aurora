# Chat agêntico da Aurora (desktop)

O chat do desktop deixou de ser uma única chamada de texto. Agora ele é um loop de agente: o modelo decide se responde direto ou se age, chama ferramentas, lê o resultado e continua até concluir. Não existe roteador por palavra-chave; quem escolhe a ferramenta é o modelo.

## Peças

| Arquivo | Papel |
|---|---|
| `app/chatAgent.js` | Loop do agente. Limite de 15 ações; detecção de repetição (mesma ação 3×); um empurrão quando a resposta só anuncia a próxima ação ("vou rolar…"); compactação dos resultados antigos para caber no contexto; fechamento com um resumo sem ferramentas. |
| `app/local.js` → `runLocalChat` | Ollama `/api/chat` com tool calling nativo. Um modelo sem suporte a ferramentas (ex.: fine-tunes `aurora-local`) devolve `unsupported`, e o chat cai no pipeline de texto antigo. |
| `app/agentTools/` | Ferramentas: `browser_*` (por DOM/refs, com OCR só como reserva), `web_search`/`web_fetch` (DuckDuckGo), `open` (apps do Menu Iniciar, arquivos, links), `list_dir`/`read_file`/`write_file`/`edit_file` (presos às pastas liberadas) e `run_command` (sempre pede autorização). |
| `app/browserBackend.js` | Dois navegadores: "Chromium da Aurora" (Playwright; sem o Chromium próprio, usa Chrome ou Edge instalados) e "Meu Google Chrome" (CDP, com perfil dedicado da Aurora). |
| `app/runtime-policy/AGENT.md` | Instruções do agente. |
| `app/pendingTurns.js` + `/api/conversations/:id/approval` | O turno pausa até o usuário clicar Permitir/Negar. Cancelar ou encerrar o turno nega a autorização. |

- **Claude/Codex:** usam o mesmo loop com um protocolo em texto (`{"tool":…,"args":…}`).
- **Quest (`LOCAL_ENGINE=llama.cpp`):** continua no caminho antigo, sem ferramentas.
- **Desligar:** Configurações → Ações no computador → "Só conversa" (ou `HARNESS_AGENT_TOOLS=false`).

## Medições (2026-09-27, qwen3.5:4b, Ollama, PC do desenvolvedor)

| Pedido | Ações | Tempo |
|---|---|---|
| "controle o navegador e acesse o youtube" | `browser_navigate` | 13–39 s (o primeiro inclui carregar o modelo) |
| "agora pesquise por jazz lofi lá" (continuação) | `browser_type` (errou o campo e se corrigiu pela lista de campos no erro) | 43 s |
| "abre o segundo vídeo" (continuação) | `browser_snapshot`, `browser_click` | 28 s |
| "pesquise lofi girl no youtube e abra o primeiro vídeo" | `browser_navigate` (URL de busca), `browser_click` | 51 s |
| "qual a cotação do dólar hoje?" | `web_search`, `web_fetch` | 59 s |
| "rode o ipconfig e me diga meu endereço IPv4" | `run_command` ×2 (com autorização) | 44 s |
| "oi, tudo bem?" | nenhuma | 9 s |

O 4b resolve esses casos, mas é lento e às vezes dá voltas; o `qwen3.5:9b` não foi medido (não está instalado). O tempo é dominado pelo processamento do prompt (as ferramentas somam cerca de 1,5k tokens), não pelas ações.
