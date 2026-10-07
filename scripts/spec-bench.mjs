// Speed of the local model with and without speculative decoding (no draft model: n-gram lookups).
// node scripts/spec-bench.mjs ["--spec-type ngram-mod" ...]   (each argument is one configuration)
import { readFileSync } from "node:fs";
import { ensureLlamaServer, stopLlamaServer } from "../app/llamaServer.js";

const model = process.env.LOCAL_MODEL || "qwen3.5:4b";
const configs = process.argv.slice(2).length ? process.argv.slice(2) : ["", "--spec-type ngram-mod", "--spec-type ngram-simple"];
const rows = Array.from({ length: 40 }, (_, i) => `PC-2026-${900 + i} | Fornecedor ${String.fromCharCode(65 + (i % 26))} Ltda | ${String(1 + (i % 28)).padStart(2, "0")}/10/2026 | ${(1000 + i * 137.5).toFixed(2)} | Aguardando entrega`);
const only = process.env.ONLY;
const allPrompts = {
  // The agent's most common shape: rows that came from a tool, copied into a document.
  copia: `Estas são as linhas que a ferramenta devolveu:\n\nPedido | Fornecedor | Entrega | Valor | Situação\n${rows.join("\n")}\n\nEscreva uma tabela em markdown com TODAS as linhas acima, sem mudar nada, e depois uma frase de resumo.`,
  conversa: "Explique em três parágrafos curtos como organizar o fechamento do mês de uma pequena empresa.",
};

// AGENT_REQUEST=<file>: a real agent request (JSON, first line) — rules, tools and a question, as the app sends it.
if (process.env.AGENT_REQUEST) allPrompts.agente = JSON.parse(readFileSync(process.env.AGENT_REQUEST, "utf8").split("\n")[0]);
const prompts = only ? { [only]: allPrompts[only] } : allPrompts;

async function time(baseUrl, prompt) {
  const started = Date.now();
  const request = typeof prompt === "string" ? { model, messages: [{ role: "user", content: prompt }] } : { ...prompt, stream: false };
  const response = await fetch(`${baseUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, temperature: 0, max_tokens: 1800, chat_template_kwargs: { enable_thinking: false } }) });
  const body = await response.json();
  const ms = Date.now() - started;
  const tokens = body.usage?.completion_tokens || 0;
  return { ms, tokens, tps: tokens / ((body.timings?.predicted_ms || ms) / 1000), text: body.choices?.[0]?.message?.content || JSON.stringify(body.choices?.[0]?.message?.tool_calls || body).slice(0, 400) };
}

const baseline = {};
for (const extra of configs) {
  stopLlamaServer();
  await new Promise((r) => setTimeout(r, 1500));
  const baseUrl = await ensureLlamaServer({ model, env: { ...process.env, LLAMA_SERVER_EXTRA_ARGS: extra } });
  if (!baseUrl) { console.log(`[${extra || "sem especulação"}] servidor não subiu (veja llama-server.log)`); continue; }
  for (const [name, prompt] of Object.entries(prompts)) {
    await time(baseUrl, "oi"); // warm-up
    // PAR=2: two requests at once (the server has 4 slots; the orchestrator runs 2 tasks together).
    const par = Number(process.env.PAR || 1);
    const runs = par > 1 ? [await time(baseUrl, prompt), ...(await Promise.all(Array.from({ length: par }, () => time(baseUrl, prompt))))] : [await time(baseUrl, prompt), await time(baseUrl, prompt)];
    const tps = runs.reduce((n, r) => n + r.tps, 0) / runs.length;
    const same = baseline[name] === undefined ? (baseline[name] = runs[0].text, "") : (runs[0].text === baseline[name] ? " (texto idêntico)" : " (texto DIFERENTE)");
    console.log(`[${extra || "sem especulação"}] ${name}: ${tps.toFixed(1)} tokens/s, ${runs[0].tokens} tokens, ${runs.map((r) => (r.ms / 1000).toFixed(1)).join(" e ")} s${same}`);
  }
}
stopLlamaServer();
process.exit(0);
