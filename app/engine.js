// The unified engine: the local Aurora first; when it fails or cannot do the task, Claude or Codex do it for
// real (files in the project folder), whichever still has usage left; with both out of their limits the local
// answer stays and says so. 15/10: from the phone, the local model could not draw a chart in 40 minutes and
// said it was impossible; the strong models, set up on the same computer, only reviewed it.
import { readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveCli } from "./cliRuntime.js";
import { runClaudeAgent } from "./claude.js";
import { runCodexAgent } from "./codex.js";
import { getSetting, setSetting } from "./store.js";
import { detectSignals, requestsFile, WRITE_TOOLS } from "./teacher.js";

export const ENGINES = { claude: { label: "Claude", run: runClaudeAgent }, codex: { label: "Codex", run: runCodexAgent } };
const DEFAULT_ORDER = ["claude", "codex"];
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
  const limits = await readLimits();
  return Object.fromEntries(Object.keys(ENGINES).map((id) => {
    const limit = limits[id] && limits[id].until > now ? limits[id] : null;
    return [id, { installed: resolveCli(id, env).installed, limitedUntil: limit?.until || null, reason: limit?.reason || null }];
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
 * The task done by the first strong engine that can: in `order`, skipping the ones not installed or out of
 * their limit, marking one that answers with a usage limit and going on to the next. Returns { ok, engine,
 * label, text, files, steps } on success; { ok: false, tried, limited, allLimited } otherwise.
 */
export async function escalate({ task, reason = "", history = [], workspace, order = DEFAULT_ORDER, env = process.env, signal, onStage = () => {}, run = null, now = () => Date.now() }) {
  const status = await engineStatus({ env, now: now() });
  const tried = [];
  const limited = [];
  for (const id of order.filter((x) => ENGINES[x])) {
    const s = status[id];
    if (!run && !s.installed) { tried.push(`${ENGINES[id].label}: não instalado`); continue; }
    if (s.limitedUntil) { limited.push({ id, until: s.limitedUntil }); continue; }
    onStage(`A Aurora pediu ajuda ao ${ENGINES[id].label}…`);
    const before = snapshot(workspace);
    const started = now();
    const answer = await (run ? run(id, executorPrompt({ task, reason, workspace, history }), { cwd: workspace, env, signal }) : ENGINES[id].run(executorPrompt({ task, reason, workspace, history }), { cwd: workspace, env, signal }));
    if (signal?.aborted) return { ok: false, tried, limited, cancelled: true };
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
    const steps = files.map((p) => ({ tool: "write_file", ok: true, by: id, args: { path: p }, summary: `Criei ${p} (pelo ${ENGINES[id].label}).` }));
    return { ok: true, engine: id, label: ENGINES[id].label, text: answer.text, files, steps, ms: now() - started };
  }
  return { ok: false, tried, limited, allLimited: limited.length > 0 && limited.length + tried.filter((t) => /não instalado/.test(t)).length >= order.length };
}

/** The line under the answer that says what the engine did, or why the local answer is the one that stayed. */
export function engineNote(outcome, { reason } = {}) {
  if (outcome.ok) return `> Feito pelo ${outcome.label}${reason ? ` (a Aurora local não conseguiu: ${reason.slice(0, 160)})` : ""}.`;
  const back = (outcome.limited || []).map((l) => `${ENGINES[l.id].label} volta ${new Date(l.until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`);
  if (outcome.allLimited) return `> Claude e Codex estão sem limite de uso agora (${back.join("; ")}): ficou a resposta da Aurora local.`;
  return `> Tentei pedir ajuda aos modelos fortes e não deu (${[...(outcome.tried || []), ...back].join("; ").slice(0, 300)}): ficou a resposta da Aurora local.`;
}
