// The unified engine: the local Aurora first; when it fails or cannot do the task, Claude or Codex do it for
// real (files in the project folder), whichever still has usage left; with both out of their limits the local
// answer stays and says so. 15/10: from the phone, the local model could not draw a chart in 40 minutes and
// said it was impossible; the strong models, set up on the same computer, only reviewed it.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveCli } from "./cliRuntime.js";
import { listApiEngines, runApiEngine } from "./apiEngines.js";
import { buildMirror, codeChanges, leaks, MIRROR_MANIFEST, MIRROR_SCRIPT, pseudonymize, restoreScript, unfake } from "./mirror.js";
import { runClaudeAgent } from "./claude.js";
import { runCodexAgent } from "./codex.js";
import { getSetting, setSetting } from "./store.js";
import { detectSignals, requestsFile, WRITE_TOOLS } from "./teacher.js";

export const ENGINES = { claude: { label: "Claude", run: runClaudeAgent }, codex: { label: "Codex", run: runCodexAgent } };
const DEFAULT_ORDER = ["claude", "codex"];

// The engines set up with an API key (app/apiEngines.js) join the CLIs here, under their own ids ("api-…"):
// everything that hands work to an engine (active help, escalation, agents, the Office) sees them all.
export async function refreshApiEngines() {
  const configured = await listApiEngines().catch(() => []);
  for (const id of Object.keys(ENGINES)) if (ENGINES[id].api && !configured.some((e) => e.id === id)) delete ENGINES[id];
  for (const cfg of configured) ENGINES[cfg.id] = { label: cfg.label, api: true, configured: Boolean(cfg.apiKey || (cfg.kind === "openai" && cfg.baseUrl)), run: (prompt, opts) => runApiEngine(cfg, prompt, opts) };
  return ENGINES;
}
/** The order engines are tried in: the CLIs first (their subscription), then the API ones. */
export const engineOrder = () => [...DEFAULT_ORDER, ...Object.keys(ENGINES).filter((id) => !DEFAULT_ORDER.includes(id))];
const DEFAULT_COOLDOWN_MS = 60 * 60_000;
const MAX_COOLDOWN_MS = 7 * 24 * 60 * 60_000;

/** A usage or quota limit in a CLI's error (not a plain failure, which the next engine also gets). */
export const OUT_OF_LIMIT = /usage limit|hit your (usage )?limit|limit reached|rate.?limit|quota|credit balance|insufficient_quota|too many requests|\b429\b|limite de uso|out of (credits|tokens)|upgrade to (pro|plus|max)|session limit|weekly limit|5-hour limit/i;

