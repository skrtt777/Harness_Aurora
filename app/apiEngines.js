// Any model through an API key (docs/VISAO_HARNESS_2.0.md, phase 1): Anthropic (official SDK) and anything
// that speaks the OpenAI chat API (OpenAI, OpenRouter, Gemini, a local or company endpoint). The CLIs bring
// their own tools; an API model gets the Aurora's minimal set, confined to the folder it works in — the
// mirror (app/mirror.js), so the same blind work applies to every engine: list, read, write and run Python.
import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getSetting, setSetting } from "./store.js";

export const API_KINDS = ["anthropic", "openai"];
// Ready-made providers; "openai" kind with a base URL covers the rest.
export const API_PRESETS = {
  anthropic: { kind: "anthropic", label: "Claude (API)", model: "claude-opus-5-5" },
  openai: { kind: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  openrouter: { kind: "openai", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  gemini: { kind: "openai", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  custom: { kind: "openai", label: "Endpoint próprio" },
};
const MAX_TURNS = 40;
const MAX_READ = 60_000;
const MAX_TOOL_OUTPUT = 12_000;

// ---------------- The tools, confined to `root` ----------------
const TOOLS = [
  { name: "list_files", description: "Lista os arquivos da pasta de trabalho (ou de uma subpasta), com o tamanho de cada um.", schema: { type: "object", properties: { path: { type: "string", description: "Subpasta relativa; vazio para a raiz." } }, required: [], additionalProperties: false } },
  { name: "read_file", description: "Lê um arquivo de texto da pasta de trabalho (CSV, código, Markdown…).", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
  { name: "write_file", description: "Grava um arquivo de texto na pasta de trabalho (cria as pastas que faltarem).", schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } },
  { name: "run_python", description: "Roda um script Python que está na pasta de trabalho, com a pasta como diretório atual. Para instalar um pacote, use o script \"-m pip install nome\".", schema: { type: "object", properties: { script: { type: "string", description: "Caminho relativo do .py, ou \"-m pip install pacote\"." } }, required: ["script"], additionalProperties: false } },
];

/** `path` inside `root`, or null when it would escape it (.., absolute paths elsewhere). */
export function inside(root, path = "") {
  const base = resolve(root);
  const target = resolve(base, String(path || "."));
  const rel = relative(base, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return target;
}

const clip = (s, n = MAX_TOOL_OUTPUT) => { const t = String(s ?? ""); return t.length > n ? `${t.slice(0, n)}\n… (cortado)` : t; };

function python(args, cwd, signal, env) {
  const tries = [["python", []], ["py", ["-3"]]];
  const attempt = (i) => new Promise((done) => {
    execFile(tries[i][0], [...tries[i][1], ...args], { cwd, timeout: 5 * 60_000, windowsHide: true, signal, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } }, (error, stdout, stderr) => {
      if (error?.code === "ENOENT" && i + 1 < tries.length) return done(attempt(i + 1));
      done(`${error ? `ERRO (código ${error.code ?? "?"})\n` : ""}${stdout || ""}${stderr ? `\n${stderr}` : ""}`.trim() || "(sem saída)");
    });
  });
  return attempt(0);
}

/** One tool call: a string result (errors start with "ERRO"). */
export async function runTool(name, input, { root, signal, env = {} }) {
  const args = input && typeof input === "object" ? input : {};
  if (name === "list_files") {
    const dir = inside(root, args.path);
    if (!dir) return "ERRO: fora da pasta de trabalho.";
    const out = [];
    const walk = (d, depth) => {
      let entries = [];
      try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (out.length > 400 || e.name.startsWith(".")) continue;
        const p = join(d, e.name);
        if (e.isDirectory()) { out.push(`${relative(root, p)}/`); if (depth > 0) walk(p, depth - 1); }
        else { let size = 0; try { size = statSync(p).size; } catch { /* gone */ } out.push(`${relative(root, p)} (${size} bytes)`); }
      }
    };
    walk(dir, 3);
    return out.join("\n") || "(pasta vazia)";
  }
  if (name === "read_file") {
    const file = inside(root, args.path);
    if (!file) return "ERRO: fora da pasta de trabalho.";
    try { return clip(readFileSync(file, "utf8"), MAX_READ); } catch (error) { return `ERRO: ${error.message}`; }
  }
  if (name === "write_file") {
    const file = inside(root, args.path);
    if (!file || typeof args.content !== "string") return "ERRO: caminho fora da pasta ou conteúdo ausente.";
    try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, args.content, "utf8"); return `Gravado: ${relative(root, file)} (${Buffer.byteLength(args.content)} bytes).`; } catch (error) { return `ERRO: ${error.message}`; }
  }
  if (name === "run_python") {
    const script = String(args.script || "").trim();
    const pip = /^-m\s+pip\s+install\s+([\w.\-\[\]=<>, ]+)$/.exec(script);
    if (pip) return clip(await python(["-m", "pip", "install", ...pip[1].split(/[\s,]+/).filter(Boolean)], root, signal, env));
    const file = inside(root, script);
    if (!file || !/\.py$/i.test(file)) return "ERRO: informe um .py da pasta de trabalho.";
    return clip(await python([file], root, signal, env));
  }
  return `ERRO: ferramenta desconhecida ${name}.`;
}

