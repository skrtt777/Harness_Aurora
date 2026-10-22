import test from "node:test";
import assert from "node:assert/strict";
import { buildMemoryGraph } from "../.test-build/livemap/adapter.js";
import { layoutClouds } from "../.test-build/livemap/clouds.js";
import { hemAt, layoutAurora } from "../.test-build/livemap/aurora.js";

const mem = (id) => ({ id, title: `Memória ${id}`, scope: "project", projectId: "p", conversationId: null, kind: "extracted", source: null, tags: [], snippet: "", sensitive: false, createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z", uses: 0, helped: 0, failed: 0, status: "active" });
const snapshot = () => {
  const points = [];
  const groups = [[-20, 30], [-8, 3], [4, 12], [16, 7], [28, 1]];
  groups.forEach(([x, n], g) => { for (let i = 0; i < n; i += 1) points.push({ id: `g${g}m${i}`, position: [x + i * 0.05, Math.sin(i) * 0.5, 0], cluster: g, neighbors: [] }); });
  return {
    generatedAt: "x", relations: [], projects: [], conversations: [], recalls: [], events: [],
    memories: points.map((p) => mem(p.id)),
    atlas: { model: "m", clusters: groups.map((_, id) => ({ id, label: `g${id}`, count: 1, center: [0, 0, 0] })), points },
  };
};

test("the aurora: a curtain per section, every memory a ray standing on its own curtain's hem", () => {
  const s = snapshot();
  const base = layoutClouds(buildMemoryGraph(s), s);
  const A = layoutAurora(base);
  assert.equal(A.clouds.length, base.clouds.length);
  assert.equal(A.aurora.curtains.filter(Boolean).length, base.clouds.length);
  assert.equal(A.nodes.size, base.nodes.size, "every memory has a place");
  for (const [id, p] of A.nodes) {
    const pl = A.aurora.place.get(id);
    assert.ok(pl, "on a curtain");
    assert.equal(pl.curtain, base.cloudOf.get(id), "on its own section's curtain");
    assert.equal(A.cloudOf.get(id), base.cloudOf.get(id), "same section, same colour");
    const c = A.aurora.curtains[pl.curtain];
    const h = hemAt(c, pl.u);
    assert.ok(Math.hypot(h[0] - p[0], h[2] - p[2]) < 1e-6, "on the hem (in xz)");
    assert.ok(p[1] >= c.y && p[1] <= c.y + c.height * 0.1, "at its foot");
    assert.ok(p[1] > A.aurora.ground, "above the lake");
  }
  // The atlas's left-to-right order is kept, and a bigger section hangs a longer, taller curtain.
  const byIndex = (k) => A.aurora.curtains[k];
  const big = base.clouds.findIndex((c) => c.ids.length === 30), small = base.clouds.findIndex((c) => c.ids.length === 1);
  assert.ok(byIndex(big).length > byIndex(small).length && byIndex(big).height > byIndex(small).height);
  const xs = base.clouds.map((c) => c.x), ax = A.clouds.map((c) => c.x);
  const orderBase = [...xs.keys()].sort((a, b) => xs[a] - xs[b]);
  const orderAurora = [...ax.keys()].sort((a, b) => ax[a] - ax[b]);
  assert.deepEqual(orderAurora, orderBase);
  assert.equal(A.aurora.labelAt.length, A.aurora.curtains.length);
});
