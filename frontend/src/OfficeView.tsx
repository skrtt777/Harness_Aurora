import { useEffect, useMemo, useRef, useState } from "react";
import { getOffice, type OfficeRoom } from "./api";
import { COLS, ROWS, PLAN, step, sync, stroll, type OfficeActor, type Walker } from "./officeSim";
import "./office.css";

/**
 * The agents' office (app/office.js): each project has its room and the task agents share the team
 * floor; every little person is a real session, agent, copy, teacher or the boss, in the state it is
 * really in. They walk to their desks to work, sit with the teacher to review, meet with the boss on
 * team requests, take a coffee after a delivery and rest on the sofa when there is nothing to do.
 */

export const STATE_LABEL: Record<string, string> = {
  trabalhando: "Trabalhando", pensando: "Pensando", aguardando: "Esperando sua autorização", revisao: "Em revisão com o professor",
  refazendo: "Refazendo", conferindo: "Conferindo", chegando: "Chegando", reuniao: "Em reunião", cafe: "No cafezinho",
  descanso: "Descansando", cobrado: "Sendo cobrado", desligado: "Fora do escritório", supervisionando: "Supervisionando", cobrando: "Cobrando",
};
const KIND_LABEL: Record<OfficeActor["kind"], string> = { aurora: "Aurora (sessão)", agente: "Agente", copia: "Cópia (subagente)", professor: "Professor", chefe: "Chefe" };
const BUSY = new Set(["trabalhando", "pensando", "aguardando", "revisao", "refazendo", "conferindo", "chegando", "reuniao"]);

// The office's own palette (a lit room seen from above, the same in light and dark).
const C = {
  floor: "#d9c6a5", floor2: "#cfba96", wall: "#3d4452", wallTop: "#59627a", window: "#9fd3ff", rugMeet: "#b9c8d8", rugBoss: "#c9b3c9", rugCoffee: "#d8b48c", rugLounge: "#b8cfae",
  desk: "#8a6a4a", deskTop: "#a8845e", screenOff: "#2a2f3a", screenOn: "#58d1ff", chair: "#3b4150", table: "#7b5b3e", tableTop: "#9c7650",
  glass: "rgba(170,210,240,0.35)", sofa: "#5a7fb5", sofaTop: "#7097cf", plant: "#3f8f4f", pot: "#a0562f", machine: "#2f3440", counter: "#6b5a4a", board: "#f4f6f8",
  ink: "#1d2230", label: "#1d2230", labelBg: "rgba(255,255,255,0.86)",
};
const SKIN = ["#f1c7a3", "#d9a47c", "#a8714f", "#7a4e33", "#ffd9b8"];
const HAIR = ["#2b2118", "#5a3a22", "#c48a3f", "#1b1b1b", "#8b8f99", "#b5442e"];
const BODY: Record<OfficeActor["kind"], string> = { aurora: "#9b5cf6", agente: "#2fb6a2", copia: "#7fd8cb", professor: "#d97757", chefe: "#2f3f73" };
const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const since = (ms?: number | null) => {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `há ${s} s` : s < 3600 ? `há ${Math.round(s / 60)} min` : `há ${Math.round(s / 3600)} h`;
};

