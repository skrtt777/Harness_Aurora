// The Aurora inside the code editor (the VS Code extension, vscode/aurora): the gray suggestion while
// the person types (fill-in-the-middle on the local model that is already loaded: the agent's
// llama-server when it is up, Ollama otherwise) and the rewrite of a selected snippet (Ctrl+I), which
// comes back as code only; the extension shows it as a diff to accept or refuse. Nothing leaves the PC.
import { resolveLocalModel } from "./ollamaSetup.js";
import { llamaServerInfo } from "./llamaServer.js";
import { keepAlive, runLocal } from "./local.js";

// Qwen's fill-in-the-middle tokens (qwen2.5-coder, qwen3, qwen3.5); other models read them as text.
const FIM = { prefix: "<|fim_prefix|>", suffix: "<|fim_suffix|>", middle: "<|fim_middle|>", stop: ["<|fim_pad|>", "<|endoftext|>", "<|im_end|>", "<|fim_prefix|>", "<|file_sep|>", "<|repo_name|>"] };
const PREFIX_CHARS = 4000, SUFFIX_CHARS = 1500;

/** A raw generation (no chat template) on the loaded model: { text, ms, engine }. */
async function rawGenerate(prompt, { maxTokens = 64, stop = [], temperature = 0.1, signal, env = process.env } = {}) {
  const started = Date.now();
  const model = await resolveLocalModel(env);
  const shared = env.LOCAL_SHARE_SERVER !== "off" && !env.LOCAL_BASE_URL ? llamaServerInfo() : null;
  const timeout = AbortSignal.timeout(Number(env.CODE_COMPLETE_TIMEOUT_MS) || 8000);
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
  if (shared?.healthy && shared.baseUrl && shared.model === model) {
    const r = await fetch(`${shared.baseUrl}/completion`, { method: "POST", signal: both, headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, n_predict: maxTokens, stop, temperature, cache_prompt: true }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || `Executor local: HTTP ${r.status}`);
    return { text: String(data.content || ""), ms: Date.now() - started, engine: "llama-server", model };
  }
  const base = env.LOCAL_BASE_URL || "http://127.0.0.1:11434";
  const r = await fetch(`${base}/api/generate`, { method: "POST", signal: both, headers: { "content-type": "application/json" }, body: JSON.stringify({ model, prompt, raw: true, stream: false, keep_alive: keepAlive(env), options: { num_predict: maxTokens, temperature, stop } }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `O Ollama respondeu ${r.status}.`);
  return { text: String(data.response || ""), ms: Date.now() - started, engine: "ollama", model };
}

/**
 * What the model wrote, as the editor should insert it at the cursor:
 * - in the middle of a line (text after the cursor), one line only;
 * - after code on the line, the line goes on (no leading line break);
 * - at most `maxLines`, cut at a blank line;
 * - what the text after the cursor already says is not repeated.
 */
export function cleanCompletion(text, { prefix = "", suffix = "", maxLines = 8 } = {}) {
  let out = String(text || "");
  for (const s of FIM.stop) { const at = out.indexOf(s); if (at >= 0) out = out.slice(0, at); }
  const linePrefix = prefix.slice(prefix.lastIndexOf("\n") + 1);
  const lineSuffix = suffix.split("\n")[0];
  // A line that already ends a statement ("return 0;", "{", "}"): the model's line break is right.
  const lineEnded = /[;{}]\s*$/.test(linePrefix);
  if (linePrefix.trim() && !lineEnded) out = out.replace(/^\s*\n\s*/, "");
  else if (lineEnded && !/^\s*\n/.test(out)) return "";
  // The cursor already sits indented on an empty line: the model's own line break and indent go.
  else if (linePrefix && !linePrefix.trim()) out = out.replace(/^[ \t]*\n/, "").replace(new RegExp(`^${linePrefix}`), "");
  if (lineSuffix.trim()) out = out.split("\n")[0];
  let lines = out.split("\n");
  const blank = lines.findIndex((l, i) => i > 0 && !l.trim());
  if (blank > 0) lines = lines.slice(0, blank);
  // Code before the cursor and a first line that ends the statement: only that line (the model tends
  // to close the block that already exists below).
  if (linePrefix.trim() && !lineEnded && !/[{([:,=>]\s*$/.test(lines[0])) lines = lines.slice(0, 1);
  // Closing lines when what follows the cursor already closes: not written twice.
  const nextLine = suffix.replace(/^[^\n]*\n?/, "").split("\n").find((l) => l.trim())?.trim() || "";
  if (/^[)\]}]/.test(nextLine)) while (lines.length > 1 && /^\s*[)\]}][)\]};,]*\s*$/.test(lines.at(-1))) lines.pop();
  lines = lines.slice(0, maxLines);
  out = lines.join("\n").replace(/\s+$/, "");
  // The model often writes again the lines that already follow the cursor.
  const next = suffix.replace(/^[^\n]*\n?/, "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (next.length) {
    const kept = out.split("\n");
    const at = kept.findIndex((l, i) => i > 0 && l.trim() && l.trim() === next[0]);
    if (at > 0) out = kept.slice(0, at).join("\n").replace(/\s+$/, "");
  }
  if (lineSuffix.trim()) {
    const tail = lineSuffix.trim();
    if (out.endsWith(tail)) out = out.slice(0, -tail.length);
  }
  return out.trim() ? out : "";
}

