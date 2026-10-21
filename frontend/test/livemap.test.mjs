import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent, buildMemoryGraph, categoryOf, relevanceOf, searchIds, edgesOf } from "../.test-build/livemap/adapter.js";
import { layoutGraph, clusterRadius } from "../.test-build/livemap/layout.js";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const mem = (id, extra = {}) => ({ id, title: `Memória ${id}`, scope: "global", projectId: null, conversationId: null, kind: "extracted", source: null, tags: [], snippet: `texto ${id}`, sensitive: false, createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z", uses: 0, helped: 0, failed: 0, status: "active", ...extra });
const snapshot = () => ({
  generatedAt: "2026-10-20T12:00:00Z",
  memories: [
    mem("g1", { title: "Prefere respostas curtas", tags: ["preferência"], uses: 9, helped: 4 }),
    mem("p1", { scope: "project", projectId: "proj", title: "Meta de vendas do Sul" }),
    mem("p2", { scope: "project", projectId: "proj", title: "Planilha de metas" }),
    mem("c1", { scope: "conversation", conversationId: "conv", title: "Combinado: relatório na sexta", createdAt: "2026-09-01T10:00:00Z" }),
    mem("k1", { scope: "project", projectId: "proj", kind: "imported", title: "Manual do RH" }),
  ],
  relations: [{ from: "c1", to: "p1", type: "derivation" }, { from: "p1", to: "c1", type: "derivation" }, { from: "c1", to: "fora", type: "thematic" }],
  atlas: {
    model: "nomic-embed-text",
    clusters: [{ id: 0, label: "metas vendas", count: 3, center: [0, 0, 0] }, { id: 1, label: "rh", count: 1, center: [5, 5, 0] }],
    points: [
      { id: "p1", position: [1, 0, 0], cluster: 0, neighbors: [{ id: "p2", similarity: 0.91 }, { id: "c1", similarity: 0.72 }] },
      { id: "p2", position: [1.4, 0.3, 0], cluster: 0, neighbors: [{ id: "p1", similarity: 0.91 }] },
      { id: "c1", position: [0.6, -0.2, 0], cluster: 0, neighbors: [] },
      { id: "k1", position: [5, 5, 0], cluster: 1, neighbors: [] },
    ],
  },
  projects: [{ id: "proj", name: "Vendas" }],
  conversations: [{ id: "conv", title: "Metas de outubro", projectId: "proj" }],
  recalls: [], events: [],
});

test("each stored memory is one node, with its category; nothing more", () => {
  const g = buildMemoryGraph(snapshot(), { now: NOW });
  assert.deepEqual(g.nodes.map((n) => n.id).sort(), ["c1", "g1", "k1", "p1", "p2"]);
  assert.deepEqual(Object.fromEntries(g.nodes.map((n) => [n.id, n.category])), { g1: "geral", p1: "projeto", p2: "projeto", c1: "conversa", k1: "conhecimento" });
  assert.equal(categoryOf({ scope: "global", kind: "manual", source: "Base de conhecimento do RH" }), "conhecimento");
  assert.ok(relevanceOf({ uses: 9, helped: 4, failed: 0 }) > 0.5);
  assert.equal(relevanceOf({ uses: 0, helped: 0, failed: 2 }), 0);
});

test("edges are only real: explicit relations once, measured similarities, never to a memory not on the map", () => {
  const g = buildMemoryGraph(snapshot(), { now: NOW });
  const rel = g.edges.filter((e) => e.kind === "relacao");
  assert.deepEqual(rel.map((e) => [e.type, [e.from, e.to].sort().join("-")]), [["derivation", "c1-p1"]], "the pair once, the dangling one out");
  const sem = g.edges.filter((e) => e.kind === "semantica");
  assert.deepEqual(sem.map((e) => [e.from, e.to, e.weight]), [["p1", "p2", 0.91]], "p1–c1 is already a relation, p2–p1 is the same pair");
  assert.equal(g.stats.edges, 2);
  assert.deepEqual(g.stats.similarity, [0, 0, 0, 0, 1]);
  assert.equal(edgesOf(g, "p1").length, 2);
});

test("the three views: semantic, by folder/project, by conversation — the general memory always apart", () => {
  const overview = buildMemoryGraph(snapshot(), { mode: "geral", now: NOW });
  assert.deepEqual(overview.clusters.map((c) => c.id), ["geral", "sem:0", "sem:1"]);
  assert.equal(overview.clusters[0].general, true);
  const sem0 = overview.clusters.find((c) => c.id === "sem:0");
  assert.deepEqual([sem0.label, sem0.sublabel], ["vendas", "semântico · metas vendas"], "named after the project most of it comes from, keywords kept");
  const byFolder = buildMemoryGraph(snapshot(), { mode: "pasta", now: NOW });
  assert.deepEqual(byFolder.clusters.map((c) => [c.id, c.label, c.nodeIds.length]), [["geral", "memória geral", 1], ["proj:proj", "vendas", 4]], "the conversation's memory goes with its conversation's project");
  const byConversation = buildMemoryGraph(snapshot(), { mode: "conversa", now: NOW });
  assert.deepEqual(byConversation.clusters.map((c) => c.id).sort(), ["conv:conv", "geral", "proj:proj"]);
  assert.equal(byConversation.clusters.find((c) => c.id === "conv:conv").label, "metas de outubro");
});

test("filters and search: folder, conversation, period, relevance, category, words; empty when nothing passes", () => {
  const s = snapshot();
  assert.deepEqual(buildMemoryGraph(s, { filters: { projectId: "proj" }, now: NOW }).nodes.map((n) => n.id).sort(), ["c1", "k1", "p1", "p2"]);
  assert.deepEqual(buildMemoryGraph(s, { filters: { conversationId: "conv" }, now: NOW }).nodes.map((n) => n.id), ["c1"]);
  assert.deepEqual(buildMemoryGraph(s, { filters: { sinceDays: 7 }, now: NOW }).nodes.map((n) => n.id).sort(), ["g1", "k1", "p1", "p2"]);
  assert.deepEqual(buildMemoryGraph(s, { filters: { minRelevance: 0.4 }, now: NOW }).nodes.map((n) => n.id), ["g1"]);
  assert.deepEqual(buildMemoryGraph(s, { filters: { categories: ["conhecimento"] }, now: NOW }).nodes.map((n) => n.id), ["k1"]);
  const g = buildMemoryGraph(s, { now: NOW });
  assert.deepEqual(searchIds(g, "metas"), ["p2"]);
  assert.deepEqual(searchIds(g, "preferencia"), ["g1"], "tags and accents");
  assert.deepEqual(searchIds(g, "c1"), ["c1"], "by id");
  const empty = buildMemoryGraph(s, { filters: { query: "nada disso existe" }, now: NOW });
  assert.deepEqual([empty.nodes.length, empty.edges.length, empty.clusters.length, empty.stats.memories], [0, 0, 0, 0]);
  const none = buildMemoryGraph({ ...s, memories: [], relations: [], atlas: null }, { now: NOW });
  assert.equal(none.stats.memories, 0);
});

test("live events change the graph incrementally: a new memory enters, a deleted one leaves with its links", () => {
  const s = snapshot();
  const created = applyEvent(s, { type: "created", at: "2026-10-20T12:01:00Z", id: "n1", title: "Nova", scope: "project", projectId: "proj" });
  assert.equal(created.needsRefresh, true);
  assert.ok(created.snapshot.memories.some((m) => m.id === "n1" && m.projectId === "proj"));
  const deleted = applyEvent(s, { type: "deleted", at: "x", id: "p1" });
  assert.ok(!deleted.snapshot.memories.some((m) => m.id === "p1"));
  assert.ok(!deleted.snapshot.relations.some((r) => r.from === "p1" || r.to === "p1"));
  assert.equal(applyEvent(s, { type: "recalled", at: "x", ids: ["p1"] }).snapshot, s, "a recall changes no structure (it only pulses)");
});

test("links between two clusters become one aggregated arc per pair (and stay as edges for the memory in focus)", () => {
  const g = buildMemoryGraph(snapshot(), { mode: "conversa", now: NOW });
  const cross = g.edges.filter((e) => e.cross);
  assert.ok(cross.length >= 1);
  assert.deepEqual(g.bridges.map((b) => [b.a, b.b, b.count]), [["conv:conv", "proj:proj", 1]], "c1 (its conversation) – p1 (the project)");
  assert.ok(g.edges.filter((e) => !e.cross).every((e) => g.nodes.find((n) => n.id === e.from).clusterId === g.nodes.find((n) => n.id === e.to).clusterId));
});

test("the semantic atlas holds steady: the server re-clusters, the map keeps groups; a new memory joins its neighbours", async () => {
  const { steadyAtlas, newFrozenAtlas } = await import("../.test-build/livemap/adapter.js");
  const state = newFrozenAtlas();
  const first = steadyAtlas(snapshot().atlas, state);
  assert.equal(first.points.find((p) => p.id === "p1").cluster, 0);
  // Later the server re-clusters everything (ids swapped, positions moved) and a new memory n1 arrives.
  const reclustered = {
    model: "m", clusters: [{ id: 0, label: "outro nome", count: 1, center: [0, 0, 0] }, { id: 1, label: "trocado", count: 4, center: [0, 0, 0] }],
    points: [
      { id: "p1", position: [9, 9, 0], cluster: 1, neighbors: [] },
      { id: "p2", position: [9, 9, 0], cluster: 1, neighbors: [] },
      { id: "c1", position: [9, 9, 0], cluster: 1, neighbors: [] },
      { id: "k1", position: [0, 0, 0], cluster: 0, neighbors: [] },
      { id: "n1", position: [50, 50, 0], cluster: 0, neighbors: [{ id: "p1", similarity: 0.9 }, { id: "p2", similarity: 0.8 }] },
    ],
  };
  const later = steadyAtlas(reclustered, state);
  const at = (id) => later.points.find((p) => p.id === id);
  assert.deepEqual([at("p1").cluster, at("p1").position], [0, [1, 0, 0]], "kept as first seen");
  assert.equal(at("n1").cluster, 0, "with its neighbours, not where the new clustering put it");
  assert.ok(Math.abs(at("n1").position[0] - 1.2) < 0.4, "near its neighbours");
  assert.equal(later.clusters.find((c) => c.id === 0).label, "metas vendas", "names stay as first seen");
});

test("a turn followed step by step from real events; another conversation's events do not mix in", async () => {
  const { reduceTurn } = await import("../.test-build/livemap/adapter.js");
  let t = reduceTurn(null, { type: "turn-start", at: "a", seq: 1, conversationId: "conv", message: "qual a meta do Sul?" });
  assert.deepEqual([t.phase, t.message, t.ended], ["pergunta", "qual a meta do Sul?", false]);
  t = reduceTurn(t, { type: "scanned", at: "b", conversationId: "conv", candidates: [{ id: "p1", score: 2.4, similarity: 0.8 }, { id: "p2", score: 1.1, similarity: 0.6 }] });
  assert.deepEqual([t.phase, t.scanned.map((c) => c.id)], ["busca", ["p1", "p2"]]);
  t = reduceTurn(t, { type: "recalled", at: "c", conversationId: "outra", ids: ["x"] });
  assert.deepEqual(t.recalled, [], "another conversation's recall is not this turn's");
  t = reduceTurn(t, { type: "recalled", at: "c", conversationId: "conv", ids: ["p1"] });
  assert.deepEqual([t.phase, t.recalled], ["consulta", ["p1"]]);
  t = reduceTurn(t, { type: "created", at: "d", id: "n1" });
  t = reduceTurn(t, { type: "answered", at: "e", conversationId: "conv", used: ["p1"], created: ["n1", "n2"] });
  assert.deepEqual([t.phase, t.used, t.created], ["resposta", ["p1"], ["n1", "n2"]]);
  t = reduceTurn(t, { type: "turn-end", at: "f", conversationId: "conv" });
  assert.equal(t.ended, true);
  t = reduceTurn(t, { type: "created", at: "f2", id: "n3", conversationId: "conv" });
  assert.ok(t.created.includes("n3"), "a memory extracted right after the end is still this turn's");
  assert.equal(reduceTurn(t, { type: "created", at: "f3", id: "n4", conversationId: "outra" }).created.includes("n4"), false);
  assert.equal(reduceTurn(t, { type: "recalled", at: "g", conversationId: "conv", ids: ["late"] }).recalled.includes("late"), false, "an ended turn takes nothing more");
});

test("the Zeladora on the map: her place, her trail, links, joins and flags come only from her events", async () => {
  const { reduceKeeper, keeperFromSnapshot, applyEvent } = await import("../.test-build/livemap/adapter.js");
  let k = keeperFromSnapshot({ running: true, enabled: true, phase: "parada", round: 0, current: null, area: null, areaLabel: null, restUntil: null, stats: { read: 0, linked: 0, joined: 0, flagged: 0 }, areas: [], recent: [], flags: [], last: null });
  k = reduceKeeper(k, { type: "keeper", at: "a", action: "round", round: 1, total: 3, areas: [{ key: "projeto:p", label: "Vendas", total: 3 }] });
  k = reduceKeeper(k, { type: "keeper", at: "b", action: "walk", area: "projeto:p", label: "Vendas", total: 3 });
  k = reduceKeeper(k, { type: "keeper", at: "c", action: "read", id: "m1", area: "projeto:p" });
  k = reduceKeeper(k, { type: "keeper", at: "d", action: "read", id: "m2", area: "projeto:p" });
  assert.deepEqual([k.current, k.trail, k.areas[0].read, k.areaLabel], ["m2", ["m2", "m1"], 2, "Vendas"]);
  k = reduceKeeper(k, { type: "keeper", at: "e", action: "link", from: "m2", to: "m1", similarity: 0.85 });
  k = reduceKeeper(k, { type: "keeper", at: "f", action: "join", kept: "m1", archived: "m3", title: "A", archivedTitle: "A cópia" });
  k = reduceKeeper(k, { type: "keeper", at: "g", action: "flag", id: "m1", otherId: "m2", reason: "valores diferentes" });
  k = reduceKeeper(k, { type: "keeper", at: "g", action: "flag", id: "m1", otherId: "m2", reason: "valores diferentes" });
  assert.deepEqual([k.links.length, k.joins[0].archived, k.flags.length, k.stats.linked, k.stats.joined, k.stats.flagged], [1, "m3", 1, 1, 1, 1]);
  k = reduceKeeper(k, { type: "keeper", at: "h", action: "rest", until: "2026-10-20T12:00:00Z" });
  assert.deepEqual([k.phase, k.current, k.trail.length], ["descansando", null, 0]);
  assert.equal(reduceKeeper(k, { type: "recalled", at: "i", ids: ["x"] }), k, "other events do not move her");
  // A link she made becomes a real relation on the map.
  const snap = { memories: [], relations: [], atlas: null, projects: [], conversations: [], recalls: [], events: [], generatedAt: "" };
  assert.deepEqual(applyEvent(snap, { type: "keeper", at: "j", action: "link", from: "m2", to: "m1" }).snapshot.relations, [{ from: "m2", to: "m1", type: "thematic" }]);
});

test("sections: waiting, being read, done — from the memories she really read; compactions can be undone", async () => {
  const { reduceKeeper, sectionProgress } = await import("../.test-build/livemap/adapter.js");
  const graph = { nodes: [{ id: "a", clusterId: "s1" }, { id: "b", clusterId: "s1" }, { id: "c", clusterId: "s2" }], clusters: [{ id: "s1", nodeIds: ["a", "b"] }, { id: "s2", nodeIds: ["c"] }] };
  let k = reduceKeeper(null, { type: "keeper", at: "1", action: "round", round: 1, sections: [{ key: "sem:0", label: "x", total: 3 }] });
  assert.deepEqual([...sectionProgress(graph, k).values()].map((s) => s.state), ["na fila", "na fila"]);
  k = reduceKeeper(k, { type: "keeper", at: "2", action: "read", id: "a", section: "sem:0", kind: "regra" });
  let p = sectionProgress(graph, k);
  assert.deepEqual([p.get("s1"), p.get("s2").state], [{ read: 1, total: 2, state: "lendo" }, "na fila"]);
  assert.equal(k.kinds.a, "regra");
  k = reduceKeeper(k, { type: "keeper", at: "3", action: "read", id: "b", section: "sem:0", kind: "vaga" });
  k = reduceKeeper(k, { type: "keeper", at: "4", action: "read", id: "c", section: "sem:1" });
  p = sectionProgress(graph, k);
  assert.deepEqual([p.get("s1").state, p.get("s2").state], ["feito", "feito"]);
  k = reduceKeeper(k, { type: "keeper", at: "5", action: "compact", id: "n", merged: ["a", "b"], title: "Pensamento" });
  assert.deepEqual([k.compactions[0].from, k.stats.compacted, k.trail[0]], [["a", "b"], 1, "n"]);
  assert.equal(sectionProgress(graph, { ...k, enabled: false }).size, 0, "off: no sections greyed");
});

test("layout: deterministic, the general memory at the core, clusters apart, a new memory does not move the others", () => {
  const s = snapshot();
  const g = buildMemoryGraph(s, { mode: "pasta", now: NOW });
  const a = layoutGraph(g, s); const b = layoutGraph(g, s);
  assert.deepEqual([...a.nodes], [...b.nodes]);
  assert.deepEqual(a.clusters.get("geral").center, [0, 0, 0]);
  const centers = [...a.clusters.values()];
  for (let i = 0; i < centers.length; i += 1) for (let j = i + 1; j < centers.length; j += 1) {
    const d = Math.hypot(centers[i].center[0] - centers[j].center[0], centers[i].center[1] - centers[j].center[1]);
    assert.ok(d >= centers[i].radius + centers[j].radius, "clusters do not overlap");
  }
  const s2 = { ...s, memories: [...s.memories, mem("g2", { title: "Outra geral" })] };
  const after = layoutGraph(buildMemoryGraph(s2, { mode: "pasta", now: NOW }), s2);
  const moved = (id) => { const p = a.nodes.get(id); const q = after.nodes.get(id); return Math.hypot(p[0] - q[0], p[1] - q[1]); };
  assert.ok(moved("p1") < 0.001, "a memory of another cluster stays put");
  assert.ok(moved("g1") < clusterRadius(2) - clusterRadius(1) + 0.5, "in its own cluster it shifts at most by the cluster's growth");
  for (const [id, p] of a.nodes) {
    const c = a.clusters.get(g.nodes.find((n) => n.id === id).clusterId);
    assert.ok(Math.hypot(p[0] - c.center[0], p[1] - c.center[1]) <= c.radius + 1, `${id} inside its cluster`);
  }
});

test("the Zeladora's legs: feet stand on memories and follow her as she walks — never left far behind", async () => {
  const { stepLegs, LEG_DEFAULTS } = await import("../.test-build/livemap/legs.js");
  // A web of memories: one every 6 units.
  const web = [];
  for (let x = -40; x <= 340; x += 6) for (let y = -70; y <= 70; y += 6) web.push({ id: `${x}:${y}`, p: [x, y, 0] });
  const nearest = (x, y, r, taken) => { let best = null, bd = r * r; for (const n of web) { if (taken.has(n.id)) continue; const d = (n.p[0] - x) ** 2 + (n.p[1] - y) ** 2; if (d < bd) { bd = d; best = n; } } return best; };
  const legs = [];
  let worst = 0;
  for (let ms = 0; ms <= 4000; ms += 16) {
    const x = Math.min(250, (ms / 3000) * 250); // walks 250 units in 3 s, then stands
    const feet = stepLegs(legs, [x, 0, 0], 0, 100_000 + ms, nearest, undefined, [ms < 3000 ? 250 / 3 : 0, 0, 0]);
    if (ms > 400) worst = Math.max(worst, ...feet.map((f) => Math.hypot(f[0] - x, f[1])));
  }
  assert.ok(worst < LEG_DEFAULTS.reach * 3, `a foot was left ${worst.toFixed(1)} units behind`);
  // Standing still: every foot on a memory, two feet never on the same one, all around her.
  const on = legs.map((l) => l.on);
  assert.ok(on.every(Boolean), "every foot stands on a memory");
  assert.equal(new Set(on).size, on.length, "one foot per memory");
  for (const leg of legs) assert.ok(Math.hypot(leg.foot[0] - 250, leg.foot[1]) < LEG_DEFAULTS.reach * 1.6);
  // A sudden jump (she appears elsewhere): the feet come back at once.
  const feet = stepLegs(legs, [-30, 0, 0], 0, 200_000, nearest);
  assert.ok(Math.max(...feet.map((f) => Math.hypot(f[0] + 30, f[1]))) < LEG_DEFAULTS.reach * 3);
});
