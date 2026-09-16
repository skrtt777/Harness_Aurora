import {
  groupColor,
  groupKey,
  type Memory,
  type RelationType,
} from "./data.js";
export type MemoryEdge = {
  key: string;
  from: Memory;
  to: Memory;
  type: RelationType;
};
export type MemoryGroup = {
  id: string;
  label: string;
  color: string;
  position: [number, number, number];
  count: number;
};
export const edgeKey = (from: string, to: string) => JSON.stringify([from, to]);
export function buildGraph(memories: Memory[]) {
  const byId = new Map(memories.map((m) => [m.id, m]));
  const edges: MemoryEdge[] = [];
  const grouped = new Map<string, Memory[]>();
  const incoming = new Map<string, MemoryEdge[]>();
  for (const m of memories) {
    const key = groupKey(m);
    const group = grouped.get(key) || [];
    group.push(m);
    grouped.set(key, group);
    for (const id of m.relations) {
      const to = byId.get(id);
      if (!to || id === m.id) continue;
      const edge = {
        key: edgeKey(m.id, id),
        from: m,
        to,
        type: m.relationTypes?.[id] || "thematic",
      } as MemoryEdge;
      edges.push(edge);
      const list = incoming.get(id) || [];
      list.push(edge);
      incoming.set(id, list);
    }
  }
  const groups: MemoryGroup[] = [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, nodes]) => ({
      id: `group:${label}`,
      label,
      color: groupColor(label),
      count: nodes.length,
      position: [0, 1, 2].map(
        (axis) =>
          nodes.reduce((sum, m) => sum + m.position[axis], 0) / nodes.length,
      ) as [number, number, number],
    }));
  return { byId, edges, groups, incoming };
}
// Origin traverses only explicit directed belonging/derivation edges, with cycle protection.
export function traceOrigin(memories: Memory[], selectedId: string | null) {
  const byId = new Map(memories.map((m) => [m.id, m]));
  const nodeIds = new Set<string>(),
    edgeKeys = new Set<string>();
  const order: Memory[] = [];
  const pending = selectedId ? [selectedId] : [];
  while (pending.length) {
    const id = pending.pop()!;
    const m = byId.get(id);
    if (!m || nodeIds.has(id)) continue;
    nodeIds.add(id);
    order.push(m);
    for (const target of m.relations) {
      const type = m.relationTypes?.[target];
      if ((type === "belonging" || type === "derivation") && byId.has(target)) {
        edgeKeys.add(edgeKey(id, target));
        pending.push(target);
      }
    }
  }
  return { nodeIds, edgeKeys, order };
}
