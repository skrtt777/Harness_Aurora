// The Aurora inside the code editor (the VS Code extension, vscode/aurora): the gray suggestion while
// the person types (fill-in-the-middle on the local model that is already loaded: the agent's
// llama-server when it is up, Ollama otherwise) and the rewrite of a selected snippet (Ctrl+I), which
// comes back as code only; the extension shows it as a diff to accept or refuse. Nothing leaves the PC.
import { resolveLocalModel } from "./ollamaSetup.js";
import { llamaServerInfo } from "./llamaServer.js";
import { keepAlive, runLocal } from "./local.js";
import { CODE_MODEL, codeServerInfo, ensureCodeServer } from "./codeModel.js";

// Qwen's fill-in-the-middle tokens (qwen2.5-coder, qwen3, qwen3.5); other models read them as text.
const FIM = { prefix: "<|fim_prefix|>", suffix: "<|fim_suffix|>", middle: "<|fim_middle|>", stop: ["<|fim_pad|>", "<|endoftext|>", "<|im_end|>", "<|fim_prefix|>", "<|file_sep|>", "<|repo_name|>"] };
const PREFIX_CHARS = 4000, SUFFIX_CHARS = 1500;

/** A raw generation (no chat template) on the loaded model: { text, ms, engine }. */
async function rawGenerate(prompt, { maxTokens = 64, stop = [], temperature = 0.1, signal, env = process.env, useCodeModel = true } = {}) {
  const started = Date.now();
  const timeout = AbortSignal.timeout(Number(env.CODE_COMPLETE_TIMEOUT_MS) || 8000);
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
  // The code model (app/codeModel.js) when it is there and up; while it loads, the chat model answers.
  if (useCodeModel) {
    const info = codeServerInfo();
    if (info?.healthy) {
      const r = await fetch(`${info.baseUrl}/completion`, { method: "POST", signal: both, headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, n_predict: maxTokens, stop, temperature, cache_prompt: true }) });
      const data = await r.json().catch(() => ({}));
      if (r.ok) return { text: String(data.content || ""), ms: Date.now() - started, engine: "code-model", model: CODE_MODEL.name, truncated: data.stop_type === "limit" || data.stopped_limit === true };
    } else ensureCodeServer({ env }).catch(() => null);
  }
  const model = await resolveLocalModel(env);
  const shared = env.LOCAL_SHARE_SERVER !== "off" && !env.LOCAL_BASE_URL ? llamaServerInfo() : null;
  if (shared?.healthy && shared.baseUrl && shared.model === model) {
    const r = await fetch(`${shared.baseUrl}/completion`, { method: "POST", signal: both, headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, n_predict: maxTokens, stop, temperature, cache_prompt: true }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || `Executor local: HTTP ${r.status}`);
    return { text: String(data.content || ""), ms: Date.now() - started, engine: "llama-server", model, truncated: data.stop_type === "limit" || data.stopped_limit === true };
  }
  const base = env.LOCAL_BASE_URL || "http://127.0.0.1:11434";
  const r = await fetch(`${base}/api/generate`, { method: "POST", signal: both, headers: { "content-type": "application/json" }, body: JSON.stringify({ model, prompt, raw: true, stream: false, keep_alive: keepAlive(env), options: { num_predict: maxTokens, temperature, stop } }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `O Ollama respondeu ${r.status}.`);
  return { text: String(data.response || ""), ms: Date.now() - started, engine: "ollama", model, truncated: data.done_reason === "length" };
}

/**
 * What the model wrote, as the editor should insert it at the cursor:
 * - in the middle of a line (text after the cursor), one line only;
 * - after code on the line, the line goes on (no leading line break);
 * - at most `maxLines`, cut at a blank line;
 * - what the text after the cursor already says is not repeated.
 */
export function cleanCompletion(text, { prefix = "", suffix = "", maxLines = 8, truncated = false, language = "", target = 0 } = {}) {
  const python = /python/i.test(language);
  const balance = (t) => bracketBalance(t, { python });
  let out = String(text || "");
  for (const s of FIM.stop) { const at = out.indexOf(s); if (at >= 0) out = out.slice(0, at); }
  // Cut by the token limit: the last line is half a line, before anything else is judged.
  if (truncated) { const nl = out.lastIndexOf("\n"); if (nl < 0) return ""; out = out.slice(0, nl); }
  const linePrefix = prefix.slice(prefix.lastIndexOf("\n") + 1);
  const lineSuffix = suffix.split("\n")[0];
  const atLineEnd = !lineSuffix.trim();
  // The cursor at the end of a line that already ends a statement ("return 0;", "{", "}", Python's
  // "def f():"): the model's line break is right. ("return { " with " };" after it is not an end.)
  const lineEnded = atLineEnd && (python ? /:\s*$/ : /[;{}]\s*$/).test(linePrefix);
  if (linePrefix.trim() && !lineEnded) out = out.replace(/^\s*\n\s*/, "");
  else if (lineEnded && !/^\s*\n/.test(out)) return "";
  // The cursor already sits indented on an empty line: the model's own line break and indent go.
  else if (linePrefix && !linePrefix.trim()) out = out.replace(/^[ \t]*\n/, "").replace(new RegExp(`^${linePrefix}`), "");
  if (!atLineEnd) {
    // Text after the cursor: one line, without what already follows it (");") when the brackets say
    // so ("setTimeout(resolve, ms)" keeps its own ")").
    // An object or a list the model wrote over several lines ("nome: nome,\n email: email,") goes on one.
    const parts = out.split("\n").map((l) => l.trim()).filter(Boolean);
    let n = 1;
    while (n < parts.length && /[,([{]$/.test(parts[n - 1])) n += 1;
    const one = (n > 1 ? parts.slice(0, n).join(" ") : out.split("\n")[0]).replace(/\s+$/, "");
    const tail = lineSuffix.trim();
    const options = [];
    for (let k = Math.min(tail.length, one.length); k > 0; k -= 1) if (one.endsWith(tail.slice(0, k))) options.push(one.slice(0, -k));
    options.push(one);
    const pick = target === null ? one : options.find((o) => balance(o) === target);
    return pick?.trim() ? pick : "";
  }
  let lines = out.split("\n");
  const blank = lines.findIndex((l, i) => i > 0 && !l.trim());
  if (blank > 0) lines = lines.slice(0, blank);
  // A line less indented than the cursor's line belongs to the code around it ("def main():" after the
  // function, the "});" that closes the caller's block): the suggestion ends before it.
  const base = /^[ \t]*/.exec(linePrefix)[0].replace(/\t/g, "    ").length;
  const outdent = lines.findIndex((l, i) => i > 0 && l.trim() && /^[ \t]*/.exec(l)[0].replace(/\t/g, "    ").length < base);
  if (outdent > 0) lines = lines.slice(0, outdent);
  lines = lines.slice(0, maxLines);
  // Brackets: the suggestion closes what it opens, plus what the file leaves open around the cursor
  // (target < 0: "app.get('/x', " waits for its ")"), and nothing of the code below it (that "}" is
  // already there). One that ends with a block still open goes back to the last whole line.
  // (target null: the file's own brackets do not match, so nothing can be judged by them.)
  const bal = () => balance(lines.join("\n"));
  while (target !== null && lines.length > 1 && bal() < target && /^\s*[)\]}][)\]};,]*\s*$/.test(lines.at(-1))) lines.pop();
  if (target !== null && Number.isNaN(bal())) return "";
  if (target !== null && bal() > target) {
    let depth = 0, whole = -1;
    lines.forEach((l, i) => { depth += balance(l); if (depth === target || (depth === 0 && whole < 0)) whole = i; });
    lines = whole >= 0 ? lines.slice(0, whole + 1) : [];
  }
  out = lines.join("\n").replace(/\s+$/, "");
  // The model often writes again the lines that already follow the cursor.
  const next = suffix.replace(/^[^\n]*\n?/, "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (next.length) {
    const kept = out.split("\n");
    // A short line ("}", ")") is a copy only when the line after it matches too: else it closes the
    // suggestion's own block.
    const at = kept.findIndex((l, i) => i > 0 && l.trim() && l.trim() === next[0] && (next[0].length > 3 || (next[1] !== undefined && kept[i + 1]?.trim() === next[1])));
    if (at > 0) out = kept.slice(0, at).join("\n").replace(/\s+$/, "");
  }
  return out.trim() ? out : "";
}

