// MemoryGraphAdapter: the Mapa Vivo's data layer, apart from the drawing. It turns the real snapshot of the
// memory (app/memoryGraph.js) into nodes, edges, clusters and indicators — nothing invented: a node is a
// stored memory, an edge is an explicit relation or a measured embedding similarity, a cluster is a semantic
// group from the atlas, a project/folder, a conversation, or the general memory.
import type { GraphMemory, MemoryGraphSnapshot, MemoryLiveEvent } from "../api";

export type ViewMode = "geral" | "pasta" | "conversa";
export type Category = "geral" | "conversa" | "projeto" | "conhecimento";
export type EdgeKind = "relacao" | "semantica";

export const CATEGORY_LABEL: Record<Category, string> = { geral: "Memória geral", conversa: "Conversas", projeto: "Projetos e pastas", conhecimento: "Conhecimento associado" };
// The palette of the brief: turquoise general memory, pink conversations, amber projects, violet knowledge;
// green marks real activity (recalled or created just now), not a category.
export const CATEGORY_COLOR: Record<Category, string> = { geral: "#3fd6c6", conversa: "#f05a8c", projeto: "#e8b04a", conhecimento: "#9b7cf0" };
export const ACTIVITY_COLOR = "#6fdc8c";
export const RELATION_LABEL: Record<string, string> = { belonging: "pertencimento", thematic: "temática", derivation: "derivação", correction: "correção" };

export type GraphNode = { id: string; label: string; category: Category; clusterId: string; relevance: number; createdAt: number; memory: GraphMemory };
export type GraphEdge = { id: string; from: string; to: string; kind: EdgeKind; weight: number; type?: string; cross: boolean };
/** The links between two clusters, aggregated into one long arc (count of real links, their mean strength). */
export type GraphBridge = { a: string; b: string; count: number; weight: number };
export type GraphCluster = { id: string; label: string; sublabel: string; category: Category; nodeIds: string[]; general: boolean };
export type GraphStats = {
  memories: number; edges: number; clusters: number;
  byCategory: Record<Category, number>;
  edgesByKind: Record<EdgeKind, number>;
  relationTypes: Record<string, number>;
  similarity: number[];           // histogram of semantic links: 0.5–0.6, …, 0.9–1.0
  embedded: number;               // memories with a position in the semantic atlas
};
export type MemoryGraph = { nodes: GraphNode[]; edges: GraphEdge[]; bridges: GraphBridge[]; clusters: GraphCluster[]; stats: GraphStats; mode: ViewMode };
export type Filters = { query?: string; projectId?: string; conversationId?: string; sinceDays?: number; minRelevance?: number; categories?: Category[] };

const GENERAL = "geral";
const MAX_SEMANTIC_PER_NODE = 3;

/** Which colour family a memory belongs to. */
export function categoryOf(m: Pick<GraphMemory, "scope" | "kind" | "source">): Category {
  if (m.kind === "imported" || /conhecimento|documento|knowledge|base de/i.test(m.source || "")) return "conhecimento";
  return m.scope === "project" ? "projeto" : m.scope === "conversation" ? "conversa" : "geral";
}

/** How much a memory has proven itself (uses, helped, failed), 0–1; 0 for a memory never used. */
export function relevanceOf(m: Pick<GraphMemory, "uses" | "helped" | "failed">): number {
  const score = (m.uses || 0) + 2 * (m.helped || 0) - (m.failed || 0);
  return score <= 0 ? 0 : Math.min(1, Math.log1p(score) / Math.log1p(30));
}

/**
 * The Paper Lab's split: a memory is "comprovada" once it has proven itself (used or helped in an answer) or a
 * person wrote or imported it; one the Aurora extracted and nobody used yet, or one the Zeladora flagged, is
 * still "em revisão".
 */
export type Review = "comprovada" | "revisar";
export function reviewOf(m: Pick<GraphMemory, "uses" | "helped" | "kind">, flagged = false): Review {
  if (flagged) return "revisar";
  return (m.uses || 0) > 0 || (m.helped || 0) > 0 || m.kind === "manual" || m.kind === "imported" ? "comprovada" : "revisar";
}