/** When a limit ends, from the CLI's own words; an hour when it does not say. */
export function limitResetAt(message, now = Date.now()) {
  const text = String(message || "");
  const unix = text.match(/\|(\d{10})\b/);
  if (unix) return Math.min(Number(unix[1]) * 1000, now + MAX_COOLDOWN_MS);
  const after = text.match(/(?:try again|tente (?:de novo|novamente)|again) in ((?:\d+\s*(?:days?|dias?|hours?|horas?|h|minutes?|minutos?|min|m)\b[\s,e]*)+)/i);
  if (after) {
    let ms = 0;
    for (const [, n, unit] of after[1].matchAll(/(\d+)\s*(days?|dias?|hours?|horas?|h|minutes?|minutos?|min|m)\b/gi)) ms += Number(n) * (/^d/i.test(unit) ? 864e5 : /^h/i.test(unit) ? 36e5 : 6e4);
    if (ms) return now + Math.min(ms, MAX_COOLDOWN_MS);
  }
  const clock = text.match(/resets?(?: at)? (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (clock) {
    let h = Number(clock[1]) % 12 + (clock[3]?.toLowerCase() === "pm" ? 12 : clock[3] ? 0 : Number(clock[1]) >= 12 ? 12 : 0);
    if (!clock[3]) h = Number(clock[1]);
    const at = new Date(now); at.setHours(h, Number(clock[2] || 0), 0, 0);
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  return now + DEFAULT_COOLDOWN_MS;
}

async function readLimits() { try { return JSON.parse((await getSetting("engine_limits")) || "{}") || {}; } catch { return {}; } }

/** Marks an engine as out of its limit until `until` (ms). */
export async function markLimited(engine, until, reason = "") {
  const limits = await readLimits();
  limits[engine] = { until, reason: String(reason).slice(0, 200) };
  await setSetting("engine_limits", JSON.stringify(limits));
}

/** Each strong engine now: installed, and whether (and until when) it is out of its limit. */
export async function engineStatus({ env = process.env, now = Date.now() } = {}) {
  await refreshApiEngines();
  const limits = await readLimits();
  return Object.fromEntries(Object.keys(ENGINES).map((id) => {
    const limit = limits[id] && limits[id].until > now ? limits[id] : null;
    return [id, { label: ENGINES[id].label, api: Boolean(ENGINES[id].api), installed: ENGINES[id].api ? ENGINES[id].configured : resolveCli(id, env).installed, limitedUntil: limit?.until || null, reason: limit?.reason || null }];
  }));
}

/**
 * On by default in the app; "off" in Configurações or AURORA_ESCALATION=off. The batteries and tests run on a
 * database in the temp folder and measure the local model: there it is off unless AURORA_ESCALATION=on (an
 * evaluation calling Claude would spend the person's limit and mix the scores).
 */
export async function escalationOn(env = process.env) {
  if (env.AURORA_ESCALATION === "off") return false;
  const db = env.HARNESS_DB_FILE || process.env.HARNESS_DB_FILE || "";
  if (env.AURORA_ESCALATION !== "on" && db && resolve(db).toLowerCase().startsWith(resolve(tmpdir()).toLowerCase())) return false;
  return (await getSetting("escalation_mode")) !== "off";
}

const CANNOT = /\b(n[ãa]o (é|seria|foi) poss[íi]vel|n[ãa]o consigo|n[ãa]o consegui|n[ãa]o (tenho|h[áa]) como|n[ãa]o d[áa] para|n[ãa]o (é|est[áa]) suportad|sem suporte|infelizmente|n[ãa]o posso (criar|gerar|fazer|inserir))\b/i;

/**
 * Why the local answer needs a strong engine, or null: it gave up or called the task impossible, actions
 * failed and stayed failed, it ran out of steps or repeated itself, it claimed a file nothing wrote, a file
 * was asked and none was written, or the person complained about the last answer.
 */
export function escalationReason({ request, result, history = [] }) {
  if (!result) return null;
  // Small talk is not a task: "oi, o que você consegue fazer?" went to Claude because the local answer listed
  // what it cannot do (20/10).
  if (CHAT_ONLY.test(String(request || "")) && !requestsFile(request)) return null;
  if (!result.ok) return result.cancelled ? null : `o modelo local falhou (${String(result.error || "erro").slice(0, 120)})`;
  const signals = detectSignals({ userMessage: request, result, history }).filter((s) => s.code !== "copies_disagree");
  if (signals.length) return signals.map((s) => s.detail).join("; ").slice(0, 400);
  if (CANNOT.test(String(result.text || "").slice(0, 1500))) return "a resposta local diz que não é possível fazer";
  const wrote = (result.steps || []).some((s) => s.ok && WRITE_TOOLS.has(s.tool));
  if (requestsFile(request) && !wrote) return "o pedido é um arquivo e o modelo local não gravou nenhum";
  if ((result.checks || []).some((c) => /_final$|^dispatch$/.test(c.check))) return "a conferência da entrega não fechou";
  return null;
}

/** Files under `dir` (a few levels, no node_modules/.git) with their modification times. */
function snapshot(dir, depth = 4, out = new Map()) {
  if (depth < 0 || out.size > 5000) return out;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "__pycache__") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) snapshot(p, depth - 1, out);
    else if (e.isFile()) { try { out.set(p, statSync(p).mtimeMs); } catch { /* gone */ } }
  }
  return out;
}