/** The gray suggestion at the cursor: { text, ms, engine }. Empty text when there is nothing good. */
export async function completeCode({ prefix = "", suffix = "", language = "", file = "" } = {}, { signal, env = process.env, generate = rawGenerate, check = syntaxProblem } = {}) {
  const before = String(prefix).slice(-PREFIX_CHARS), after = String(suffix).slice(0, SUFFIX_CHARS);
  if (!before.trim()) return { text: "", ms: 0 };
  const header = file ? `<|file_sep|>${String(file).replace(/\\/g, "/").split("/").slice(-2).join("/")}\n` : "";
  const multi = !after.split("\n")[0].trim();
  const started = Date.now();
  // What the whole file leaves open is what the suggestion must close; only known when the file came whole.
  const fileBalance = bracketBalance(`${before}\n${after}`, { python: /python/i.test(language) });
  const target = Number.isNaN(fileBalance) ? null : String(prefix).length <= PREFIX_CHARS && String(suffix).length <= SUFFIX_CHARS ? Math.min(0, -fileBalance) : 0;
  // Up to three tries: the first suggestion that compiles with the file around it wins (JavaScript and
  // Python; other languages take the first). An error far from the suggestion's lines is the file's own
  // (half-written code elsewhere) and does not count against it.
  const tries = [{ temperature: 0, header }, { temperature: 0.6, header: "" }, { temperature: 0.9, header }];
  const startLine = before.split("\n").length;
  let last = null;
  for (const t of tries) {
    const r = await generate(`${FIM.prefix}${t.header}${before}${FIM.suffix}${after}${FIM.middle}`, { maxTokens: multi ? 128 : 48, stop: FIM.stop, temperature: t.temperature, signal, env });
    last = r;
    const text = cleanCompletion(r.text, { prefix: before, suffix: after, maxLines: multi ? 8 : 1, truncated: r.truncated, language, target });
    if (!text) continue;
    const problem = await check(language, `${before}${text}${after}`, file);
    const endLine = startLine + text.split("\n").length;
    if (!problem || (problem.line && (problem.line < startLine - 1 || problem.line > endLine + 1))) return { text, ms: Date.now() - started, engine: r.engine, model: r.model, language };
    if (signal?.aborted) break;
  }
  return { text: "", ms: Date.now() - started, engine: last?.engine, model: last?.model, language };
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
/** The Ctrl+I prompt: the request, the code around, the selection (or the cursor). */
export function editPrompt({ instruction = "", selection = "", before = "", after = "", language = "", file = "", problem = "" } = {}) {
  const lang = String(language || "").trim();
  const name = String(file || "").replace(/\\/g, "/").split("/").pop();
  const sel = String(selection);
  return [
    "Você edita código dentro do editor. Responda SÓ com o código, num único bloco ```, sem explicação. Não acrescente nada que não foi pedido (exports, imports, exemplos de uso, testes): o resto do arquivo já existe.",
    sel.trim()
      ? `Reescreva o trecho selecionado conforme o pedido. Devolva o trecho inteiro já mudado (não só a parte nova), com a mesma indentação, e nada do que vem antes ou depois dele.`
      : `Escreva o código que vai no lugar do cursor (marcado como <CURSOR>), conforme o pedido, com a indentação do lugar.`,
    `Pedido: ${String(instruction).trim()}`,
    `Arquivo: ${name || "(sem nome)"}${lang ? ` (${lang})` : ""}`,
    `Código antes:\n\`\`\`${lang}\n${String(before).slice(-3000)}${sel.trim() ? "" : "<CURSOR>"}\n\`\`\``,
    ...(sel.trim() ? [`Trecho selecionado:\n\`\`\`${lang}\n${sel.slice(0, 12000)}\n\`\`\``] : []),
    `Código depois:\n\`\`\`${lang}\n${String(after).slice(0, 2000)}\n\`\`\``,
    ...(problem ? [`A sua resposta anterior não funcionou no arquivo: ${problem}\nCorrija e devolva o trecho inteiro de novo.`] : []),
  ].join("\n\n");
}

export async function editCode({ instruction = "", selection = "", before = "", after = "", language = "", file = "" } = {}, { signal, env = process.env, run = runLocal, check = checkSyntax } = {}) {
  const ask = String(instruction).trim();
  if (!ask) throw Object.assign(new Error("Diga o que mudar no código."), { status: 400 });
  const sel = String(selection);
  const lines = sel.split("\n").length;
  const opts = { ...env, LOCAL_TEMPERATURE: "0", LOCAL_MAX_OUTPUT_TOKENS: String(Math.min(4096, Math.max(512, lines * 40))) };
  // The file as it was: when it already does not compile, the answer is not judged by it.
  const judged = (await check(language, `${before}${sel}${sel && after ? "\n" : ""}${after}`, file)) === null;
  const same = (a, b) => String(a).replace(/\s+/g, " ").trim() === String(b).replace(/\s+/g, " ").trim();
  const started = Date.now();
  let result = null, problem = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await run(editPrompt({ instruction: ask, selection: sel, before, after, language, file, problem }), attempt ? { ...opts, LOCAL_TEMPERATURE: "0.5" } : opts, signal);
    if (!r.ok) throw Object.assign(new Error(r.error || "O modelo local não respondeu."), { status: r.cancelled ? 499 : 502 });
    const code = cleanEdit(r.text, { selection: sel, before, after, language });
    result = { code, model: r.metrics?.model || null, attempts: attempt + 1 };
    // The snippet back as it was ("troque o for por reduce" answered with the same for): not done.
    problem = sel.trim() && same(code, sel) ? "você devolveu o trecho igual, sem aplicar o pedido" : judged ? await check(language, `${before}${code}${after ? "\n" : ""}${after}`, file) : null;
    if (!problem) break;
    result.problem = problem;
  }
  // A second look by the same model: does the code do what was asked, the cases the request names
  // included? Its fix is taken only when it compiles and is not the selection again.
  if (!result.problem && env.CODE_EDIT_REVIEW !== "off") {
    const r = await run(reviewPrompt({ instruction: ask, code: result.code, language, selection: sel }), opts, signal);
    if (r.ok && /```/.test(r.text) && !/^\s*OK\b/i.test(r.text)) {
      const fixed = cleanEdit(r.text, { selection: sel, before, after, language });
      const bad = !fixed.trim() || same(fixed, result.code) || (sel.trim() && same(fixed, sel)) || (judged && (await check(language, `${before}${fixed}${after ? "\n" : ""}${after}`, file)));
      if (!bad) { result.code = fixed; result.reviewed = true; }
    }
  }
  result.ms = Date.now() - started;
  return result;
}

/** The second look of Ctrl+I: OK, or the snippet corrected. */
export function reviewPrompt({ instruction = "", code = "", language = "", selection = "" } = {}) {
  const lang = String(language || "").trim();
  return [
    "Revise uma edição de código. Responda só OK se ela está certa; senão, responda só com o trecho corrigido inteiro num bloco ```.",
    `Pedido: ${String(instruction).trim()}`,
    ...(String(selection).trim() ? [`Código antes:\n\`\`\`${lang}\n${String(selection).slice(0, 8000)}\n\`\`\``] : []),
    `Código depois:\n\`\`\`${lang}\n${String(code).slice(0, 8000)}\n\`\`\``,
    "Confira: o código depois faz TUDO o que o pedido diz, nos casos que o pedido cita (lista vazia, null/undefined, valores que não são números, maiúsculas, pontuação, espaços…)? E continua fazendo o que o código antes fazia nos outros casos? Imagine uma entrada de cada caso e siga o código linha por linha.",
  ].join("\n\n");
}

/** What the model answered, as the snippet that replaces the selection. */
export function cleanEdit(text, { selection = "", before = "", after = "", language = "" } = {}) {
  const sel = String(selection);
  let code = codeOf(text).replace(/^(?:[ \t]*\n)+/, "");
  // A model that copied the lines around the snippet into its answer: only the snippet stays.
  const tailBefore = new Set(String(before).split("\n").map((l) => l.trim()).filter(Boolean).slice(-5));
  const inSelection = new Set(sel.split("\n").map((l) => l.trim()));
  let lines_ = code.split("\n");
  while (lines_.length > 1 && (!lines_[0].trim() || (tailBefore.has(lines_[0].trim()) && !inSelection.has(lines_[0].trim())))) lines_ = lines_.slice(1);
  // A line of what follows the selection (the export below it, the next function): from there on it is a copy.
  const later = new Set(String(after).split("\n").slice(0, 60).map((l) => l.trim()).filter((l) => l.length > 3 && !inSelection.has(l)));
  const cut = lines_.findIndex((l, i) => i > 0 && later.has(l.trim()));
  if (cut > 0) lines_ = lines_.slice(0, cut);
  code = lines_.join("\n").replace(/\s+$/, "");
  // The selection's own indentation, when the model lost it.
  const indent = /^[ \t]*/.exec(sel.split("\n").find((l) => l.trim()) || "")?.[0] || "";
  if (indent && code.split("\n").filter((l) => l.trim()).every((l) => !/^[ \t]/.test(l))) code = code.split("\n").map((l) => (l.trim() ? indent + l : l)).join("\n");
  // Brackets: the snippet closes what the selection closed, no more (a "}" of the loop around it,
  // closed again by the model, would break the file).
  if (!/python/i.test(language)) {
    const want = bracketBalance(sel);
    const out = code.split("\n");
    while (out.length > 1 && bracketBalance(out.join("\n")) < want && /^\s*[)\]}][)\]};,]*\s*$/.test(out.at(-1))) out.pop();
    code = out.join("\n");
  }
  return code;
}