export default function OfficeView({ onOpenConversation, onOpenAgents }: { onOpenConversation: (id: string) => void; onOpenAgents: () => void }) {
  const [rooms, setRooms] = useState<OfficeRoom[]>([]);
  const [roomId, setRoomId] = useState<string>(() => { try { return localStorage.getItem("aurora-office-room") || "equipe"; } catch { return "equipe"; } });
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const walkersRef = useRef<Walker[]>([]);
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null); selectedRef.current = selected;

  // The office now, every 1.5 s while the window is visible.
  useEffect(() => {
    let stop = false; let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (document.visibilityState === "visible") {
        try { const o = await getOffice(); if (!stop) { setRooms(o.rooms); setError(""); } }
        catch (e) { if (!stop) setError(e instanceof Error ? e.message : String(e)); }
      }
      if (!stop) timer = setTimeout(load, 1500);
    };
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, []);
  const room = rooms.find((r) => r.id === roomId) || rooms[0];
  useEffect(() => { if (room && room.id !== roomId) setRoomId(room.id); }, [room, roomId]);
  useEffect(() => { try { localStorage.setItem("aurora-office-room", roomId); } catch { /* private window */ } }, [roomId]);
  // Another room: a fresh floor (everyone at their place); the same room: they walk to the new spots.
  const lastRoom = useRef<string | null>(null);
  useEffect(() => {
    if (!room) return;
    const actors = room.actors.filter((a) => a.state !== "desligado");
    if (lastRoom.current !== room.id) { walkersRef.current = sync([], actors, Date.now()); lastRoom.current = room.id; }
    else walkersRef.current = sync(walkersRef.current, actors, Date.now());
  }, [room]);

  // The animation: walk, then draw (fewer frames when the person prefers less motion).
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0; let last = performance.now();
    const frame = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      walkersRef.current = step(walkersRef.current, still ? 1 : dt);
      stroll(walkersRef.current, Date.now());
      draw(ctx, canvas, walkersRef.current, t / 1000, hoverRef.current, selectedRef.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Pointing at someone: their name and what they do; a click selects them.
  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const r = canvas.getBoundingClientRect(); const s = r.width / (COLS * TILE);
    const x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s;
    let best: Walker | null = null; let bd = 22;
    for (const w of walkersRef.current) { const p = toPx(w); const d = Math.hypot(p.x - x, p.y - 14 - y); if (d < bd) { bd = d; best = w; } }
    return best;
  };
  const people = useMemo(() => (room?.actors || []).slice().sort((a, b) => Number(BUSY.has(b.state)) - Number(BUSY.has(a.state)) || a.name.localeCompare(b.name)), [room]);
  const chosen = people.find((a) => a.id === selected) || null;
  const counts = (r: OfficeRoom) => r.actors.filter((a) => a.kind !== "chefe" && BUSY.has(a.state)).length;

  return <section className="office-view page-skin" aria-label="Escritório dos agentes">
    <header className="page-header-row">
      <div>
        <h1 className="page-title">Escritório</h1>
        <p className="office-lede">Cada pessoa aqui é uma sessão, um agente ou um professor de verdade, no estado em que está agora.</p>
      </div>
    </header>
    <nav className="office-rooms" aria-label="Salas">
      {rooms.map((r) => <button key={r.id} className={`office-room-tab ${r.id === room?.id ? "active" : ""}`} aria-pressed={r.id === room?.id} onClick={() => { setRoomId(r.id); setSelected(null); }}>
        <span>{r.name}</span>{counts(r) > 0 && <span className="office-busy">{counts(r)} trabalhando</span>}
      </button>)}
    </nav>
    {error && <p role="alert" className="office-error">Não consegui ler o escritório: {error}</p>}
    <div className="office-body">
      <div className="office-stage">
        <canvas ref={canvasRef} className="office-canvas" width={COLS * TILE} height={ROWS * TILE} aria-label={`Sala ${room?.name || ""}: ${people.filter((a) => a.state !== "desligado").length} pessoas`}
          onMouseMove={(e) => { const w = pick(e); hoverRef.current = w?.id || null; e.currentTarget.style.cursor = w ? "pointer" : "default"; }}
          onMouseLeave={() => { hoverRef.current = null; }}
          onClick={(e) => setSelected(pick(e)?.id || null)} />
        <ul className="office-legend" aria-label="Legenda">
          {(["aurora", "agente", "copia", "professor", "chefe"] as const).map((k) => <li key={k}><span className="office-dot" style={{ background: BODY[k] }} />{KIND_LABEL[k]}</li>)}
        </ul>
      </div>
      <aside className="office-side" aria-label="Quem está na sala">
        {chosen ? <div className="office-card">
          <p className="office-kind">{KIND_LABEL[chosen.kind]}{chosen.department ? ` · ${chosen.department}` : ""}</p>
          <h2>{chosen.kind === "aurora" && chosen.task ? `Aurora · ${chosen.task}` : chosen.name}</h2>
          <p className={`office-state s-${chosen.state}`}>{STATE_LABEL[chosen.state] || chosen.state}{chosen.since ? ` · ${since(chosen.since)}` : ""}</p>
          <p>{chosen.activity}</p>
          {chosen.task && chosen.kind === "agente" && <p className="office-task">Tarefa: {chosen.task}</p>}
          {chosen.plan && chosen.plan.total > 0 && <p className="office-task">Plano: {chosen.plan.done} de {chosen.plan.total} passos</p>}
          <div className="office-actions">
            {chosen.conversationId && <button onClick={() => onOpenConversation(chosen.conversationId!)}>Abrir conversa</button>}
            {chosen.kind === "agente" && <button onClick={onOpenAgents}>Ver agentes</button>}
            <button className="ghost" onClick={() => setSelected(null)}>Fechar</button>
          </div>
        </div> : <p className="office-hint">Clique numa pessoa para ver o que ela está fazendo.</p>}
        <ul className="office-people">
          {people.map((a) => <li key={a.id}>
            <button className={a.id === selected ? "active" : ""} onClick={() => setSelected(a.id)}>
              <span className="office-dot" style={{ background: BODY[a.kind] }} />
              <span className="office-who">{a.kind === "aurora" && a.task ? `Aurora · ${a.task}` : a.name}</span>
              <span className={`office-state s-${a.state}`}>{STATE_LABEL[a.state] || a.state}</span>
            </button>
          </li>)}
        </ul>
      </aside>
    </div>
  </section>;
}