export function executorPrompt({ task, reason, workspace, history = [] }) {
  const recent = history.filter((m) => ["user", "assistant"].includes(m.role) && m.provider !== "Sistema").slice(-6)
    .map((m) => `${m.role === "user" ? "Pessoa" : "Aurora"}: ${String(m.content || "").slice(0, 600)}`).join("\n");
  return [
    "Você está ajudando a Aurora, a assistente local desta pessoa, a terminar uma tarefa que ela não conseguiu sozinha.",
    reason ? `Por que a Aurora local não conseguiu: ${reason}.` : "A pessoa pediu que você fizesse esta tarefa.",
    `Faça a tarefa de verdade, nesta pasta: ${workspace}. Crie aqui os arquivos pedidos (pode escrever e rodar Python: python-pptx para apresentações com gráficos nativos, openpyxl para planilhas, matplotlib para imagens; instale com pip se faltar).`,
    "Use os dados reais dos arquivos da pasta e da conversa; nunca invente números. Não apague nem altere arquivos que já existiam, a não ser que a tarefa peça.",
    "Antes de responder, abra o que criou e confira que está certo (os gráficos existem, os números batem).",
    "Responda em português do Brasil, curto e direto, para a pessoa: o que entregou e o caminho completo de cada arquivo. Se algo não puder ser feito, diga o motivo concreto.",
    recent ? `\nConversa recente:\n${recent}` : "",
    `\nTarefa: ${task}`,
  ].join("\n");
}

/**
 * When a strong engine helps: "ativa" (default, 20/10) — a task it does better (a file to deliver, a chart, an
 * analysis of the project's spreadsheets) goes to it first, blind, and the local Aurora stays as the fallback;
 * "quando_falha" — only after the local answer fails (as on 15/10).
 */
export const HELP_MODES = ["ativa", "quando_falha"];
export async function helpMode(env = process.env) {
  const value = env.AURORA_PAID_HELP || (await getSetting("paid_help"));
  return HELP_MODES.includes(value) ? value : "ativa";
}

export const DEFAULT_ENGINE_DAILY_LIMIT = 40;
const today = () => new Date().toISOString().slice(0, 10);
/** Strong-engine calls today and the daily cap (Configurações), shared by the active help and the escalation. */
export async function engineBudget() {
  const raw = await getSetting("engine_daily_limit");
  const limit = raw === null || raw === "" ? NaN : Number(raw);
  let usage = { date: today(), count: 0 };
  try { const saved = JSON.parse(await getSetting("engine_usage")); if (saved?.date === today()) usage = saved; } catch { /* first use */ }
  return { dailyLimit: Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_ENGINE_DAILY_LIMIT, usedToday: usage.count };
}
async function spendEngineCall() {
  const { usedToday } = await engineBudget();
  await setSetting("engine_usage", JSON.stringify({ date: today(), count: usedToday + 1 }));
}

/** Whether `dir` has a file matching `pattern` within two levels (by default a spreadsheet). */
export function hasTables(dir, pattern = /\.(csv|tsv|xlsx|xlsm)$/i) {
  if (!dir) return false;
  const look = (d, depth) => {
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return false; }
    return entries.some((e) => (e.isFile() && pattern.test(e.name)) || (depth > 0 && e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && look(join(d, e.name), depth - 1)));
  };
  return look(dir, 2);
}
export const hasCode = (dir) => hasTables(dir, /\.(py|js|mjs|cjs|ts|tsx|jsx|java|cs|go|rs|php|rb|kt|c|cpp|sql|ps1|sh)$/i);

