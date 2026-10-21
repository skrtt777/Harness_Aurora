import test from "node:test";
import assert from "node:assert/strict";
import { buildMemoryGraph } from "../.test-build/livemap/adapter.js";
import { layoutTree, pathTo, pathBetween, commonFork } from "../.test-build/livemap/tree.js";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const mem = (id, extra = {}) => ({ id, title: `Memória ${id}`, scope: "global", projectId: null, conversationId: null, kind: "extracted", source: null, tags: [], snippet: `texto ${id}`, sensitive: false, createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z", uses: 0, helped: 0, failed: 0, status: "active", ...extra });
const snapshot = (memories, points) => ({
  generatedAt: "2026-10-20T12:00:00Z", memories, relations: [],
  atlas: points ? { model: "m", clusters: [...new Set(points.map((p) => p.cluster))].map((id) => ({ id, label: `grupo ${id}`, count: 1, center: [0, 0, 0] })), points } : null,
  projects: [], conversations: [], recalls: [], events: [],
});
// Three sections of a semantic map: in section 0, a1/a2 almost the same, a3 a bit apart, a4 far.
const base = () => {
  const memories = ["a1", "a2", "a3", "a4", "b1", "b2", "c1"].map((id, i) => mem(id, { scope: "project", projectId: "p", createdAt: `2026-10-${String(10 + i).padStart(2, "0")}T10:00:00Z` }));
  const points = [
    { id: "a1", position: [0, 0, 0], cluster: 0, neighbors: [] },
    { id: "a2", position: [0.1, 0, 0], cluster: 0, neighbors: [] },
    { id: "a3", position: [1, 0.2, 0], cluster: 0, neighbors: [] },
    { id: "a4", position: [4, 0, 0], cluster: 0, neighbors: [] },
    { id: "b1", position: [10, 10, 0], cluster: 1, neighbors: [] },
    { id: "b2", position: [10.5, 10, 0], cluster: 1, neighbors: [] },
    { id: "c1", position: [-10, 3, 0], cluster: 2, neighbors: [] },
  ];
  return snapshot(memories, points);
};

test("one tree: every memory is one leaf where the map puts it, all hanging from the root, each fork above its parent", () => {
  const s = base();
  const g = buildMemoryGraph(s, { now: NOW });
  const { tree, nodes } = layoutTree(g, s);
  assert.equal(tree.leafOf.size, g.nodes.length);
  for (const n of g.nodes) {
    const i = tree.leafOf.get(n.id);
    assert.equal(tree.memoryAt[i], n.id);
    assert.deepEqual(nodes.get(n.id), [tree.x[i], tree.y[i], 0]);
    const path = pathTo(tree, i);
    assert.equal(path[0], 0, "reaches the root");
  }
  for (let i = 1; i < tree.count; i += 1) {
    assert.ok(tree.parent[i] < i, "parents come first");
    if (!tree.memoryAt[i]) assert.ok(tree.y[i] > tree.y[tree.parent[i]], `fork ${i} above its parent`);
    assert.ok(Math.abs(tree.angle[i]) <= tree.span + 1e-6 && tree.r[i] <= tree.reach + 1e-6, "inside the reach of a wave");
  }
  assert.equal(tree.carried[0], g.nodes.length, "the root carries every memory");
  for (const sec of tree.sections) assert.equal(tree.parent[sec.node], 0, "a section branches from the root");
});

test("the shape is the data: alike memories fork near the canopy, different ones near the base; a section stays together", () => {
  const s = base();
  const g = buildMemoryGraph(s, { now: NOW });
  const { tree } = layoutTree(g, s);
  const leaf = (id) => tree.leafOf.get(id);
  const near = commonFork(tree, leaf("a1"), leaf("a2"));
  const mid = commonFork(tree, leaf("a1"), leaf("a3"));
  const far = commonFork(tree, leaf("a1"), leaf("a4"));
  assert.ok(tree.y[near] > tree.y[mid] && tree.y[mid] > tree.y[far], `a1·a2 ${tree.y[near].toFixed(0)} > a1·a3 ${tree.y[mid].toFixed(0)} > a1·a4 ${tree.y[far].toFixed(0)}`);
  assert.equal(commonFork(tree, leaf("a1"), leaf("b1")), 0, "two sections meet only at the root");
  // A section's leaves are one contiguous slice of the fan.
  const angles = tree.sections.map((sec) => g.clusters.find((c) => c.id === sec.id).nodeIds.map((id) => tree.angle[leaf(id)]));
  const ranges = angles.map((a) => [Math.min(...a), Math.max(...a)]).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < ranges.length; i += 1) assert.ok(ranges[i][0] > ranges[i - 1][1], "sections do not interleave");
  // The newest memory sits higher in the canopy than the oldest of its section (same jitter range).
  assert.ok(tree.y[leaf("a4")] > tree.y[leaf("a1")] - tree.R * 0.08);
});

test("the way from memory A to memory B goes down to their fork and up again", () => {
  const s = base();
  const g = buildMemoryGraph(s, { now: NOW });
  const { tree } = layoutTree(g, s);
  const a = tree.leafOf.get("a1"), b = tree.leafOf.get("a4");
  const way = pathBetween(tree, a, b);
  assert.equal(way[0], a); assert.equal(way[way.length - 1], b);
  assert.ok(way.includes(commonFork(tree, a, b)));
  for (let i = 1; i < way.length; i += 1) assert.ok(tree.parent[way[i]] === way[i - 1] || tree.parent[way[i - 1]] === way[i], "every step is a branch");
  assert.deepEqual(pathBetween(tree, a, a), [a]);
});

test("deterministic, works without the semantic atlas, and a new memory barely moves the others", () => {
  const s = base();
  const g = buildMemoryGraph(s, { now: NOW });
  assert.deepEqual([...layoutTree(g, s).nodes], [...layoutTree(g, s).nodes]);
  const plain = snapshot(s.memories, null);
  const t = layoutTree(buildMemoryGraph(plain, { mode: "pasta", now: NOW }), plain);
  assert.equal(t.tree.leafOf.size, s.memories.length);
  const before = layoutTree(g, s);
  const s2 = { ...s, memories: [...s.memories, mem("a5", { scope: "project", projectId: "p", createdAt: "2026-10-20T10:00:00Z" })], atlas: { ...s.atlas, points: [...s.atlas.points, { id: "a5", position: [0.05, 0.1, 0], cluster: 0, neighbors: [] }] } };
  const after = layoutTree(buildMemoryGraph(s2, { now: NOW }), s2);
  for (const id of ["b1", "c1"]) {
    const p = before.nodes.get(id), q = after.nodes.get(id);
    assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) < before.tree.R * 0.25, `${id} stays near its place`);
  }
});

test("a big memory grows its tree fast", () => {
  const memories = [], points = [];
  for (let i = 0; i < 3000; i += 1) {
    memories.push(mem(`m${i}`, { createdAt: new Date(NOW - i * 60_000).toISOString() }));
    points.push({ id: `m${i}`, position: [Math.sin(i) * 5, Math.cos(i * 1.7) * 5, (i % 13) / 3], cluster: i % 6, neighbors: [] });
  }
  const s = snapshot(memories, points);
  const g = buildMemoryGraph(s, { now: NOW });
  const t0 = performance.now();
  const { tree } = layoutTree(g, s);
  const ms = performance.now() - t0;
  assert.equal(tree.leafOf.size, 3000);
  assert.ok(ms < 2500, `${ms.toFixed(0)} ms`);
});
