import { useCallback, useMemo } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { groupColor, groupKey, memoryHealth, type Memory, type MemoryCluster } from "./data";
import { buildGraph } from "./graph";

const RELATION_LABEL: Record<string, string> = {
  belonging: "pertence a",
  thematic: "relacionado a",
  derivation: "decorre de",
  correction: "corrige",
};

type CardData = { title: string; subtitle: string; color: string; selected: boolean; tone?: "ok" | "bad" | "dim" };

function Card({ data }: NodeProps) {
  const d = data as unknown as CardData;
  return (
    <div className={`flow-node ${d.selected ? "selected" : ""} ${d.tone || ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="flow-node-dot" style={{ background: d.color }} />
      <div className="flow-node-body">
        <strong title={d.title}>{d.title}</strong>
        <small>{d.subtitle}</small>
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
};

const usage = (m: Memory) => (m.stats ? `${m.stats.uses}× usada · ajudou ${m.stats.helped} · falhou ${m.stats.failed}` : m.project || m.conversation || "Contexto geral");
const tone = (m: Memory): CardData["tone"] => (memoryHealth(m).failing ? "bad" : memoryHealth(m).helpful ? "ok" : memoryHealth(m).unused ? "dim" : undefined);
const ring = (count: number, radius: number, offset = 0) => Array.from({ length: count }, (_, i) => {
  const angle = (i / Math.max(count, 1)) * Math.PI * 2 + offset - Math.PI / 2;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.7 };
});

/**
 * The selected memory's neighbourhood, readable: the memory in the middle,
 * its most similar memories and explicit relations around it, their own
 * nearest ones in an outer ring. With nothing selected, an overview of the
 * topics (or project groups) — each card opens its most used memory.
 */
export default function MemoryFlow({ memories, allMemories, clusters, selectedId, onSelect }: Props) {
  const graph = useMemo(() => buildGraph(allMemories), [allMemories]);
  const visible = useMemo(() => new Set(memories.map((m) => m.id)), [memories]);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const card = (m: Memory, x: number, y: number, selected = false): Node => ({
      id: m.id, type: "card", position: { x: x - 110, y: y - 28 }, draggable: false,
      data: { title: m.title, subtitle: usage(m), color: groupColor(groupKey(m)), selected, tone: tone(m) } satisfies CardData,
    });
    const selected = graph.byId.get(selectedId || "");
    if (selected) {
      // First ring: similar memories (by meaning) and explicit relations, both directions.
      const first = new Map<string, string>();
      for (const n of selected.neighbors ?? []) first.set(n.id, `${Math.round(n.similarity * 100)}% parecida`);
      for (const id of selected.relations) if (!first.has(id)) first.set(id, RELATION_LABEL[selected.relationTypes?.[id] || "thematic"]);
      for (const e of graph.incoming.get(selected.id) ?? []) if (!first.has(e.from.id)) first.set(e.from.id, RELATION_LABEL[e.type]);
      for (const m of allMemories) if (!first.has(m.id) && m.id !== selected.id && m.neighbors?.some((n) => n.id === selected.id)) first.set(m.id, "parecida");
      const firstIds = [...first.keys()].filter((id) => graph.byId.has(id)).slice(0, 8);
      nodes.push(card(selected, 0, 0, true));
      ring(firstIds.length, 430).forEach((p, i) => {
        const m = graph.byId.get(firstIds[i])!;
        nodes.push(card(m, p.x, p.y));
        edges.push({ id: `s-${m.id}`, source: selected.id, target: m.id, label: first.get(m.id), style: { stroke: "#5fd4c0" }, labelStyle: { fill: "#aab3bd", fontSize: 11 }, labelBgStyle: { fill: "#0f1012" } });
      });
      // Second ring: each first-ring memory's closest one not yet shown.
      const shown = new Set([selected.id, ...firstIds]);
      const second: { id: string; from: string }[] = [];
      for (const id of firstIds) {
        if (second.length >= 6) break;
        const next = graph.byId.get(id)?.neighbors?.find((n) => !shown.has(n.id) && graph.byId.has(n.id));
        if (next) { shown.add(next.id); second.push({ id: next.id, from: id }); }
      }
      ring(second.length, 820, 0.3).forEach((p, i) => {
        const m = graph.byId.get(second[i].id)!;
        nodes.push(card(m, p.x, p.y));
        edges.push({ id: `t-${m.id}`, source: second[i].from, target: m.id, style: { stroke: "#3a4048" } });
      });
      return { nodes, edges };
    }
    // Overview: one card per topic (or project group), with its most used memory as the entry point.
    const topicOf = (m: Memory) => (clusters.length && m.cluster !== undefined ? String(m.cluster) : groupKey(m));
    const groups = new Map<string, Memory[]>();
    for (const m of memories) groups.set(topicOf(m), [...(groups.get(topicOf(m)) || []), m]);
    const entries = [...groups].sort((a, b) => b[1].length - a[1].length);
    ring(entries.length, Math.max(260, entries.length * 60)).forEach((p, i) => {
      const [key, members] = entries[i];
      const lead = [...members].sort((a, b) => (b.stats?.uses ?? 0) - (a.stats?.uses ?? 0))[0];
      const label = clusters.find((c) => String(c.id) === key)?.label || key;
      nodes.push({
        id: lead.id, type: "card", position: { x: p.x - 110, y: p.y - 28 }, draggable: false,
        data: { title: label, subtitle: `${members.length} memórias · abrir "${lead.title.slice(0, 32)}"`, color: groupColor(groupKey(lead)), selected: false } satisfies CardData,
      });
    });
    return { nodes, edges };
  }, [graph, selectedId, allMemories, memories, clusters]);

  const handleNodeClick = useCallback((_: unknown, node: Node) => onSelect(node.id), [onSelect]);
  const empty = !nodes.length || (selectedId && !visible.has(selectedId) && !graph.byId.has(selectedId));

  return (
    <div className="memory-flow">
      {empty ? (
        <div className="list-empty">Nenhuma memória para mostrar.</div>
      ) : (
        <ReactFlow key={selectedId || "overview"} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={handleNodeClick} fitView fitViewOptions={{ padding: 0.2 }} proOptions={{ hideAttribution: true }}>
          <Background gap={24} color="#1c1f24" />
          <Controls showInteractive={false} />
        </ReactFlow>
      )}
      <p className="flow-hint">{selectedId ? "Clique numa memória para ver a vizinhança dela." : "Selecione uma memória (no mapa ou na lista) para ver as parecidas e relacionadas."}</p>
    </div>
  );
}