// ---------------- Drawing ----------------
const TILE = 32;
const toPx = (w: { x: number; y: number }) => ({ x: w.x * TILE + TILE / 2, y: w.y * TILE + TILE * 0.82 });

function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, walkers: Walker[], t: number, hover: string | null, selected: string | null) {
  // Sharp on any screen: the backing store follows the displayed size.
  const ratio = window.devicePixelRatio || 1; const shown = canvas.clientWidth || COLS * TILE;
  const want = Math.round(shown * ratio);
  if (canvas.width !== want) { canvas.width = want; canvas.height = Math.round(want * ROWS / COLS); }
  const k = canvas.width / (COLS * TILE);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  floor(ctx);
  const working = new Set<number>();
  for (const w of walkers) if (w.seat && w.spot?.kind === "desk" && ["trabalhando", "pensando", "refazendo", "conferindo", "aguardando", "cobrado"].includes(w.actor.state)) working.add(w.spot.desk!);
  // Furniture and people in depth order (what is lower on the floor is drawn later).
  const items: Array<{ y: number; draw: () => void }> = [];
  for (const f of PLAN.furniture) items.push({ y: (f.y + f.h) * TILE - (f.kind === "glass" ? 4 : 0), draw: () => furniture(ctx, f, working, t) });
  for (const w of walkers) items.push({ y: toPx(w).y + (w.seat && w.spot?.face === "up" ? 6 : 0), draw: () => person(ctx, w, t, w.id === hover || w.id === selected) });
  items.sort((a, b) => a.y - b.y).forEach((i) => i.draw());
  // Names and bubbles on top of everything.
  for (const w of walkers) overlay(ctx, w, t, w.id === hover || w.id === selected);
}

