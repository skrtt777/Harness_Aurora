# Sessão 2026-10-30 — "fetch failed" no modelo local, mesmo depois do fix do undici

Handoff para quem (pessoa ou IA) continuar o trabalho. Escrito depois de reproduzir o problema
de ponta a ponta no notebook da empresa (hardware fraco, sem GPU dedicada) e corrigir a causa raiz
real, que é **diferente e mais profunda** do que o commit `e423f1b` já tinha corrigido.

## Contexto

No dia anterior (29/10), um pedido real usando o modelo local (Power BI, várias partes via
`subagents`) falhou só com `"fetch failed"`, sem detalhe. Uma sessão anterior (no PC de casa,
30/10 de madrugada) já tinha diagnosticado e corrigido uma causa: o `undici headersTimeout` padrão
de 300s (5 min) do `fetch` nativo do Node, que matava a chamada ao `llama-server`/Ollama antes da
Aurora completar sua própria espera de até 15 min no CPU. Isso ficou nos commits:

- `e423f1b` — `app/localFetch.js` (novo): um `Agent` do undici com `headersTimeout:0, bodyTimeout:0`,
  usado agora em todas as chamadas ao modelo local. Tem teste em `test/localFetch.test.js`.
- `f4b04d4` — backend da Aurora roda em processo próprio (`electron/backend.js`), reinicia solo.
- Publicados juntos como **0.1.59**.

Esta sessão (ainda 30/10, já no notebook da empresa) tinha como tarefa: confirmar que o fix
resolveu o problema de ontem, comparando 0.1.58 (instalada) com a 0.1.59 (main), medindo o tempo
até a resposta do modelo, **sem tocar no banco real nem nas pastas reais da empresa** (regras
completas na nota de passagem que originou a sessão — não copiada aqui por ter caminhos da
empresa).

## O que a investigação encontrou (resumo executivo)

**O fix do undici (`e423f1b`) está correto e funciona** — confirmado com o teste existente e com
reprodução ao vivo. Mas ele **não foi suficiente**: tanto a 0.1.58 quanto a 0.1.59 continuavam
cortando uma resposta longa do modelo local em ~303 segundos, com o mesmo sintoma (`"fetch failed"`
na 0.1.58, `"The operation was aborted due to timeout"` na 0.1.59 — mensagem diferente, mesma causa
de fundo).

**Causa raiz real:** `app/llamaServer.js#pickDeviceDir` detecta a placa de vídeo via Vulkan. Neste
notebook (sem GPU dedicada), o Vulkan **enxerga a GPU integrada** (Intel UHD Graphics) e
`pickDeviceDir` retorna `{ gpu: true, device: { name: "Intel(R) UHD Graphics", ... } }`. Isso faz
`app/local.js` escolher a espera **"de GPU"** (`LOCAL_TIMEOUT_DEFAULT_MS = 300_000`, 5 min) em vez
da espera **"de CPU"** (`CPU_TIMEOUT_MS = 900_000`, 15 min) — porque o código só checava
`llamaServerInfo()?.gpu === false` para decidir, e aqui `gpu` era `true`.

O problema: essa GPU integrada **escreve a 6-8 tokens/s**, exatamente igual ao CPU puro (confirmado
no `llama-server.log`: `n_threads = 6`, sem nenhuma linha de offload/Vulkan, `tg = 7.6x t/s` do
início ao fim). Ou seja: "tem uma GPU" ≠ "é rápida o suficiente para merecer a espera curta". Em
hardware fraco com só GPU integrada, a Aurora dava 5 min quando devia dar 15 — e por isso o corte
em ~300s continuava acontecendo mesmo depois do `localFetch.js`, porque o `AbortController` que
corta a chamada é **da própria Aurora** (`app/local.js`/`app/localLlama.js`), não do undici.

## Como foi reproduzido (metodologia, reutilizável)

Sandbox totalmente isolado, nunca tocando no app real nem no banco real:

1. **Cópia segura do banco:** `VACUUM INTO` a partir do `harness.db` real (somente leitura na
   origem) para um arquivo de teste. Depois, na cópia: `UPDATE agents SET enabled = 0`,
   `whatsapp_enabled = 'false'`, `telegram_token`/`telegram_chat_id` limpos, `computer_map = 'false'`,
   `full_computer_access = 'false'`.
