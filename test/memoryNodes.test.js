import test from "node:test";
import assert from "node:assert/strict";
import { NODE_MIN, splitSize, tendNodes } from "../app/memoryNodes.js";

// Memories in a 12-dim space: each topic points along its own axis; `sub` tilts it a little (a sub-thought).
const vec = (axis, i, sub = 0) => Array.from({ length: 12 }, (_, d) => (d === axis ? 1 : 0) + (sub && d === 11 ? sub * 0.9 : 0) + Math.sin(d * 3.1 + i * 1.7 + axis) * 0.05);
const mem = (id, axis, i, title, sub = 0) => ({ id, title, tags: "[]", vector: vec(axis, i, sub) });
const group = (prefix, axis, n, title, sub = 0, from = 0) => Array.from({ length: n }, (_, i) => mem(`${prefix}${i + from}`, axis, i + from, `${title} ${i + from}`, sub));
const nodeOf = (book, id) => book.nodes.find((n) => n.members.includes(id));

test("she plants the first nodes from what exists: each memory in exactly one, alike ones together", () => {
  const memories = [...group("a", 0, 10, "vendas relatório"), ...group("b", 3, 10, "jogos canvas"), ...group("c", 6, 10, "whatsapp conexão")];
  const now = "2026-10-21T12:00:00.000Z";
  const { book, events } = tendNodes(memories, undefined, { now });
  assert.equal(events[0].action, "plant");
  assert.equal(book.nodes.reduce((s, n) => s + n.members.length, 0), 30);
  for (const p of ["a", "b", "c"]) assert.equal(new Set(memories.filter((m) => m.id.startsWith(p)).map((m) => nodeOf(book, m.id).id)).size, 1, `${p} together`);
  assert.notEqual(nodeOf(book, "a0").id, nodeOf(book, "b0").id);
  assert.ok(book.nodes.every((n) => n.label && n.born));
  // Deterministic, and a second tending with nothing new changes nothing.
  assert.deepEqual(tendNodes(memories, undefined, { now }).book, book);
  const again = tendNodes(memories, book);
  assert.deepEqual(again.events, []);
  assert.deepEqual(again.book, book);
});

test("a new memory is adopted by the node that means the closest thing", () => {
  const memories = [...group("a", 0, 10, "vendas"), ...group("b", 3, 10, "jogos"), ...group("c", 6, 10, "whatsapp")];
  const { book } = tendNodes(memories);
  const fresh = mem("novo", 3, 99, "jogos novo");
  const { book: next, events } = tendNodes([...memories, fresh], book);
  assert.deepEqual(events.map((e) => e.action), ["adopt"]);
  assert.equal(events[0].id, "novo");
  assert.equal(nodeOf(next, "novo").id, nodeOf(book, "b0").id);
  assert.ok(events[0].similarity > 0.9);
});

test("a node grown too big for one thought splits: a new node is born with its own name, its parent keeps the rest", () => {
  // The games node holds two sub-thoughts (2D and 3D) and keeps growing in both.
  const sub2d = (n, from) => group("b", 3, n, "jogos canvas 2d", 0.7, from);
  const sub3d = (n, from) => group("b", 3, n, "jogos três 3d", -0.7, from);
  const base = [...group("a", 0, 8, "vendas"), ...sub2d(8, 8), ...sub3d(8, 38)];
  const book = { next: 3, nodes: [{ id: 1, label: "vendas", members: base.filter((m) => m.id.startsWith("a")).map((m) => m.id), born: "x", parent: null }, { id: 2, label: "jogos", members: base.filter((m) => m.id.startsWith("b")).map((m) => m.id), born: "x", parent: null }] };
  const grown = [...group("a", 0, 8, "vendas"), ...sub2d(26, 8), ...sub3d(26, 38)];
  assert.ok(splitSize(grown.length) < 52 && splitSize(grown.length) >= 26, "one split is enough");
  const { book: next, events } = tendNodes(grown, book);
  // (A few new 3D ones, outside the mixed node, may sprout their own node first: the same separation.)
  const split = events.find((e) => e.action === "split");
  assert.ok(split, events.map((e) => e.action).join(","));
  assert.equal(split.parent, 2);
  const born = next.nodes.find((n) => n.id === split.node);
  assert.equal(born.parent, split.parent);
  assert.ok(born.members.length >= NODE_MIN + 1 && born.label);
  assert.notEqual(born.label, next.nodes.find((n) => n.id === split.parent).label);
  // The sub-thoughts went apart: the 2D ones in one node, the 3D ones in the other.
  const where = (ids) => new Set(ids.map((id) => nodeOf(next, id).id));
  assert.equal(where(Array.from({ length: 26 }, (_, i) => `b${i + 8}`)).size, 1);
  const node2d = nodeOf(next, "b8").id;
  assert.ok(Array.from({ length: 26 }, (_, i) => `b${i + 38}`).every((id) => nodeOf(next, id).id !== node2d), "no 3D memory left with the 2D ones");
  // Ids are never reused.
  assert.ok(next.next > Math.max(...next.nodes.map((n) => n.id)));
});