function floor(ctx: CanvasRenderingContext2D) {
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { ctx.fillStyle = (x + y) % 2 ? C.floor : C.floor2; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); }
  const rug = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(x * TILE + 4, y * TILE + 4, w * TILE - 8, h * TILE - 8, 8); ctx.fill(); };
  rug(1, 1, 8, 6, C.rugMeet); rug(11, 1, 7, 4, C.rugBoss); rug(21, 1, 8, 6, C.rugCoffee); rug(21, 14, 8, 4, C.rugLounge);
  // Walls with windows at the top, the door at the bottom left.
  ctx.fillStyle = C.wall; ctx.fillRect(0, 0, COLS * TILE, TILE * 0.7); ctx.fillRect(0, 0, 10, ROWS * TILE); ctx.fillRect(COLS * TILE - 10, 0, 10, ROWS * TILE); ctx.fillRect(0, ROWS * TILE - 10, COLS * TILE, 10);
  ctx.fillStyle = C.window; for (let x = 2; x < COLS - 2; x += 4) ctx.fillRect(x * TILE, 4, TILE * 2.4, TILE * 0.45);
  ctx.fillStyle = C.wallTop; ctx.fillRect(0, TILE * 0.7, COLS * TILE, 4);
  ctx.fillStyle = "#6b4a2e"; ctx.fillRect(2.4 * TILE, ROWS * TILE - 12, TILE * 2.2, 12);
  ctx.fillStyle = C.ink; ctx.font = "600 11px Segoe UI, sans-serif"; ctx.textAlign = "center";
  ctx.globalAlpha = 0.55; ctx.fillText("ENTRADA", 3.5 * TILE, ROWS * TILE - 16); ctx.fillText("REUNIÃO", 5 * TILE, 7.2 * TILE); ctx.fillText("CAFÉ", 25 * TILE, 6.6 * TILE); ctx.fillText("CHEFE", 14.5 * TILE, 4.8 * TILE); ctx.fillText("DESCANSO", 25 * TILE, 14.6 * TILE); ctx.globalAlpha = 1;
}

function block(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, top: string, side: string, lift = 10) {
  ctx.fillStyle = side; ctx.fillRect(x, y + h - lift, w, lift);
  ctx.fillStyle = top; ctx.beginPath(); ctx.roundRect(x, y - lift * 0.4, w, h - lift * 0.6, 4); ctx.fill();
}

