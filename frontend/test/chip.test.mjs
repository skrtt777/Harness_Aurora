import test from "node:test";
import assert from "node:assert/strict";
import { assignSlots, bitsOf, BANK, fragmentsOf, layerAlpha, layoutChip, levelAt, LEVELS, strengthOf, chunkAround, along } from "../.test-build/livemap/chip.js";

const cats = [{ id: "a", label: "vendas" }, { id: "b", label: "jogos" }, { id: "c", label: "leis" }];
const mem = (id, category, createdAt) => ({ id, category, createdAt });
const overlap = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

test("slots: in order of creation; a memory keeps its slot; forgotten ones leave a hole; new ones go to the end", () => {
  const first = assignSlots(null, cats, [mem("a2", "a", 2), mem("a1", "a", 1), mem("b1", "b", 1)]);
  assert.deepEqual(first.get("a"), ["a1", "a2"]);
  const next = assignSlots(first, cats, [mem("a2", "a", 2), mem("a3", "a", 3), mem("b1", "b", 1)]);
  assert.deepEqual(next.get("a"), [null, "a2", "a3"]);
  // Moved to another nucleus: out of the old one, at the end of the new one.
  const moved = assignSlots(next, cats, [mem("a2", "b", 2), mem("a3", "a", 3), mem("b1", "b", 1)]);
  assert.deepEqual(moved.get("a"), [null, null, "a3"]);
  assert.deepEqual(moved.get("b"), ["b1", "a2"]);
  // The same memories in another session: the same slots.
  assert.deepEqual(assignSlots(null, cats, [mem("a2", "a", 2), mem("a1", "a", 1), mem("b1", "b", 1)]), first);
});

test("layout: banks of 60, no nucleus over another or over the core, every cell inside its nucleus, buses end on the core", () => {
  const memories = [];
  for (let i = 0; i < 130; i += 1) memories.push(mem(`a${i}`, "a", i));
  for (let i = 0; i < 20; i += 1) memories.push(mem(`b${i}`, "b", i));
  const slots = assignSlots(null, cats, memories);
  const L = layoutChip(cats, slots);
  const a = L.nuclei.find((n) => n.id === "a"), c = L.nuclei.find((n) => n.id === "c");
  assert.equal(a.banks, Math.ceil(130 / BANK));
  assert.equal(c.banks, 1, "an empty nucleus still has its first bank");
  for (const n of L.nuclei) {
    assert.ok(!overlap(n, L.core), `${n.id} over the core`);
    for (const m of L.nuclei) if (m !== n) assert.ok(!overlap(n, m), `${n.id} over ${m.id}`);
    const end = n.bus[n.bus.length - 1];
    const onCore = (Math.abs(end[0] - L.core.x) < 1e-6 || Math.abs(end[0] - (L.core.x + L.core.w)) < 1e-6 || Math.abs(end[1] - L.core.y) < 1e-6 || Math.abs(end[1] - (L.core.y + L.core.h)) < 1e-6);
    assert.ok(onCore, `${n.id}'s bus ends on the core`);
  }
  assert.equal(L.cell.size, 150);
  for (const [, cell] of L.cell) {
    const n = L.nuclei[cell.n];
    assert.ok(cell.x >= n.x && cell.y >= n.y && cell.x + cell.w <= n.x + n.w && cell.y + cell.h <= n.y + n.h);
  }
  const cells = [...L.cell.values()];
  for (let i = 0; i < cells.length; i += 1) for (let j = i + 1; j < cells.length; j += 1) assert.ok(!overlap(cells[i], cells[j]));
});

test("bits: the signature's signs, else the text's hash (stable)", () => {
  const bits = bitsOf("f0".padEnd(48, "0"), "x");
  assert.deepEqual([...bits.slice(0, 8)], [1, 1, 1, 1, 0, 0, 0, 0]);
  assert.equal(bits.length, 192);
  assert.deepEqual(bitsOf(null, "memória"), bitsOf(null, "memória"));
  assert.notDeepEqual(bitsOf(null, "memória"), bitsOf(null, "outra"));
});

test("fragments: tags first, then the weightiest words, no stop words, no repeats", () => {
  const f = fragmentsOf({ text: "Contrato da Atlas: multa de rescisão", snippet: "A multa do contrato é de 20% sobre o valor restante do contrato.", tags: ["jurídico"] });
  assert.equal(f[0], "jurídico");
  assert.ok(f.includes("Contrato") || f.includes("contrato"));
  assert.ok(!f.some((w) => ["da", "de", "sobre", "do"].includes(w.toLowerCase())));
  assert.equal(new Set(f.map((w) => w.toLowerCase())).size, f.length);
  assert.ok(f.length <= 5);
});

test("levels: six bands, one main layer at a time, smooth crossfade at the edges", () => {
  assert.equal(LEVELS.length, 6);
  assert.deepEqual([1, 3, 10, 50, 200, 900].map(levelAt), [0, 1, 2, 3, 4, 5]);
  for (const z of [1, 4.4, 16, 60, 280, 1000]) {
    const alphas = LEVELS.map((_, i) => layerAlpha(z, i));
    assert.equal(alphas.filter((a) => a > 0.99).length, 1, `one layer at ${z}`);
  }
  const edge = LEVELS.map((_, i) => layerAlpha(8, i));
  assert.ok(edge[1] > 0.3 && edge[1] < 0.7 && edge[2] > 0.3 && edge[2] < 0.7, "a crossfade at 8×");
});

test("strength, chunk, along", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  const fresh = strengthOf({ uses: 6, lastUsedAt: now, createdAt: now - 1e9 }, now);
  const old = strengthOf({ uses: 0, lastUsedAt: null, createdAt: now - 200 * 86_400_000 }, now);
  assert.ok(fresh > 0.8 && old < 0.3);
  assert.match(chunkAround("um texto longo que fala de contratos e multas no fim", "multas", 20), /multas/);
  assert.deepEqual(along([[0, 0], [10, 0], [10, 10]], 0.75), [10, 5]);
});

test("timeline, heat, comparison: from the memory's own dates, uses and bits", async () => {
  const { lifeAt, heatOf, heatColor, compareBits, timelineBuckets } = await import("../.test-build/livemap/chip.js");
  const m = { createdAt: 100, archivedAt: 200 };
  assert.deepEqual([50, 150, 250].map((t) => lifeAt(m, t)), ["unborn", "alive", "fossil"]);
  assert.equal(lifeAt(m, null), "fossil");
  assert.equal(lifeAt({ createdAt: 100, archivedAt: null }, null), "alive");
  const now = Date.parse("2026-10-24T12:00:00Z");
  assert.ok(heatOf({ uses: 10, lastUsedAt: now, createdAt: 0 }, now) > 0.9);
  assert.equal(heatOf({ uses: 0, lastUsedAt: null, createdAt: now }, now), 0);
  assert.match(heatColor(0.5), /^#[0-9a-f]{6}$/);
  const { agree, share } = compareBits(Uint8Array.from([1, 0, 1, 1]), Uint8Array.from([1, 1, 1, 0]));
  assert.deepEqual([...agree], [1, 0, 1, 0]);
  assert.equal(share, 0.5);
  const b = timelineBuckets([{ createdAt: 0, archivedAt: 90 }, { createdAt: 50, archivedAt: null }], [{ at: 99 }], 0, 100, 10);
  assert.equal(b.born[0], 1); assert.equal(b.born[5], 1); assert.equal(b.gone[9], 1); assert.equal(b.asked[9], 1);
});
