import test from "node:test";
import assert from "node:assert/strict";
import { buildMemoryGraph } from "../.test-build/livemap/adapter.js";
import { layoutAtlas, SPACING, territoryRadius } from "../.test-build/livemap/atlas.js";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const mem = (id, extra = {}) => ({ id, title: `Memória ${id}`, scope: "project", projectId: "p", conversationId: null, kind: "extracted", source: null, tags: [], snippet: `texto ${id}`, sensitive: false, createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z", uses: 0, helped: 0, failed: 0, status: "active", ...extra });
// Three subjects: sales on the left, games on the right, law apart; a1 and a2 mean nearly the same thing.
const snapshot = (withAtlas = true) => {
  const points = [
    { id: "a1", position: [-10, 0, 0], cluster: 0, neighbors: [{ id: "a2", similarity: 0.95 }] },
    { id: "a2", position: [-10, 0, 0], cluster: 0, neighbors: [{ id: "a1", similarity: 0.95 }] },
    { id: "a3", position: [-9.5, -0.5, 0], cluster: 0, neighbors: [] },
    { id: "a4", position: [-12, 2, 0], cluster: 0, neighbors: [] },
    { id: "b1", position: [10, 0, 0], cluster: 1, neighbors: [] },
    { id: "b2", position: [10.4, 0.3, 0], cluster: 1, neighbors: [] },
    { id: "b3", position: [9.8, -0.2, 0], cluster: 1, neighbors: [] },
    { id: "c1", position: [0, 14, 0], cluster: 2, neighbors: [] },
    { id: "c2", position: [0.3, 14.2, 0], cluster: 2, neighbors: [] },
  ];
  return {
    generatedAt: "2026-10-21T12:00:00Z", relations: [], projects: [], conversations: [], recalls: [], events: [],
    memories: points.map((p) => mem(p.id)),
    atlas: withAtlas ? { model: "m", clusters: [0, 1, 2].map((id) => ({ id, label: ["vendas", "jogos", "jurídico"][id], count: 1, center: [0, 0, 0] })), points } : null,
  };
};
// Even-odd rule over all the rings of a territory's land.
const inside = (rings, [x, y]) => {
  let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

test("every memory is a settlement on its own territory's land, and its name sits on it too", () => {
  const s = snapshot();
  const g = buildMemoryGraph(s, { now: NOW });
  const L = layoutAtlas(g, s);
  assert.equal(L.clouds.length, g.clusters.length);
  assert.equal(L.nodes.size, g.nodes.length);
  for (const n of g.nodes) {
    const ci = L.cloudOf.get(n.id);
    assert.equal(L.clouds[ci].id, n.clusterId);
    const t = L.atlas.territories[ci];
    assert.ok(t.land.length > 0, `${t.id} has land`);
    const [x, y] = L.nodes.get(n.id);
    assert.ok(inside(t.land, [x, y]), `${n.id} on the land of ${t.id}`);
    for (const [j, other] of L.atlas.territories.entries()) if (j !== ci) assert.ok(!inside(other.land, [x, y]), `${n.id} not on ${other.id}`);
  }
  for (const t of L.atlas.territories) assert.ok(inside(t.land, t.label), `${t.id}'s name on its land`);
  assert.ok(L.atlas.shore.length > 0);
});

test("settlements never touch; neighbours in meaning stand side by side", () => {
  const s = snapshot();
  const g = buildMemoryGraph(s, { now: NOW });
  const L = layoutAtlas(g, s);
  const ids = [...L.nodes.keys()];
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
    const a = L.nodes.get(ids[i]), b = L.nodes.get(ids[j]);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= SPACING * 0.9, `${ids[i]} and ${ids[j]} apart`);
  }
  const d = (a, b) => Math.hypot(L.nodes.get(a)[0] - L.nodes.get(b)[0], L.nodes.get(a)[1] - L.nodes.get(b)[1]);
  assert.ok(d("a1", "a2") < d("a1", "a4"), "the two that mean the same thing are closer than the odd one");
});

test("territories keep the atlas's places, never overlap, and grow with their memories", () => {
  const s = snapshot();
  const g = buildMemoryGraph(s, { now: NOW });
  const L = layoutAtlas(g, s);
  const at = (id) => L.clouds.find((c) => c.ids.includes(id));
  assert.ok(at("a1").x < at("b1").x, "sales left of games, as in the atlas");
  assert.equal(at("a1").r, territoryRadius(4));
  for (let i = 0; i < L.clouds.length; i += 1) for (let j = i + 1; j < L.clouds.length; j += 1) {
    const a = L.clouds[i], b = L.clouds[j];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 0.5);
  }
  // Deterministic: the same memories make the same map.
  const again = layoutAtlas(buildMemoryGraph(s, { now: NOW }), s);
  for (const [id, p] of L.nodes) assert.deepEqual(again.nodes.get(id), p);
});

test("without the atlas the map still stands (a sunflower per territory), and with no memories it is empty", () => {
  const s = snapshot(false);
  const g = buildMemoryGraph(s, { now: NOW });
  const L = layoutAtlas(g, s, "baixa");
  assert.equal(L.nodes.size, g.nodes.length);
  for (const p of L.nodes.values()) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const empty = layoutAtlas(buildMemoryGraph({ ...s, memories: [] }, { now: NOW }), null);
  assert.equal(empty.nodes.size, 0);
  assert.equal(empty.atlas.territories.length, 0);
});
