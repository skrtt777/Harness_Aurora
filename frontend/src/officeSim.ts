// The agents' office as a little simulation: the floor plan (desks with computers, the meeting
// table, the boss's desk, the coffee corner, the sofa, the door), where each state sends a person
// (working -> their desk; review or team meeting -> the table; just delivered -> coffee; idle -> the
// sofa or a stroll between the rest spots; called to account -> their desk, with the boss beside),
// the walk there (A* on the tiles) and the step of each frame. Pure: no React, no canvas (tests).

export type OfficeActor = {
  id: string; tool?: string; kind: "aurora" | "agente" | "copia" | "professor" | "chefe"; name: string; state: string; activity: string;
  since?: number | null; conversationId?: string | null; agentId?: string; task?: string; with?: string; teacher?: string; department?: string | null;
  plan?: { done: number; total: number } | null;
};

export const COLS = 30, ROWS = 18;
export type Tile = { x: number; y: number };
export type Spot = Tile & { face: "up" | "down" | "left" | "right"; sit: boolean; kind: SpotKind; desk?: number };
export type SpotKind = "desk" | "meeting" | "boss" | "visit" | "coffee" | "sofa" | "rest" | "door" | "shelf" | "server" | "pace";

/** The furniture: blocked tiles, drawn by the view. */
export type Furniture = { kind: "desk" | "table" | "bossdesk" | "counter" | "machine" | "sofa" | "plant" | "roundtable" | "glass" | "shelf" | "whiteboard" | "server"; x: number; y: number; w: number; h: number; desk?: number };

function plan() {
  const furniture: Furniture[] = [];
  const spots: Spot[] = [];
  // Meeting room (top left), behind glass with an opening.
  furniture.push({ kind: "table", x: 3, y: 3, w: 4, h: 2 }, { kind: "whiteboard", x: 1, y: 1, w: 3, h: 1 });
  for (let x = 1; x <= 8; x++) if (x !== 5) furniture.push({ kind: "glass", x, y: 7, w: 1, h: 1 });
  for (let y = 1; y <= 6; y++) furniture.push({ kind: "glass", x: 9, y, w: 1, h: 1 });
  for (const x of [3, 4, 5, 6]) { spots.push({ x, y: 2, face: "down", sit: true, kind: "meeting" }); spots.push({ x, y: 5, face: "up", sit: true, kind: "meeting" }); }
  for (const y of [3, 4]) { spots.push({ x: 2, y, face: "right", sit: true, kind: "meeting" }); spots.push({ x: 7, y, face: "left", sit: true, kind: "meeting" }); }
  // The boss's corner (top middle): the desk and two places to stand in front of it.
  furniture.push({ kind: "bossdesk", x: 13, y: 2, w: 3, h: 1 }, { kind: "shelf", x: 11, y: 1, w: 2, h: 1 }, { kind: "plant", x: 17, y: 1, w: 1, h: 1 });
  spots.push({ x: 14, y: 1, face: "down", sit: true, kind: "boss" });
  spots.push({ x: 13, y: 3, face: "up", sit: false, kind: "visit" }, { x: 15, y: 3, face: "up", sit: false, kind: "visit" });
  spots.push({ x: 11, y: 2, face: "up", sit: false, kind: "shelf" }, { x: 12, y: 2, face: "up", sit: false, kind: "shelf" });
  // The server rack (right wall): where commands run.
  furniture.push({ kind: "server", x: 27, y: 8, w: 1, h: 1 });
  spots.push({ x: 27, y: 9, face: "up", sit: false, kind: "server" }, { x: 26, y: 8, face: "right", sit: false, kind: "server" });
  // Coffee corner (top right): the machine, the counter, a round table.
  furniture.push({ kind: "machine", x: 27, y: 1, w: 1, h: 1 }, { kind: "counter", x: 22, y: 1, w: 5, h: 1 }, { kind: "roundtable", x: 24, y: 4, w: 1, h: 1 }, { kind: "plant", x: 28, y: 1, w: 1, h: 1 });
  for (const x of [27, 22, 23, 24, 25, 26]) spots.push({ x, y: 2, face: "up", sit: false, kind: "coffee" });
  spots.push({ x: 23, y: 4, face: "right", sit: true, kind: "coffee" }, { x: 25, y: 4, face: "left", sit: true, kind: "coffee" }, { x: 24, y: 5, face: "up", sit: true, kind: "coffee" });
  // Desks (two rows of seven, people facing their screens).
  let n = 0;
  for (const y of [9, 13]) for (let x = 5; x <= 23; x += 3) {
    furniture.push({ kind: "desk", x, y, w: 2, h: 1, desk: n });
    spots.push({ x, y: y + 1, face: "up", sit: true, kind: "desk", desk: n });
    n++;
  }
  // Lounge (bottom right): the sofa, plants; rest spots around.
  furniture.push({ kind: "sofa", x: 23, y: 16, w: 4, h: 1 }, { kind: "plant", x: 28, y: 16, w: 1, h: 1 }, { kind: "plant", x: 22, y: 16, w: 1, h: 1 }, { kind: "plant", x: 1, y: 9, w: 1, h: 1 }, { kind: "plant", x: 28, y: 9, w: 1, h: 1 });
  for (const x of [23, 24, 25, 26]) spots.push({ x, y: 16, face: "down", sit: true, kind: "sofa" });
  for (const [x, y] of [[20, 6], [11, 6], [27, 12], [2, 12], [18, 16], [9, 16]]) spots.push({ x, y, face: "down", sit: false, kind: "rest" });
  spots.push({ x: 3, y: 16, face: "up", sit: false, kind: "door" });
  return { furniture, spots };
}
export const PLAN = plan();
export const DOOR: Tile = { x: 3, y: 16 };

