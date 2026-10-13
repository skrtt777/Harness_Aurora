// The HR team of the office: it evaluates each task agent by its real deliveries (the runs: delivered,
// corrected by the teacher, failed, undone by the person), praises and rewards the good ones, gives the
// weak ones a warning with an improvement plan (the lessons of their own mistakes go into their
// instructions), and, when an agent keeps failing after the plan, dismisses it (turned off, reversible)
// and hires a replacement for the same job that starts with everything learned. Every decision is an
// event the office shows and the person can undo ("Recontratar").
import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { agentInstructions, createAgent, getAgent, listAgents, listRuns, updateAgent } from "./agents.js";
import { getProject, updateProject } from "./store.js";

/** The HR team, by name: they appear in the office. */
export const HR_TEAM = [
  { id: "rh:helena", name: "Helena", role: "Avaliação e prêmios" },
  { id: "rh:otavio", name: "Otávio", role: "Contratação e desligamento" },
];

export const HR_RULES = {
  window: 10,            // the last runs that count
  minRuns: 3,            // judged only after this many
  reward: 85,            // score for a prize
  warn: 60,              // below: a warning and an improvement plan
  dismiss: 40,           // below, after a plan and 2 more runs: dismissed and replaced
  rewardEveryDays: 7, warnEveryDays: 3,
};

