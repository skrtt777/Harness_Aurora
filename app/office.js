// The agents' office: the sessions, agents and helpers of the Harness as people in a room, so you can
// see them work. Each project has its room; the task agents share the team floor. Every character is
// something real, in the state it is really in (nothing is staged):
// - "aurora": a conversation turn running now (or that just ended), one per conversation, each with a
//   name of its own (sessionName); a quiet room keeps its Aurora resting;
// - "agente": a task agent (app/agents.js), working on a run, resting, or called to account after a
//   failed or corrected delivery;
// - "copia": the extra copies of the local model checking an answer (app/copies.js);
// - "professor": Claude or Codex, only while reviewing (app/teachingLoop.js);
// - "chefe": the orchestrator (app/orchestrator.js) and the delivery check: in the meeting while a
//   team request runs, at the desk of whoever must redo, checking what was just delivered.
// buildOffice is pure (tests); officeSnapshot gathers the data.
import { turnSnapshots } from "./pendingTurns.js";

export const TEAM_ROOM = "equipe";
export const LOOSE_ROOM = "geral";
const TEACHERS = { claude: "Claude", codex: "Codex" };

const TOOL_ACTIVITY = [
  [/^(browser|web_fetch|web_search|open_url|navigate)/, "Pesquisando na web"],
  [/^(read_file|list_dir|list_files|glob|search_files|grep)/, "Lendo arquivos"],
  [/^(write_file|edit_file|write_document)/, "Escrevendo a entrega"],
  [/^(run_command|shell|powershell)/, "Rodando um comando"],
  [/^knowledge/, "Buscando nos documentos da empresa"],
  [/^memor/, "Consultando memórias"],
  [/^(open_app|computer|screenshot|click|type_text)/, "Usando um programa"],
  [/^(powerbi|bi_)/, "Montando o Power BI"],
];
const toolActivity = (tool) => (TOOL_ACTIVITY.find(([re]) => re.test(String(tool || ""))) || [null, `Usando ${tool}`])[1];

/** What a running turn is doing, from its stage, steps and approval. */
export function turnState(turn, conversation = null) {
  const stage = String(turn.stage || "");
  const running = turn.steps?.findLast?.((s) => s.status === "running") || null;
  if (turn.approval) return { state: "aguardando", activity: `Esperando sua autorização: ${turn.approval.summary || turn.approval.tool}` };
  const review = /Revisando com (\w+)/i.exec(stage);
  if (review || /Consultando o professor/i.test(stage)) {
    const key = review ? review[1].toLowerCase() : conversation?.teacherProvider || "codex";
    return { state: "revisao", activity: `Em revisão com ${TEACHERS[key] || review?.[1] || "o professor"}`, teacher: TEACHERS[key] ? key : "codex" };
  }
  if (/Refazendo/i.test(stage)) return { state: "refazendo", activity: "Refazendo com as lições do professor" };
  const copies = /com (\d+) c[óo]pias/i.exec(stage);
  if (copies) return { state: "conferindo", activity: `Conferindo a resposta com ${copies[1]} cópias`, copies: Number(copies[1]) };
  if (/Carregando o modelo/i.test(stage)) return { state: "chegando", activity: "Chegando: carregando o modelo local" };
  if (running) return { state: "trabalhando", activity: running.summary || toolActivity(running.tool), tool: running.tool };
  return { state: "pensando", activity: stage || "Pensando" };
}

