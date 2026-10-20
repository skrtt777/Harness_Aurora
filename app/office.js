// The agents' office: the sessions, agents and helpers of the Harness as people in a room, so you can
// see them work. Each project has its room; the task agents share the team floor. Every character is
// something real, in the state it is really in (nothing is staged):
// - "aurora": a conversation turn running now (or that just ended), one per conversation, each with a
//   name of its own (sessionName); a quiet room keeps its Aurora resting;
// - "agente": a task agent (app/agents.js), working on a run, resting, or called to account after a
//   failed or corrected delivery;
// - "copia": the extra copies of the local model checking an answer (app/copies.js);
// - "subagente": a subagent the Aurora made for one part of a delivery (agentTools/subagents.js);
// - "professor": Claude or Codex, only while reviewing (app/teachingLoop.js);
// - "forte": Claude or Codex doing a task someone handed it (app/engine.js), in the mirror, blind;
// - "chefe": the orchestrator (app/orchestrator.js) and the delivery check: in the meeting while a
//   team request runs, at the desk of whoever must redo, checking what was just delivered.
// buildOffice is pure (tests); officeSnapshot gathers the data.
import { turnSnapshots } from "./pendingTurns.js";

import { DEPARTMENTS, areaOf, stationOf, fichaOf } from "./headquarters.js";

