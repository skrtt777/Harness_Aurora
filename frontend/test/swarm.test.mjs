import test from "node:test";
import assert from "node:assert/strict";
import { buildMemoryGraph } from "../.test-build/livemap/adapter.js";
import { layoutClouds } from "../.test-build/livemap/clouds.js";
import { HAZE_SHARE, homeUV, planSwarm, swarmSide } from "../.test-build/livemap/swarm.js";

const mem = (id) => ({ id, title: `Memória ${id}`, scope: "project", projectId: "p", conversationId: null, kind: "extracted", source: null, tags: [], snippet: "", sensitive: false, createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z", uses: 0, helped: 0, failed: 0, status: "active" });
const snapshot = () => {
  const points = [];
  for (let i = 0; i < 40; i += 1) points.push({ id: `a${i}`, position: [-10 + Math.cos(i) * 0.5, Math.sin(i) * 0.5, 0], cluster: 0, neighbors: [] });
  for (let i = 0; i < 3; i += 1) points.push({ id: `b${i}`, position: [10, i * 0.2, 0], cluster: 1, neighbors: [] });
  return {
    generatedAt: "x", relations: [], projects: [], conversations: [], recalls: [], events: [],
    memories: points.map((p) => mem(p.id)),
    atlas: { model: "m", clusters: [0, 1].map((id) => ({ id, label: `g${id}`, count: 1, center: [0, 0, 0] })), points },
  };
};

test("every particle has a home, and every home in the swarm is a memory: one knot each, no section haze", () => {
  const s = snapshot();
  const L = layoutClouds(buildMemoryGraph(s), s);
  const ids = [...L.nodes.keys()];
  const P = planSwarm(L, ids, 128);
  assert.equal(P.count, 128 * 128);
  assert.equal(P.homes, ids.length + L.clouds.length);
  assert.ok(P.homeSide * P.homeSide >= P.homes);
  const knots = P.perHome.slice(0, ids.length), haze = P.perHome.slice(ids.length);
  assert.ok(knots.every((n) => n > 0), "no memory without particles");
  assert.ok(Math.max(...knots) - Math.min(...knots) <= 1, "the same for every memory");
  assert.equal(HAZE_SHARE, 0);
  assert.ok(haze.every((n) => n === 0), "no matter that is not a memory");
  // A view with no memory still shows its sections, each a haze by its volume.
  const E = planSwarm(L, [], 128);
  const big = L.clouds.findIndex((c) => c.ids.length === 40), small = L.clouds.findIndex((c) => c.ids.length === 3);
  assert.equal(E.perHome.reduce((a, b) => a + b, 0), E.count);
  assert.ok(E.perHome[big] > E.perHome[small], "the bigger section, the more haze");
  assert.equal(P.perHome.reduce((a, b) => a + b, 0), P.count);
  // The texture: each particle points at its home's texel, with a seed and a distance in 0..1.
  for (let i = 0; i < P.count; i += 997) {
    const [u, v, seed, dist] = P.ref.slice(i * 4, i * 4 + 4);
    const home = Math.floor(v * P.homeSide) * P.homeSide + Math.floor(u * P.homeSide);
    assert.ok(home < P.homes);
    assert.deepEqual(homeUV(home, P.homeSide).map((x) => Math.fround(x)), [u, v]);
    assert.ok(seed >= 0 && seed < 1 && dist >= 0 && dist <= 1);
  }
});

test("the quality sets the swarm: about a million, a quarter million, 65 thousand", () => {
  assert.equal(swarmSide("alta") ** 2, 1_048_576);
  assert.equal(swarmSide("media") ** 2, 262_144);
  assert.equal(swarmSide("baixa") ** 2, 65_536);
});