// ---------------- Names ----------------
// Each Aurora session gets a person's name of its own: one starting with the same letter as its
// conversation's title ("Metas de outubro" -> Marina, Mateus...), chosen by the conversation's id (the
// same session keeps its name), never the same twice in a room.
const NAMES = {
  a: ["Ana", "Arthur", "Alice", "André", "Amanda", "Antônio"], b: ["Bruno", "Beatriz", "Bernardo", "Bianca", "Benício"], c: ["Carla", "Caio", "Camila", "César", "Clara"],
  d: ["Davi", "Daniela", "Diego", "Débora", "Dora"], e: ["Eduardo", "Elisa", "Enzo", "Estela", "Érico"], f: ["Fernanda", "Felipe", "Fábio", "Flávia", "Francisco"],
  g: ["Gabriel", "Giovana", "Gustavo", "Gabriela", "Guilherme"], h: ["Helena", "Heitor", "Hugo", "Heloísa", "Henrique"], i: ["Isabela", "Igor", "Ingrid", "Ítalo", "Iris"],
  j: ["Júlia", "João", "Joana", "Jorge", "Juliano"], k: ["Karina", "Kauã", "Kelly", "Kléber"], l: ["Lucas", "Laura", "Leonardo", "Lívia", "Luana"],
  m: ["Marina", "Mateus", "Mariana", "Miguel", "Mel"], n: ["Natália", "Nicolas", "Nina", "Nelson", "Noemi"], o: ["Otávio", "Olívia", "Oscar", "Odete", "Orlando"],
  p: ["Paulo", "Patrícia", "Pedro", "Paula", "Priscila"], q: ["Quitéria", "Quirino", "Quênia"], r: ["Rafael", "Renata", "Rodrigo", "Raquel", "Rui"],
  s: ["Sofia", "Samuel", "Sara", "Sérgio", "Silvia"], t: ["Tiago", "Tânia", "Tomás", "Teresa", "Túlio"], u: ["Úrsula", "Ulisses", "Ubiratã"],
  v: ["Valentina", "Vinícius", "Vera", "Vitor", "Viviane"], w: ["Wesley", "Wanda", "Wagner", "Wilma"], x: ["Xavier", "Xênia"], y: ["Yasmin", "Yuri"], z: ["Zeca", "Zélia", "Zoe"],
};
const ALL_NAMES = Object.values(NAMES).flat();
const fold = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const hashText = (text) => { let h = 2166136261; for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
/** A session's name: the initial of its title, picked by its id, not one already in the room. */
export function sessionName(title, id, taken = new Set()) {
  const letter = (/[a-z]/.exec(fold(title)) || [""])[0];
  const pool = NAMES[letter] || ALL_NAMES; const h = hashText(id);
  for (const list of [pool, ALL_NAMES]) for (let i = 0; i < list.length; i++) { const n = list[(h + i) % list.length]; if (!taken.has(n)) return n; }
  return `Aurora ${(h % 90) + 10}`;
}

const short = (text, n = 48) => { const s = String(text || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const age = (iso, now) => (iso ? now - new Date(iso).getTime() : Infinity);

/**
 * The office from the facts:
 * projects: [{ id, name, agentId? }] (agent projects belong to the team floor);
 * conversations: Map id -> { id, title, projectId, teacherProvider };
 * turns: { active: [...], ended: [...] } (pendingTurns.turnSnapshots);
 * agents: [{ id, name, kind, department, enabled, projectId }]; runs: recent runs (newest first);
 * orchestrations: recent ones (running first).
 * -> { rooms: [{ id, name, kind, actors: [...] }] }
 */
export function buildOffice({ projects = [], conversations = new Map(), turns = { active: [], ended: [] }, agents = [], runs = [], orchestrations = [], now = Date.now() } = {}) {
  const agentProjects = new Map(agents.map((a) => [a.projectId, a]));
  const rooms = new Map();
  const room = (id, name, kind) => { if (!rooms.has(id)) rooms.set(id, { id, name, kind, actors: [] }); return rooms.get(id); };
  room(TEAM_ROOM, "Equipe de agentes", "equipe");
  for (const p of projects) if (!p.agentId && !agentProjects.has(p.id)) room(p.id, p.name, "projeto");
  const roomOf = (conversation) => {
    const pid = conversation?.projectId;
    if (pid && agentProjects.has(pid)) return TEAM_ROOM;
    if (pid && rooms.has(pid)) return pid;
    return room(LOOSE_ROOM, "Conversas soltas", "geral").id;
  };
  const runByConversation = new Map(runs.map((r) => [r.conversationId, r]));
  const activeById = new Map(turns.active.map((t) => [t.conversationId, t]));
  const add = (roomId, actor) => { rooms.get(roomId).actors.push(actor); return actor; };
  const helpers = (r, owner, s) => {
    if (s.state === "revisao") add(r, { id: `prof:${owner.id}`, kind: "professor", name: TEACHERS[s.teacher], teacher: s.teacher, state: "revisao", activity: `Revisando a entrega de ${owner.name}`, with: owner.id, since: owner.since });
    if (s.state === "conferindo") for (let i = 1; i < Math.min(s.copies || 2, 4); i++) add(r, { id: `copia:${owner.id}:${i}`, kind: "copia", name: `Cópia ${i + 1} de ${owner.name}`, state: "conferindo", activity: `Conferindo a resposta de ${owner.name}`, with: owner.id, since: owner.since });
  };

  // The task agents: each one, in the state of its run (or at rest).
  const runningOrch = orchestrations.find((o) => o.status === "running") || null;
  const inMeeting = new Set(runningOrch ? (runningOrch.plan || []).map((t) => t.agentId).filter(Boolean) : []);
  for (const a of agents) {
    const last = runs.find((r) => r.agentId === a.id) || null;
    const turn = last?.status === "running" ? activeById.get(last.conversationId) : null;
    const base = { id: `agente:${a.id}`, kind: "agente", name: a.name, agentId: a.id, department: a.department || null, conversationId: last?.conversationId || null };
    let actor;
    if (!a.enabled) actor = { ...base, state: "desligado", activity: "Desligado" };
    else if (turn) { const s = turnState(turn, conversations.get(turn.conversationId)); actor = { ...base, ...s, activity: short(s.activity, 60), since: turn.since, task: short(last.request, 80) }; }
    else if (last?.status === "running") actor = { ...base, state: "pensando", activity: "Começando o trabalho", since: new Date(last.startedAt).getTime(), task: short(last.request, 80) };
    else if (inMeeting.has(a.id)) actor = { ...base, state: "reuniao", activity: "Na reunião da equipe", task: short(runningOrch.request, 80) };
    else if (last?.status === "failed" && age(last.finishedAt, now) < 30 * 60_000) actor = { ...base, state: "cobrado", activity: `Não entregou: ${short(last.error || "falhou", 60)}`, since: new Date(last.finishedAt).getTime() };
    else if (last?.status === "done" && last.review?.verdict === "fix" && age(last.finishedAt, now) < 30 * 60_000) actor = { ...base, state: "cobrado", activity: "O professor pediu correções na última entrega", since: new Date(last.finishedAt).getTime() };
    else if (last?.status === "done" && age(last.finishedAt, now) < 10 * 60_000) actor = { ...base, state: "cafe", activity: `Entregou: ${short(last.files?.[0]?.split(/[\\/]/).pop() || last.request, 50)}`, since: new Date(last.finishedAt).getTime() };
    else actor = { ...base, state: "descanso", activity: last ? `Última entrega ${new Date(last.finishedAt || last.startedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Ainda sem trabalho" };
    add(TEAM_ROOM, actor);
    if (turn) helpers(TEAM_ROOM, actor, actor);
  }

  // The Aurora in each conversation working now (agent runs are already on the team floor), each with
  // her own name; the oldest session names first, so a newcomer never takes someone's name.
  const names = new Map();
  const nameIn = (r, c, id) => { if (!names.has(r)) names.set(r, new Set(rooms.get(r).actors.map((a) => a.name))); const n = sessionName(c?.title || "", id, names.get(r)); names.get(r).add(n); return n; };
  for (const t of [...turns.active].sort((a, b) => (a.since || 0) - (b.since || 0))) {
    if (runByConversation.get(t.conversationId)?.status === "running") continue;
    const c = conversations.get(t.conversationId); const r = roomOf(c);
    const s = turnState(t, c);
    const actor = add(r, { id: `aurora:${t.conversationId}`, kind: "aurora", name: nameIn(r, c, t.conversationId), conversationId: t.conversationId, task: short(c?.title || "Conversa", 60), ...s, activity: short(s.activity, 60), since: t.since, plan: t.plan });
    helpers(r, actor, s);
  }
  // Just delivered: a coffee (once per conversation, the latest).
  const seen = new Set();
  for (const e of turns.ended) {
    if (seen.has(e.conversationId) || activeById.has(e.conversationId) || runByConversation.has(e.conversationId)) continue;
    seen.add(e.conversationId);
    const c = conversations.get(e.conversationId); const r = roomOf(c);
    add(r, { id: `aurora:${e.conversationId}`, kind: "aurora", name: nameIn(r, c, e.conversationId), conversationId: e.conversationId, task: short(c?.title || "Conversa", 60), state: e.cancelled ? "descanso" : "cafe", activity: e.cancelled ? "Pedido cancelado" : "Acabou de responder", since: e.endedAt });
  }

  // Each room: its Aurora at rest when nobody is working there, and the boss.
  for (const r of rooms.values()) {
    if (r.kind !== "equipe" && !r.actors.some((a) => a.kind === "aurora")) r.actors.push({ id: `aurora:${r.id}`, kind: "aurora", name: "Aurora", state: "descanso", activity: "Livre: esperando um pedido" });
    const redo = r.actors.find((a) => a.state === "refazendo" || a.state === "cobrado");
    const delivered = r.actors.find((a) => a.state === "cafe" && now - (a.since || 0) < 90_000);
    const boss = { id: `chefe:${r.id}`, kind: "chefe", name: "Chefe", state: "supervisionando", activity: "Acompanhando a equipe" };
    if (r.id === TEAM_ROOM && runningOrch) Object.assign(boss, { state: "reuniao", activity: `Reunião: ${short(runningOrch.request, 60)}`, since: new Date(runningOrch.startedAt).getTime() });
    else if (redo) Object.assign(boss, { state: "cobrando", activity: redo.state === "refazendo" ? `Cobrando qualidade de ${redo.name}` : `Cobrando a entrega de ${redo.name}`, with: redo.id });
    else if (delivered) Object.assign(boss, { state: "conferindo", activity: `Conferindo a entrega de ${delivered.name}`, with: delivered.id });
    else if (r.actors.some((a) => a.state === "aguardando")) Object.assign(boss, { activity: "Esperando sua autorização junto com a equipe" });
    r.actors.push(boss);
  }
  const order = { equipe: 0, projeto: 1, geral: 2 };
  return { rooms: [...rooms.values()].sort((a, b) => order[a.kind] - order[b.kind]), updatedAt: new Date(now).toISOString() };
}

/** The office now, from the store, the agents and the running turns. */
export async function officeSnapshot({ store, agents: agentStore, orchestrator, now = Date.now() }) {
  const turns = turnSnapshots({ now });
  const ids = [...new Set([...turns.active, ...turns.ended].map((t) => t.conversationId))];
  const conversations = new Map((await Promise.all(ids.map((id) => store.getConversation(id).catch(() => null)))).filter(Boolean).map((c) => [c.id, c]));
  const [projects, agents, runs, orchestrations] = await Promise.all([
    store.listProjects(), agentStore.listAgents(), agentStore.listRuns({ limit: 60 }), orchestrator.listOrchestrations(5).catch(() => []),
  ]);
  return buildOffice({ projects, conversations, turns, agents, runs, orchestrations, now });
}
