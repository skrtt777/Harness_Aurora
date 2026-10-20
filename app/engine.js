// The unified engine: the local Aurora first; when it fails or cannot do the task, Claude or Codex do it for
// real (files in the project folder), whichever still has usage left; with both out of their limits the local
// answer stays and says so. 15/10: from the phone, the local model could not draw a chart in 40 minutes and
// said it was impossible; the strong models, set up on the same computer, only reviewed it.
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveCli } from "./cliRuntime.js";
import { buildMirror, leaks, MIRROR_MANIFEST, MIRROR_SCRIPT, pseudonymize, restoreScript, unfake } from "./mirror.js";
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
 * How much of the project a paid engine may see: "espelho" (default) — only the synthetic mirror, its script
 * runs here; "livre" — the real folder, as before 19/10.
 */
export const PRIVACY_MODES = ["espelho", "livre"];
export async function privacyMode(env = process.env) {
  const value = env.AURORA_PAID_PRIVACY || (await getSetting("paid_privacy"));
  return PRIVACY_MODES.includes(value) ? value : "espelho";
}

export function mirrorPrompt({ task, reason, mirrorDir, history = [], map }) {
  const recent = history.filter((m) => ["user", "assistant"].includes(m.role) && m.provider !== "Sistema").slice(-6)
    .map((m) => `${m.role === "user" ? "Pessoa" : "Aurora"}: ${pseudonymize(String(m.content || "").slice(0, 600), map).text}`).join("\n");
  return [
    "Você está ajudando a Aurora, a assistente local desta pessoa, a terminar uma tarefa que ela não conseguiu sozinha.",
    reason ? `Por que a Aurora local não conseguiu: ${pseudonymize(reason, map).text}.` : "A pessoa pediu que você fizesse esta tarefa.",
    `Os dados da empresa não podem sair do computador. Esta pasta (${mirrorDir}) é um ESPELHO da pasta do projeto: as planilhas têm as colunas, os tipos e os formatos reais, mas os valores e os nomes são falsos. Veja ${MIRROR_MANIFEST} (o que existe na pasta real e quantas linhas cada planilha tem lá).`,
    `Entregue a tarefa como um script Python: grave ${MIRROR_SCRIPT} nesta pasta. Ele vai rodar na pasta real, com os mesmos nomes de arquivo (caminhos relativos à pasta atual), e deve gravar ali os arquivos pedidos. Se a tarefa for uma pergunta, o script imprime a resposta (print) em português.`,
    "Nada de valores fixos tirados das planilhas: tudo vem dos arquivos (a pasta real tem outros valores e mais linhas). Um valor citado no pedido, como \"Cliente 3\", pode ficar no script: ele é trocado pelo real antes de rodar.",
    "Use python-pptx para apresentações (gráficos nativos), openpyxl para planilhas, matplotlib para imagens; instale com pip se faltar. Rode o script aqui no espelho e confira o que ele gera antes de responder.",
    "Responda em português do Brasil, em até 3 frases, o que o script faz e quais arquivos ele grava, sem citar valores do espelho (eles são falsos). Se a tarefa precisar ler o conteúdo de um documento que só está listado, ou não puder virar script, responda só PRECISA_DO_CONTEUDO e o motivo.",
    recent ? `\nConversa recente (nomes e documentos trocados por marcas):\n${recent}` : "",
    `\nTarefa: ${pseudonymize(task, map).text}`,
  ].join("\n");
}

const PYTHONS = [["python", []], ["py", ["-3"]]];
/** `script` run with cwd `dir`: { ok, stdout, stderr }; python first, then the py launcher. */
export function runPython(script, dir, { timeoutMs = 5 * 60_000, signal } = {}) {
  const attempt = (i) => new Promise((done) => {
    const [cmd, pre] = PYTHONS[i];
    execFile(cmd, [...pre, script], { cwd: dir, timeout: timeoutMs, windowsHide: true, signal, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } }, (error, stdout, stderr) => {
      if (error?.code === "ENOENT" && i + 1 < PYTHONS.length) return done(attempt(i + 1));
      done({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || error?.message || "") });
    });
  });
  return attempt(0);
}

/**
 * One engine on the mirror: it writes the script there, the script runs on the real folder (fakes back to real
 * values), one repair round with the error pseudonymized. Returns the engine's answer plus { script, ran }.
 */