export const OFFICE_ROOM = "escritorio";
// The HR team (app/hr.js HR_TEAM), here without importing the store.
const HR_PEOPLE = [{ id: "rh:helena", name: "Helena", role: "Avaliação e prêmios" }, { id: "rh:otavio", name: "Otávio", role: "Contratação e desligamento" }];
const TEACHERS = { claude: "Claude", codex: "Codex" };
// The guards (app/chatAgent.js), as the Conferência says them.
const CHECK_LABEL = {
  requested_files_missing: "faltava um arquivo do pedido", claimed_run: "disse que rodou sem rodar", claimed_delivery: "disse que entregou sem gravar",
  dispatch: "a entrega não estava completa", unconfirmed_citations: "citação não confirmada na fonte", requested_files_missing_final: "faltava um arquivo do pedido",
  uncited_source: "citou fonte sem consultar", invented_document: "documento que não existe", data_blanks: "campos em branco", asked_instead_of_doing: "perguntou em vez de fazer",
};

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
  // A strong engine doing the task (app/engine.js), blind in the mirror; then its script run here.
  const doing = /(?:fazendo com o|pediu ajuda ao|; o) (Claude|Codex)/i.exec(stage);
  const here = /rodando aqui o script do (Claude|Codex)/i.exec(stage);
  if (here) return { state: "trabalhando", activity: `Rodando aqui, nos dados reais, o que o ${here[1]} escreveu`, tool: "run_command", engine: here[1].toLowerCase() };
  if (doing) return { state: "delegado", activity: `Passou a tarefa ao ${doing[1]}, sem enviar seus dados`, engine: doing[1].toLowerCase() };
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
 * The office from the facts, one floor for everyone (13/10: "um escritório geral e todos os agents
 * ficam nele"): each person carries the project it works on.
 * projects: [{ id, name, agentId? }];
 * conversations: Map id -> { id, title, projectId, teacherProvider };
 * turns: { active: [...], ended: [...] } (pendingTurns.turnSnapshots);
 * agents: [{ id, name, kind, department, enabled, projectId }]; runs: recent runs (newest first);
 * orchestrations: recent ones (running first);
 * hr: { events: recent HR events (newest first), badges: Map agentId -> { stars, warnings, status } }.
 * -> { rooms: [{ id, name, kind, actors: [...] }] } (one room; the list keeps the API of before)
 */
export function buildOffice({ projects = [], conversations = new Map(), turns = { active: [], ended: [] }, agents = [], runs = [], orchestrations = [], hr = null, now = Date.now() } = {}) {
  const agentProjects = new Map(agents.map((a) => [a.projectId, a]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const floor = { id: OFFICE_ROOM, name: "Escritório Aurora", kind: "geral", actors: [] };
  const projectOf = (conversation) => {
    const pid = conversation?.projectId;
    if (pid && agentProjects.has(pid)) return "Equipe de agentes";
    return (pid && projectName.get(pid)) || "Conversas soltas";
  };
  const runByConversation = new Map(runs.map((r) => [r.conversationId, r]));
  const activeById = new Map(turns.active.map((t) => [t.conversationId, t]));
  const add = (actor) => { floor.actors.push(actor); return actor; };
  const helpers = (owner, s, turn = null) => {
    // The subagents of the turn: each one working on its part (as its own stage and steps say), or,
    // its part delivered, at the café while the Aurora puts it together.
    for (const sa of turn?.subagents || []) {
      const st = sa.done ? (sa.ok ? { state: "cafe", activity: `Entregou a parte: ${sa.task}` } : { state: "cobrado", activity: `Não terminou a parte: ${sa.task}` }) : turnState({ stage: sa.stage, steps: sa.steps });
      add({ id: `sub:${owner.id}:${sa.id}`, kind: "subagente", name: sa.name, task: short(sa.task, 80), project: owner.project, ...st, activity: short(st.activity, 60), with: owner.id, since: sa.done ? sa.endedAt : sa.since });
    }
    // The strong engine at the desk next to whoever handed it the task, working in the mirror.
    if (s.state === "delegado" && TEACHERS[s.engine]) add({ id: `forte:${owner.id}`, kind: "forte", name: TEACHERS[s.engine], teacher: s.engine, project: owner.project, state: "trabalhando", tool: "write_file", activity: `Fazendo a tarefa de ${owner.name} numa cópia com valores falsos`, with: owner.id, since: owner.since });
    if (s.state === "revisao") add({ id: `prof:${owner.id}`, kind: "professor", name: TEACHERS[s.teacher], teacher: s.teacher, project: owner.project, state: "revisao", activity: `Revisando a entrega de ${owner.name}`, with: owner.id, since: owner.since });
    if (s.state === "conferindo") for (let i = 1; i < Math.min(s.copies || 2, 4); i++) add({ id: `copia:${owner.id}:${i}`, kind: "copia", name: `Cópia ${i + 1} de ${owner.name}`, project: owner.project, state: "conferindo", activity: `Conferindo a resposta de ${owner.name}`, with: owner.id, since: owner.since });
  };

  // The task agents: each one, in the state of its run (or at rest), with its HR badge.
  const runningOrch = orchestrations.find((o) => o.status === "running") || null;
  const inMeeting = new Set(runningOrch ? (runningOrch.plan || []).map((t) => t.agentId).filter(Boolean) : []);
  for (const a of agents) {
    const last = runs.find((r) => r.agentId === a.id) || null;
    const turn = last?.status === "running" ? activeById.get(last.conversationId) : null;
    const badge = hr?.badges?.get(a.id);
    const base = { id: `agente:${a.id}`, kind: "agente", name: a.name, agentId: a.id, department: a.department || null, ...(TEACHERS[a.engine] ? { engine: a.engine } : {}), project: "Equipe de agentes", conversationId: last?.conversationId || null, ...(badge ? { stars: badge.stars, warnings: badge.warnings } : {}) };
    let actor;
    if (!a.enabled) actor = { ...base, state: "desligado", activity: badge?.status === "demitido" ? "Desligado pelo RH" : "Desligado" };
    else if (turn) { const s = turnState(turn, conversations.get(turn.conversationId)); actor = { ...base, ...s, activity: short(s.activity, 60), since: turn.since, task: short(last.request, 80) }; }
    else if (last?.status === "running") actor = { ...base, state: "pensando", activity: "Começando o trabalho", since: new Date(last.startedAt).getTime(), task: short(last.request, 80) };
    else if (inMeeting.has(a.id)) actor = { ...base, state: "reuniao", activity: "Na reunião da equipe", task: short(runningOrch.request, 80) };
    else if (last?.status === "failed" && age(last.finishedAt, now) < 30 * 60_000) actor = { ...base, state: "cobrado", activity: `Não entregou: ${short(last.error || "falhou", 60)}`, since: new Date(last.finishedAt).getTime() };
    else if (last?.status === "done" && last.review?.verdict === "fix" && age(last.finishedAt, now) < 30 * 60_000) actor = { ...base, state: "cobrado", activity: "O professor pediu correções na última entrega", since: new Date(last.finishedAt).getTime() };
    else if (last?.status === "done" && age(last.finishedAt, now) < 10 * 60_000) actor = { ...base, state: "cafe", activity: `Entregou: ${short(last.files?.[0]?.split(/[\\/]/).pop() || last.request, 50)}`, since: new Date(last.finishedAt).getTime() };
    else actor = { ...base, state: "descanso", activity: last ? `Última entrega ${new Date(last.finishedAt || last.startedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Ainda sem trabalho" };
    add(actor);
    if (turn) helpers(actor, actor, turn);
  }

  // The Aurora in each conversation working now (agent runs are already there as agents), each with
  // her own name; the oldest session names first, so a newcomer never takes someone's name.
  const names = new Set(floor.actors.map((a) => a.name));
  const nameFor = (c, id) => { const n = sessionName(c?.title || "", id, names); names.add(n); return n; };
  for (const t of [...turns.active].sort((a, b) => (a.since || 0) - (b.since || 0))) {
    if (runByConversation.get(t.conversationId)?.status === "running") continue;
    const c = conversations.get(t.conversationId);
    const s = turnState(t, c);
    const actor = add({ id: `aurora:${t.conversationId}`, kind: "aurora", name: nameFor(c, t.conversationId), conversationId: t.conversationId, project: projectOf(c), task: short(c?.title || "Conversa", 60), ...s, activity: short(s.activity, 60), since: t.since, plan: t.plan });
    helpers(actor, s, t);
  }
  // Just delivered: a coffee (once per conversation, the latest).
  const seen = new Set();
  for (const e of turns.ended) {
    if (seen.has(e.conversationId) || activeById.has(e.conversationId) || runByConversation.has(e.conversationId)) continue;
    seen.add(e.conversationId);
    const c = conversations.get(e.conversationId);
    add({ id: `aurora:${e.conversationId}`, kind: "aurora", name: nameFor(c, e.conversationId), conversationId: e.conversationId, project: projectOf(c), task: short(c?.title || "Conversa", 60), state: e.cancelled ? "descanso" : "cafe", activity: e.cancelled ? "Pedido cancelado" : "Acabou de responder", since: e.endedAt });
  }
  if (!floor.actors.some((a) => a.kind === "aurora")) add({ id: "aurora:livre", kind: "aurora", name: "Aurora", state: "descanso", activity: "Livre: esperando um pedido" });

  // The HR team: at their desks following the grades, or with whoever they are rewarding, warning,
  // dismissing or welcoming now (the events of the last minutes).
  if (hr) {
    const recent = (hr.events || []).filter((e) => now - e.at < 10 * 60_000 && e.kind !== "avaliacao");
    const reviewing = (hr.events || []).find((e) => e.kind === "avaliacao" && now - e.at < 2 * 60_000);
    for (const member of HR_PEOPLE) {
      const e = recent.find((x) => x.by === member.name);
      const target = e ? floor.actors.find((a) => a.agentId === (e.kind === "contratacao" ? e.agentId : e.agentId)) : null;
      const doing = e && target ? {
        premio: { state: "premiando", activity: `Entregando uma estrela a ${target.name}` },
        elogio: { state: "premiando", activity: `Elogiando ${target.name}: melhorou` },
        advertencia: { state: "orientando", activity: `Passando o plano de melhoria a ${target.name}` },
        demissao: { state: "desligando", activity: `Desligando ${target.name}` },
        contratacao: { state: "entrevistando", activity: `Recebendo ${target.name}, recém-contratado` },
        recontratacao: { state: "entrevistando", activity: `Recebendo ${target.name} de volta` },
      }[e.kind] : null;
      const still = reviewing ? { state: "avaliando", activity: "Avaliando as entregas da equipe" } : { state: "trabalhando", activity: member.role === "Avaliação e prêmios" ? "Acompanhando as notas da equipe" : "Cuidando das vagas da equipe" };
      add({ id: member.id, kind: "rh", name: member.name, project: "RH", ...(doing || still), ...(doing ? { with: target.id, since: e.at } : {}) });
      // The one being welcomed sits in the meeting with HR.
      if (doing?.state === "entrevistando" && target && target.state === "descanso") Object.assign(target, { state: "reuniao", activity: "Integração com o RH", with: member.id });
    }
  }

  // The boss of the floor.
  const redo = floor.actors.find((a) => a.state === "refazendo" || a.state === "cobrado");
  const delivered = floor.actors.find((a) => a.state === "cafe" && now - (a.since || 0) < 90_000);
  const boss = { id: "chefe", kind: "chefe", name: "Chefe", state: "supervisionando", activity: "Acompanhando a equipe" };
  if (runningOrch) Object.assign(boss, { state: "reuniao", activity: `Reunião: ${short(runningOrch.request, 60)}`, since: new Date(runningOrch.startedAt).getTime() });
  else if (redo) Object.assign(boss, { state: "cobrando", activity: redo.state === "refazendo" ? `Cobrando qualidade de ${redo.name}` : `Cobrando a entrega de ${redo.name}`, with: redo.id });
  else if (delivered) Object.assign(boss, { state: "conferindo", activity: `Conferindo a entrega de ${delivered.name}`, with: delivered.id });
  else if (floor.actors.some((a) => a.state === "aguardando")) Object.assign(boss, { activity: "Esperando sua autorização junto com a equipe" });
  floor.actors.push(boss);

  // The Sede: each person in the room of its station, each request with its ficha (headquarters.js).
  const areaOfConversation = new Map();
  const areaFor = (a) => {
    if (a.kind === "agente") return areaOf(`${a.department || ""} ${a.name || ""} ${a.task || ""}`);
    const owner = a.with ? floor.actors.find((o) => o.id === a.with) : null;
    if (owner && owner !== a) return areaFor(owner);
    if (!a.conversationId) return "operacoes";
    if (!areaOfConversation.has(a.conversationId)) { const c = conversations.get(a.conversationId); areaOfConversation.set(a.conversationId, areaOf(`${c?.title || ""} ${a.task || ""}`)); }
    return areaOfConversation.get(a.conversationId);
  };
  const turnOf = (a) => activeById.get(a.conversationId) || null;
  for (const a of floor.actors) {
    const t = turnOf(a);
    const area = areaFor(a);
    const just = a.state === "cafe" && now - (a.since || 0) < 60_000 && (a.kind === "aurora" || a.kind === "agente");
    Object.assign(a, just ? { room: "expedicao", station: "expedicao", area } : { ...stationOf({ state: a.state, tool: a.tool, kind: a.kind, area, checkedAt: a.kind === "aurora" || a.kind === "agente" ? t?.checkedAt || 0 : 0, now }), area });
    if (a.room === "conferencia" && t?.lastCheck) a.activity = `Na Conferência: ${CHECK_LABEL[t.lastCheck] || t.lastCheck}`;
  }
  const fichas = [];
  for (const t of turns.active) {
    const c = conversations.get(t.conversationId);
    const owner = floor.actors.find((a) => a.conversationId === t.conversationId && (a.kind === "aurora" || a.kind === "agente"));
    fichas.push({ ...fichaOf({ conversationId: t.conversationId, title: c?.title || owner?.task, request: owner?.task, steps: (t.tools || []).map((tool) => ({ tool })), station: owner?.station || "recepcao", review: t.reviewed, checks: t.checks }), who: owner?.name || null, since: t.since || null, order: t.order ? { deliver: t.order.deliver, rules: t.order.rules, run: t.order.run } : null });
  }
  for (const e of turns.ended.slice(0, 6)) {
    if (activeById.has(e.conversationId) || fichas.some((f) => f.id === e.conversationId) || now - e.endedAt > 10 * 60_000) continue;
    const c = conversations.get(e.conversationId);
    fichas.push({ ...fichaOf({ conversationId: e.conversationId, title: c?.title, steps: (e.tools || []).map((tool) => ({ tool })), review: e.reviewed, checks: e.checks, ended: true, ok: !e.cancelled }), who: floor.actors.find((a) => a.conversationId === e.conversationId)?.name || null, endedAt: e.endedAt });
  }
  return { rooms: [floor], departments: DEPARTMENTS, fichas, updatedAt: new Date(now).toISOString() };
}

/** The office now, from the store, the agents and the running turns. */
export async function officeSnapshot({ store, agents: agentStore, orchestrator, hr: hrStore = null, now = Date.now() }) {
  const turns = turnSnapshots({ now });
  const ids = [...new Set([...turns.active, ...turns.ended].map((t) => t.conversationId))];
  const conversations = new Map((await Promise.all(ids.map((id) => store.getConversation(id).catch(() => null)))).filter(Boolean).map((c) => [c.id, c]));
  const [projects, agents, runs, orchestrations, events, badges] = await Promise.all([
    store.listProjects(), agentStore.listAgents(), agentStore.listRuns({ limit: 60 }), orchestrator.listOrchestrations(5).catch(() => []),
    hrStore ? hrStore.recentHrEvents(15 * 60_000, now).catch(() => []) : [], hrStore ? hrStore.hrBadges().catch(() => new Map()) : new Map(),
  ]);
  // The HR review once an hour, in the background (it only reads the runs).
  hrStore?.reviewIfDue(now);
  return buildOffice({ projects, conversations, turns, agents, runs, orchestrations, hr: hrStore ? { events, badges } : null, now });
}