/** The gray suggestion at the cursor: { text, ms, engine }. Empty text when there is nothing good. */
export async function completeCode({ prefix = "", suffix = "", language = "", file = "" } = {}, { signal, env = process.env, generate = rawGenerate } = {}) {
  const before = String(prefix).slice(-PREFIX_CHARS), after = String(suffix).slice(0, SUFFIX_CHARS);
  if (!before.trim()) return { text: "", ms: 0 };
  const header = file ? `<|file_sep|>${String(file).replace(/\\/g, "/").split("/").slice(-2).join("/")}\n` : "";
  const multi = !after.split("\n")[0].trim();
  const r = await generate(`${FIM.prefix}${header}${before}${FIM.suffix}${after}${FIM.middle}`, { maxTokens: multi ? 96 : 40, stop: FIM.stop, temperature: 0.1, signal, env });
  return { text: cleanCompletion(r.text, { prefix: before, suffix: after, maxLines: multi ? 8 : 1 }), ms: r.ms, engine: r.engine, model: r.model, language };
}

/** The code inside the first fenced block of an answer (or the whole answer, without fences). */
export function codeOf(answer) {
  const text = String(answer || "").replace(/<think>[\s\S]*?<\/think>/g, "");
  const fenced = /```[\w+#.-]*[^\S\n]*\n([\s\S]*?)\n?```/.exec(text);
  return (fenced ? fenced[1] : text.replace(/^```[\w+#.-]*\n?|```\s*$/g, "")).replace(/\s+$/, "");
}

/**
 * Ctrl+I: the selected snippet rewritten as the person asked (or, with nothing selected, the code to
 * insert at the cursor). { code } keeps the selection's indentation; the extension shows the diff.
 */
export async function editCode({ instruction = "", selection = "", before = "", after = "", language = "", file = "" } = {}, { signal, env = process.env, run = runLocal } = {}) {
  const ask = String(instruction).trim();
  if (!ask) throw Object.assign(new Error("Diga o que mudar no código."), { status: 400 });
  const lang = String(language || "").trim();
  const name = String(file || "").replace(/\\/g, "/").split("/").pop();
  const sel = String(selection);
  const parts = [
    "Você edita código dentro do editor. Responda SÓ com o código, num único bloco ```, sem explicação. Não acrescente nada que não foi pedido (exports, imports, exemplos de uso, testes): o resto do arquivo já existe.",
    sel.trim()
      ? `Reescreva o trecho selecionado conforme o pedido. Devolva o trecho inteiro já mudado (não só a parte nova), com a mesma indentação, e nada do que vem antes ou depois dele.`
      : `Escreva o código que vai no lugar do cursor (marcado como <CURSOR>), conforme o pedido, com a indentação do lugar.`,
    `Pedido: ${ask}`,
    `Arquivo: ${name || "(sem nome)"}${lang ? ` (${lang})` : ""}`,
    `Código antes:\n\`\`\`${lang}\n${String(before).slice(-3000)}${sel.trim() ? "" : "<CURSOR>"}\n\`\`\``,
    ...(sel.trim() ? [`Trecho selecionado:\n\`\`\`${lang}\n${sel.slice(0, 12000)}\n\`\`\``] : []),
    `Código depois:\n\`\`\`${lang}\n${String(after).slice(0, 2000)}\n\`\`\``,
  ];
  const lines = sel.split("\n").length;
  const r = await run(parts.join("\n\n"), { ...env, LOCAL_TEMPERATURE: "0.2", LOCAL_MAX_OUTPUT_TOKENS: String(Math.min(4096, Math.max(512, lines * 40))) }, signal);
  if (!r.ok) throw Object.assign(new Error(r.error || "O modelo local não respondeu."), { status: r.cancelled ? 499 : 502 });
  let code = codeOf(r.text).replace(/^(?:[ \t]*\n)+/, "");
  // A model that copied the lines around the snippet into its answer: only the snippet stays.
  const tailBefore = new Set(String(before).split("\n").map((l) => l.trim()).filter(Boolean).slice(-5));
  const inSelection = new Set(sel.split("\n").map((l) => l.trim()));
  const firstAfter = String(after).split("\n").map((l) => l.trim()).find(Boolean);
  let lines_ = code.split("\n");
  while (lines_.length > 1 && (!lines_[0].trim() || (tailBefore.has(lines_[0].trim()) && !inSelection.has(lines_[0].trim())))) lines_ = lines_.slice(1);
  const cut = firstAfter && !sel.includes(firstAfter) ? lines_.findIndex((l, i) => i > 0 && l.trim() === firstAfter) : -1;
  if (cut > 0) lines_ = lines_.slice(0, cut);
  code = lines_.join("\n").replace(/\s+$/, "");
  // The selection's own indentation, when the model lost it.
  const indent = /^[ \t]*/.exec(sel.split("\n").find((l) => l.trim()) || "")?.[0] || "";
  if (indent && code.split("\n").filter((l) => l.trim()).every((l) => !/^[ \t]/.test(l))) code = code.split("\n").map((l) => (l.trim() ? indent + l : l)).join("\n");
  return { code, ms: r.metrics?.wallMs ? Math.round(r.metrics.wallMs) : null, model: r.metrics?.model || null };
}