async function runOnMirror({ id, task, reason, history, workspace, env, signal, onStage, run, now }) {
  const mirror = buildMirror(workspace);
  try {
    const prompt = mirrorPrompt({ task, reason, mirrorDir: mirror.dir, history, map: mirror.map });
    const leaked = leaks(prompt, mirror.map);
    if (leaked.length) return { ok: false, error: `o pedido ainda tinha ${leaked.length} valor(es) da pasta real; nada foi enviado` };
    const call = (text) => (run ? run(id, text, { cwd: mirror.dir, env, signal, mirror }) : ENGINES[id].run(text, { cwd: mirror.dir, env, signal }));
    let answer = await call(prompt);
    if (!answer.ok || signal?.aborted) return answer;
    if (/PRECISA_DO_CONTEUDO/.test(answer.text)) return { ...answer, ok: false, needsContent: true, error: answer.text.replace(/PRECISA_DO_CONTEUDO[:\s-]*/, "").trim().slice(0, 300) };
    const scriptPath = join(mirror.dir, MIRROR_SCRIPT);
    for (let round = 0; round < 2; round += 1) {
      if (!existsSync(scriptPath)) return { ...answer, ok: false, error: `o ${ENGINES[id].label} não gravou ${MIRROR_SCRIPT}` };
      const { code, restored } = restoreScript(readFileSync(scriptPath, "utf8"), mirror.map);
      const realScript = join(mirror.dir, `_real_${MIRROR_SCRIPT}`);
      writeFileSync(realScript, code, "utf8");
      onStage("A Aurora está rodando aqui o script do modelo forte, nos dados reais…");
      const ran = await runPython(realScript, workspace, { signal });
      if (ran.ok || signal?.aborted || round === 1) return { ...answer, text: unfake(answer.text, mirror.map), ran, restored };
      onStage(`O script falhou nos dados reais; o ${ENGINES[id].label} está corrigindo…`);
      const error = pseudonymize((ran.stderr || ran.stdout).slice(-3000), mirror.map).text;
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
export async function escalate({ task, reason = "", history = [], workspace, order = DEFAULT_ORDER, env = process.env, signal, onStage = () => {}, run = null, now = () => Date.now(), privacy = "livre" }) {
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
    const answer = privacy === "espelho"
      ? await runOnMirror({ id, task, reason, history, workspace, env, signal, onStage, run, now })
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
    const text = [printed, answer.text.trim(), files.length ? `Arquivos:\n${files.map((f) => `- ${f}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
    return { ok: true, engine: id, label: ENGINES[id].label, text, files, steps: [...steps, { tool: "run_command", ok: true, by: id, args: { command: `python ${MIRROR_SCRIPT}` }, summary: `Rodei aqui, nos dados reais, o script do ${ENGINES[id].label}.` }], ms: now() - started, privacy };
  }
  return { ok: false, tried, limited, allLimited: limited.length > 0 && limited.length + tried.filter((t) => /não instalado/.test(t)).length >= order.length };
}

/** The line under the answer that says what the engine did, or why the local answer is the one that stayed. */
export function engineNote(outcome, { reason } = {}) {
  if (outcome.ok && outcome.privacy === "espelho") return `> Feito com o ${outcome.label} sem enviar seus dados: ele viu só uma cópia com valores falsos e o script rodou aqui${reason ? ` (a Aurora local não conseguiu: ${reason.slice(0, 160)})` : ""}.`;
  if (outcome.ok) return `> Feito pelo ${outcome.label}${reason ? ` (a Aurora local não conseguiu: ${reason.slice(0, 160)})` : ""}.`;
  if (outcome.needsContent) return `> Esta tarefa precisa que um modelo forte leia o conteúdo real dos documentos${outcome.why ? ` (${outcome.why.slice(0, 160)})` : ""}, e seus dados não saem do computador: ficou a resposta da Aurora local.`;
  const back = (outcome.limited || []).map((l) => `${ENGINES[l.id].label} volta ${new Date(l.until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`);
  if (outcome.allLimited) return `> Claude e Codex estão sem limite de uso agora (${back.join("; ")}): ficou a resposta da Aurora local.`;
  return `> Tentei pedir ajuda aos modelos fortes e não deu (${[...(outcome.tried || []), ...back].join("; ").slice(0, 300)}): ficou a resposta da Aurora local.`;
}
