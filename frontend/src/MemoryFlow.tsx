import { useCallback, useMemo } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { groupKey, memoryColor, memoryHealth, type Memory, type MemoryCluster } from "./data";
import { buildGraph } from "./graph";

const RELATION_LABEL: Record<string, string> = {
  belonging: "pertence a",
  thematic: "relacionado a",
  derivation: "decorre de",
  correction: "corrige",
};
const RELATION_COLOR: Record<string, string> = {
  belonging: "#6aa6ff",
  thematic: "#b18cff",
  derivation: "#ffb86b",
  correction: "#ff6b8a",
};
// Two memories close in meaning across topics: the bridges between subjects.
const SIMILAR_MIN = 0.72;
const MAX_OVERVIEW = 160;

type CardData = { title: string; subtitle: string; color: string; selected?: boolean; tone?: "ok" | "bad" | "dim"; kind: "memory" | "topic" | "outcome" };

function Card({ data }: NodeProps) {
  const d = data as unknown as CardData;
  return (
    <div className={`flow-node flow-${d.kind} ${d.selected ? "selected" : ""} ${d.tone || ""}`} style={d.kind === "topic" ? { borderColor: d.color } : undefined}>
      <Handle type="target" position={Position.Left} />
      <span className="flow-node-dot" style={{ background: d.color }} />
      <div className="flow-node-body">
        <strong title={d.title}>{d.title}</strong>
        <small title={d.subtitle}>{d.subtitle}</small>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { card: Card };

type Props = {
  memories: Memory[];
  allMemories: Memory[];
  clusters: MemoryCluster[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClear?: () => void;
};

const SIZE = { memory: [230, 58], topic: [210, 58], outcome: [190, 52] } as const;
const usage = (m: Memory) => (m.stats ? `${m.stats.uses}× usada · ajudou ${m.stats.helped} · falhou ${m.stats.failed}` : m.project || m.conversation || "Contexto geral");
const tone = (m: Memory): CardData["tone"] => (memoryHealth(m).failing ? "bad" : memoryHealth(m).helpful ? "ok" : memoryHealth(m).unused ? "dim" : undefined);

/** Left-to-right layout (dagre): where each memory comes from on the left, where it leads on the right. */
function layout(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 16, ranksep: 110, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const [w, h] = SIZE[(n.data as unknown as CardData).kind];
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    const [w, h] = SIZE[(n.data as unknown as CardData).kind];
    return p ? { ...n, position: { x: p.x - w / 2, y: p.y - h / 2 } } : n;
  });
}

/**
 * The neighbourhood as a flowchart, left to right.
 * - Nothing selected: every topic, its memories, and the links between memories — explicit relations
 *   (solid, named) and close meanings across topics (dashed, "% parecida"): which memories connect.
 * - A memory selected: what leads to it on the left (its topic, memories pointing to it), the memory,
 *   then where it goes — the memories it connects to and what it did in answers (helped, failed,
 *   never used).
 * (Until 0.1.18 the whole flowchart was here; the radial view that replaced it showed only three
 * loose topic cards with nothing selected, 11/10/2026.)
 */
export default function MemoryFlow({ memories, allMemories, clusters, selectedId, onSelect, onClear }: Props) {
  const graph = useMemo(() => buildGraph(allMemories), [allMemories]);
  const topicOf = useCallback((m: Memory) => (clusters.length && m.cluster !== undefined && m.cluster >= 0 ? `topic:${m.cluster}` : `topic:${groupKey(m)}`), [clusters]);
  const topicLabel = useCallback((key: string) => {
    const raw = key.slice(6);
    return clusters.find((c) => String(c.id) === raw)?.label || raw;
  }, [clusters]);

  const { nodes, edges, note } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const seen = new Set<string>();
    const memoryNode = (m: Memory, selected = false) => {
      if (seen.has(m.id)) return;
      seen.add(m.id);
      nodes.push({ id: m.id, type: "card", position: { x: 0, y: 0 }, draggable: false, data: { kind: "memory", title: m.title, subtitle: usage(m), color: memoryColor(m), selected, tone: tone(m) } satisfies CardData });
    };
    const topicNode = (key: string, count: number, color: string) => {
      if (seen.has(key)) return;
      seen.add(key);
      nodes.push({ id: key, type: "card", position: { x: 0, y: 0 }, draggable: false, data: { kind: "topic", title: topicLabel(key), subtitle: `assunto · ${count} memória${count === 1 ? "" : "s"}`, color } satisfies CardData });
    };
    const relationEdge = (from: string, to: string, type: string, animated = false) => edges.push({
      id: `r-${from}-${to}`, source: from, target: to, label: RELATION_LABEL[type] || type, animated,
      style: { stroke: RELATION_COLOR[type] || "#8a93a6", strokeWidth: 1.6 }, markerEnd: { type: MarkerType.ArrowClosed, color: RELATION_COLOR[type] || "#8a93a6" },
      labelStyle: { fill: "#c9d3e6", fontSize: 11 }, labelBgStyle: { fill: "#0f1220" },
    });
    const similarEdge = (from: string, to: string, similarity: number, animated = false) => edges.push({
      id: `s-${from}-${to}`, source: from, target: to, label: `${Math.round(similarity * 100)}% parecida`, animated, type: "smoothstep",
      style: { stroke: "#5fd4c0", strokeDasharray: "5 4", strokeWidth: 1.3 }, markerEnd: { type: MarkerType.ArrowClosed, color: "#5fd4c0" },
      labelStyle: { fill: "#9fe3d6", fontSize: 10 }, labelBgStyle: { fill: "#0f1220" },
    });
    const topicEdge = (topic: string, to: string) => edges.push({ id: `t-${topic}-${to}`, source: topic, target: to, style: { stroke: "#3a4258", strokeWidth: 1 } });

    const selected = graph.byId.get(selectedId || "");
    if (selected) {
      // Where it comes from: its topic and the memories that point to it.
      const topic = topicOf(selected);
      const siblings = allMemories.filter((m) => topicOf(m) === topic).length;
      topicNode(topic, siblings, memoryColor(selected));
      memoryNode(selected, true);
      topicEdge(topic, selected.id);
      for (const e of graph.incoming.get(selected.id) ?? []) { memoryNode(e.from); relationEdge(e.from.id, selected.id, e.type, true); }
      // Where it goes: its relations, then the closest memories by meaning.
      for (const id of selected.relations) {
        const to = graph.byId.get(id);
        if (!to || to.id === selected.id) continue;
        memoryNode(to);
        relationEdge(selected.id, to.id, selected.relationTypes?.[id] || "thematic", true);
      }
      for (const n of (selected.neighbors ?? []).slice(0, 6)) {
        const to = graph.byId.get(n.id);
        if (!to || seen.has(to.id)) continue;
        memoryNode(to);
        similarEdge(selected.id, to.id, n.similarity, true);
        // One step further: what that memory leads to.
        const next = to.neighbors?.find((x) => !seen.has(x.id) && graph.byId.has(x.id) && x.similarity >= SIMILAR_MIN);
        if (next) { memoryNode(graph.byId.get(next.id)!); similarEdge(to.id, next.id, next.similarity); }
      }
      // What it did in the answers.
      const s = selected.stats;
      const outcome = !s || (s.uses === 0 && s.helped === 0 && s.failed === 0)
        ? { title: "Ainda não usada", subtitle: "não entrou em nenhuma resposta", color: "#6b7385" }
        : s.failed > s.helped
          ? { title: `Atrapalhou ${s.failed}×`, subtitle: `usada ${s.uses}× · ajudou ${s.helped}×`, color: "#ff6b8a" }
          : { title: `Ajudou ${s.helped}×`, subtitle: `usada ${s.uses}× · falhou ${s.failed}×`, color: "#5fd48a" };
      nodes.push({ id: "outcome", type: "card", position: { x: 0, y: 0 }, draggable: false, data: { kind: "outcome", ...outcome } satisfies CardData });
      edges.push({ id: "o", source: selected.id, target: "outcome", style: { stroke: outcome.color, strokeWidth: 1.6 }, markerEnd: { type: MarkerType.ArrowClosed, color: outcome.color }, label: "nas respostas", labelStyle: { fill: "#c9d3e6", fontSize: 11 }, labelBgStyle: { fill: "#0f1220" } });
      return { nodes: layout(nodes, edges), edges, note: "" };
    }

    // Overview: the whole flowchart of what is in view (the filters still apply).
    const shown = [...memories].sort((a, b) => (b.stats?.uses ?? 0) - (a.stats?.uses ?? 0)).slice(0, MAX_OVERVIEW);
    const ids = new Set(shown.map((m) => m.id));
    const counts = new Map<string, number>();
    for (const m of shown) counts.set(topicOf(m), (counts.get(topicOf(m)) || 0) + 1);
    for (const m of shown) {
      topicNode(topicOf(m), counts.get(topicOf(m)) || 0, memoryColor(m));
      memoryNode(m);
      topicEdge(topicOf(m), m.id);
    }
    for (const e of graph.edges) if (ids.has(e.from.id) && ids.has(e.to.id)) relationEdge(e.from.id, e.to.id, e.type);
    const bridged = new Set<string>();
    for (const m of shown) {
      // Each memory's closest one by meaning, inside or across topics: how they interconnect.
      const n = m.neighbors?.find((x) => ids.has(x.id) && x.similarity >= SIMILAR_MIN);
      if (!n) continue;
      const key = [m.id, n.id].sort().join("|");
      if (bridged.has(key)) continue;
      bridged.add(key);
      similarEdge(m.id, n.id, n.similarity);
    }
    const note = memories.length > MAX_OVERVIEW ? `Mostrando as ${MAX_OVERVIEW} memórias mais usadas de ${memories.length}: use os filtros para ver as outras.` : "";
    // One column per topic (its memories below it), the links crossing between columns: a single
    // left-to-right chain stacked every memory in one unreadable column.
    const COL = 290, ROW = 68, PER_COLUMN = 8;
    const topics = [...counts].sort((a, b) => b[1] - a[1]).map(([key]) => key);
    let column = 0;
    const placed = new Map<string, { x: number; y: number }>();
    for (const key of topics) {
      const members = shown.filter((m) => topicOf(m) === key);
      placed.set(key, { x: column * COL, y: 0 });
      members.forEach((m, i) => placed.set(m.id, { x: (column + Math.floor(i / PER_COLUMN)) * COL, y: 90 + (i % PER_COLUMN) * ROW }));
      column += Math.max(1, Math.ceil(members.length / PER_COLUMN));
    }
    const overviewEdges = edges.filter((e) => !e.id.startsWith("t-"));
    return { nodes: nodes.map((n) => ({ ...n, position: placed.get(n.id) || n.position })), edges: overviewEdges, note };
  }, [graph, selectedId, allMemories, memories, topicOf, topicLabel]);

  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    if (node.id === "outcome") return;
    if (node.id.startsWith("topic:")) {
      // A topic opens its most used memory.
      const lead = memories.filter((m) => topicOf(m) === node.id).sort((a, b) => (b.stats?.uses ?? 0) - (a.stats?.uses ?? 0))[0];
      if (lead) onSelect(lead.id);
      return;
    }
    onSelect(node.id);
  }, [memories, onSelect, topicOf]);

  if (!nodes.length) return <div className="memory-flow"><div className="list-empty">Nenhuma memória para mostrar.</div></div>;
  return (
    <div className="memory-flow">
      <ReactFlow key={selectedId || "overview"} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={handleNodeClick} fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.1} proOptions={{ hideAttribution: true }}>
        <Background gap={24} color="#1c1f2c" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {selectedId && onClear && <button className="flow-back btn btn-sm" onClick={onClear}>← Todas as memórias</button>}
      <div className="flow-legend">
        <span><i className="solid" /> relação</span>
        <span><i className="dashed" /> sentido parecido</span>
        <span><i className="ok" /> ajudou</span>
        <span><i className="bad" /> atrapalhou</span>
      </div>
      <p className="flow-hint">{note || (selectedId ? "À esquerda, o que leva a esta memória; à direita, para onde ela vai. Clique em outra para seguir." : "Clique numa memória para ver de onde ela vem e para onde vai.")}</p>
    </div>
  );
}
