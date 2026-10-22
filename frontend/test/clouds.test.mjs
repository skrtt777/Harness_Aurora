import test from "node:test";
import assert from "node:assert/strict";
import { buildMemoryGraph, reviewOf } from "../.test-build/livemap/adapter.js";
import { buildField, cloudRadius, grainPerMemory, layoutClouds } from "../.test-build/livemap/clouds.js";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const mem = (id, extra = {}) => ({ id, title: `Memória ${id}`, scope: "project", projectId: "p", conversationId: null, kind: "extracted", source: null, tags: [], snippet: `texto ${id}`, sensitive: false, createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z", uses: 0, helped: 0, failed: 0, status: "active", ...extra });
// Three subjects of a semantic map: sales on the left, games on the right, law far up; inside sales, a1 and a2
// mean nearly the same thing and a4 is the odd one out.
const snapshot = () => {
  const points = [
    { id: "a1", position: [-10, 0, 0], cluster: 0, neighbors: [] },
    { id: "a2", position: [-10.1, 0.05, 0], cluster: 0, neighbors: [] },
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
    atlas: { model: "m", clusters: [0, 1, 2].map((id) => ({ id, label: ["vendas", "jogos", "jurídico"][id], count: 1, center: [0, 0, 0] })), points },
  };
};

test("one cloud per section, every memory a point of its own cloud, inside it", () => {
  const s = snapshot();
  const g = buildMemoryGraph(s, { now: NOW });
  const L = layoutClouds(g, s);
  assert.equal(L.clouds.length, g.clusters.length);
  assert.equal(L.nodes.size, g.nodes.length);
  for (const n of g.nodes) {
    const c = L.clouds[L.cloudOf.get(n.id)];
    assert.equal(c.id, n.clusterId, `${n.id} drawn in its own section`);
    const [x, y] = L.nodes.get(n.id);
    const z = L.nodes.get(n.id)[2];
    assert.ok(Math.hypot(x - c.x, y - c.y, z - c.z) <= c.r, `${n.id} inside its cloud`);
  }
  // Bigger sections, bigger clouds.
  const sales = L.clouds.find((c) => c.ids.includes("a1")), law = L.clouds.find((c) => c.ids.includes("c1"));
  assert.ok(sales.r > law.r);
  assert.equal(sales.r, cloudRadius(4));
  // A space: the atlas's third axis gives the clouds depth.
  assert.ok(L.clouds.every((c) => Number.isFinite(c.z)));
});

test("clouds never overlap, and sit where their meaning puts them", () => {
  const s = snapshot();
  const g = buildMemoryGraph(s, { now: NOW });
  const L = layoutClouds(g, s);
  for (let i = 0; i < L.clouds.length; i += 1) for (let j = i + 1; j < L.clouds.length; j += 1) {
    const a = L.clouds[i], b = L.clouds[j];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= a.r + b.r - 0.5, `${a.id} and ${b.id} apart`);
  }
  const at = (id) => L.clouds.find((c) => c.ids.includes(id));
  assert.ok(at("a1").x < at("b1").x, "sales left of games, as in the atlas");
  assert.ok(at("c1").y > at("a1").y && at("c1").y > at("b1").y, "law above both");
  for (const c of L.clouds) assert.ok(Math.hypot(c.x, c.y, c.z) + c.r <= L.R + 1e-6);
});

test("inside a cloud, memories keep their direction: the odd one out is away from the twins", () => {
  const s = snapshot();
  const g = buildMemoryGraph(s, { now: NOW });
  const L = layoutClouds(g, s);
  const p = (id) => L.nodes.get(id);
  const d = (a, b) => Math.hypot(p(a)[0] - p(b)[0], p(a)[1] - p(b)[1], p(a)[2] - p(b)[2]);
  assert.ok(d("a1", "a2") < d("a1", "a4"));
  // Deterministic.
  const again = layoutClouds(buildMemoryGraph(s, { now: NOW }), s);
  for (const [id, q] of L.nodes) assert.deepEqual(again.nodes.get(id), q);
});

test("without an atlas the field still lays every memory out", () => {
  const s = { ...snapshot(), atlas: null };
  const g = buildMemoryGraph(s, { now: NOW });
  const L = layoutClouds(g, s);
  assert.equal(L.nodes.size, g.nodes.length);
  for (const [, q] of L.nodes) assert.ok(Number.isFinite(q[0]) && Number.isFinite(q[1]));
});

test("the grain: particles and fibres of each cloud stay near it, with a budget for many memories", () => {
  const s = snapshot();
  const g = buildMemoryGraph(s, { now: NOW });
  const L = layoutClouds(g, s);
  const f = buildField(L, 20);
  assert.ok(f.points.count >= g.nodes.length * 20 * 0.9);
  assert.ok(f.fibres.count > 0 && f.fibres.count % 2 === 0);
  for (let i = 0; i < f.points.count; i += 1) {
    const c = L.clouds[f.points.cloud[i]];
    assert.ok(Math.hypot(f.points.pos[i * 3] - c.x, f.points.pos[i * 3 + 1] - c.y, f.points.pos[i * 3 + 2] - c.z) < c.r * 1.8);
    assert.ok(Number.isFinite(f.points.pos[i * 3]));
  }
  assert.equal(grainPerMemory("alta", 100), 70);
  assert.ok(grainPerMemory("alta", 5000) * 5000 <= 50_000);
  assert.ok(grainPerMemory("baixa", 10) < grainPerMemory("media", 10));
});

test("proven or in review: used, helped, written by a person or imported is proven; extracted and unused, or flagged, in review", () => {
  assert.equal(reviewOf({ uses: 0, helped: 0, kind: "extracted" }), "revisar");
  assert.equal(reviewOf({ uses: 2, helped: 0, kind: "extracted" }), "comprovada");
  assert.equal(reviewOf({ uses: 0, helped: 1, kind: "extracted" }), "comprovada");
  assert.equal(reviewOf({ uses: 0, helped: 0, kind: "manual" }), "comprovada");
  assert.equal(reviewOf({ uses: 0, helped: 0, kind: "imported" }), "comprovada");
  assert.equal(reviewOf({ uses: 5, helped: 3, kind: "manual" }, true), "revisar");
});