const NUDGE = "Diga em uma ou duas frases, em texto, o que você fez e quais arquivos gravou.";
const NO_SUMMARY = "(o modelo terminou o trabalho sem escrever um resumo)";
const SYSTEM = "Você trabalha numa pasta do computador da pessoa, com as ferramentas list_files, read_file, write_file e run_python. Use as ferramentas para fazer a tarefa de verdade (gravar os arquivos, rodar os scripts) e conferir o resultado. No fim, responda em texto, curto, em português do Brasil.";

// ---------------- Anthropic (official SDK, manual tool loop) ----------------
async function runAnthropic(engine, prompt, { cwd, signal, env, client = null }) {
  const anthropic = client || new Anthropic({ apiKey: engine.apiKey, ...(engine.baseUrl ? { baseURL: engine.baseUrl } : {}), maxRetries: 2 });
  const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
  const messages = [{ role: "user", content: prompt }];
  const model = engine.model || API_PRESETS.anthropic.model;
  let text = "";
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let usedTools = false, nudged = false;
  // Streamed (a long answer never times out) and collected whole with finalMessage(); a client without
  // stream() (the tests' fake) is called plainly.
  const call = (body) => (anthropic.beta.messages.stream ? anthropic.beta.messages.stream(body, { signal }).finalMessage() : anthropic.beta.messages.create(body, { signal }));
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    if (signal?.aborted) return { ok: false, error: "cancelado" };
    // - Server-side fallback ("default" routes a policy decline to another model in the same call).
    // - Automatic prompt caching: the request's last block is cached, so every turn of the tool loop reads the
    //   whole conversation so far from the cache (~0.1× the price) instead of paying for it again.
    // - The work is a delivery (files, scripts, checks): high effort; thinking is adaptive (always on in 5.5).
    const response = await call({
      model, max_tokens: 32000, system: SYSTEM, tools, messages,
      cache_control: { type: "ephemeral" }, ...(/opus|sonnet-5|fable/i.test(model) ? { output_config: { effort: "high" } } : {}),
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    });
    usage.input += response.usage?.input_tokens || 0;
    usage.output += response.usage?.output_tokens || 0;
    usage.cacheRead += response.usage?.cache_read_input_tokens || 0;
    usage.cacheWrite += response.usage?.cache_creation_input_tokens || 0;
    const said = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (said) text = said;
    if (response.stop_reason === "refusal") return { ok: false, error: "o modelo recusou a tarefa" };
    if (response.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: response.content }); continue; }
    const calls = response.content.filter((b) => b.type === "tool_use");
    if (!calls.length || response.stop_reason === "end_turn") {
      if (text) return { ok: true, text, usage };
      if (usedTools && !nudged) { nudged = true; messages.push({ role: "assistant", content: response.content.length ? response.content : [{ type: "text", text: "(feito)" }] }, { role: "user", content: NUDGE }); continue; }
      return usedTools ? { ok: true, text: NO_SUMMARY, usage } : { ok: false, error: "resposta vazia" };
    }
    usedTools = true;
    if (response.stop_reason === "max_tokens") return { ok: false, error: "a resposta foi cortada no limite de tokens" };
    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const call of calls) {
      const out = await runTool(call.name, call.input, { root: cwd, signal, env });
      results.push({ type: "tool_result", tool_use_id: call.id, content: out, ...(out.startsWith("ERRO") ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  return { ok: false, error: `passou de ${MAX_TURNS} rodadas sem terminar` };
}

// ---------------- OpenAI-compatible chat API (OpenAI, OpenRouter, Gemini, endpoints) ----------------
async function runOpenAiCompatible(engine, prompt, { cwd, signal, env, fetchImpl = fetch }) {
  const base = String(engine.baseUrl || "").replace(/\/+$/, "");
  if (!base) return { ok: false, error: "endereço (base URL) não configurado" };
  if (!engine.model) return { ok: false, error: "modelo não configurado" };
  const tools = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } }));
  const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }];
  let text = "";
  const usage = { input: 0, output: 0 };
  let usedTools = false, nudged = false;
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    if (signal?.aborted) return { ok: false, error: "cancelado" };
    const response = await fetchImpl(`${base}/chat/completions`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", ...(engine.apiKey ? { authorization: `Bearer ${engine.apiKey}` } : {}) },
      body: JSON.stringify({ model: engine.model, messages, tools, tool_choice: "auto" }),
    });
    const body = await response.json().catch(() => ({}));
    // The status goes into the error: a 429 or "insufficient_quota" marks the engine out of its limit (engine.js).
    if (!response.ok) return { ok: false, status: response.status, error: `HTTP ${response.status}: ${String(body?.error?.message || body?.error || response.statusText).slice(0, 300)}${response.status === 429 ? " (rate limit)" : ""}` };
    usage.input += body.usage?.prompt_tokens || 0;
    usage.output += body.usage?.completion_tokens || 0;
    const message = body.choices?.[0]?.message;
    if (!message) return { ok: false, error: "resposta sem mensagem" };
    if (typeof message.content === "string" && message.content.trim()) text = message.content.trim();
    const calls = message.tool_calls || [];
    if (!calls.length) {
      if (text) return { ok: true, text, usage };
      // Smaller models (and some providers) end the work with the tools and no words: one nudge, then the
      // work stands without a summary (20/10, qwen3.5:4b through Ollama).
      if (usedTools && !nudged) { nudged = true; messages.push({ role: "assistant", content: "" }, { role: "user", content: NUDGE }); continue; }
      return usedTools ? { ok: true, text: NO_SUMMARY, usage } : { ok: false, error: "resposta vazia" };
    }
    usedTools = true;
    messages.push({ role: "assistant", content: message.content || null, tool_calls: calls });
    for (const call of calls) {
      let input = {};
      try { input = JSON.parse(call.function?.arguments || "{}"); } catch { input = null; }
      const out = input ? await runTool(call.function?.name, input, { root: cwd, signal, env }) : "ERRO: argumentos em JSON inválido.";
      messages.push({ role: "tool", tool_call_id: call.id, content: out });
    }
  }
  return { ok: false, error: `passou de ${MAX_TURNS} rodadas sem terminar` };
}

