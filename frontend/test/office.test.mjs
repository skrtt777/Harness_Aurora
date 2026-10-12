import test from "node:test";
import assert from "node:assert/strict";
import { PLAN, DOOR, findPath, walkable, placeOf, assignSpots, sync, step, stroll } from "../.test-build/officeSim.js";

const actor = (id, state, extra = {}) => ({ id, kind: "agente", name: id, state, activity: "", ...extra });

test("office plan: every spot can be walked to from the door, through no furniture", () => {
  const grid = walkable();
  for (const s of PLAN.spots) {
    const path = findPath(DOOR, s);
    assert.ok(path.length > 0 || (s.x === DOOR.x && s.y === DOOR.y), `${s.kind} ${s.x},${s.y}`);
    for (const t of path.slice(0, -1)) assert.ok(grid[t.y][t.x], `passa por móvel em ${t.x},${t.y}`);
  }
  assert.equal(PLAN.spots.filter((s) => s.kind === "desk").length, 14);
});

test("office: each state sends a person to its place (desk, table, coffee, sofa; the boss beside who it checks)", () => {
  assert.equal(placeOf(actor("a", "trabalhando")), "desk");
  assert.equal(placeOf(actor("a", "revisao")), "meeting");
  assert.equal(placeOf(actor("a", "cafe")), "coffee");
  assert.equal(placeOf(actor("a", "descanso")), "sofa");
  assert.equal(placeOf(actor("a", "desligado")), "gone");
  assert.equal(placeOf({ ...actor("c", "cobrando"), kind: "chefe" }), "beside");
  const actors = [actor("w", "trabalhando"), actor("r", "revisao"), { ...actor("p", "revisao"), kind: "professor", with: "r" }, actor("k", "cafe"), { ...actor("boss", "cobrando"), kind: "chefe", with: "w" }];
  const spots = assignSpots(actors);
  assert.equal(spots.get("w").kind, "desk"); assert.equal(spots.get("k").kind, "coffee");
  // The teacher sits right next to whoever it reviews; the boss stands beside the desk it checks.
  const r = spots.get("r"), p = spots.get("p");
  assert.ok(Math.hypot(r.x - p.x, r.y - p.y) <= 1.5, "professor ao lado");
  assert.deepEqual([spots.get("boss").x, spots.get("boss").y], [spots.get("w").x + 1, spots.get("w").y]);
  // Nobody shares a spot; the same person keeps their desk when the data refreshes.
  const again = assignSpots(actors, spots);
  assert.equal(again.get("w"), spots.get("w"));
  assert.equal(new Set([...spots.values()].filter((s) => s.kind !== "visit")).size, [...spots.values()].filter((s) => s.kind !== "visit").length);
});

test("office: newcomers come in through the door and walk to their place; who leaves walks out", () => {
  let floor = sync([], [actor("a", "descanso")], 0);
  assert.equal(floor[0].path.length, 0);                    // already there when the office opened
  floor = sync(floor, [actor("a", "descanso"), actor("b", "trabalhando")], 1000);
  const b = floor.find((w) => w.id === "b");
  assert.deepEqual([b.x, b.y], [DOOR.x, DOOR.y]); assert.ok(b.path.length > 0);
  for (let i = 0; i < 400; i++) floor = step(floor, 0.05);
  assert.equal(b.path.length, 0); assert.equal(b.seat, true); assert.equal(b.spot.kind, "desk");
  // b's turn ends: b goes for coffee; a is gone from the data: a walks out and disappears.
  floor = sync(floor, [{ ...actor("b", "cafe") }], 2000);
  assert.ok(floor.find((w) => w.id === "a").leaving);
  for (let i = 0; i < 600; i++) floor = step(floor, 0.05);
  assert.ok(!floor.some((w) => w.id === "a")); assert.equal(floor.find((w) => w.id === "b").spot.kind, "coffee");
  // Resting, now and then a stroll to another rest spot (kept by the next refresh).
  floor = sync(floor, [actor("b", "descanso")], 3000);
  const before = floor[0].spot; floor[0].strollAt = 0; stroll(floor, 10_000);
  const after = floor[0].spot; assert.ok(["sofa", "rest", "coffee"].includes(after.kind));
  floor = sync(floor, [actor("b", "descanso")], 11_000); assert.equal(floor[0].spot, after);
  assert.ok(before);
});