/** Walkable tiles (walls round the room; furniture blocks, except where someone sits on it: the sofa). */
export function walkable(): boolean[][] {
  const g = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => x > 0 && y > 0 && x < COLS - 1 && y < ROWS - 1));
  for (const f of PLAN.furniture) if (f.kind !== "sofa") for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) g[y][x] = false;
  return g;
}
const GRID = walkable();

/** The shortest walk between two tiles (4 directions), without the start; [] when there is none. */
export function findPath(from: Tile, to: Tile, grid: boolean[][] = GRID): Tile[] {
  const key = (x: number, y: number) => y * COLS + x;
  const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < COLS && y < ROWS && (grid[y][x] || (x === to.x && y === to.y));
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  if (start.x === to.x && start.y === to.y) return [];
  const open: Array<{ x: number; y: number; f: number; g: number }> = [{ ...start, g: 0, f: Math.abs(start.x - to.x) + Math.abs(start.y - to.y) }];
  const came = new Map<number, number>(); const cost = new Map<number, number>([[key(start.x, start.y), 0]]);
  while (open.length) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === to.x && cur.y === to.y) {
      const path: Tile[] = []; let k = key(cur.x, cur.y);
      while (k !== key(start.x, start.y)) { path.unshift({ x: k % COLS, y: Math.floor(k / COLS) }); k = came.get(k)!; }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy; if (!ok(nx, ny)) continue;
      const g = cur.g + 1; const k = key(nx, ny);
      if (g < (cost.get(k) ?? Infinity)) { cost.set(k, g); came.set(k, key(cur.x, cur.y)); open.push({ x: nx, y: ny, g, f: g + Math.abs(nx - to.x) + Math.abs(ny - to.y) }); }
    }
  }
  return [];
}

const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Where a state sends someone: the kind of spot. */
export function placeOf(a: OfficeActor): SpotKind | "beside" | "gone" {
  if (a.kind === "chefe") return a.state === "reuniao" ? "meeting" : a.state === "cobrando" || a.state === "conferindo" ? "beside" : "boss";
  // Working, the tool decides where: reading files and documents at the shelves, commands at the
  // server, the rest (writing, the web, the BI) at the computer.
  if (a.state === "trabalhando" && a.tool) {
    if (/^(read_file|list_dir|list_files|glob|search_files|grep|knowledge|memor)/.test(a.tool)) return "shelf";
    if (/^(run_command|shell|powershell)/.test(a.tool)) return "server";
  }
  switch (a.state) {
    case "revisao": case "reuniao": return "meeting";
    case "cafe": return "coffee";
    case "descanso": return "sofa";
    case "desligado": return "gone";
    default: return "desk";        // trabalhando, pensando, aguardando, refazendo, conferindo, chegando, cobrado
  }
}