/** Openers minus closers, outside strings and line comments. */
export function bracketBalance(text, { python = false } = {}) {
  // A stack by type: "[ ... )" is not balanced, it is broken (NaN, which matches no target).
  const stack = [];
  let depth = 0;
  const pair = { ")": "(", "]": "[", "}": "{" };
  for (const line of String(text).split("\n")) {
    let quote = null;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (python ? c === "#" : c === "/" && line[i + 1] === "/") break;
      if ("{([".includes(c)) { depth += 1; stack.push(c); }
      else if ("})]".includes(c)) {
        depth -= 1;
        // A closer of what came before this text (the file's own opener) has no type to check.
        if (stack.length && stack.pop() !== pair[c]) return NaN;
      }
    }
  }
  return depth;
}

let pythonOk = null;
/**
 * Does this code compile? null when it does (or when there is no way to tell: TypeScript, other
 * languages, no Python on the PC), else the error's first line. JavaScript with node --check, Python
 * with ast.parse; both in a child process with a short timeout.
 */
export async function checkSyntax(language, text, file = "") {
  return (await syntaxProblem(language, text, file))?.message || null;
}

/** The syntax error of the code: { message, line } (line 1-based, null when unknown), or null. */
export async function syntaxProblem(language, text, file = "") {
  const lang = String(language || "").toLowerCase();
  const js = /^(javascript|javascriptreact)$/.test(lang) || (!lang && /\.(c|m)?jsx?$/i.test(file));
  const py = lang === "python" || (!lang && /\.py$/i.test(file));
  if (!js && !py) return null;
  const { execFile } = await import("node:child_process");
  const run = (cmd, args, input, env) => new Promise((done) => {
    const child = execFile(cmd, args, { timeout: 8000, windowsHide: true, env }, (error, _out, stderr) => done(error ? String(stderr || error.message) : null));
    child.stdin?.end(input);
  });
  if (js) {
    // node --check reads stdin with --input-type; module syntax (import/export) tried when CommonJS fails.
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    let err = await run(process.execPath, ["--check", "--input-type=commonjs", "-"], text, env);
    if (err && /import|export/.test(err)) err = await run(process.execPath, ["--check", "--input-type=module", "-"], text, env);
    if (!err) return null;
    return { message: (/SyntaxError[^\n]*/.exec(err)?.[0] || err.split("\n").find((l) => l.trim()) || "erro de sintaxe").slice(0, 200), line: Number(/\[stdin\]:(\d+)/.exec(err)?.[1]) || null };
  }
  // Python on this PC, asked once (a syntax error never turns the check off).
  pythonOk ??= await new Promise((done) => execFile("python", ["--version"], { timeout: 5000, windowsHide: true }, (error, out, err) => done(!error && /Python 3/.test(`${out}${err}`))));
  if (!pythonOk) return null;
  const err = await run("python", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], text, process.env);
  if (!err) return null;
  return { message: (/(SyntaxError|IndentationError)[^\n]*/.exec(err)?.[0] || "erro de sintaxe").slice(0, 200), line: Number(/line (\d+)/.exec(err)?.[1]) || null };
}
