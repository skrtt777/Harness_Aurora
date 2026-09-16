import test from "node:test";
import assert from "node:assert/strict";
import {
  createDemoMemories,
  linkMemories,
  importMemories,
} from "../.test-build/data.js";
import { buildGraph, traceOrigin, edgeKey } from "../.test-build/graph.js";
import {
  createMorphology,
  overviewGeometry,
  disposeMorphology,
} from "../.test-build/morphology.js";

test("1,000 deterministic demo memories have stable positions, IDs and valid relations", () => {
  const nodes = linkMemories(createDemoMemories());
  assert.equal(nodes.length, 1000);
  assert.equal(new Set(nodes.map((m) => m.id)).size, 1000);
  assert.deepEqual(nodes, linkMemories(createDemoMemories()));
  assert(nodes.every((m) => m.kind === "demo"));
  const graph = buildGraph(nodes);
  assert.equal(graph.groups.length, 6);
  assert.equal(graph.edges.length, 994);
  assert(graph.edges.every((e) => graph.byId.has(e.to.id)));
  const last = nodes.at(-1);
  const path = traceOrigin(nodes, last.id);
  assert(path.order.length > 2);
  assert(path.order.length < 10);
  assert(path.order.every((n) => n.project === last.project));
});
test("import/export preserves directed relationships, types, supplied positions and content", () => {
  const nodes = importMemories([
    {
      id: "child",
      title: "Decisão",
      content: "ação",
      position: [1, 2, 3],
      relations: ["parent"],
      relationTypes: { parent: "correction" },
    },
    { id: "parent", position: [0, 0, 0] },
  ]);
  assert.deepEqual(importMemories(JSON.parse(JSON.stringify(nodes))), nodes);
  assert.deepEqual(nodes[0].relations, ["parent"]);
  assert.deepEqual(nodes[1].relations, []);
  assert.deepEqual(nodes[0].position, [1, 2, 3]);
  assert.equal(nodes[0].relationTypes.parent, "correction");
  assert.equal(nodes[0].kind, "context");
});
test("missing coordinates get a deterministic nonzero layout without moving supplied coordinates", () => {
  const source = [
    { id: "a", project: "Aurora" },
    { id: "b", project: "Aurora", position: [2, 3, 4] },
  ];
  const first = importMemories(source);
  assert.deepEqual(first, importMemories(source));
  assert.notDeepEqual(first[0].position, [0, 0, 0]);
  assert.deepEqual(first[1].position, [2, 3, 4]);
});
test("bad JSON records fail clearly instead of corrupting the graph", () => {
  for (const bad of [
    null,
    {},
    [null],
    [{ id: "x" }, { id: "x" }],
    [{ scope: "bad" }],
    [{ kind: "bad" }],
    [{ position: [1, 2] }],
    [{ position: [NaN, 2, 3] }],
    [{ position: ["1", 2, 3] }],
    [{ relations: ["absent"] }],
    [{ tags: "tag" }],
    [{ relationTypes: { x: "fake" } }],
  ])
    assert.throws(() => importMemories(bad));
  assert.deepEqual(importMemories([]), []);
});
test("origin traversal terminates on cycles and does not treat thematic/correction edges as parents", () => {
  const memories = importMemories([
    {
      id: "a",
      relations: ["b", "c"],
      relationTypes: { b: "belonging", c: "thematic" },
    },
    {
      id: "b",
      relations: ["a", "d"],
      relationTypes: { a: "derivation", d: "correction" },
    },
    { id: "c" },
    { id: "d" },
  ]);
  const path = traceOrigin(memories, "a");
  assert.deepEqual([...path.nodeIds], ["a", "b"]);
  assert(path.edgeKeys.has(edgeKey("a", "b")));
  assert.equal(path.edgeKeys.size, 2);
  assert.equal(traceOrigin(memories, null).order.length, 0);
});
test("merged neural geometry is finite, bounded, repeatable and varies with seed", () => {
  const a = createMorphology("neuron-a", true),
    b = createMorphology("neuron-a", true),
    c = createMorphology("neuron-b", true),
    overview = overviewGeometry("low");
  assert.deepEqual(
    a.branches.attributes.position.array,
    b.branches.attributes.position.array,
  );
  assert.notDeepEqual(
    a.branches.attributes.position.array,
    c.branches.attributes.position.array,
  );
  assert(a.bounds.min.y < a.bounds.max.y);
  for (const g of [a.body, a.branches, a.axon, a.tips, overview]) {
    assert(g.attributes.position.count > 0);
    assert([...g.attributes.position.array].every(Number.isFinite));
    assert([...g.attributes.normal.array].every(Number.isFinite));
  }
  assert(
    overview.attributes.position.count < a.branches.attributes.position.count,
  );
  [a, b, c].forEach(disposeMorphology);
  overview.dispose();
});