/**
 * Each actor's spot: kept from before when still right (nobody changes desks while the data refreshes),
 * a free one of the right kind otherwise (the same desk for the same agent when it is free). The boss
 * "beside" stands next to whoever it is checking; a reviewer sits next to whoever it reviews.
 */
export function assignSpots(actors: OfficeActor[], before: Map<string, Spot> = new Map()): Map<string, Spot> {
  const out = new Map<string, Spot>(); const taken = new Set<Spot>();
  const want = (a: OfficeActor) => placeOf(a);
  const free = (kind: SpotKind) => PLAN.spots.filter((s) => s.kind === kind && !taken.has(s));
  const take = (a: OfficeActor, s: Spot | undefined) => { if (s) { out.set(a.id, s); taken.add(s); } };
  // Those staying where they are first.
  // (resting, any rest spot will do: a stroll is not undone by the next refresh).
  const fits = (a: OfficeActor, p: Spot) => p.kind === want(a) || (a.state === "descanso" && a.kind !== "chefe" && (p.kind === "rest" || p.kind === "coffee" || p.kind === "sofa"));
  for (const a of actors) { const p = before.get(a.id); if (p && fits(a, p) && !taken.has(p)) take(a, p); }
  // Meetings: owner and reviewer side by side.
  const meeting = PLAN.spots.filter((s) => s.kind === "meeting");
  for (const a of actors) {
    if (out.has(a.id) || want(a) !== "meeting") continue;
    const partner = a.with ? out.get(a.with) : undefined;
    const near = partner ? meeting.filter((s) => !taken.has(s)).sort((p, q) => Math.hypot(p.x - partner.x, p.y - partner.y) - Math.hypot(q.x - partner.x, q.y - partner.y))[0] : undefined;
    take(a, near || free("meeting")[0]);
  }
  for (const a of actors) {
    if (out.has(a.id)) continue;
    const kind = want(a);
    if (kind === "gone" || kind === "beside") continue;
    // A helper (a copy checking an answer) takes the free desk nearest to whoever it helps.
    const partner = a.with ? out.get(a.with) : undefined;
    const options = free(kind as SpotKind).sort((p, q) => (partner ? Math.hypot(p.x - partner.x, p.y - partner.y) - Math.hypot(q.x - partner.x, q.y - partner.y) : 0));
    if (partner && options.length) { take(a, options[0]); continue; }
    const rest = kind === "sofa" || kind === "coffee" ? [...options, ...free("rest"), ...free(kind === "sofa" ? "coffee" : "sofa")] : options.length ? options : free("rest");
    // The same desk for the same person, when it is free (their place in the office).
    const pick = rest.length ? rest[hash(a.id) % Math.min(rest.length, kind === "desk" ? rest.length : 3)] : undefined;
    take(a, pick);
  }
  // The boss beside whoever it is checking (at their desk, or in front of the boss's desk).
  for (const a of actors) {
    if (out.has(a.id) || want(a) !== "beside") continue;
    const target = a.with ? out.get(a.with) : undefined;
    if (target) out.set(a.id, { x: target.x + 1, y: target.y + (target.kind === "desk" ? 0 : 1), face: "left", sit: false, kind: "visit" });
    else take(a, PLAN.spots.find((s) => s.kind === "boss"));
  }
  return out;
}

/** An errand on the way to one's place: a spot, how long to stay, what one carries away from it. */
export type Errand = { spot: Spot; wait: number; carry?: Carry };
export type Carry = "paper" | "cup" | null;
/** A person on the floor: where they are, where they go, how they look. */
export type Walker = {
  id: string; actor: OfficeActor; x: number; y: number; path: Tile[]; spot: Spot | null; leaving: boolean; phase: number; facing: Spot["face"]; seat: boolean; strollAt: number;
  home?: Spot | null; homeAt?: number; queue?: Errand[]; dwell?: number; gives?: Carry; arrivedAt?: number | null; carry?: Carry; routineAt?: number; chatWith?: string | null;
};
const SPEED = 3.2;            // tiles per second
const BUSY = new Set(["trabalhando", "pensando", "refazendo", "conferindo", "aguardando", "chegando", "revisao", "cobrado"]);
const same = (a?: Spot | null, b?: Spot | null) => !!a && !!b && a.x === b.x && a.y === b.y;
const go = (w: Walker, spot: Spot) => { w.spot = spot; w.path = findPath(w, spot); w.arrivedAt = null; };

