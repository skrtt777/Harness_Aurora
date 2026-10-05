import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getDb } from "./db.js";
import { renderDocument } from "./documentWriter.js";
import { httpError } from "./httpSecurity.js";
import { runLocal } from "./local.js";

/**
 * Phase E of docs/AGENTES_ROTEIRO.md: one big request ("feche o mês") split among the task
 * agents, run, and put together. The local model only plans, constrained by a JSON schema to
 * the agents that exist; running and the summary are plain code, so a weak plan is the only
 * thing that can go wrong, and the person sees it before anything runs.
 */

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function ready() {
  const db = await getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS orchestrations (
      id TEXT PRIMARY KEY, request TEXT NOT NULL, plan TEXT NOT NULL, status TEXT NOT NULL,
      started_at TEXT NOT NULL, finished_at TEXT, results TEXT, summary_file TEXT)`);
  return db;
}

// The deliverable is a field of its own: written into the request text, "planilha" became "lista".
const FORMATS = { planilha: "planilha Excel (.xlsx)", "relatório em Word": "relatório em Word (.docx)", PDF: "PDF (.pdf)", texto: "texto (.md)" };

export function planPrompt(request, agents) {
  return [
    "Você coordena uma equipe de agentes. Divida o pedido abaixo em tarefas, uma por agente que tem algo a fazer nele.",
    "Cada tarefa deve ser um pedido completo e independente, que o agente entende sozinho: o que entregar (planilha, relatório), com quais colunas ou informações e qual período.",
    "Use só os agentes listados, pelo nome exato. Não crie tarefa para agente que não tem relação com o pedido.",
    "Copie para cada tarefa os critérios, períodos, datas e números do pedido com as mesmas palavras (\"mais de 30 dias\", \"acima de 5%\", \"em outubro\"): não reescreva nem acrescente critério, e peça para copiar os valores das planilhas, sem recalcular.",
    "Cada tarefa diz o tipo de arquivo que o pedido pede para aquela parte, com a mesma palavra: \"planilha\" continua \"planilha\", \"relatório em Word\" continua \"relatório em Word\" (nunca troque por \"lista\").",
    "",
    "Agentes:",
    ...agents.map((a) => `- ${a.name}${a.department ? ` (setor ${a.department})` : ""}: ${a.mission}`),
    "",
    `Pedido: ${request}`,
    "",
    "Se uma tarefa precisa do que outro agente entrega antes (ex.: o e-mail de cobrança usa a lista de inadimplentes), ponha-a depois na lista e diga em depende_de o nome desse agente; tarefas independentes ficam sem depende_de.",
    'Responda só com JSON: {"tasks":[{"agent":"nome exato","request":"pedido completo para esse agente","formato":"planilha | relatório em Word | PDF | texto","depende_de":["nome de agente de uma tarefa anterior"]}]}',
  ].join("\n");
}

/** Model answer → valid tasks (known agents, one task per agent, non-empty requests). */
// Words that say one part comes after another. Without them the model still invented that the
// Controladoria waits for RH and Financeiro (orchestrator eval, 05/10/2026), and a failed RH task
// then stopped a report that never needed it.
const SEQUENCE = /\b(primeiro|depois|em seguida|ap[oó]s|usando|com base|a partir d|com (ela|ele|essa|esse|isso|a planilha|o relat[oó]rio|a lista))\b/i;

export function parsePlan(text, agents, request = null) {
  let parsed;
  try { parsed = JSON.parse(String(text || "").match(/\{[\s\S]*\}/)?.[0] || ""); } catch { return []; }
  const byName = new Map(agents.map((a) => [fold(a.name), a]));
  const seen = new Set();
  const kept = (Array.isArray(parsed?.tasks) ? parsed.tasks : []).map((t) => ({ agent: byName.get(fold(t?.agent)), request: String(t?.request || "").trim(), format: FORMATS[t?.formato] ? t.formato : null, after: Array.isArray(t?.depende_de) ? t.depende_de : [] }))
    .filter((t) => t.agent && t.request.length >= 10 && !seen.has(t.agent.id) && seen.add(t.agent.id));
  return kept.map((t, i) => {
    // Only earlier tasks can be waited for: no cycles, and the order the plan was written in.
    const before = new Set(kept.slice(0, i).map((k) => k.agent.id));
    const dependsOn = request !== null && !SEQUENCE.test(request) ? [] : [...new Set(t.after.map((name) => byName.get(fold(name))?.id).filter((id) => id && before.has(id)))];
    return { agentId: t.agent.id, agentName: t.agent.name, request: `${t.request.slice(0, 1900)}${t.format && !t.request.includes(FORMATS[t.format]) ? ` Entregue como ${FORMATS[t.format]}.` : ""}`, ...(dependsOn.length ? { dependsOn } : {}) };
  });
}

/**
 * Plan with the local model; if it gives nothing usable, every sector agent whose department
 * the request names gets the request itself (better a rough plan than none).
 */
export async function planRequest({ request, agents, ask = runLocal, env = process.env }) {
  const active = agents.filter((a) => a.enabled);
  if (!active.length) throw httpError(409, "Crie ou ligue pelo menos um agente antes.");
  const names = active.map((a) => a.name);
  const schema = { type: "object", properties: { tasks: { type: "array", items: { type: "object", properties: { agent: { type: "string", enum: names }, request: { type: "string" }, formato: { type: "string", enum: Object.keys(FORMATS) }, depende_de: { type: "array", items: { type: "string", enum: names } } }, required: ["agent", "request", "formato"] } } }, required: ["tasks"] };
  const answer = await ask(planPrompt(request, active), { ...env, LOCAL_OUTPUT_SCHEMA: JSON.stringify(schema) }).catch((error) => ({ ok: false, error: error.message }));
  const tasks = answer?.ok ? parsePlan(answer.text, active, request) : [];
  if (tasks.length) return { tasks, planner: "modelo" };
  const named = active.filter((a) => a.department && fold(request).includes(fold(a.department)));
  return { tasks: named.map((a) => ({ agentId: a.id, agentName: a.name, request })), planner: "palavras do pedido" };
}

/**
 * Runs the tasks, at most `concurrency` at a time (the local model serves 4 copies). A task with
 * `dependsOn` waits for those agents' tasks and gets their delivered files in its request; if one
 * of them didn't deliver, it doesn't run.
 */
export async function runPlan({ tasks, runAgent, handleChatTurn, concurrency = 2, onProgress = () => {}, original = null }) {
  const results = new Array(tasks.length);
  const finished = new Map(); // agentId → promise of its result
  const settle = new Map();
  for (const task of tasks) finished.set(task.agentId, new Promise((resolve) => settle.set(task.agentId, resolve)));
  let next = 0;
  const runOne = async (i) => {
    const task = tasks[i];
    const deps = await Promise.all((task.dependsOn || []).map((id) => finished.get(id)).filter(Boolean));
    const missing = deps.filter((d) => d.status !== "done" || !d.files.length);
    if (missing.length) return { ...task, status: "failed", files: [], answer: "", error: `Dependia de ${missing.map((d) => d.agentName).join(", ")}, que não entregou.` };
    let request = deps.length ? `${task.request}\n\nUse o que a equipe já entregou:\n${deps.flatMap((d) => d.files.map((f) => `- ${d.agentName}: ${f}`)).join("\n")}` : task.request;
    // The plan paraphrases: "títulos em atraso" became "contas a pagar em atraso" and the agent read
    // the wrong sheet. The person's own words go along to check the criteria against.
    if (original && original !== task.request) request += `\n\n(Esta tarefa é a sua parte de um pedido maior da pessoa: "${original.slice(0, 1200)}". Faça só a sua parte, com os critérios nas palavras dela.)`;
    onProgress({ index: i, status: "running" });
    try {
      // Read access to the folders of those deliveries: they sit in the other agents' folders.
      const readRoots = [...new Set(deps.flatMap((d) => d.files.map((f) => dirname(f))))];
      const run = await runAgent(task.agentId, { request, trigger: "orquestrador", handleChatTurn, ...(readRoots.length ? { readRoots } : {}) });
      return { ...task, status: run?.status || "failed", files: run?.files || [], answer: run?.answer || "", error: run?.error || null, conversationId: run?.conversationId || null };
    } catch (error) {
      return { ...task, status: "failed", files: [], answer: "", error: error.message };
    }
  };
  // Tasks are taken in plan order; dependencies only point backwards, so waiting never deadlocks
  // as long as the ones being waited for are already started (they are: they come first).
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await runOne(i);
      settle.get(tasks[i].agentId)(results[i]);
      onProgress({ index: i, status: results[i].status });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker));
  return results;
}

/** The summary is code, not the model: who did what, the files, and what failed. */
export function summaryMarkdown(request, results, date = new Date()) {
  const done = results.filter((r) => r.status === "done" && r.files.length);
  const lines = [
    `# Resumo: ${request.slice(0, 120)}`,
    `${date.toLocaleDateString("pt-BR")} · ${done.length} de ${results.length} tarefa(s) entregue(s)`,
    "",
    "| Agente | Tarefa | Situação | Arquivos |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.agentName} | ${r.request.replace(/\|/g, "/").slice(0, 160)} | ${r.status === "done" ? (r.files.length ? "Entregue" : "Sem arquivo") : "Não concluída"} | ${r.files.map((f) => basename(f)).join(", ") || "-"} |`),
    "",
    ...results.flatMap((r) => [`## ${r.agentName}`, r.error ? `Erro: ${r.error}` : String(r.answer || "").replace(/^#+\s*/gm, "").slice(0, 1500), ...r.files.map((f) => `- Arquivo: ${f}`), ""]),
  ];
  const missing = results.filter((r) => r.status !== "done" || !r.files.length);
  if (missing.length) lines.push("## Pendências", ...missing.map((r) => `- ${r.agentName}: ${r.error || "não entregou arquivo"}`));
  return lines.join("\n");
}

/**
 * Runs a plan the person approved and writes the summary in `dir`. Returns at once with the
 * id; `done` resolves when everything finished (the route answers right away, tests await it).
 */
export async function startOrchestration({ request, tasks, dir, runAgent, handleChatTurn, concurrency = 2 }) {
  if (!String(request || "").trim()) throw httpError(400, "Diga o que a equipe deve fazer.");
  if (!tasks?.length) throw httpError(400, "O plano está vazio.");
  const db = await ready();
  const id = randomUUID();
  db.prepare("INSERT INTO orchestrations (id, request, plan, status, started_at) VALUES (?, ?, ?, 'running', ?)").run(id, request.slice(0, 4000), JSON.stringify(tasks), new Date().toISOString());
  const done = finish({ db, id, request, tasks, dir, runAgent, handleChatTurn, concurrency }).catch((error) => {
    db.prepare("UPDATE orchestrations SET status = 'failed', finished_at = ?, results = ? WHERE id = ?").run(new Date().toISOString(), JSON.stringify([{ error: error.message }]), id);
  });
  return { id, done };
}

async function finish({ db, id, request, tasks, dir, runAgent, handleChatTurn, concurrency }) {
  const results = await runPlan({ tasks, runAgent, handleChatTurn, concurrency, original: request });
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const summaryFile = join(dir, `Resumo da equipe ${stamp}.docx`);
  writeFileSync(summaryFile, await renderDocument("docx", summaryMarkdown(request, results)));
  db.prepare("UPDATE orchestrations SET status = ?, finished_at = ?, results = ?, summary_file = ? WHERE id = ?")
    .run(results.every((r) => r.status === "done") ? "done" : "partial", new Date().toISOString(), JSON.stringify(results), summaryFile, id);
}

export async function getOrchestration(id) {
  const db = await ready();
  const r = db.prepare("SELECT * FROM orchestrations WHERE id = ?").get(id);
  return r && { id: r.id, request: r.request, plan: JSON.parse(r.plan), status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, results: r.results ? JSON.parse(r.results) : [], summaryFile: r.summary_file };
}

export async function listOrchestrations(limit = 10) {
  const db = await ready();
  return Promise.all(db.prepare("SELECT id FROM orchestrations ORDER BY started_at DESC LIMIT ?").all(limit).map((r) => getOrchestration(r.id)));
}