function furniture(ctx: CanvasRenderingContext2D, f: (typeof PLAN.furniture)[number], working: Set<number>, t: number) {
  const x = f.x * TILE, y = f.y * TILE, w = f.w * TILE, h = f.h * TILE;
  switch (f.kind) {
    case "desk": {
      block(ctx, x + 2, y + 6, w - 4, h - 6, C.deskTop, C.desk);
      const on = working.has(f.desk!);
      // The monitor (lit while someone works at it), keyboard, mug.
      ctx.fillStyle = "#222"; ctx.fillRect(x + w / 2 - 2, y + 6, 4, 6);
      ctx.fillStyle = on ? C.screenOn : C.screenOff; ctx.beginPath(); ctx.roundRect(x + w / 2 - 15, y - 12, 30, 19, 3); ctx.fill();
      if (on) { ctx.fillStyle = "rgba(255,255,255,0.75)"; for (let i = 0; i < 4; i++) { const len = 6 + ((Math.sin(t * 3 + i * 1.7 + f.desk!) + 1) * 7); ctx.fillRect(x + w / 2 - 11, y - 9 + i * 4, len, 1.6); } }
      ctx.fillStyle = "#cfd3da"; ctx.fillRect(x + w / 2 - 10, y + 12, 20, 4);
      ctx.fillStyle = "#e8e2d6"; ctx.beginPath(); ctx.arc(x + w - 10, y + 12, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.chair; ctx.beginPath(); ctx.roundRect(x + 6, y + h + 8, 20, 14, 5); ctx.fill();
      break;
    }
    case "table": block(ctx, x + 4, y + 4, w - 8, h - 4, C.tableTop, C.table, 12); ctx.fillStyle = "#f5f5f5"; ctx.fillRect(x + 20, y + 14, 14, 10); ctx.fillRect(x + w - 40, y + 20, 14, 10); break;
    case "roundtable": ctx.fillStyle = C.table; ctx.beginPath(); ctx.ellipse(x + 16, y + 20, 14, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = C.tableTop; ctx.beginPath(); ctx.ellipse(x + 16, y + 16, 14, 10, 0, 0, Math.PI * 2); ctx.fill(); break;
    case "bossdesk": block(ctx, x, y + 4, w, h - 2, "#5b3b2a", "#3e281c", 12); ctx.fillStyle = C.screenOn; ctx.fillRect(x + w / 2 - 12, y - 10, 24, 14); ctx.fillStyle = "#c9a227"; ctx.fillRect(x + 8, y + 6, 10, 6); break;
    case "counter": block(ctx, x, y + 2, w, h - 2, "#8d7966", C.counter, 12); ctx.fillStyle = "#ffffff"; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x + 14 + i * 34, y + 10, 4, 0, Math.PI * 2); ctx.fill(); } break;
    case "machine": {
      block(ctx, x + 3, y, w - 6, h, "#4a5060", C.machine, 14); ctx.fillStyle = "#ff6b4a"; ctx.fillRect(x + 10, y + 6, 4, 4);
      // Steam.
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2; for (let i = 0; i < 2; i++) { const p = (t * 0.8 + i * 0.5) % 1; ctx.globalAlpha = 1 - p; ctx.beginPath(); ctx.moveTo(x + 16 + Math.sin(t * 3 + i) * 2, y - 4 - p * 16); ctx.lineTo(x + 16 + Math.sin(t * 3 + i + 1) * 3, y - 10 - p * 16); ctx.stroke(); } ctx.globalAlpha = 1;
      break;
    }
    case "sofa": block(ctx, x, y + 2, w, h - 2, C.sofaTop, C.sofa, 14); ctx.fillStyle = C.sofa; ctx.fillRect(x, y + 16, w, 14); break;
    case "plant": ctx.fillStyle = C.pot; ctx.fillRect(x + 10, y + 16, 12, 12); ctx.fillStyle = C.plant; for (const [dx, dy, r] of [[16, 10, 9], [10, 14, 7], [22, 14, 7]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2); ctx.fill(); } break;
    case "shelf": block(ctx, x, y, w, h, "#7a5a3c", "#5a3f28", 14); for (let i = 0; i < 6; i++) { ctx.fillStyle = ["#c0392b", "#2980b9", "#27ae60", "#f39c12"][i % 4]; ctx.fillRect(x + 6 + i * 9, y + 4, 6, 12); } break;
    case "whiteboard": ctx.fillStyle = "#9aa0aa"; ctx.fillRect(x, y + 2, w, 4); ctx.fillStyle = C.board; ctx.fillRect(x + 4, y - 10, w - 8, 20); ctx.strokeStyle = "#5fa8d3"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 12, y + 4); ctx.lineTo(x + 30, y - 4); ctx.lineTo(x + 46, y + 2); ctx.lineTo(x + 70, y - 6); ctx.stroke(); break;
    case "glass": ctx.fillStyle = C.glass; ctx.fillRect(x, y + h / 2 - 3, w, 6); ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillRect(x, y + h / 2 - 3, w, 1.5); break;
  }
}