const short = (s: string, n = 34) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const fold = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Whether a memory passes the filters (search on title, text, tags and id). */
export function matches(m: GraphMemory, f: Filters = {}, now = Date.now()): boolean {
  if (f.projectId) {
    if (m.projectId !== f.projectId && !(m.scope === "conversation" && f.projectId === (m as GraphMemory & { conversationProject?: string }).conversationProject)) return false;
  }
  if (f.conversationId && m.conversationId !== f.conversationId) return false;
  if (f.sinceDays && now - Date.parse(m.createdAt) > f.sinceDays * 86_400_000) return false;
  if (f.minRelevance && relevanceOf(m) < f.minRelevance) return false;
  if (f.categories?.length && !f.categories.includes(categoryOf(m))) return false;
  if (f.query?.trim()) {
    const q = fold(f.query.trim());
    const hay = fold([m.title, m.snippet || "", m.tags.join(" "), m.id].join(" "));
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** The cluster a memory goes in, for a view mode. The general memory always has its own. */
function clusterFor(m: GraphMemory, mode: ViewMode, atlasCluster: number | undefined, convProject: Map<string, string | null>, nodes = false): { id: string; label: string; sublabel: string; category: Category } {
  // With the Zeladora's nodes, the general memory is in its node like any other (it has thoughts too).
  if (nodes && mode === "geral" && atlasCluster !== undefined && atlasCluster >= 0) return { id: `sem:${atlasCluster}`, label: "", sublabel: "nódulo da zeladora", category: categoryOf(m) };
  if (m.scope === "global") return { id: GENERAL, label: "memória geral", sublabel: "identidade e contexto global", category: "geral" };
  if (mode === "geral") {
    if (atlasCluster !== undefined && atlasCluster >= 0) return { id: `sem:${atlasCluster}`, label: "", sublabel: "agrupamento semântico", category: categoryOf(m) };
    return { id: `cat:${categoryOf(m)}`, label: CATEGORY_LABEL[categoryOf(m)].toLowerCase(), sublabel: "sem posição semântica", category: categoryOf(m) };
  }
  if (mode === "pasta") {
    const project = m.projectId || (m.conversationId ? convProject.get(m.conversationId) || null : null);
    return project ? { id: `proj:${project}`, label: "", sublabel: "projeto / pasta", category: "projeto" } : { id: "soltas", label: "conversas soltas", sublabel: "sem projeto", category: "conversa" };
  }
  if (m.conversationId) return { id: `conv:${m.conversationId}`, label: "", sublabel: "conversa", category: "conversa" };
  return { id: `proj:${m.projectId}`, label: "", sublabel: "projeto / pasta", category: "projeto" };
}

/**
 * The graph for a view mode and filters. Edges only between visible memories; semantic links are the atlas's
 * measured neighbours (similarity ≥ 0.5 there), at most 3 per memory, each pair once.
 */
export function buildMemoryGraph(snap: MemoryGraphSnapshot, { mode = "geral", filters = {}, now = Date.now() }: { mode?: ViewMode; filters?: Filters; now?: number } = {}): MemoryGraph {
  const convProject = new Map(snap.conversations.map((c) => [c.id, c.projectId]));
  const projectName = new Map(snap.projects.map((p) => [p.id, p.name]));
  const convTitle = new Map(snap.conversations.map((c) => [c.id, c.title]));
  const atlasById = new Map((snap.atlas?.points || []).map((p) => [p.id, p]));
  const atlasLabel = new Map((snap.atlas?.clusters || []).map((c) => [c.id, c.label]));
  const withProject = snap.memories.map((m) => Object.assign({}, m, { conversationProject: m.conversationId ? convProject.get(m.conversationId) || undefined : undefined }));
  const visible = withProject.filter((m) => matches(m, filters, now));
  const ids = new Set(visible.map((m) => m.id));

  const clusters = new Map<string, GraphCluster>();
  const nodes: GraphNode[] = visible.map((m) => {
    const c = clusterFor(m, mode, atlasById.get(m.id)?.cluster, convProject, Boolean(snap.atlas?.nodes));
    if (!clusters.has(c.id)) {
      const label = c.label
        || (c.id.startsWith("sem:") ? atlasLabel.get(Number(c.id.slice(4))) || "agrupamento" : "")
        || (c.id.startsWith("proj:") ? projectName.get(c.id.slice(5)) || "projeto" : "")
        || (c.id.startsWith("conv:") ? convTitle.get(c.id.slice(5)) || "conversa" : "");
      clusters.set(c.id, { id: c.id, label: short(label, 28).toLowerCase(), sublabel: c.sublabel, category: c.category, nodeIds: [], general: c.id === GENERAL });
    }
    clusters.get(c.id)!.nodeIds.push(m.id);
    return { id: m.id, label: short(m.title), category: categoryOf(m), clusterId: c.id, relevance: relevanceOf(m), createdAt: Date.parse(m.createdAt) || 0, memory: m };
  });
  // A semantic group most of whose memories (60%+) come from one project or conversation takes its name;
  // otherwise it keeps the atlas's keywords. The colour follows its members' main category.
  const byId = new Map(withProject.map((m) => [m.id, m]));
  for (const c of clusters.values()) {
    if (!c.id.startsWith("sem:")) continue;
    const tally = new Map<string, number>();
    const cats = new Map<Category, number>();
    for (const id of c.nodeIds) {
      const m = byId.get(id)!;
      const home = m.projectId ? `p:${m.projectId}` : m.conversationProject ? `p:${m.conversationProject}` : m.conversationId ? `c:${m.conversationId}` : "";
      if (home) tally.set(home, (tally.get(home) || 0) + 1);
      cats.set(categoryOf(m), (cats.get(categoryOf(m)) || 0) + 1);
    }
    const [home, count] = [...tally].sort((a, b) => b[1] - a[1])[0] || ["", 0];
    if (home && count / c.nodeIds.length >= 0.6) {
      const name = home.startsWith("p:") ? projectName.get(home.slice(2)) : convTitle.get(home.slice(2));
      if (name) { c.sublabel = `semântico · ${c.label}`; c.label = short(name, 28).toLowerCase(); }
    }
    c.category = [...cats].sort((a, b) => b[1] - a[1])[0]?.[0] || c.category;
  }
  // Two cells of the same project get the same name: each keeps its own subject (the atlas's keyword).
  const byLabel = new Map<string, GraphCluster[]>();
  for (const c of clusters.values()) byLabel.set(c.label, [...(byLabel.get(c.label) || []), c]);
  for (const group of byLabel.values()) {
    if (group.length < 2) continue;
    group.forEach((c, i) => {
      const words = c.sublabel.startsWith("semântico · ") ? c.sublabel.slice("semântico · ".length).split(/\s*·\s*|\s+/) : [];
      const keyword = words.find((w) => w && !c.label.includes(w));
      c.label = keyword ? `${c.label} · ${keyword}` : `${c.label} ${i + 1}`;
    });
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const r of snap.relations) {
    if (!ids.has(r.from) || !ids.has(r.to) || seen.has(pair(r.from, r.to))) continue;
    seen.add(pair(r.from, r.to));
    edges.push({ id: `r:${pair(r.from, r.to)}`, from: r.from, to: r.to, kind: "relacao", weight: 1, type: r.type, cross: false });
  }
  for (const p of snap.atlas?.points || []) {
    if (!ids.has(p.id)) continue;
    for (const n of p.neighbors.slice(0, MAX_SEMANTIC_PER_NODE)) {
      if (!ids.has(n.id) || seen.has(pair(p.id, n.id))) continue;
      seen.add(pair(p.id, n.id));
      edges.push({ id: `s:${pair(p.id, n.id)}`, from: p.id, to: n.id, kind: "semantica", weight: n.similarity, cross: false });
    }
  }

  // Links between two different clusters are drawn aggregated: one long arc per pair of clusters (LOD).
  const clusterOfNode = new Map(nodes.map((n) => [n.id, n.clusterId]));
  const bridgeMap = new Map<string, GraphBridge>();
  for (const e of edges) {
    const a = clusterOfNode.get(e.from)!; const b = clusterOfNode.get(e.to)!;
    if (a === b) continue;
    e.cross = true;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const bridge = bridgeMap.get(key) || { a: a < b ? a : b, b: a < b ? b : a, count: 0, weight: 0 };
    bridge.weight = (bridge.weight * bridge.count + e.weight) / (bridge.count + 1);
    bridge.count += 1;
    bridgeMap.set(key, bridge);
  }

  const byCategory: Record<Category, number> = { geral: 0, conversa: 0, projeto: 0, conhecimento: 0 };
  for (const n of nodes) byCategory[n.category] += 1;
  const relationTypes: Record<string, number> = {};
  const similarity = [0, 0, 0, 0, 0];
  for (const e of edges) {
    if (e.kind === "relacao") relationTypes[e.type || "outra"] = (relationTypes[e.type || "outra"] || 0) + 1;
    else similarity[Math.max(0, Math.min(4, Math.floor((e.weight - 0.5) * 10)))] += 1;
  }
  return {
    mode, nodes, edges,
    bridges: [...bridgeMap.values()].sort((a, b) => b.count - a.count),
    clusters: [...clusters.values()].sort((a, b) => (a.general ? -1 : b.general ? 1 : b.nodeIds.length - a.nodeIds.length || a.id.localeCompare(b.id))),
    stats: {
      memories: nodes.length, edges: edges.length, clusters: clusters.size, byCategory,
      edgesByKind: { relacao: edges.filter((e) => e.kind === "relacao").length, semantica: edges.filter((e) => e.kind === "semantica").length },
      relationTypes, similarity, embedded: visible.filter((m) => atlasById.has(m.id)).length,
    },
  };
}

/**
 * A live event applied to the snapshot, incrementally (no refetch for what the event carries): a memory
 * created with its known fields, deleted or archived ones removed. "updated" and "recalled" change nothing
 * structural; the view reacts to them (pulses) and refreshes the snapshot quietly when it needs the text.
 */
export function applyEvent(snap: MemoryGraphSnapshot, event: MemoryLiveEvent): { snapshot: MemoryGraphSnapshot; needsRefresh: boolean } {
  if ((event.type === "deleted" || event.type === "archived") && event.id) {
    return { snapshot: { ...snap, memories: snap.memories.filter((m) => m.id !== event.id), relations: snap.relations.filter((r) => r.from !== event.id && r.to !== event.id) }, needsRefresh: false };
  }
  if (event.type === "created" && event.id && !snap.memories.some((m) => m.id === event.id)) {
    const memory: GraphMemory = {
      id: event.id, title: event.title || "Nova memória", scope: (event.scope as GraphMemory["scope"]) || "global",
      projectId: event.projectId || null, conversationId: event.conversationId || null, kind: event.kind || "extracted", source: null,
      tags: [], snippet: null, sensitive: false, createdAt: event.at, updatedAt: event.at, uses: 0, helped: 0, failed: 0, status: "active",
    };
    // Its text, tags and semantic neighbours come with the next quiet refresh.
    return { snapshot: { ...snap, memories: [...snap.memories, memory] }, needsRefresh: true };
  }
  if (event.type === "updated" || event.type === "restored") return { snapshot: snap, needsRefresh: true };
  // The Zeladora changed her nodes (a memory adopted, a node born or folded): the sections come with a refresh.
  if (event.type === "keeper" && (event.action === "adopt" || event.action === "node-born" || event.action === "node-gone" || event.action === "plant")) return { snapshot: snap, needsRefresh: true };
  // The Zeladora linked two memories: the relation is real from now on.
  if (event.type === "keeper" && event.action === "link" && event.from && event.to && !snap.relations.some((r) => r.from === event.from && r.to === event.to)) {
    return { snapshot: { ...snap, relations: [...snap.relations, { from: event.from, to: event.to, type: "thematic" }] }, needsRefresh: false };
  }
  return { snapshot: snap, needsRefresh: false };
}

/**
 * A Zeladora as the map follows her (app/memoryKeeper.js): a spider on the web of memories. Where she is, the
 * memories she just read (her tentacles reach them) and what kind each one is, the links she made a moment ago
 * (threads), the open flags (marks), the compactions and joins she can undo, and which memories she has read in
 * this round (each section's progress). Built from the snapshot's `keeper`, then only from "keeper" events.
 */
export type KeeperView = {
  enabled: boolean; running: boolean; phase: string; round: number; current: string | null; area: string | null; areaLabel: string | null;
  trail: string[]; readIds: string[]; kinds: Record<string, string>; links: { from: string; to: string; at: number }[];
  /** When each memory of the trail was read (ms): her tentacle reaches it, then reads it back. */
  trailAt: Record<string, number>;
  /** What she is doing now, in words (her speech bubble), and when it started. */
  saying: { text: string; action: string; at: number } | null;
  /** The section the person called her to, while she is there. */
  called: string | null;
  flags: { id: string; otherId: string | null; reason: string; title?: string; otherTitle?: string }[];
  joins: { kept: string; archived: string; title?: string; archivedTitle?: string; at: string }[];
  compactions: { id: string; from: string[]; title?: string; at: string }[];
  /** The obsolete memories she pruned (archived; undo brings one back). */
  prunes: { id: string; title?: string; reason: string; byTitle?: string | null; at: string }[];
  /** What she just did to the shape of the field, for the map to show it (newest first, a few seconds each). */
  growth: Growth[];
  /** Her nodes: the sections of the map. */
  nodes: { id: number; label: string; count: number }[];
  areas: { key: string; label: string; total: number; read: number }[];
  stats: { read: number; linked: number; joined: number; compacted: number; flagged: number; pruned: number; born: number; folded: number; adopted: number };
  restUntil: string | null;
};
/**
 * prune: a leaf she cut (it falls); arrival: a new memory she goes to; adopt: a new memory put in its node (it
 * grows in); born: a new node (split from `from`, or sprouted for a new subject); gone: a node folded into `into`.
 */
export type Growth = { kind: "prune" | "arrival" | "adopt" | "born" | "gone"; id?: string; section?: string; from?: string | null; into?: string | null; label?: string; reason?: string; at: number };
const TRAIL = 22;
const GROWTH = 16;
const emptyKeeperStats = () => ({ read: 0, linked: 0, joined: 0, compacted: 0, flagged: 0, pruned: 0, born: 0, folded: 0, adopted: 0 });
export function keeperFromSnapshot(k: MemoryGraphSnapshot["keeper"]): KeeperView | null {
  if (!k) return null;
  return {
    enabled: k.enabled, running: Boolean(k.running), phase: k.phase, round: k.round, current: k.current, area: k.area, areaLabel: k.areaLabel,
    trail: k.current ? [k.current] : [], readIds: k.readIds || [], kinds: {}, links: [], flags: k.flags || [], trailAt: {}, called: k.visiting || null,
    saying: k.phase === "descansando" ? { text: "descansando", action: "rest", at: 0 } : k.areaLabel ? { text: `andando por ${k.areaLabel}`, action: "walk", at: 0 } : null,
    joins: (k.recent || []).filter((a) => a.action === "join").map((a) => ({ kept: a.kept!, archived: a.archived!, title: a.title, archivedTitle: a.archivedTitle, at: a.at })),
    compactions: (k.compactions || []).map((c) => ({ id: c.id, from: c.from, title: c.title, at: c.at })),
    prunes: (k.prunes || []).map((p) => ({ id: p.id, title: p.title, reason: p.reason, byTitle: p.byTitle, at: p.at })),
    growth: [], nodes: (k.nodes || []).map((n) => ({ id: n.id, label: n.label, count: n.count })),
    areas: k.sections || k.areas || [], stats: { ...emptyKeeperStats(), ...k.stats }, restUntil: k.restUntil,
  };
}
export function reduceKeeper(view: KeeperView | null, event: MemoryLiveEvent, now = Date.now()): KeeperView | null {
  if (event.type !== "keeper" || !event.action) return view;
  const base: KeeperView = view || { enabled: true, running: true, phase: "andando", round: 0, current: null, area: null, areaLabel: null, trail: [], readIds: [], kinds: {}, links: [], flags: [], joins: [], compactions: [], prunes: [], growth: [], nodes: [], areas: [], stats: emptyKeeperStats(), restUntil: null, trailAt: {}, saying: null, called: null };
  const say = (text: string) => ({ text, action: event.action!, at: now });
  const short = (t?: string) => (t ? (t.length > 34 ? `«${t.slice(0, 33)}…»` : `«${t}»`) : "uma memória");
  // Any event from her means she is running here.
  const v = base.running ? base : { ...base, running: true };
  const grow = (g: Omit<Growth, "at">) => [{ ...g, at: now }, ...v.growth.filter((x) => now - x.at < 20_000)].slice(0, GROWTH);
  switch (event.action) {
    case "prune": return event.id ? { ...v, saying: say(`podando ${short(event.title)} · ${event.reason || "obsoleta"}`), current: v.current === event.id ? null : v.current, trail: v.trail.filter((x) => x !== event.id), prunes: [{ id: event.id, title: event.title, reason: event.reason || "", byTitle: event.byTitle, at: event.at }, ...v.prunes.filter((p) => p.id !== event.id)].slice(0, 30), growth: grow({ kind: "prune", id: event.id, section: event.section, reason: event.reason, label: event.title }), stats: { ...v.stats, pruned: v.stats.pruned + 1 } } : v;
    case "arrival": return event.id ? { ...v, saying: say(`memória nova · ${short(event.title)}`), growth: grow({ kind: "arrival", id: event.id, label: event.title }) } : v;
    case "adopt": return event.id ? { ...v, saying: say(`${short(event.title)} entra no nódulo ${event.label || ""}`), growth: grow({ kind: "adopt", id: event.id, section: event.section, label: event.label }), stats: { ...v.stats, adopted: v.stats.adopted + 1 } } : v;
    case "plant": return { ...v, saying: say(`plantou ${event.nodes?.length || 0} nódulos`) };
    case "node-born": return { ...v, saying: say(event.parentLabel ? `nódulo novo · ${event.label} (saiu de ${event.parentLabel})` : `nódulo novo · ${event.label} (assunto novo)`), growth: grow({ kind: "born", section: event.section, from: event.parentSection || null, label: event.label }), stats: { ...v.stats, born: v.stats.born + 1 } };
    case "node-gone": return { ...v, saying: say(event.intoLabel ? `recolheu o nódulo ${event.label} em ${event.intoLabel}` : `o nódulo ${event.label} ficou vazio e saiu`), growth: grow({ kind: "gone", section: event.section, into: event.intoSection || null, label: event.label }), stats: { ...v.stats, folded: v.stats.folded + 1 } };
    case "called": return { ...v, saying: say(`chamada: ${event.label || "a seu pedido"} · ${event.total || 0} memórias`) };
    case "round": return { ...v, enabled: true, phase: "andando", round: event.round ?? v.round + 1, areas: (event.sections || event.areas || []).map((a) => ({ ...a, read: 0 })), readIds: [], stats: emptyKeeperStats(), restUntil: null };
    case "walk": return { ...v, phase: "andando", area: event.section || event.area || null, areaLabel: event.label || null, trail: [], called: event.called ? event.label || "a seu pedido" : null, saying: say(event.called ? `indo até ${event.label}` : event.back ? `voltando para ${event.label}` : `andando para ${event.label}`) };
    case "read": {
      if (!event.id) return v;
      const section = event.section || event.area;
      const areas = v.areas.map((a) => (a.key === section ? { ...a, read: Math.min(a.total, a.read + 1) } : a));
      const trailAt = { ...v.trailAt, [event.id]: now };
      for (const id of Object.keys(trailAt)) if (now - trailAt[id] > 120_000) delete trailAt[id];
      return { ...v, phase: "andando", current: event.id, trailAt, saying: say(`lendo ${short(event.title)}${event.kind ? ` · ${event.kind}` : ""}`), trail: [event.id, ...v.trail.filter((x) => x !== event.id)].slice(0, TRAIL), readIds: v.readIds.includes(event.id) ? v.readIds : [...v.readIds, event.id], kinds: event.kind ? { ...v.kinds, [event.id]: event.kind } : v.kinds, areas, stats: { ...v.stats, read: v.stats.read + 1 } };
    }
    case "link": return event.from && event.to ? { ...v, saying: say(`ligando ${short(event.title)} ↔ ${short(event.otherTitle)}`), links: [...v.links.filter((l) => now - l.at < 8000), { from: event.from, to: event.to, at: now }], stats: { ...v.stats, linked: v.stats.linked + 1 } } : v;
    case "join": return event.kept && event.archived ? { ...v, saying: say(`juntando a cópia ${short(event.archivedTitle)}`), trail: v.trail.filter((x) => x !== event.archived), joins: [{ kept: event.kept, archived: event.archived, title: event.title, archivedTitle: event.archivedTitle, at: event.at }, ...v.joins].slice(0, 30), stats: { ...v.stats, joined: v.stats.joined + 1 } } : v;
    case "compact": return event.id && event.merged ? { ...v, saying: say(`compactando ${event.merged.length} memórias em uma · ${short(event.title)}`), trailAt: { ...v.trailAt, [event.id]: now }, trail: [event.id, ...v.trail.filter((x) => !event.merged!.includes(x))].slice(0, TRAIL), readIds: [...v.readIds, event.id], compactions: [{ id: event.id, from: event.merged, title: event.title, at: event.at }, ...v.compactions].slice(0, 30), stats: { ...v.stats, compacted: v.stats.compacted + 1 } } : v;
    case "flag": {
      if (!event.id || v.flags.some((f) => f.id === event.id && (f.otherId || null) === (event.otherId || null))) return v;
      return { ...v, saying: say(event.otherId ? `marcando conflito · ${event.reason || ""}` : `marcando ${short(event.title)} como vaga`), flags: [{ id: event.id, otherId: event.otherId || null, reason: event.reason || "", title: event.title, otherTitle: event.otherTitle }, ...v.flags], stats: { ...v.stats, flagged: v.stats.flagged + 1 } };
    }
    case "rest": return { ...v, phase: "descansando", current: null, area: null, areaLabel: null, trail: [], called: null, restUntil: event.until || null, saying: say("ronda completa · descansando") };
    default: return v;
  }
}

/**
 * Each section of the map (a cluster: one thought) as the Zeladora goes: how many of its memories she has read
 * in this round, and whether it is done, being read, or still waiting ("na fila"). While she rests, a section
 * read in the last round stays done.
 */
export type SectionState = { read: number; total: number; state: "feito" | "lendo" | "na fila" };
export function sectionProgress(graph: MemoryGraph, keeper: KeeperView | null): Map<string, SectionState> {
  const out = new Map<string, SectionState>();
  if (!keeper || !keeper.enabled || !keeper.running) return out;
  const read = new Set(keeper.readIds);
  const here = keeper.current ? graph.nodes.find((n) => n.id === keeper.current)?.clusterId : undefined;
  for (const c of graph.clusters) {
    const done = c.nodeIds.filter((id) => read.has(id)).length;
    const state = done >= c.nodeIds.length && c.nodeIds.length > 0 ? "feito" : c.id === here ? "lendo" : keeper.phase === "descansando" && done > 0 ? "feito" : "na fila";
    out.set(c.id, { read: done, total: c.nodeIds.length, state });
  }
  return out;
}

/**
 * The semantic atlas held steady for the session: the clustering and positions are recomputed on the server
 * as memories come and go (k-means and PCA move everything), so the first ones seen are kept. A memory that
 * arrives later joins the cluster most of its measured neighbours are in, at their mean position (nudged by
 * its id); without neighbours, the atlas's own answer. Returns the steadied atlas and the updated memory.
 */
export type FrozenAtlas = { points: Map<string, { cluster: number; position: number[] }>; labels: Map<number, string> };
export const newFrozenAtlas = (): FrozenAtlas => ({ points: new Map(), labels: new Map() });
const jitter = (id: string, salt: number) => { let h = 2166136261 ^ salt; for (let i = 0; i < id.length; i += 1) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000 - 0.5; };
export function steadyAtlas(atlas: MemoryGraphSnapshot["atlas"], state: FrozenAtlas): MemoryGraphSnapshot["atlas"] {
  if (!atlas) return atlas;
  // The Zeladora's nodes are already stable (and change on purpose, as she tends them): only the positions are
  // held steady, the node of each memory and the names are hers.
  if (atlas.nodes) {
    const points = atlas.points.map((p) => {
      const kept = state.points.get(p.id);
      if (kept) { kept.cluster = p.cluster; return { ...p, position: kept.position }; }
      state.points.set(p.id, { cluster: p.cluster, position: p.position });
      return p;
    });
    return { ...atlas, points };
  }
  const frozen = state.points;
  const firstTime = frozen.size === 0;
  const points = atlas.points.map((p) => {
    const kept = frozen.get(p.id);
    if (kept) return { ...p, cluster: kept.cluster, position: kept.position };
    if (!firstTime) {
      const near = p.neighbors.map((n) => frozen.get(n.id)).filter(Boolean) as { cluster: number; position: number[] }[];
      if (near.length) {
        const votes = new Map<number, number>();
        for (const n of near) votes.set(n.cluster, (votes.get(n.cluster) || 0) + 1);
        const cluster = [...votes].sort((a, b) => b[1] - a[1])[0][0];
        const home = near.filter((n) => n.cluster === cluster);
        const position = [0, 1, 2].map((a) => home.reduce((s, n) => s + (n.position[a] || 0), 0) / home.length + (a < 2 ? jitter(p.id, a) * 0.6 : 0));
        frozen.set(p.id, { cluster, position });
        return { ...p, cluster, position };
      }
    }
    frozen.set(p.id, { cluster: p.cluster, position: p.position });
    return p;
  });
  // The cluster names stay the ones first seen too.
  const clusters = atlas.clusters.map((c) => {
    if (!state.labels.has(c.id)) state.labels.set(c.id, c.label);
    return { ...c, label: state.labels.get(c.id)! };
  });
  return { ...atlas, points, clusters };
}

/**
 * A turn of the Aurora as the map follows it, step by step from the real events: pergunta (turn-start), busca
 * (scanned: the candidates the search scored), consulta (recalled: what went into the context), resposta
 * (answered: what the saved answer used and created), then ended. Events of another conversation do not mix in.
 */
export type TurnPhase = "pergunta" | "busca" | "consulta" | "resposta";
export type TurnState = { key: string; conversationId: string | null; message: string; phase: TurnPhase; scanned: { id: string; score: number }[]; recalled: string[]; used: string[]; created: string[]; ended: boolean };
export function reduceTurn(turn: TurnState | null, event: MemoryLiveEvent): TurnState | null {
  if (event.type === "turn-start") return { key: `${event.seq ?? event.at}`, conversationId: event.conversationId || null, message: event.message || "", phase: "pergunta", scanned: [], recalled: [], used: [], created: [], ended: false };
  const ours = turn && !turn.ended && (!event.conversationId || !turn.conversationId || turn.conversationId === event.conversationId);
  if (event.type === "turn-end") return turn && (!event.conversationId || turn.conversationId === event.conversationId) ? { ...turn, ended: true } : turn;
  // Memories extracted from the answer are saved just after the turn ends: still this turn's, if of its conversation.
  if (event.type === "created" && event.id && turn?.ended && turn.conversationId && event.conversationId === turn.conversationId) return { ...turn, created: [...new Set([...turn.created, event.id])] };
  if (!ours) return turn;
  if (event.type === "scanned" && event.candidates?.length) return { ...turn!, phase: "busca", scanned: event.candidates.map((c) => ({ id: c.id, score: c.score })) };
  if (event.type === "recalled" && event.ids?.length) return { ...turn!, phase: "consulta", recalled: event.ids };
  if (event.type === "created" && event.id) return { ...turn!, created: [...new Set([...turn!.created, event.id])] };
  if (event.type === "answered") return { ...turn!, phase: "resposta", used: event.used || [], created: [...new Set([...turn!.created, ...(event.created || [])])] };
  return turn;
}

/** The ids a search lights up (all visible memories matching the words), best first by relevance. */
export function searchIds(graph: MemoryGraph, query: string): string[] {
  if (!query.trim()) return [];
  return graph.nodes.filter((n) => matches(n.memory, { query })).sort((a, b) => b.relevance - a.relevance).map((n) => n.id);
}

/** Edges touching a node (for hover and the side panel). */
export function edgesOf(graph: MemoryGraph, id: string): GraphEdge[] {
  return graph.edges.filter((e) => e.from === id || e.to === id);
}