2. **Pastas de teste:** `HARNESS_KNOWN_FOLDERS` (JSON com `desktop`/`documents`/`downloads`/`home`)
   apontando para uma pasta nova, nunca para as pastas reais — mecanismo que já existia no código
   (`app/agentTools/index.js#knownFolders`, pensado originalmente para avaliações automatizadas).
3. **Portas isoladas:** `PORT=18890` (API), `LLAMA_SERVER_PORT=18194` (llama-server próprio,
   nunca o 18181 real), `HARNESS_PBI_OPEN=off`.
4. **Comparação 0.1.58 vs main:** um `git worktree add ../Harness_Aurora-v0158 v0.1.58` (tag real,
   mesma versão instalada no notebook) ao lado do checkout principal, `npm ci` nos dois, cada um
   rodado isoladamente (nunca os dois `llama-server` ao mesmo tempo — hardware fraco não aguenta
   dois modelos concorrentes e o resultado ficaria sem sentido).
5. **Pedido sintético (sem dado da empresa):** uma mensagem simples pedindo pro modelo local
   "listar 150 itens fictícios numerados" — grande o suficiente pra gerar bastante texto (gera
   ~1700+ tokens a ~7.6 tok/s) sem precisar de nenhum arquivo real. Medido o tempo total do turno
   via `POST /api/conversations/:id/messages` (a rota só responde quando o turno termina, então o
   tempo da chamada HTTP já é o "tempo até a resposta").
6. Depois de cada teste: processos do sandbox encerrados, worktree extra removido, pasta de teste
   e cópia do banco apagadas (`rm -rf`).

Isso é reaproveitável para o próximo teste de desempenho em hardware fraco — não precisa reinventar.

## O fix aplicado

`app/local.js`:

- Novo `export function needsPatientTimeout(model, { info, samples } = {})`: decide pela espera
  de 15 min (CPU) quando **há uma GPU conhecida** (`info.gpu === true`) mas ela ainda não provou
  ser rápida — "provar" aqui é: as últimas respostas desse mesmo modelo nesta máquina (via
  `app/modelSpeed.js#modelSpeedState`/`normalSpeed`, que já existia para outra coisa — detectar
  quedas de desempenho) tiveram `writeTps` normal **abaixo de 25 tok/s**. Só com histórico
  suficiente (5+ respostas medidas) E rápido o bastante é que a espera curta (5 min) é usada.
  `info.gpu === false` (CPU puro) sempre é a espera longa, como já era. **Sem `info` nenhum**
  (`llamaServerInfo()` retornou `null`) mantém o comportamento **original** (espera curta) — essa
  distinção só foi adicionada depois de uma rodada de testes mostrar por quê: ver nota abaixo.
- Os dois pontos que decidiam isso hard-coded (`runLocalChatOnce`, para o agente com ferramentas;
  e `runLocalOnce`, no atalho que reusa o llama-server já carregado para gerações simples — esse
  segundo nem tinha a distinção CPU/GPU, caía no default de 2 min do `runLlama`) passaram a chamar
  essa função.
- `info`/`samples` são injetáveis (parâmetro opcional) só pra dar pra testar sem precisar de
  llama-server de verdade — mesmo padrão que `pickDeviceDir(libDir, { run, env })` já usa no
  projeto.

Teste novo: `test/localDeviceTimeout.test.js` (6 casos, sem precisar de modelo real: sem GPU →
espera longa; sem info nenhuma → espera curta/original; GPU sem histórico → espera longa; GPU com
histórico lento (7.6 tok/s, o caso real de hoje) → espera longa; GPU com histórico rápido
(60 tok/s) → espera curta; histórico de outro modelo nunca libera a espera curta para o modelo
atual).

**Confirmado ao vivo** (mesmo pedido sintético, mesmo sandbox, código com o fix): o turno que antes
morria aos ~303s agora **terminou com sucesso aos 293s, HTTP 200, sem erro**.