async function ready() {
  const db = await getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS hr_events (
      id TEXT PRIMARY KEY, agent_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT, score REAL,
      by_name TEXT, related_id TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_hr_events_agent ON hr_events(agent_id, created_at);
    CREATE TABLE IF NOT EXISTS agent_hr (
      agent_id TEXT PRIMARY KEY, stars INTEGER NOT NULL DEFAULT 0, warnings INTEGER NOT NULL DEFAULT 0,
      lessons TEXT, status TEXT NOT NULL DEFAULT 'ativo', replaced_by TEXT, replaces TEXT, updated_at TEXT NOT NULL)`);
  return db;
}
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };

/** The points of one run: 100 delivered clean, 60 corrected by the teacher, 30 undone by the person, 0 failed. */
export function runPoints(run) {
  if (run.status === "failed") return 0;
  if (run.status !== "done") return null;
  if (run.undoneAt) return 30;
  if (run.review?.verdict === "fix") return 60;
  if ((run.checks || []).length >= 3) return 80;           // the guards had to hold it back several times
  return 100;
}

/** An agent's report card from its runs (newest first). */
export function scoreAgent(runs, rules = HR_RULES) {
  const counted = runs.map((r) => ({ r, p: runPoints(r) })).filter((x) => x.p !== null).slice(0, rules.window);
  if (!counted.length) return { score: null, runs: 0, delivered: 0, corrected: 0, failed: 0, trend: 0 };
  // The recent ones weigh more (an agent that improved is judged by what it does now).
  let sum = 0, weight = 0;
  counted.forEach((x, i) => { const w = 1 + (counted.length - i) / counted.length; sum += x.p * w; weight += w; });
  const half = Math.ceil(counted.length / 2);
  const avg = (xs) => (xs.length ? xs.reduce((n, x) => n + x.p, 0) / xs.length : 0);
  return {
    score: Math.round(sum / weight), runs: counted.length,
    delivered: counted.filter((x) => x.p >= 60).length, corrected: counted.filter((x) => x.p === 60).length, failed: counted.filter((x) => x.p === 0).length,
    trend: counted.length >= 4 ? Math.round(avg(counted.slice(0, half)) - avg(counted.slice(half))) : 0,
  };
}

/** What went wrong in an agent's runs, as rules for its instructions (the improvement plan). */
export function lessonsFrom(runs, max = 5) {
  const out = [];
  for (const r of runs) {
    for (const p of r.review?.problems || []) out.push(String(p));
    if (r.status === "failed" && r.error && !/Interrompida/.test(r.error)) out.push(`Uma execução falhou com: ${String(r.error).slice(0, 160)}. Antes de terminar, confira se a entrega existe e funciona.`);
    if (r.undoneAt) out.push(`A pessoa desfez a entrega de "${String(r.request).slice(0, 80)}": confirme o que ela quer antes de mexer em arquivos dela.`);
  }
  const seen = new Set();
  return out.map((s) => s.replace(/\s+/g, " ").trim().slice(0, 240)).filter((s) => { const k = s.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max);
}

/** Instructions with the HR plan: the agent's own instructions plus the lessons of its mistakes. */
export function instructionsWithPlan(agent, lessons) {
  const base = agentInstructions(agent);
  return lessons.length ? `${base}\nPlano de melhoria do RH (erros das suas entregas anteriores; não os repita):\n${lessons.map((l) => `- ${l}`).join("\n")}` : base;
}

async function event(db, e) {
  const row = { id: randomUUID(), created_at: new Date().toISOString(), ...e };
  db.prepare("INSERT INTO hr_events (id, agent_id, kind, title, detail, score, by_name, related_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.agent_id || null, row.kind, row.title, row.detail || null, row.score ?? null, row.by_name || null, row.related_id || null, row.created_at);
  return row;
}
async function hrOf(db, agentId) {
  const r = db.prepare("SELECT * FROM agent_hr WHERE agent_id = ?").get(agentId);
  return r ? { stars: r.stars, warnings: r.warnings, lessons: parse(r.lessons, []), status: r.status, replacedBy: r.replaced_by, replaces: r.replaces } : { stars: 0, warnings: 0, lessons: [], status: "ativo", replacedBy: null, replaces: null };
}
async function saveHr(db, agentId, hr) {
  db.prepare(`INSERT INTO agent_hr (agent_id, stars, warnings, lessons, status, replaced_by, replaces, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET stars = excluded.stars, warnings = excluded.warnings, lessons = excluded.lessons, status = excluded.status, replaced_by = excluded.replaced_by, replaces = excluded.replaces, updated_at = excluded.updated_at`)
    .run(agentId, hr.stars, hr.warnings, JSON.stringify(hr.lessons || []), hr.status, hr.replacedBy || null, hr.replaces || null, new Date().toISOString());
}
const daysSince = (iso, now) => (iso ? (now - new Date(iso).getTime()) / 86_400_000 : Infinity);
const lastEvent = (db, agentId, kind) => db.prepare("SELECT * FROM hr_events WHERE agent_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1").get(agentId, kind) || null;

/** A replacement's name: the job's name and a new person ("Cobrança · Bruna"). */
const NEW_NAMES = ["Bruna", "Caio", "Débora", "Enzo", "Fernanda", "Gael", "Heloísa", "Igor", "Júlia", "Kaio", "Lívia", "Murilo", "Nina", "Otto", "Paula", "Rafael", "Sofia", "Tomás", "Valéria", "Yuri"];
export function replacementName(name, taken = new Set()) {
  const job = String(name).split(" · ")[0];
  for (const n of NEW_NAMES) { const candidate = `${job} · ${n}`; if (!taken.has(candidate)) return candidate.slice(0, 80); }
  return `${job} · ${Date.now() % 1000}`;
}

/**
 * The HR review: every active agent with enough runs gets its grade, and the decisions follow the
 * rules. `apply: false` only says what would be done. Returns { report, decisions }.
 */
export async function hrReview({ now = Date.now(), apply = true, rules = HR_RULES } = {}) {
  const db = await ready();
  const agents = await listAgents();
  const report = []; const decisions = [];
  const names = new Set(agents.map((a) => a.name));
  for (const agent of agents) {
    const hr = await hrOf(db, agent.id);
    const runs = await listRuns({ agentId: agent.id, limit: 30 });
    const card = scoreAgent(runs, rules);
    report.push({ agentId: agent.id, name: agent.name, department: agent.department, enabled: agent.enabled, ...card, stars: hr.stars, warnings: hr.warnings, status: hr.status, lessons: hr.lessons, replacedBy: hr.replacedBy, replaces: hr.replaces });
    if (!agent.enabled || hr.status === "demitido" || card.score === null || card.runs < rules.minRuns) continue;
    const warned = lastEvent(db, agent.id, "advertencia");
    const runsSinceWarning = warned ? runs.filter((r) => r.startedAt > warned.created_at && runPoints(r) !== null).length : 0;
    if (card.score >= rules.reward && daysSince(lastEvent(db, agent.id, "premio")?.created_at, now) >= rules.rewardEveryDays) {
      decisions.push({ kind: "premio", agent, card, by: HR_TEAM[0], title: `${agent.name} ganhou uma estrela`, detail: `Nota ${card.score}: ${card.delivered} de ${card.runs} entregas aprovadas${card.corrected ? ` (${card.corrected} com correção)` : ""}. Parabéns, continue assim.` });
    } else if (card.score < rules.dismiss && warned && runsSinceWarning >= 2 && card.runs >= 5) {
      decisions.push({ kind: "demissao", agent, card, by: HR_TEAM[1], title: `${agent.name} foi desligado`, detail: `Nota ${card.score} mesmo depois do plano de melhoria (${runsSinceWarning} entregas depois da advertência, ${card.failed} falhas). Um substituto foi contratado com as lições.` });
    } else if (card.score < rules.warn && daysSince(warned?.created_at, now) >= rules.warnEveryDays) {
      decisions.push({ kind: "advertencia", agent, card, by: HR_TEAM[0], title: `${agent.name} recebeu um plano de melhoria`, detail: `Nota ${card.score}: ${card.failed} falhas e ${card.corrected} correções nas últimas ${card.runs} entregas. As lições dos erros foram para as instruções dele.` });
    } else if (card.trend >= 15 && hr.warnings > 0 && daysSince(lastEvent(db, agent.id, "elogio")?.created_at, now) >= rules.warnEveryDays) {
      decisions.push({ kind: "elogio", agent, card, by: HR_TEAM[0], title: `${agent.name} melhorou`, detail: `A nota subiu ${card.trend} pontos depois do plano de melhoria. Bom trabalho.` });
    }
  }
  if (!apply) return { report, decisions: decisions.map(({ agent, ...d }) => ({ ...d, agentId: agent.id, name: agent.name })) };

  const done = [];
  for (const d of decisions) {
    const hr = await hrOf(db, d.agent.id);
    if (d.kind === "premio") { hr.stars += 1; await saveHr(db, d.agent.id, hr); }
    if (d.kind === "elogio") { /* the praise is the event */ }
    if (d.kind === "advertencia") {
      const runs = await listRuns({ agentId: d.agent.id, limit: 30 });
      hr.warnings += 1;
      hr.lessons = [...new Set([...(hr.lessons || []), ...lessonsFrom(runs)])].slice(-8);
      await saveHr(db, d.agent.id, hr);
      if (d.agent.projectId && (await getProject(d.agent.projectId))) await updateProject(d.agent.projectId, { instructions: instructionsWithPlan(d.agent, hr.lessons) });
    }
    if (d.kind === "demissao") {
      const runs = await listRuns({ agentId: d.agent.id, limit: 30 });
      const lessons = [...new Set([...(hr.lessons || []), ...lessonsFrom(runs, 8)])].slice(-8);
      const name = replacementName(d.agent.name, names); names.add(name);
      const hire = await createAgent({ name, kind: d.agent.kind, mission: d.agent.mission, department: d.agent.department, workDir: d.agent.workDir, tools: d.agent.tools, trigger: d.agent.trigger });
      if (hire.projectId) await updateProject(hire.projectId, { instructions: instructionsWithPlan(hire, lessons) });
      await updateAgent(d.agent.id, { enabled: false });
      await saveHr(db, d.agent.id, { ...hr, lessons, status: "demitido", replacedBy: hire.id });
      await saveHr(db, hire.id, { stars: 0, warnings: 0, lessons, status: "ativo", replacedBy: null, replaces: d.agent.id });
      await event(db, { created_at: new Date(now).toISOString(), agent_id: hire.id, kind: "contratacao", title: `${hire.name} foi contratado`, detail: `Substitui ${d.agent.name} no mesmo trabalho, já com ${lessons.length} lições do que deu errado.`, by_name: HR_TEAM[1].name, related_id: d.agent.id });
      d.related = hire.id;
    }
    done.push(await event(db, { created_at: new Date(now).toISOString(), agent_id: d.agent.id, kind: d.kind, title: d.title, detail: d.detail, score: d.card.score, by_name: d.by.name, related_id: d.related || null }));
  }
  db.prepare("INSERT INTO hr_events (id, agent_id, kind, title, detail, score, by_name, related_id, created_at) VALUES (?, NULL, 'avaliacao', ?, ?, NULL, ?, NULL, ?)")
    .run(randomUUID(), `Avaliação: ${report.filter((r) => r.score !== null).length} agentes avaliados`, `${done.length} decisões`, HR_TEAM[0].name, new Date(now).toISOString());
  return { report, decisions: done };
}

/** Undo a dismissal: the old agent back, its replacement turned off. */
export async function rehire(agentId) {
  const db = await ready();
  const hr = await hrOf(db, agentId);
  if (hr.status !== "demitido") throw new Error("Este agente não foi desligado pelo RH.");
  await updateAgent(agentId, { enabled: true });
  if (hr.replacedBy && (await getAgent(hr.replacedBy))) await updateAgent(hr.replacedBy, { enabled: false });
  await saveHr(db, agentId, { ...hr, status: "ativo", replacedBy: null, warnings: 0 });
  const agent = await getAgent(agentId);
  return event(db, { agent_id: agentId, kind: "recontratacao", title: `${agent.name} foi recontratado`, detail: "A pessoa desfez o desligamento.", by_name: "Você" });
}

/** The HR page: the report card of everyone and the latest events. */
export async function hrSnapshot({ limit = 30 } = {}) {
  const db = await ready();
  const { report } = await hrReview({ apply: false });
  const events = db.prepare("SELECT * FROM hr_events ORDER BY created_at DESC LIMIT ?").all(limit).map((e) => ({ id: e.id, agentId: e.agent_id, kind: e.kind, title: e.title, detail: e.detail, score: e.score, by: e.by_name, relatedId: e.related_id, at: e.created_at }));
  const last = db.prepare("SELECT created_at FROM hr_events WHERE kind = 'avaliacao' ORDER BY created_at DESC LIMIT 1").get();
  return { team: HR_TEAM, rules: HR_RULES, report: report.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)), events, lastReview: last?.created_at || null };
}

/** The review once an hour (on the office's refresh): cheap, it only reads the runs. */
let reviewing = null;
export function reviewIfDue(now = Date.now(), everyMs = 60 * 60_000) {
  if (reviewing) return reviewing;
  reviewing = (async () => {
    const db = await ready();
    const last = db.prepare("SELECT created_at FROM hr_events WHERE kind = 'avaliacao' ORDER BY created_at DESC LIMIT 1").get();
    if (last && now - new Date(last.created_at).getTime() < everyMs) return null;
    return hrReview({ now });
  })().catch(() => null).finally(() => { reviewing = null; });
  return reviewing;
}

/** The recent HR events, for the office (who is being rewarded, warned, dismissed, hired now). */
export async function recentHrEvents(sinceMs = 15 * 60_000, now = Date.now()) {
  const db = await ready();
  return db.prepare("SELECT * FROM hr_events WHERE created_at >= ? ORDER BY created_at DESC LIMIT 10").all(new Date(now - sinceMs).toISOString())
    .map((e) => ({ agentId: e.agent_id, kind: e.kind, title: e.title, by: e.by_name, at: new Date(e.created_at).getTime(), relatedId: e.related_id }));
}

/** Stars and status of each agent, for the office's badges. */
export async function hrBadges() {
  const db = await ready();
  return new Map(db.prepare("SELECT agent_id, stars, warnings, status FROM agent_hr").all().map((r) => [r.agent_id, { stars: r.stars, warnings: r.warnings, status: r.status }]));
}
