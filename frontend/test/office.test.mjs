import test from "node:test";
import assert from "node:assert/strict";
import * as sim from "../.test-build/officeSim.js";
import { PLAN, DOOR, findPath, walkable, placeOf, assignSpots, sync, step, routines, usePlan, desksFor, makePlan } from "../.test-build/officeSim.js";

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
  let now = 0; const run = (floor, secs) => { for (let i = 0; i < secs * 20; i++) { now += 50; floor = step(floor, 0.05, now); routines(floor, now); } return floor; };
  let floor = sync([], [actor("a", "descanso")], now);
  assert.equal(floor[0].path.length, 0);                    // already there when the office opened
  floor = sync(floor, [actor("a", "descanso"), actor("b", "trabalhando")], now);
  const b = floor.find((w) => w.id === "b");
  assert.deepEqual([b.x, b.y], [DOOR.x, DOOR.y]); assert.ok(b.path.length > 0);
  floor = run(floor, 20);
  assert.equal(b.path.length, 0); assert.equal(b.seat, true); assert.equal(b.spot.kind, "desk");
  // b delivers: the paper to the boss's desk first, a coffee from the machine, then the café.
  floor = sync(floor, [actor("b", "cafe")], now);
  assert.equal(b.spot.kind, "visit"); assert.equal(b.carry, "paper");
  assert.ok(floor.find((w) => w.id === "a").leaving);
  floor = run(floor, 14); assert.equal(b.carry, null);        // handed over
  floor = run(floor, 20);
  assert.ok(!floor.some((w) => w.id === "a")); assert.equal(b.spot.kind, "coffee"); assert.equal(b.carry, "cup");
});

test("office: the tool decides the place of work (shelves to read, the server to run), kept a few seconds", () => {
  assert.equal(placeOf(actor("a", "trabalhando", { tool: "read_file" })), "shelf");
  assert.equal(placeOf(actor("a", "trabalhando", { tool: "run_command" })), "server");
  assert.equal(placeOf(actor("a", "trabalhando", { tool: "write_document" })), "desk");
  let floor = sync([], [actor("a", "trabalhando", { tool: "write_document" })], 0);
  floor = sync(floor, [actor("a", "trabalhando", { tool: "read_file" })], 1000);
  assert.equal(floor[0].home.kind, "desk");                  // a tool of one second does not move anyone
  floor = sync(floor, [actor("a", "trabalhando", { tool: "read_file" })], 7000);
  assert.equal(floor[0].home.kind, "shelf");
});

test("office: life between the facts: the boss goes round who works, idle people chat, long thinking paces", () => {
  let now = 0;
  let floor = sync([], [actor("w1", "trabalhando"), actor("w2", "trabalhando"), { ...actor("boss", "supervisionando"), kind: "chefe" }, actor("i1", "descanso"), actor("i2", "descanso")], now);
  const seen = new Set(); let chatted = false;
  for (let i = 0; i < 180 * 20; i++) { now += 50; floor = step(floor, 0.05, now); routines(floor, now); const boss = floor.find((w) => w.id === "boss"); if (boss.spot.kind === "visit" && !boss.path.length) seen.add(`${boss.spot.x},${boss.spot.y}`); chatted ||= floor.some((w) => w.chatWith); }
  assert.ok(seen.size >= 2, "o chefe passou por mais de uma mesa");
  assert.ok(chatted, "dois livres conversando");
  // Thinking for long: up and pacing beside the desk.
  floor = sync([], [actor("t", "pensando", { since: 1 })], 0); now = 0; let paced = false;
  for (let i = 0; i < 20 * 20; i++) { now += 50; floor = step(floor, 0.05, now); routines(floor, now); paced ||= floor[0].spot.kind === "pace"; }
  assert.ok(paced);
});