**Pegadinha encontrada rodando a suíte completa antes de publicar:** a primeira versão do fix
tratava "`llamaServerInfo()` não retornou nada" (`!info`) igual a "sem GPU" — ou seja, espera
longa também. Isso fez dois testes que simulam um `fetch` que nunca resolve (pra testar
cancelamento) passarem de poucos *milissegundos* para **30 min e 58 min cada**
(`test/functional-tests.test.js`: `functional validator propagates cancellation...` e
`dependent steps cannot run while a functional failure persists`), porque eles dependiam do
timeout padrão (antes 5 min) pra desistir, sem passar `env.LOCAL_CHAT_BASE_URL` por um
`ensureLlamaServer` de verdade — nesse caso `llamaServerInfo()` sempre retorna `null`. Corrigido
tratando "sem info" como antes (espera curta); só "GPU sem prova de velocidade" ganha a espera
longa. Rodar a suíte inteira de novo depois de qualquer mudança aqui é obrigatório — um teste
isolado (`node --test test/localDeviceTimeout.test.js`) não pega esse tipo de regressão de tempo.

## Commit

`c5a50c0` — `app/local.js` + `test/localDeviceTimeout.test.js` (já com a correção acima).
Identidade `Abraão Lucas <lucaspedral2010@gmail.com>`, trailer
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
Ainda **não há release nova publicada** com esse fix (só commit em `main`) — publicar fica a
critério de quem estiver com a aprovação para isso.

## Em aberto — para quem continuar

1. **~23 testes falhando em `npm test`, pré-existentes (não relacionados a este fix)** — confirmado
   reproduzindo-os com e sem o fix (`git checkout 24377ee -- app/local.js` temporário, mesma falha
   nos dois). Arquivos afetados: `test/agentPolicy.test.js`, `test/sampleData.test.js`,
   `test/productionTour.test.js`, `test/teacher.test.js`, entre outros. Padrão comum em vários:
   esperado `'allow'`, recebido `'ask'` — parece alguma mudança de comportamento/política de
   aprovação (`app/agentTools/*`, modo `plan`/`manual`/`always-allow`) que ficou fora de sincronia
   com o que os testes esperam, ou um problema de isolamento entre testes (estado de uma pasta
   temporária vazando pra outro teste). Vale investigar — não teve tempo nesta sessão, e **não é
   causado pelo fix de timeout** (confirmado isolando a mudança). `test/telegram.test.js` também
   apareceu falhando/lento (~54s) numa rodada isolada desta sessão — pode ser flakiness de rede;
   não investigado a fundo, confirmar se se repete antes de assumir que é outra regressão.
2. **O limiar de 25 tok/s em `FAST_DEVICE_WRITE_TPS` é uma estimativa razoável, não medida**:
   qualquer GPU dedicada de verdade deveria passar disso com folga rodando um modelo de 4B
   quantizado; qualquer coisa perto do que uma GPU integrada/CPU entrega (6-10 tok/s aqui) fica
   bem abaixo. Se aparecer um caso real de GPU dedicada lenta (ou GPU integrada rápida) que não
   se encaixe bem nesse corte, ajustar o número — não é um valor sagrado.
3. **`llamaServerInfo()` não expõe `device`/`dir`** (só `model`, `baseUrl`, `gpu`, `healthy`,
   `slots`, `restoredTokens`) — se um dia quiser decidir com base no *nome* do dispositivo
   (ex.: qualquer coisa com "UHD"/"Iris"/"Radeon Graphics" = integrada, tratar como CPU de cara,
   sem esperar medição), precisa expor isso também. Não fiz isso agora porque depender do nome do
   dispositivo é frágil (nomes variam, outros fabricantes, etc.) — preferi a medição real.
4. Os itens antigos do roadmap continuam abertos (polish visual do Atlas 3D, etc.) — ver
   `docs/historico/PROJECT_LOG.md` e a memória do projeto, não mexido nesta sessão.

## Como testar rapidamente o que mudou

```bash
node --test test/localDeviceTimeout.test.js test/local-llama.test.js test/localFetch.test.js
```

Para reproduzir com modelo real (demora, precisa do Ollama com o modelo já baixado): montar o
sandbox descrito acima e mandar uma pergunta que force uma resposta longa (algumas centenas de
tokens) pelo provider `local`; medir o tempo da chamada HTTP.
