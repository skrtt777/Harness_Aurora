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
function clusterFor(m: GraphMemory, mode: ViewMode, atlasCluster: number | undefined, convProject: Map<string, string | null>): { id: string; label: string; sublabel: string; category: Category } {
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
    const c = clusterFor(m, mode, atlasById.get(m.id)?.cluster, convProject);
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
  return { snapshot: snap, needsRefresh: false };
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

/** The ids a search lights up (all visible memories matching the words), best first by relevance. */
export function searchIds(graph: MemoryGraph, query: string): string[] {
  if (!query.trim()) return [];
  return graph.nodes.filter((n) => matches(n.memory, { query })).sort((a, b) => b.relevance - a.relevance).map((n) => n.id);
}

/** Edges touching a node (for hover and the side panel). */
export function edgesOf(graph: MemoryGraph, id: string): GraphEdge[] {
  return graph.edges.filter((e) => e.from === id || e.to === id);
}