/** One task by an API engine in `cwd`; the same result shape as the CLI engines ({ ok, text } | { ok: false, error }). */
export async function runApiEngine(engine, prompt, { cwd, env = process.env, signal, client, fetchImpl } = {}) {
  try {
    if (!engine.apiKey && engine.kind === "anthropic") return { ok: false, error: "chave da API não configurada" };
    return engine.kind === "anthropic"
      ? await runAnthropic(engine, prompt, { cwd, signal, env, client })
      : await runOpenAiCompatible(engine, prompt, { cwd, signal, env, fetchImpl });
  } catch (error) {
    if (signal?.aborted) return { ok: false, error: "cancelado" };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, status: 429, error: `rate limit: ${error.message}` };
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, status: 401, error: "a chave da API foi recusada" };
    if (error instanceof Anthropic.APIError) return { ok: false, status: error.status, error: `${error.status ?? ""} ${error.message}`.trim() };
    return { ok: false, error: String(error?.message || error) };
  }
}

// ---------------- Configured engines (Configurações → Modelos) ----------------
const KEY = "api_engines";
const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);

/** The engines as saved: [{ id, label, kind, baseUrl, model, apiKey }] (ids "api-…"). */
export async function listApiEngines() {
  try { const list = JSON.parse((await getSetting(KEY)) || "[]"); return Array.isArray(list) ? list : []; } catch { return []; }
}
/** What the screen gets: the key only as "…last 4". */
export const publicEngine = (e) => ({ id: e.id, label: e.label, kind: e.kind, baseUrl: e.baseUrl || "", model: e.model || "", hasKey: Boolean(e.apiKey), keyHint: e.apiKey ? `…${String(e.apiKey).slice(-4)}` : "" });

/** Adds or updates one engine; a missing apiKey on update keeps the saved one. */
export async function saveApiEngine({ id = null, preset = "custom", label, kind, baseUrl, model, apiKey }) {
  const base = API_PRESETS[preset] || API_PRESETS.custom;
  const list = await listApiEngines();
  const current = id ? list.find((e) => e.id === id) : null;
  const next = {
    id: current?.id || `api-${slug(label || base.label) || "modelo"}-${Date.now().toString(36).slice(-4)}`,
    label: String(label || current?.label || base.label).trim().slice(0, 40),
    kind: API_KINDS.includes(kind) ? kind : current?.kind || base.kind,
    baseUrl: String(baseUrl ?? current?.baseUrl ?? base.baseUrl ?? "").trim(),
    model: String(model ?? current?.model ?? base.model ?? "").trim(),
    apiKey: apiKey ? String(apiKey).trim() : current?.apiKey || "",
  };
  if (next.kind === "openai" && !/^https?:\/\//.test(next.baseUrl)) throw Object.assign(new Error("Informe o endereço da API (começando com http)."), { status: 400 });
  if (!next.model) throw Object.assign(new Error("Informe o modelo."), { status: 400 });
  await setSetting(KEY, JSON.stringify([...list.filter((e) => e.id !== next.id), next]));
  return next;
}
export async function deleteApiEngine(id) {
  await setSetting(KEY, JSON.stringify((await listApiEngines()).filter((e) => e.id !== id)));
}
