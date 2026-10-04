import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { getDb } from "./db.js";
import { createConversation, createProject, getProject, updateProject } from "./store.js";
import { httpError } from "./httpSecurity.js";

/**
 * Task agents (docs/AGENTES_ROTEIRO.md): "employees" of Aurora with a mission, a work folder
 * and a trigger. An agent is a project (its folder is the workspace, its mission the project
 * instructions), so a run is an ordinary chat turn — same context, tools, guards, copies and
 * teacher — with three differences applied in the tool context: Auto mode, the company search
 * limited to its department, and only the tools it was given.
 */

export const AGENT_KINDS = ["setor", "pessoal"];

async function ready() {
  const db = await getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, mission TEXT NOT NULL,
      department TEXT, work_dir TEXT NOT NULL, tools TEXT, trigger TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, conversation_id TEXT,
      request TEXT NOT NULL, trigger TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
      answer TEXT, files TEXT, steps INTEGER, checks TEXT, review TEXT, copies TEXT, error TEXT);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id, started_at)`);
  return db;
}

const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
const mapAgent = (r) => r && ({
  id: r.id, name: r.name, kind: r.kind, mission: r.mission, department: r.department || null, workDir: r.work_dir,
  tools: parse(r.tools, null), trigger: parse(r.trigger, { type: "manual" }), enabled: Boolean(r.enabled), projectId: r.project_id,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const mapRun = (r) => r && ({
  id: r.id, agentId: r.agent_id, conversationId: r.conversation_id, request: r.request, trigger: r.trigger, status: r.status,
  startedAt: r.started_at, finishedAt: r.finished_at, answer: r.answer, files: parse(r.files, []), steps: r.steps,
  checks: parse(r.checks, []), review: parse(r.review, null), copies: parse(r.copies, null), error: r.error,
});

/** The instructions every run starts from: the mission plus how this agent works. */
export function agentInstructions({ name, mission, department, workDir }) {
  return [
    `Você é ${name}, um agente da Aurora.${department ? ` Setor: ${department}.` : ""}`,
    `Missão: ${mission}`,
    `Trabalhe sozinho até entregar. ${department ? `Os documentos do setor ${department} estão na busca da empresa (knowledge_search) e podem ser lidos com read_file. ` : ""}Salve cada entrega como arquivo na sua pasta (${workDir}) e termine dizendo o que foi feito e o nome dos arquivos.`,
    "Copie números, datas e nomes exatamente dos documentos e cite a fonte; não invente o que não encontrou.",
  ].join("\n");
}

export async function listAgents() {
  const db = await ready();
  return db.prepare("SELECT * FROM agents ORDER BY kind, name").all().map(mapAgent);
}

export async function getAgent(id) {
  const db = await ready();
  return mapAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(id));
}

export async function agentForProject(projectId) {
  if (!projectId) return null;
  const db = await ready();
  return mapAgent(db.prepare("SELECT * FROM agents WHERE project_id = ?").get(projectId));
}

function cleanTrigger(trigger) {
  const t = trigger && typeof trigger === "object" ? trigger : { type: "manual" };
  if (t.type === "schedule") {
    // "every N minutes" or "at HH:MM on these weekdays (0 = Sunday)".
    const every = Number(t.everyMinutes);
    if (every) return { type: "schedule", everyMinutes: Math.max(5, Math.min(7 * 24 * 60, Math.round(every))), request: String(t.request || "").slice(0, 2000) };
    if (!/^\d{2}:\d{2}$/.test(String(t.at || ""))) throw httpError(400, "Informe o horário como HH:MM.");
    const days = Array.isArray(t.weekdays) ? [...new Set(t.weekdays.map(Number).filter((d) => d >= 0 && d <= 6))] : [1, 2, 3, 4, 5];
    return { type: "schedule", at: t.at, weekdays: days, request: String(t.request || "").slice(0, 2000) };
  }
  if (t.type === "file") {
    if (!t.folder || !isAbsolute(String(t.folder))) throw httpError(400, "Informe o caminho completo da pasta observada.");
    return { type: "file", folder: String(t.folder), pattern: String(t.pattern || "*").slice(0, 100), request: String(t.request || "").slice(0, 2000) };
  }
  return { type: "manual" };
}

export async function createAgent({ name, kind = "pessoal", mission, department = null, workDir, tools = null, trigger = null }) {
  if (!String(name || "").trim()) throw httpError(400, "Dê um nome ao agente.");
  if (!String(mission || "").trim()) throw httpError(400, "Descreva a missão do agente.");
  if (!AGENT_KINDS.includes(kind)) throw httpError(400, "Tipo de agente inválido.");
  if (!workDir || !isAbsolute(String(workDir))) throw httpError(400, "Informe o caminho completo da pasta de trabalho do agente.");
  const dir = resolve(String(workDir));
  mkdirSync(dir, { recursive: true });
  const db = await ready();
  const id = randomUUID();
  const ts = new Date().toISOString();
  const clean = { name: String(name).trim().slice(0, 80), mission: String(mission).trim().slice(0, 4000), department: department ? String(department).trim().slice(0, 80) : null, workDir: dir };
  const project = await createProject({ name: `Agente: ${clean.name}`, instructions: agentInstructions(clean), workspaceDir: dir });
  db.prepare("INSERT INTO agents (id, name, kind, mission, department, work_dir, tools, trigger, enabled, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)")
    .run(id, clean.name, kind, clean.mission, clean.department, dir, tools ? JSON.stringify(tools) : null, JSON.stringify(cleanTrigger(trigger)), project.id, ts, ts);
  return getAgent(id);
}

export async function updateAgent(id, patch = {}) {
  const agent = await getAgent(id);
  if (!agent) throw httpError(404, "Agente não encontrado.");
  const next = { ...agent, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  const db = await ready();
  db.prepare("UPDATE agents SET name = ?, mission = ?, department = ?, tools = ?, trigger = ?, enabled = ?, updated_at = ? WHERE id = ?")
    .run(String(next.name).slice(0, 80), String(next.mission).slice(0, 4000), next.department || null, next.tools ? JSON.stringify(next.tools) : null, JSON.stringify(cleanTrigger(next.trigger)), next.enabled ? 1 : 0, new Date().toISOString(), id);
  if (agent.projectId && (await getProject(agent.projectId))) await updateProject(agent.projectId, { instructions: agentInstructions(next) });
  return getAgent(id);
}

export async function deleteAgent(id) {
  const db = await ready();
  db.prepare("DELETE FROM agents WHERE id = ?").run(id);
}

/**
 * What a run of this agent may do, applied on top of the chat's tool context: Auto mode in its
 * folder, the company search limited to its department, and its tool list.
 */
export async function agentToolOverrides(agent, { listSources }) {
  const sources = agent.department ? (await listSources()).filter((s) => String(s.department).toLowerCase() === agent.department.toLowerCase()) : [];
  return {
    mode: "auto",
    ...(sources.length ? { knowledgeSourceIds: sources.map((s) => s.id), knowledgeRoots: sources.map((s) => s.path) } : {}),
    agentTools: agent.tools,
  };
}

const running = new Map(); // agentId → runId: one run per agent at a time

/**
 * One run: a new chat in the agent's project, the request as the message. `handleChatTurn` is
 * passed in (server.js) so this module does not import the server.
 */
export async function runAgent(id, { request, trigger = "manual", env = process.env, handleChatTurn }) {
  const agent = await getAgent(id);
  if (!agent) throw httpError(404, "Agente não encontrado.");
  if (!agent.enabled) throw httpError(409, "O agente está desligado.");
  if (running.has(id)) throw httpError(409, `${agent.name} já está trabalhando.`);
  const text = String(request || agent.trigger.request || "").trim();
  if (!text) throw httpError(400, "Diga o que o agente deve fazer.");
  const db = await ready();
  const runId = randomUUID();
  const conversation = await createConversation({ provider: "local", projectId: agent.projectId, title: `${agent.name}: ${text.slice(0, 40)}` });
  db.prepare("INSERT INTO agent_runs (id, agent_id, conversation_id, request, trigger, status, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?)")
    .run(runId, id, conversation.id, text.slice(0, 4000), trigger, new Date().toISOString());
  running.set(id, runId);
  try {
    const turn = await handleChatTurn({ conversationId: conversation.id, message: text, env });
    const execution = turn.message?.execution || {};
    const steps = execution.toolSteps || [];
    const files = [...new Set(steps.filter((s) => s.ok && ["write_file", "edit_file", "write_document"].includes(s.tool)).map((s) => (s.tool === "write_document" && /^Criei (.+?) \(/.exec(s.summary || "")?.[1]) || resolve(agent.workDir, String(s.args?.path || ""))))];
    db.prepare("UPDATE agent_runs SET status = ?, finished_at = ?, answer = ?, files = ?, steps = ?, checks = ?, review = ?, copies = ?, error = ? WHERE id = ?")
      .run(turn.ok ? "done" : "failed", new Date().toISOString(), String(turn.message?.content || "").slice(0, 20000), JSON.stringify(files), steps.length,
        JSON.stringify(execution.checks || []), execution.review ? JSON.stringify(execution.review) : null, execution.copies ? JSON.stringify(execution.copies) : null, turn.ok ? null : String(turn.error || "falhou").slice(0, 2000), runId);
  } catch (error) {
    db.prepare("UPDATE agent_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(new Date().toISOString(), String(error.message).slice(0, 2000), runId);
  } finally {
    running.delete(id);
  }
  return getRun(runId);
}

export async function getRun(id) {
  const db = await ready();
  return mapRun(db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id));
}

export async function listRuns({ agentId, limit = 50 } = {}) {
  const db = await ready();
  const rows = agentId
    ? db.prepare("SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?").all(agentId, limit)
    : db.prepare("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?").all(limit);
  return rows.map(mapRun);
}

export const isAgentRunning = (id) => running.has(id);

/** Ready-made sector agents for the departments of the registered company folders. */
export const SECTOR_TEMPLATES = {
  RH: "Cuidar das rotinas de pessoal: férias, admissões e desligamentos, quadro de funcionários, benefícios e treinamentos. Produz relatórios e listas em planilha ou texto.",
  Financeiro: "Acompanhar contas a pagar e a receber, inadimplência e fluxo de caixa. Produz listas de cobrança, totais por período e alertas de vencimento.",
  Controladoria: "Acompanhar o orçamento (orçado x realizado), centros de custo e o relatório gerencial. Produz resumos por área e aponta desvios.",
};

export async function createSectorAgents({ baseDir, departments }) {
  const existing = await listAgents();
  const created = [];
  for (const department of departments) {
    if (existing.some((a) => a.kind === "setor" && a.department?.toLowerCase() === department.toLowerCase())) continue;
    const mission = SECTOR_TEMPLATES[department] || `Cuidar das rotinas do setor ${department} a partir dos documentos dele, produzindo relatórios e listas conferíveis.`;
    created.push(await createAgent({ name: `Agente ${department}`, kind: "setor", mission, department, workDir: join(baseDir, department) }));
  }
  return created;
}