test("a node left with almost nothing folds into the nearest one; an emptied node simply goes", () => {
  const memories = [...group("a", 0, 10, "vendas"), ...group("b", 3, 10, "jogos"), ...group("c", 6, 10, "whatsapp")];
  const { book } = tendNodes(memories);
  // Most of "c" became obsolete and was archived: two are left.
  const left = memories.filter((m) => !m.id.startsWith("c") || ["c0", "c1"].includes(m.id));
  const { book: next, events } = tendNodes(left, book);
  const fold = events.find((e) => e.action === "fold");
  assert.ok(fold);
  assert.equal(fold.node, nodeOf(book, "c0").id);
  assert.equal(fold.members, 2);
  assert.ok(nodeOf(next, "c0") && nodeOf(next, "c1"), "nothing lost: the two left went to a neighbour");
  assert.equal(next.nodes.length, book.nodes.length - 1);
  // All of "b" gone at once: its node goes with nothing to give.
  const { book: last, events: e2 } = tendNodes(memories.filter((m) => !m.id.startsWith("b")), book);
  assert.ok(e2.some((e) => e.action === "fold" && e.node === nodeOf(book, "b0").id && e.members === 0 && e.into === null), JSON.stringify(e2));
  assert.equal(last.nodes.length, book.nodes.length - 1);
});

test("without vectors there is nothing to plant", () => {
  const { book, events } = tendNodes([{ id: "x", title: "x", tags: "[]", vector: null }]);
  assert.deepEqual(book.nodes, []);
  assert.deepEqual(events, []);
});

test("memories about something no node holds sprout a node of their own; a lone one waits, then goes to the closest", () => {
  const now = "2026-10-21T12:00:00.000Z";
  const memories = [...group("a", 0, 10, "vendas"), ...group("b", 3, 10, "jogos")];
  const { book } = tendNodes(memories, undefined, { now });
  // Three about a new subject (axis 8), created today.
  const novel = group("n", 8, 3, "whatsapp conexão").map((m) => ({ ...m, created_at: now }));
  const { book: next, events } = tendNodes([...memories, ...novel], book, { now });
  const sprout = events.find((e) => e.action === "sprout");
  assert.ok(sprout, JSON.stringify(events));
  assert.equal(sprout.members, 3);
  assert.equal(new Set(novel.map((m) => nodeOf(next, m.id).id)).size, 1);
  assert.equal(nodeOf(next, "n0").id, sprout.node);
  assert.equal(next.nodes.find((n) => n.id === sprout.node).parent, null);
  assert.ok(!events.some((e) => e.action === "adopt"), "never forced into an unrelated node");

  // A lone stranger: not adopted while new…
  const lone = { ...mem("x", 10, 1, "receita bolo"), created_at: now };
  const wait = tendNodes([...memories, lone], book, { now });
  assert.deepEqual(wait.events, []);
  assert.equal(nodeOf(wait.book, "x"), undefined);
  // …a week later, it goes to the closest node.
  const later = tendNodes([...memories, lone], wait.book, { now: "2026-10-29T12:00:00.000Z" });
  assert.deepEqual(later.events.map((e) => e.action), ["adopt"]);
  assert.ok(nodeOf(later.book, "x"));
});