const VISUAL = /\b(gr[áa]fic[oa]s?|dashboards?|painel|pain[ée]is|infogr[áa]fico|visualiza[çc][ãa]o)\b/i;
const ANALYSIS = /\b((quem|qual|quais)\b.{0,50}\b(mais|menos)\b|melhor(es)?|pior(es)?|quant[oa]s?|total|totais|soma[rs]?|m[ée]dias?|maior(es)?|menor(es)?|ranking|top \d+|compar[ae]|tend[êe]ncia|crescimento|queda|previs[ãa]o|projet[ae]|percentua(l|is)|por (m[êe]s|ano|regi[ãa]o|cliente|produto|vendedor|categoria|setor|loja|filial)|analis[ae]|an[áa]lise)\b/i;
const CODE_TASK = /\b(corrij[ae]|conserte|consertar|bug|erro no (c[óo]digo|script|programa)|refator[ae]|implemente|implementar|adicione (uma |um )?(fun[çc][ãa]o|m[ée]todo|rota|endpoint|tela|teste)|crie (os )?testes|testes? unit[áa]rios?|otimiz[ae] o c[óo]digo)\b/i;
// "Agora em azul", "acrescente abril", "tire a legenda": a change to what was just delivered.
const FOLLOW_UP = /\b(mud[ae]|troqu?e|troca|altere|coloqu?e|coloca|adicione|acrescente|inclua|tire|remova|aumente|diminua|deixe|refa[çz]a|corrija|agora|tamb[ée]m|em vez|ao inv[ée]s)\b/i;
// "Escreva uma carta de cobrança em .docx" was not seen as a file (20/10): a verb of making plus a document.
const DELIVERABLE = /\b(escrev[ae]|redija|elabore|crie|cri[ae]r|fa[çz]a|gere|gerar|monte|montar|prepare|produza|desenhe|exporte|converta)\b.{0,80}(\.(docx|xlsx|pptx|pdf|png|jpg|svg|csv|html)\b|\b(carta|of[íi]cio|relat[óo]rio|apresenta[çc][ãa]o|slides?|planilha|documento|proposta|or[çc]amento|contrato|ata|memorando|comunicado|certificado|recibo|declara[çc][ãa]o|imagem|p[áa]gina|site)\b)/i;
export const CHAT_ONLY = /^\s*(oi|ol[áa]|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|ok|beleza|tudo bem)\b/i;

/**
 * Why a strong engine should do this request first, or null for the local Aurora: a file to deliver (deck,
 * sheet, document, chart, page, script), a chart or dashboard, or an analysis of the project's spreadsheets.
 * Chat, questions about the company's documents and small talk stay local.
 */
export function proactiveFit({ request, hasTables: tables = false, hasCode: code = false, followsEngine = false }) {
  const text = String(request || "").trim();
  if (followsEngine && text.length >= 6 && FOLLOW_UP.test(text)) return "continua a entrega anterior do modelo forte";
  if (text.length < 12 || CHAT_ONLY.test(text)) return null;
  if (requestsFile(text) || DELIVERABLE.test(text)) return "é uma entrega de arquivo";
  if (VISUAL.test(text)) return "pede um gráfico ou painel";
  if (tables && ANALYSIS.test(text)) return "é uma análise das planilhas do projeto";
  if (code && CODE_TASK.test(text)) return "é uma tarefa no código do projeto";
  return null;
}

/**
 * How much of the project a paid engine may see: "espelho" (default) — only the synthetic mirror, its script
 * runs here; "livre" — the real folder, as before 19/10.
 */
export const PRIVACY_MODES = ["espelho", "livre"];
export async function privacyMode(env = process.env) {
  const value = env.AURORA_PAID_PRIVACY || (await getSetting("paid_privacy"));
  return PRIVACY_MODES.includes(value) ? value : "espelho";
}

// In the Aurora's past answers the numbers were computed here from the real data (totals, counts): they go
// as "[número]". The person's own numbers stay — in a request they are the task's parameters.
const maskNumbers = (text) => String(text).replace(/\d[\d.,]{2,}/g, "[número]");

