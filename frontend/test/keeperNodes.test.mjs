import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent, buildMemoryGraph, keeperFromSnapshot, newFrozenAtlas, reduceKeeper, steadyAtlas } from "../.test-build/livemap/adapter.js";

const mem = (id, extra = {}) => ({ id, title: `Memória ${id}`, scope: "global", projectId: null, conversationId: null, kind: "extracted", source: null, tags: [], snippet: null, sensitive: false, createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z", uses: 0, helped: 0, failed: 0, status: "active", ...extra });
const point = (id, cluster, position = [0, 0, 0]) => ({ id, position, cluster, neighbors: [] });
const snap = (atlas) => ({ generatedAt: "", memories: ["g1", "g2", "p1", "p2"].map((id) => mem(id, id.startsWith("p") ? { scope: "project", projectId: "proj" } : {})), relations: [], atlas, projects: [{ id: "proj", name: "Vendas" }], conversations: [], recalls: [], events: [] });
const ev = (action, extra = {}) => ({ type: "keeper", at: "2026-10-21T12:00:00Z", action, ...extra });

test("with the Zeladora's nodes, every memory (the general memory too) is in its node; without them, the general memory apart", () => {
  const nodes = { model: "m", nodes: true, clusters: [{ id: 1, label: "vendas · metas", count: 3, center: [0, 0, 0] }, { id: 4, label: "estilo", count: 1, center: [0, 0, 0] }], points: [point("g1", 4), point("g2", 1), point("p1", 1), point("p2", 1)] };
  const graph = buildMemoryGraph(snap(nodes));
  assert.deepEqual(graph.clusters.map((c) => [c.id, c.nodeIds.length]).sort(), [["sem:1", 3], ["sem:4", 1]]);
  assert.ok(!graph.clusters.some((c) => c.general));
  const old = buildMemoryGraph(snap({ ...nodes, nodes: false }));
  assert.ok(old.clusters.some((c) => c.general && c.nodeIds.length === 2));
});

test("her nodes are trusted across reloads (a memory moved to a new node moves on the map), positions held steady", () => {
  const state = newFrozenAtlas();
  const first = steadyAtlas({ model: "m", nodes: true, clusters: [{ id: 1, label: "a", count: 2, center: [0, 0, 0] }], points: [point("p1", 1, [1, 1, 0]), point("p2", 1, [2, 2, 0])] }, state);
  assert.equal(first.points[0].cluster, 1);
  // She split node 1: p2 is now in the new node 7, and the server's PCA moved everything.
  const later = steadyAtlas({ model: "m", nodes: true, clusters: [{ id: 1, label: "a", count: 1, center: [0, 0, 0] }, { id: 7, label: "b nova", count: 1, center: [0, 0, 0] }], points: [point("p1", 1, [9, 9, 0]), point("p2", 7, [9, 9, 0])] }, state);
  const at = (id) => later.points.find((p) => p.id === id);
  assert.equal(at("p2").cluster, 7);
  assert.deepEqual(at("p1").position, [1, 1, 0], "positions kept as first seen");
  assert.equal(later.clusters.find((c) => c.id === 7).label, "b nova");
});

test("what she does to the shape of the tree reaches the map: prunes (undoable), new memories adopted, nodes born and folded", () => {
  let k = keeperFromSnapshot({ running: true, enabled: true, phase: "andando", round: 1, current: "p1", area: null, areaLabel: null, restUntil: null, stats: { read: 0, linked: 0, joined: 0, flagged: 0 }, areas: [], recent: [], flags: [], last: null, nodes: [{ id: 1, label: "a", count: 2 }], prunes: [] });
  assert.deepEqual(k.nodes, [{ id: 1, label: "a", count: 2 }]);
  const now = Date.parse("2026-10-21T12:00:00Z");
  k = reduceKeeper(k, ev("prune", { id: "p1", title: "Meta antiga", reason: "substituída por uma mais nova", section: "sem:1" }), now);
  assert.equal(k.current, null, "she is no longer on a leaf she cut");
  assert.deepEqual(k.prunes.map((p) => p.id), ["p1"]);
  assert.equal(k.stats.pruned, 1);
  assert.match(k.saying.text, /podando/);
  k = reduceKeeper(k, ev("arrival", { id: "n1", title: "Nova" }), now + 10);
  k = reduceKeeper(k, ev("adopt", { id: "n1", title: "Nova", section: "sem:1", label: "a" }), now + 20);
  k = reduceKeeper(k, ev("node-born", { section: "sem:7", label: "b nova", parentSection: "sem:1", parentLabel: "a", members: 9 }), now + 30);
  k = reduceKeeper(k, ev("node-gone", { section: "sem:3", label: "c", intoSection: "sem:1", intoLabel: "a", members: 2 }), now + 40);
  assert.deepEqual(k.growth.map((g) => g.kind), ["gone", "born", "adopt", "arrival", "prune"]);
  assert.deepEqual([k.growth[1].section, k.growth[1].from], ["sem:7", "sem:1"]);
  assert.deepEqual([k.stats.born, k.stats.folded, k.stats.adopted], [1, 1, 1]);
  // Old growth drops off (the map shows each for a few seconds).
  k = reduceKeeper(k, ev("arrival", { id: "n2" }), now + 60_000);
  assert.deepEqual(k.growth.map((g) => g.id), ["n2"]);
  // Her node changes need the new clustering from the server.
  const s = snap(null);
  for (const action of ["adopt", "node-born", "node-gone", "plant"]) assert.equal(applyEvent(s, ev(action)).needsRefresh, true, action);
  assert.equal(applyEvent(s, ev("read", { id: "p1" })).needsRefresh, false);
});