function person(ctx: CanvasRenderingContext2D, w: Walker, t: number, lit: boolean) {
  const a = w.actor; const p = toPx(w); const h = hash(a.id);
  const skin = SKIN[h % SKIN.length], hair = HAIR[(h >> 3) % HAIR.length], body = BODY[a.kind];
  const walking = w.path.length > 0; const sit = w.seat;
  const bob = walking ? Math.abs(Math.sin(w.phase)) * 2 : 0;
  ctx.save(); ctx.translate(p.x, p.y - bob); ctx.scale(1.25, 1.25);
  if (a.kind === "copia") ctx.globalAlpha = 0.72;
  // Shadow.
  ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.beginPath(); ctx.ellipse(0, bob + 2, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  if (lit) { ctx.strokeStyle = "#5fd4c0"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, bob + 2, 12, 5, 0, 0, Math.PI * 2); ctx.stroke(); }
  // Legs (walking: in step; sitting: tucked).
  ctx.fillStyle = "#2c3140";
  if (sit) { ctx.fillRect(-6, -6, 5, 5); ctx.fillRect(1, -6, 5, 5); }
  else { const s = walking ? Math.sin(w.phase) * 3 : 0; ctx.fillRect(-5, -9 + s * 0.3, 4, 9 - s * 0.3); ctx.fillRect(1, -9 - s * 0.3, 4, 9 + s * 0.3); }
  const top = sit ? -24 : -27;
  // Body; the boss in a jacket and tie, the teacher with a badge.
  ctx.fillStyle = body; ctx.beginPath(); ctx.roundRect(-8, top, 16, 16, 5); ctx.fill();
  if (a.kind === "chefe") { ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.moveTo(-3, top); ctx.lineTo(3, top); ctx.lineTo(0, top + 6); ctx.fill(); ctx.fillStyle = "#d63b3b"; ctx.fillRect(-1, top + 3, 2, 8); }
  if (a.kind === "professor") { ctx.fillStyle = a.teacher === "claude" ? "#fbe3d6" : "#e9ecef"; ctx.fillRect(2, top + 4, 5, 6); ctx.fillStyle = "#222"; ctx.font = "bold 6px sans-serif"; ctx.textAlign = "center"; ctx.fillText(a.teacher === "claude" ? "C" : "X", 4.5, top + 9.5); }
  // Arms: typing at the desk, a raised hand waiting, a cup at coffee.
  ctx.fillStyle = body;
  const typing = sit && w.spot?.kind === "desk" && ["trabalhando", "refazendo", "conferindo"].includes(a.state);
  if (a.state === "aguardando") { ctx.fillRect(7, top - 10, 4, 12); ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(9, top - 11, 3, 0, Math.PI * 2); ctx.fill(); }
  else if (typing) { const k = Math.sin(t * 18 + (h % 5)) * 1.5; ctx.fillRect(-11, top + 5 + k, 4, 7); ctx.fillRect(7, top + 5 - k, 4, 7); }
  else { ctx.fillRect(-11, top + 3, 4, 10); ctx.fillRect(7, top + 3, 4, 10); }
  if (a.state === "cafe") { ctx.fillStyle = "#ffffff"; ctx.fillRect(8, top + 8, 6, 7); ctx.fillStyle = "#6b3e1f"; ctx.fillRect(9, top + 9, 4, 2); }
  // Head and hair (from behind when facing up).
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, top - 6, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hair;
  if (w.facing === "up") { ctx.beginPath(); ctx.arc(0, top - 6, 7.2, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(0, top - 8, 7.2, Math.PI, 0); ctx.fill(); ctx.fillStyle = "#1d2230"; const dx = w.facing === "left" ? -2 : w.facing === "right" ? 2 : 0; ctx.fillRect(-3 + dx, top - 6, 1.6, 2); ctx.fillRect(2 + dx, top - 6, 1.6, 2); }
  if (a.kind === "professor") { ctx.strokeStyle = "#222"; ctx.lineWidth = 1; ctx.strokeRect(-5, top - 7, 4, 3); ctx.strokeRect(1, top - 7, 4, 3); }
  ctx.restore();
}

/** Above each head: what they are doing, as a small sign; the name under the feet when pointed at. */
function overlay(ctx: CanvasRenderingContext2D, w: Walker, t: number, lit: boolean) {
  const a = w.actor; const p = toPx(w); const top = p.y - ((w.seat ? 24 : 27) + 8) * 1.25 - 14;
  const sign = signOf(a.state, a.kind);
  if (sign && !w.path.length) {
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(p.x - 11, top - 12, 22, 16, 6); ctx.fill(); ctx.stroke();
    glyph(ctx, sign, p.x, top - 4, t);
  }
  if (lit) {
    const text = `${a.kind === "aurora" && a.task ? `Aurora · ${a.task}` : a.name}: ${STATE_LABEL[a.state] || a.state}`;
    ctx.font = "600 12px Segoe UI, sans-serif"; const wd = Math.min(260, ctx.measureText(text).width + 12);
    ctx.fillStyle = C.labelBg; ctx.beginPath(); ctx.roundRect(p.x - wd / 2, p.y + 6, wd, 18, 6); ctx.fill();
    ctx.fillStyle = C.label; ctx.textAlign = "center"; ctx.fillText(text, p.x, p.y + 19, 248);
  } else {
    ctx.font = "600 10px Segoe UI, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "rgba(29,34,48,0.75)";
    ctx.fillText(a.kind === "aurora" ? "Aurora" : a.name.length > 14 ? `${a.name.slice(0, 13)}…` : a.name, p.x, p.y + 14);
  }
}

type Sign = "dots" | "think" | "hand" | "talk" | "cup" | "zz" | "alert" | "check" | "clip";
function signOf(state: string, kind: OfficeActor["kind"]): Sign | null {
  if (kind === "chefe") return state === "cobrando" ? "clip" : state === "conferindo" ? "check" : state === "reuniao" ? "talk" : null;
  return ({ trabalhando: "dots", refazendo: "dots", conferindo: "check", pensando: "think", chegando: "think", aguardando: "hand", revisao: "talk", reuniao: "talk", cafe: "cup", descanso: "zz", cobrado: "alert" } as Record<string, Sign>)[state] || null;
}
function glyph(ctx: CanvasRenderingContext2D, s: Sign, x: number, y: number, t: number) {
  ctx.fillStyle = "#1d2230"; ctx.strokeStyle = "#1d2230"; ctx.lineWidth = 1.6; ctx.textAlign = "center"; ctx.font = "bold 10px Segoe UI, sans-serif";
  switch (s) {
    case "dots": for (let i = 0; i < 3; i++) { ctx.globalAlpha = 0.35 + 0.65 * ((Math.floor(t * 4) % 3) === i ? 1 : 0); ctx.beginPath(); ctx.arc(x - 5 + i * 5, y, 1.8, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1; break;
    case "think": ctx.beginPath(); ctx.arc(x + 2, y - 1, 3.5, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(x - 4, y + 3, 1.3, 0, Math.PI * 2); ctx.fill(); break;
    case "hand": ctx.fillStyle = "#d6a24a"; ctx.fillRect(x - 3, y - 3, 6, 7); for (let i = 0; i < 3; i++) ctx.fillRect(x - 3 + i * 2.2, y - 7, 1.6, 5); break;
    case "talk": ctx.beginPath(); ctx.ellipse(x, y - 1, 6, 4, 0, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 3, y + 2); ctx.lineTo(x - 5, y + 5); ctx.lineTo(x, y + 3); ctx.fill(); break;
    case "cup": ctx.fillStyle = "#6b3e1f"; ctx.fillRect(x - 4, y - 3, 7, 6); ctx.strokeStyle = "#6b3e1f"; ctx.beginPath(); ctx.arc(x + 4, y, 2, -Math.PI / 2, Math.PI / 2); ctx.stroke(); break;
    case "zz": ctx.fillText("z", x - 2, y + 3); ctx.font = "bold 7px Segoe UI, sans-serif"; ctx.fillText("z", x + 4, y - 1); break;
    case "alert": ctx.fillStyle = "#e75e78"; ctx.font = "900 12px Segoe UI, sans-serif"; ctx.fillText("!", x, y + 4); break;
    case "check": ctx.strokeStyle = "#2f9e6e"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x - 1, y + 3); ctx.lineTo(x + 5, y - 3); ctx.stroke(); break;
    case "clip": ctx.strokeRect(x - 4, y - 4, 8, 9); ctx.fillRect(x - 2, y - 6, 4, 2); ctx.beginPath(); ctx.moveTo(x - 2, y - 1); ctx.lineTo(x + 2, y - 1); ctx.moveTo(x - 2, y + 2); ctx.lineTo(x + 2, y + 2); ctx.stroke(); break;
  }
}
