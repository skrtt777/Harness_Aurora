// Cold start of the local model: how long the first answer takes after the server (re)starts, and
// whether saving the fixed start of the prompt to disk (llama-server --slot-save-path) brings it back
// at once. The idea is Strata's "keep the conversation, read only what is new" carried across restarts.
//   node scripts/cache-lab.mjs <request.json>        (a real request body, e.g. one dumped by an eval)
//   LLAMA_FORCE_CPU=1 node scripts/cache-lab.mjs …   (the same on the processor only)
import { mkdtempSync, readFileSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLlamaServer, stopLlamaServer } from "../app/llamaServer.js";

const model = process.env.LOCAL_MODEL || "qwen3.5:4b";
const body = JSON.parse(readFileSync(process.argv[2], "utf8").split("\n")[0]);
const saveDir = mkdtempSync(join(tmpdir(), "aurora-slots-"));
const env = { ...process.env, LLAMA_SERVER_EXTRA_ARGS: `${process.env.LLAMA_SERVER_EXTRA_ARGS || ""} --slot-save-path ${saveDir}`.trim() };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(baseUrl, label) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, stream: false, max_tokens: 8, id_slot: 0 }) });
  const data = await response.json();
  const t = data.timings || {};
  console.log(`${label}: ${((Date.now() - started) / 1000).toFixed(1)} s no total; leu ${t.prompt_n ?? "?"} tokens em ${((t.prompt_ms || 0) / 1000).toFixed(1)} s; do cache: ${t.cache_n ?? "?"}`);
  return data;
}
async function slot(baseUrl, action, filename) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/slots/0?action=${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename }) });
  const data = await response.json().catch(() => ({}));
  console.log(`  ${action}: ${response.status} em ${((Date.now() - started) / 1000).toFixed(2)} s ${JSON.stringify(data).slice(0, 160)}`);
  return response.ok;
}

console.log(`modelo ${model}, ${process.env.LLAMA_FORCE_CPU ? "só CPU" : "GPU se houver"}; pasta ${saveDir}`);
let baseUrl = await ensureLlamaServer({ model, env });
if (!baseUrl) { console.log("o servidor não subiu (veja llama-server.log)"); process.exit(1); }
await ask(baseUrl, "1. primeira resposta (a frio)");
await ask(baseUrl, "2. mesma pergunta de novo (cache em memória)");
// The model has recurrent layers: a saved state can only be extended, never cut back. So the state
// saved is exactly the fixed start of the prompt (up to the first user message), with nothing generated.
const rendered = (await (await fetch(`${baseUrl}/apply-template`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: body.messages, tools: body.tools, chat_template_kwargs: body.chat_template_kwargs }) })).json()).prompt;
const cut = rendered.indexOf("<|im_start|>user");
const prefix = rendered.slice(0, cut);
console.log(`  prefixo fixo: ${prefix.length} caracteres de ${rendered.length}`);
await fetch(`${baseUrl}/slots/0?action=erase`, { method: "POST" });
const warm = await (await fetch(`${baseUrl}/completion`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: prefix, n_predict: 0, id_slot: 0, cache_prompt: true }) })).json();
console.log(`  aquecido: leu ${warm.timings?.prompt_n ?? "?"} tokens, gerou ${warm.timings?.predicted_n ?? "?"}`);
await slot(baseUrl, "save", "aurora-prefixo.bin");
for (const f of readdirSync(saveDir)) console.log(`  arquivo: ${f}, ${(statSync(join(saveDir, f)).size / 1024 / 1024).toFixed(0)} MB`);
stopLlamaServer();
await pause(2000);
baseUrl = await ensureLlamaServer({ model, env });
const restored = await slot(baseUrl, "restore", "aurora-prefixo.bin");
await ask(baseUrl, `3. depois de reiniciar${restored ? ", com o cache restaurado do disco" : " (restauração falhou)"}`);
stopLlamaServer();
await pause(2000);
baseUrl = await ensureLlamaServer({ model, env });
await ask(baseUrl, "4. depois de reiniciar, sem restaurar (como é hoje)");
stopLlamaServer();
process.exit(0);