export function mirrorPrompt({ task, reason, mirrorDir, history = [], map, previous = null, context = [] }) {
  const recent = history.filter((m) => ["user", "assistant"].includes(m.role) && m.provider !== "Sistema").slice(-6)
    .map((m) => {
      const text = pseudonymize(String(m.content || "").slice(0, 600), map, { names: true }).text;
      return m.role === "user" ? `Pessoa: ${text}` : `Aurora: ${maskNumbers(text)}`;
    }).join("\n");
  return [
    reason ? "Você está ajudando a Aurora, a assistente local desta pessoa, a terminar uma tarefa que ela não conseguiu sozinha." : "Você trabalha junto com a Aurora, a assistente local desta pessoa: ela passou esta tarefa para você.",
    reason ? `Por que a Aurora local não conseguiu: ${pseudonymize(reason, map, { names: true }).text}.` : "",
    context.length ? `Também nesta pasta, com informação verdadeira (não é dado da empresa): ${context.join(", ")}. Use o que está lá; não invente números.` : "",
    previous ? `Este pedido continua uma entrega anterior sua: o script que você escreveu está em ${PREVIOUS_SCRIPT} (pedido de então: "${previous.task}"). Parta dele e grave o novo ${MIRROR_SCRIPT} com a mudança pedida.` : "",
    `Os dados da empresa não podem sair do computador. Esta pasta (${mirrorDir}) é um ESPELHO da pasta do projeto: as planilhas têm as colunas, os tipos e os formatos reais, mas os valores e os nomes são falsos. Veja ${MIRROR_MANIFEST} (o que existe na pasta real e quantas linhas cada planilha tem lá).`,
    "Se a tarefa é mudar o código do projeto (corrigir, implementar, refatorar, testar), edite os arquivos de código aqui mesmo: são cópias dos reais em que nomes, identificadores e chaves viraram marcas como [NOME 1] ou [SEGREDO 1]. Mantenha as marcas como estão; a Aurora aplica as suas mudanças na pasta real, com os valores verdadeiros. Nesse caso não precisa de script.",
    `Para o resto (arquivos a partir dos dados, análises, perguntas), entregue um script Python: grave ${MIRROR_SCRIPT} nesta pasta. Ele vai rodar na pasta real, com os mesmos nomes de arquivo (caminhos relativos à pasta atual), e deve gravar ali os arquivos pedidos. Se a tarefa for uma pergunta, o script imprime a resposta (print) em português.`,
    "Nada de valores fixos tirados das planilhas: tudo vem dos arquivos (a pasta real tem outros valores e mais linhas). Um valor citado no pedido, como \"Cliente 3\", pode ficar no script: ele é trocado pelo real antes de rodar.",
    // 20/10: "há quantos dias" counted from the computer's clock, not the Aurora's; a sheet came with only
    // formulas, which Power BI and the Aurora read as "=C2-B2".
    `Hoje, para a Aurora, é ${auroraToday()}: o script lê essa data da variável de ambiente AURORA_HOJE (formato AAAA-MM-DD) e nunca usa date.today() nem datetime.now().`,
    "Números brasileiros: \"980.000\" e \"2.800.000\" são milhares (ponto separa milhar, vírgula separa decimal). Nas planilhas que gravar, escreva os valores já calculados nas células (pode somar no Python); nada de fórmulas no lugar dos números.",
    `Use python-pptx para apresentações (gráficos nativos), openpyxl para planilhas, matplotlib para imagens; instale com pip se faltar. Rode o script aqui no espelho com exatamente "python ${MIRROR_SCRIPT}" (sem cd nem outros comandos antes) e confira o que ele gera antes de responder.`,
    "Responda em português do Brasil, em até 3 frases, o que o script faz e quais arquivos ele grava, sem citar valores do espelho (eles são falsos). Se a tarefa precisar ler o conteúdo de um documento que só está listado, ou não puder virar script, responda só PRECISA_DO_CONTEUDO e o motivo.",
    recent ? `\nConversa recente (nomes e documentos trocados por marcas):\n${recent}` : "",
    `\nTarefa: ${pseudonymize(task, map, { names: true }).text}`,
  ].filter(Boolean).join("\n");
}

// The last script a strong engine delivered for a folder, kept here (settings), as it ran on the real data:
// a follow-up ("agora em azul") is blinded again with that turn's mirror, so the marks always agree.
export const PREVIOUS_SCRIPT = "aurora_tarefa_anterior.py";
const lastScriptKey = (workspace) => `engine_last_script:${resolve(workspace).toLowerCase()}`;
export async function lastScript(workspace) {
  try { return JSON.parse((await getSetting(lastScriptKey(workspace))) || "null"); } catch { return null; }
}

/** Today as the Aurora sees it (HARNESS_NOW pins it in the batteries), AAAA-MM-DD in local time. */
export function auroraToday(env = process.env) {
  const now = env.HARNESS_NOW ? new Date(env.HARNESS_NOW) : new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const PYTHONS = [["python", []], ["py", ["-3"]]];
/** `script` run with cwd `dir`: { ok, stdout, stderr }; python first, then the py launcher. */
export function runPython(script, dir, { timeoutMs = 5 * 60_000, signal } = {}) {
  const attempt = (i) => new Promise((done) => {
    const [cmd, pre] = PYTHONS[i];
    execFile(cmd, [...pre, script], { cwd: dir, timeout: timeoutMs, windowsHide: true, signal, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", AURORA_HOJE: auroraToday() } }, (error, stdout, stderr) => {
      if (error?.code === "ENOENT" && i + 1 < PYTHONS.length) return done(attempt(i + 1));
      done({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || error?.message || "") });
    });
  });
  return attempt(0);
}