/** One frame: everyone walks their path; arrived, they sit or stand, wait out an errand, go on. */
export function step(walkers: Walker[], dt: number, now: number = Date.now()): Walker[] {
  for (const w of walkers) {
    const next = w.path[0];
    if (!next) {
      w.seat = !!w.spot?.sit && !w.leaving; if (w.spot) w.facing = w.spot.face;
      if (w.arrivedAt == null) w.arrivedAt = now;
      // An errand done: the next one, or home.
      if (w.queue?.length || (w.dwell != null && w.home && !same(w.spot, w.home))) {
        if (now - w.arrivedAt >= (w.dwell ?? 0)) {
          if (w.gives !== undefined) w.carry = w.gives;          // the paper handed over, the cup taken
          const e = w.queue?.shift();
          if (e) { w.dwell = e.wait; w.gives = e.carry ?? null; go(w, e.spot); }
          else { w.dwell = undefined; w.gives = undefined; if (w.home) go(w, w.home); }
        }
      }
      continue;
    }
    w.seat = false;
    const dx = next.x - w.x, dy = next.y - w.y; const d = Math.hypot(dx, dy); const move = SPEED * dt;
    w.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    if (d <= move) { w.x = next.x; w.y = next.y; w.path.shift(); } else { w.x += (dx / d) * move; w.y += (dy / d) * move; }
    w.phase += dt * 9;
  }
  // Who left through the door is gone.
  return walkers.filter((w) => !(w.leaving && !w.path.length && Math.round(w.x) === DOOR.x && Math.round(w.y) === DOOR.y));
}

/**
 * The floor after new data: newcomers come in through the door, those whose place changed walk to the
 * new one (a delivery first goes by the boss's desk with the paper, then by the coffee machine), those
 * no longer in the data walk out. A tool that changes every few seconds does not send anyone running
 * between the shelves and the desk: a place of work is kept at least 5 s.
 */
export function sync(walkers: Walker[], actors: OfficeActor[], now: number): Walker[] {
  const before = new Map(walkers.filter((w) => (w.home || w.spot) && !w.leaving).map((w) => [w.id, (w.home || w.spot)!]));
  const spots = assignSpots(actors, before);
  const byId = new Map(walkers.map((w) => [w.id, w]));
  const out: Walker[] = [];
  const machine = PLAN.spots.find((s) => s.kind === "coffee")!;
  const bossVisit = PLAN.spots.find((s) => s.kind === "visit")!;
  for (const a of actors) {
    let spot = spots.get(a.id) || null;
    let w = byId.get(a.id);
    if (!w) {
      if (!spot) continue;
      // Who was already there when the office opened is at their place; who arrives comes in through the door.
      const fresh = walkers.length > 0;
      w = { id: a.id, actor: a, x: fresh ? DOOR.x : spot.x, y: fresh ? DOOR.y : spot.y, path: [], spot: null, leaving: false, phase: hash(a.id) % 7, facing: "up", seat: false, strollAt: now + 12000 + (hash(a.id) % 15000), home: null, homeAt: now, queue: [], carry: null };
    }
    const was = w.actor.state; w.actor = a; w.leaving = false;
    if (!spot) { w.leaving = true; w.spot = w.home = null; w.queue = []; w.path = findPath(w, DOOR); out.push(w); continue; }
    const work = (k?: SpotKind) => k === "desk" || k === "shelf" || k === "server";
    if (w.home && work(w.home.kind) && work(spot.kind) && a.state === was && now - (w.homeAt ?? 0) < 5000) spot = w.home;
    if (!same(w.home, spot)) {
      w.home = spot; w.homeAt = now; w.chatWith = null;
      // Just delivered: the paper to the boss, a coffee from the machine, then a seat at the café.
      if (a.state === "cafe" && BUSY.has(was) && a.kind !== "chefe") {
        w.queue = [{ spot: machine, wait: 3000, carry: "cup" }]; w.dwell = 2500; w.gives = null; w.carry = "paper"; go(w, bossVisit);
      } else { w.queue = []; w.dwell = undefined; w.gives = undefined; w.carry = a.state === "cafe" ? "cup" : null; go(w, spot); }
    }
    out.push(w);
  }
  for (const w of walkers) if (!actors.some((a) => a.id === w.id)) { if (!w.leaving) { w.leaving = true; w.spot = w.home = null; w.queue = []; w.path = findPath(w, DOOR); } out.push(w); }
  return out;
}