test("office: the room grows with the team (20 working, a meeting of 20, 40 at rest: nobody is left out)", () => {
  assert.equal(desksFor(20), 21); assert.equal(desksFor(3), 14);
  assert.equal(makePlan(21).rows, makePlan(14).rows + 4);
  try {
    usePlan(desksFor(20));
    assert.equal(sim.PLAN.spots.filter((s) => s.kind === "desk").length, 21);
    // Every place still reachable from the door in the bigger room.
    for (const s of sim.PLAN.spots) assert.ok(findPath(sim.DOOR, s).length > 0 || (s.x === sim.DOOR.x && s.y === sim.DOOR.y), `${s.kind} ${s.x},${s.y}`);
    const working = Array.from({ length: 20 }, (_, i) => actor(`w${i}`, "trabalhando"));
    const spots = assignSpots(working);
    assert.equal(spots.size, 20); assert.ok([...spots.values()].every((s) => s.kind === "desk"));
    const meeting = assignSpots(Array.from({ length: 20 }, (_, i) => actor(`m${i}`, "reuniao")));
    assert.equal(meeting.size, 20); assert.equal([...meeting.values()].filter((s) => s.sit).length, 12);
    const resting = assignSpots(Array.from({ length: 40 }, (_, i) => actor(`r${i}`, "descanso")));
    assert.equal(resting.size, 40); assert.equal(new Set([...resting.values()].map((s) => `${s.x},${s.y}`)).size, 40);
    const grid = walkable(); for (const s of resting.values()) if (!s.sit) assert.ok(grid[s.y][s.x], `em pé num móvel ${s.x},${s.y}`);
  } finally { usePlan(14); }
});

// The Sede (last: it changes the plan in use).
const DEPTS = [
  ["recepcao", 0, "linha"], ["arquivo", 0, "linha"], ["biblioteca", 0, "linha"], ["reuniao", 0, "apoio"], ["chefe", 0, "apoio"], ["cafe", 0, "apoio"],
  ["juridico", 1, "area"], ["financeiro", 1, "area"], ["pessoas", 1, "area"], ["comercial", 1, "area"], ["ti", 1, "area"], ["operacoes", 1, "area"],
  ["revisao", 2, "linha"], ["conferencia", 2, "linha"], ["expedicao", 2, "linha"], ["rh", 2, "apoio"], ["servidores", 2, "apoio"], ["lounge", 2, "apoio"],
].map(([id, band, kind]) => ({ id, name: id, band, kind, ...(kind === "area" ? { desks: ["A", "B", "C", "D"] } : {}) }));

test("Sede: 18 rooms, every spot of every room reachable from the door through the corridors", () => {
  assert.equal(sim.useHQ(DEPTS), true);
  assert.equal(sim.useHQ(DEPTS), false);
  const plan = sim.PLAN;
  assert.equal(plan.rooms.length, 18);
  const grid = walkable();
  for (const s of plan.spots) {
    const path = findPath(sim.DOOR, s);
    assert.ok(path.length > 0 || (s.x === sim.DOOR.x && s.y === sim.DOOR.y), `${s.room} ${s.kind} ${s.x},${s.y}`);
    for (const t of path.slice(0, -1)) assert.ok(grid[t.y][t.x], `passa por móvel em ${t.x},${t.y}`);
  }
  for (const d of DEPTS) assert.ok(plan.spots.some((s) => s.room === d.id), `sala ${d.id} sem lugar`);
  assert.equal(plan.furniture.filter((f) => f.kind === "desk" && f.label).length, 24);       // 6 areas × 4 named desks
});

test("Sede: each person goes to the room of its station (the shelf of the Arquivo, a desk of the Financeiro, the Revisão)", () => {
  const people = [
    actor("leitor", "trabalhando", { kind: "aurora", tool: "read_file", room: "arquivo" }),
    actor("escritor", "trabalhando", { kind: "aurora", tool: "write_document", room: "financeiro" }),
    actor("revisto", "revisao", { kind: "aurora", room: "revisao" }),
    { ...actor("prof", "revisao", { room: "revisao", with: "revisto" }), kind: "professor" },
    actor("folga", "descanso", { room: "lounge" }),
    { ...actor("boss", "conferindo", { room: "chefe", with: "escritor" }), kind: "chefe" },
  ];
  const spots = assignSpots(people);
  assert.equal(spots.get("leitor").room, "arquivo"); assert.equal(spots.get("leitor").kind, "shelf");
  assert.equal(spots.get("escritor").room, "financeiro"); assert.equal(spots.get("escritor").kind, "desk");
  assert.equal(spots.get("revisto").room, "revisao"); assert.equal(spots.get("prof").room, "revisao");
  assert.equal(spots.get("folga").room, "lounge");
  // The boss goes beside whoever it checks, in that person's room.
  assert.ok(Math.abs(spots.get("boss").x - spots.get("escritor").x) <= 1);
});
