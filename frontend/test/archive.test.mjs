import test from "node:test";
import assert from "node:assert/strict";
import { buildMemoryGraph } from "../.test-build/livemap/adapter.js";
import { layoutClouds } from "../.test-build/livemap/clouds.js";
import { BOOK, colsFor, layoutArchive, standingSpot } from "../.test-build/livemap/archive.js";

const mem = (id) => ({ id, title: `Memória ${id}`, scope: "project", projectId: "p", conversationId: null, kind: "extracted", source: null, tags: [], snippet: "", sensitive: false, createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z", uses: 0, helped: 0, failed: 0, status: "active" });
const snapshot = () => {
  const points = [];
  for (let i = 0; i < 60; i += 1) points.push({ id: `a${i}`, position: [-10 + Math.cos(i) * 0.5, Math.sin(i) * 0.5, 0], cluster: 0, neighbors: [] });
  for (let i = 0; i < 9; i += 1) points.push({ id: `b${i}`, position: [10 + Math.cos(i) * 0.3, Math.sin(i) * 0.3, 0], cluster: 1, neighbors: [] });
  for (let i = 0; i < 4; i += 1) points.push({ id: `c${i}`, position: [0, 12 + i * 0.1, 0], cluster: 2, neighbors: [] });
  return {
    generatedAt: "x", relations: [], projects: [], conversations: [], recalls: [], events: [],
    memories: points.map((p) => mem(p.id)),
    atlas: { model: "m", clusters: [0, 1, 2].map((id) => ({ id, label: `g${id}`, count: 1, center: [0, 0, 0] })), points },
  };
};
const archive = () => { const s = snapshot(); return layoutArchive(layoutClouds(buildMemoryGraph(s), s)); };

test("one tower per section, one book per memory, every book on its own tower's shelves", () => {
  const A = archive();
  assert.equal(A.towers.length, 3);
  assert.equal(A.books.size, 73);
  for (const [id, b] of A.books) {
    const t = A.towers[b.tower];
    assert.ok(t.ids.includes(id));
    assert.ok(Math.abs(b.x - t.x) <= t.half + 1e-6 && Math.abs(b.z - t.z) <= t.half + 1e-6, `${id} inside its tower's footprint`);
    assert.ok(b.y > 0 && b.y + BOOK.h / 2 <= t.height, `${id} under the roof`);
  }
  // No two books in the same place.
  const keys = new Set([...A.books.values()].map((b) => `${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)}`));
  assert.equal(keys.size, A.books.size);
});

test("bigger sections are taller towers; towers keep a street between them", () => {
  const A = archive();
  const big = A.towers.find((t) => t.ids.length === 60), small = A.towers.find((t) => t.ids.length === 4);
  assert.ok(big.height > small.height);
  assert.equal(big.cols, colsFor(60));
  for (let i = 0; i < A.towers.length; i += 1) for (let j = i + 1; j < A.towers.length; j += 1) {
    const a = A.towers[i], b = A.towers[j];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= (a.half + b.half) * Math.SQRT2 + 4.4, "a street between towers");
  }
  for (const t of A.towers) assert.ok(Math.hypot(t.x, t.z) < A.extent);
});

test("the reader stands in front of a book's face, outside its tower", () => {
  const A = archive();
  for (const b of A.books.values()) {
    const t = A.towers[b.tower];
    const [x, z] = standingSpot(t, b);
    assert.ok(Math.max(Math.abs(x - t.x), Math.abs(z - t.z)) > t.half, "outside the tower");
    assert.ok(Math.hypot(x - b.x, z - b.z) < 3, "close to the book");
  }
});