/**
 * Life between the facts (each still what the state is): idle people stroll and, meeting another idle
 * one, stop to chat; who has been thinking a while gets up and paces beside the desk; the boss, with
 * nobody to check, goes round the desks of who is working.
 */
export function routines(walkers: Walker[], now: number): void {
  const used = new Set(walkers.map((w) => w.spot).filter(Boolean));
  const arrived = (w: Walker) => !w.path.length && !w.queue?.length && w.dwell == null;
  const working = walkers.filter((w) => !w.leaving && arrived(w) && w.home?.kind === "desk" && ["trabalhando", "pensando", "refazendo", "conferindo"].includes(w.actor.state));
  for (const w of walkers) {
    if (w.leaving || !arrived(w) || now < (w.routineAt ?? 0)) continue;
    const a = w.actor;
    if (a.state === "descanso" && a.kind !== "chefe" && now >= w.strollAt) {
      w.strollAt = now + 14000 + (hash(w.id + now) % 18000);
      // Now and then next to another idle person, to chat; otherwise another rest spot.
      const mate = walkers.find((o) => o !== w && o.actor.state === "descanso" && arrived(o) && !o.chatWith && o.spot);
      if (mate && hash(w.id + String(now)) % 2 === 0) {
        const near = [[1, 0], [-1, 0], [0, 1]].map(([dx, dy]) => ({ x: mate.spot!.x + dx, y: mate.spot!.y + dy })).find((t) => findPath(w, t).length || (w.x === t.x && w.y === t.y));
        if (near) { const face: Spot["face"] = near.x > mate.spot!.x ? "left" : near.x < mate.spot!.x ? "right" : "up"; go(w, { ...near, face, sit: false, kind: "rest" }); w.home = w.spot; w.chatWith = mate.id; mate.chatWith = w.id; continue; }
      }
      const options = PLAN.spots.filter((s) => (s.kind === "sofa" || s.kind === "rest" || s.kind === "coffee") && !used.has(s));
      if (options.length) { const s = options[hash(w.id + String(now)) % options.length]; used.delete(w.spot); used.add(s); if (w.chatWith) { const o = walkers.find((x) => x.id === w.chatWith); if (o) o.chatWith = null; } w.chatWith = null; go(w, s); w.home = s; }
      continue;
    }
    // Thinking for a while: up and pacing beside the desk, back to the chair, again.
    if (a.state === "pensando" && w.home?.kind === "desk" && a.since && now - a.since > 6000) {
      w.routineAt = now + 3500;
      if (same(w.spot, w.home)) go(w, { x: w.home.x + (hash(w.id) % 2 ? 1 : -1), y: w.home.y + 1, face: "down", sit: false, kind: "pace" });
      else go(w, w.home);
      continue;
    }
    // The boss going round: behind each one working, a few seconds each.
    if (a.kind === "chefe" && a.state === "supervisionando") {
      w.routineAt = now + 5500;
      if (!working.length) { if (w.home && !same(w.spot, w.home)) go(w, w.home); continue; }
      const target = working[Math.floor(now / 5500) % working.length];
      go(w, { x: target.home!.x + 1, y: target.home!.y, face: "left", sit: false, kind: "visit" });
    }
  }
}
/** Kept for callers of the first version: the routines include the strolls. */
export const stroll = routines;