/** Writes each change inside `workspace` (never outside it); returns the real paths written. */
function applyCodeChanges(edits, workspace) {
  const root = resolve(workspace);
  const written = [];
  for (const edit of edits) {
    const target = resolve(root, edit.path);
    if (!target.toLowerCase().startsWith(root.toLowerCase())) continue;
    try { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, edit.content, "utf8"); written.push(target); } catch { /* skipped */ }
  }
  return written;
}

/**
 * One engine on the mirror: it writes the script there, the script runs on the real folder (fakes back to real
 * values), one repair round with the error pseudonymized. Returns the engine's answer plus { script, ran }.
 */
async function runOnMirror({ id, task, reason, history, workspace, env, signal, onStage, run, now, followUp = false, approveRun = null, timeoutMs, context = [] }) {
  const mirror = buildMirror(workspace);
  try {
    // Context that is not the company's (the Aurora's own version history) goes as files next to the mirror.
    for (const c of context) writeFileSync(join(mirror.dir, c.name), pseudonymize(c.text, mirror.map, { names: true }).text, "utf8");
    const before = followUp ? await lastScript(workspace) : null;
    const previous = before && !leaks(pseudonymize(before.script, mirror.map, { names: true }).text, mirror.map).length ? { task: pseudonymize(before.task, mirror.map, { names: true }).text.slice(0, 300) } : null;
    const blindPrevious = before ? pseudonymize(before.script, mirror.map, { names: true }).text : "";
    // A previous script still holding a real value is left out (the engine starts over), never sent.
    if (before && !leaks(blindPrevious, mirror.map).length) writeFileSync(join(mirror.dir, PREVIOUS_SCRIPT), blindPrevious, "utf8");
    const prompt = mirrorPrompt({ task, reason, mirrorDir: mirror.dir, history, map: mirror.map, previous, context: context.map((c) => c.name) });
    const leaked = leaks(prompt, mirror.map);
    if (leaked.length) return { ok: false, error: `o pedido ainda tinha ${leaked.length} valor(es) da pasta real; nada foi enviado` };
    const call = (text) => (run ? run(id, text, { cwd: mirror.dir, env, signal, mirror }) : ENGINES[id].run(text, { cwd: mirror.dir, env, signal, timeoutMs }));
    // The engine's words as the person reads them: real names back, and no link into the mirror (it is deleted
    // right after; Codex linked its aurora_tarefa.py there, 20/10).
    const mirrorPath = new RegExp(mirror.dir.replace(/[\\/]/g, "[\\\\/]").replace(/[.*+?^${}()|]/g, "\\$&") + "[^\\s)\\]`'\"]*", "gi");
    const shown = (text) => unfake(String(text || "").replace(/\[([^\]]+)\]\((?:file:\/\/\/?)?[^)]*aurora-espelho-[^)]*\)/gi, "$1").replace(mirrorPath, "(no espelho)"), mirror.map);
    // Manual mode: what the engine made changes the folder only with the person's yes (like any local change).
    const allowed = async (summary, detail) => !approveRun || await approveRun({ tool: "engine", summary, detail: String(detail).slice(0, 1500) });
    let answer = await call(prompt);
    if (!answer.ok || signal?.aborted) return answer;
    if (/PRECISA_DO_CONTEUDO/.test(answer.text)) return { ...answer, ok: false, needsContent: true, error: answer.text.replace(/PRECISA_DO_CONTEUDO[:\s-]*/, "").trim().slice(0, 300) };
    const scriptPath = join(mirror.dir, MIRROR_SCRIPT);
    // Code the engine edited in the mirror goes to the real folder with the real values back; a task that was
    // only code (no script) ends here.
    const edits = codeChanges(mirror, { withNew: !existsSync(scriptPath) });
    if (edits.length && !(await allowed(`Aplicar as mudanças do ${ENGINES[id].label} em ${edits.length} arquivo(s) de código`, edits.map((e) => `${e.isNew ? "novo" : "alterado"}: ${e.path}`).join("\n")))) return { ok: false, error: "você não autorizou aplicar as mudanças no código" };
    const applied = applyCodeChanges(edits, workspace);
    if (!existsSync(scriptPath) && applied.length) return { ...answer, text: shown(answer.text), ran: { ok: true, stdout: "", stderr: "" }, codeFiles: applied };
    for (let round = 0; round < 2; round += 1) {
      if (!existsSync(scriptPath)) return { ...answer, ok: false, error: `o ${ENGINES[id].label} não gravou ${MIRROR_SCRIPT}` };
      const { code, restored } = restoreScript(readFileSync(scriptPath, "utf8"), mirror.map);
      const realScript = join(mirror.dir, `_real_${MIRROR_SCRIPT}`);
      writeFileSync(realScript, code, "utf8");
      if (round === 0 && !(await allowed(`Rodar nesta pasta o programa que o ${ENGINES[id].label} escreveu`, code))) return { ok: false, error: "você não autorizou rodar o programa" };
      onStage(`A Aurora está rodando aqui o script do ${ENGINES[id].label}, nos dados reais…`);
      const ran = await runPython(realScript, workspace, { signal });
      if (ran.ok) await setSetting(lastScriptKey(workspace), JSON.stringify({ task: String(task).slice(0, 600), script: code, at: now() })).catch(() => {});
      if (ran.ok || signal?.aborted || round === 1) return { ...answer, text: shown(answer.text), ran, restored, codeFiles: applied };
      onStage(`O script falhou nos dados reais; o ${ENGINES[id].label} está corrigindo…`);
      const error = pseudonymize((ran.stderr || ran.stdout).slice(-3000), mirror.map, { names: true }).text;
      answer = await call(`O ${MIRROR_SCRIPT} rodou na pasta real e falhou com este erro (valores reais trocados por marcas):\n${error}\n\nCorrija ${MIRROR_SCRIPT} nesta pasta (lembre: a pasta real tem outros valores e mais linhas), rode de novo aqui e responda como antes.`);
      if (!answer.ok) return answer;
    }
    return answer;
  } finally {
    try { rmSync(mirror.dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

/**
 * The task done by the first strong engine that can: in `order`, skipping the ones not installed or out of
 * their limit, marking one that answers with a usage limit and going on to the next. With `privacy` "espelho"
 * the engine only sees the synthetic mirror and its script runs here. Returns { ok, engine, label, text,
 * files, steps } on success; { ok: false, tried, limited, allLimited, needsContent? } otherwise.
 */
export async function escalate({ task, reason = "", history = [], workspace, order = null, env = process.env, signal, onStage = () => {}, run = null, now = () => Date.now(), privacy = "livre", proactive = false, followUp = false, approveRun = null, timeoutMs, context = [] }) {
  const status = await engineStatus({ env, now: now() });
  order = (order || engineOrder()).filter((id) => ENGINES[id]);
  const tried = [];
  const limited = [];
  for (const id of order.filter((x) => ENGINES[x])) {
    const s = status[id];
    if (!run && !s.installed) { tried.push(`${ENGINES[id].label}: não instalado`); continue; }
    if (s.limitedUntil) { limited.push({ id, until: s.limitedUntil }); continue; }
    const budget = await engineBudget();
    if (budget.usedToday >= budget.dailyLimit) return { ok: false, tried, limited, budget: true };
    await spendEngineCall();
    onStage(proactive ? `A Aurora está fazendo com o ${ENGINES[id].label}${privacy === "espelho" ? ", sem enviar seus dados" : ""}…` : `A Aurora pediu ajuda ao ${ENGINES[id].label}…`);
    const before = snapshot(workspace);
    const started = now();
    const answer = privacy === "espelho"
      ? await runOnMirror({ id, task, reason, history, workspace, env, signal, onStage, run, now, followUp, approveRun, timeoutMs, context })
      : await (run ? run(id, executorPrompt({ task, reason, workspace, history }), { cwd: workspace, env, signal }) : ENGINES[id].run(executorPrompt({ task, reason, workspace, history }), { cwd: workspace, env, signal }));
    if (signal?.aborted) return { ok: false, tried, limited, cancelled: true };
    // A task that needs the documents' content does not go to the next engine either: it would see the same mirror.
    if (answer.needsContent) return { ok: false, tried, limited, needsContent: true, why: answer.error, engine: id };
    if (!answer.ok) {
      if (OUT_OF_LIMIT.test(answer.error || "")) {
        const until = limitResetAt(answer.error, now());
        await markLimited(id, until, answer.error);
        limited.push({ id, until });
      } else tried.push(`${ENGINES[id].label}: ${String(answer.error || "falhou").slice(0, 160)}`);
      continue;
    }
    const after = snapshot(workspace);
    const files = [...after].filter(([p, t]) => !before.has(p) || before.get(p) !== t).filter(([, t]) => t >= started - 2000).map(([p]) => p).slice(0, 20);
    const steps = files.map((p) => ({ tool: "write_file", ok: true, by: id, args: { path: p }, summary: `Criei ${p} (pelo ${ENGINES[id].label}${privacy === "espelho" ? ", script rodado aqui" : ""}).` }));
    if (privacy !== "espelho") return { ok: true, engine: id, label: ENGINES[id].label, text: answer.text, files, steps, ms: now() - started };
    if (!answer.ran?.ok) { tried.push(`${ENGINES[id].label}: o script falhou nos dados reais (${(answer.ran?.stderr || "").trim().split(/\r?\n/).pop()?.slice(0, 160) || "erro"})`); continue; }
    // What the script printed is computed here from the real data: it is the answer itself. The engine's own
    // words describe the script (about the mirror) and stay below.
    const printed = answer.ran.stdout.trim().slice(0, 3000);
    // Its words come under a label: a number in them is from the mirror (fake), the real ones are above.
    const said = answer.text.trim();
    const how = said ? `**Como o ${ENGINES[id].label} fez** (testado numa cópia com valores falsos${printed ? "; os números acima são os reais" : ""}):\n${said}` : "";
    const text = [printed, how, files.length ? `Arquivos:\n${files.map((f) => `- ${f}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
    return { ok: true, engine: id, label: ENGINES[id].label, text, files, steps: [...steps, { tool: "run_command", ok: true, by: id, args: { command: `python ${MIRROR_SCRIPT}` }, summary: `Rodei aqui, nos dados reais, o script do ${ENGINES[id].label}.` }], ms: now() - started, privacy };
  }
  return { ok: false, tried, limited, allLimited: limited.length > 0 && limited.length + tried.filter((t) => /não instalado/.test(t)).length >= order.length };
}

/** The line under the answer that says what the engine did, or why the local answer is the one that stayed. */
export function engineNote(outcome, { reason } = {}) {
  if (outcome.ok && outcome.privacy === "espelho") return `> Feito com o ${outcome.label} sem enviar seus dados: ele viu só uma cópia com valores falsos e o script rodou aqui${reason ? ` (a Aurora local não conseguiu: ${reason.slice(0, 160)})` : ""}.`;
  if (outcome.ok) return `> Feito pelo ${outcome.label}${reason ? ` (a Aurora local não conseguiu: ${reason.slice(0, 160)})` : ""}.`;
  if (outcome.budget) return "> O limite diário de chamadas aos modelos fortes acabou (Configurações → Professor): ficou a resposta da Aurora local.";
  if (outcome.needsContent) return `> Esta tarefa precisa que um modelo forte leia o conteúdo real dos documentos${outcome.why ? ` (${outcome.why.slice(0, 160)})` : ""}, e seus dados não saem do computador: ficou a resposta da Aurora local.`;
  const back = (outcome.limited || []).map((l) => `${ENGINES[l.id].label} volta ${new Date(l.until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`);
  if (outcome.allLimited) return `> Claude e Codex estão sem limite de uso agora (${back.join("; ")}): ficou a resposta da Aurora local.`;
  return `> Tentei pedir ajuda aos modelos fortes e não deu (${[...(outcome.tried || []), ...back].join("; ").slice(0, 300)}): ficou a resposta da Aurora local.`;
}
