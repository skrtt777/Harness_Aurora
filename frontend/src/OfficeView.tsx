import { useEffect, useMemo, useRef, useState } from "react";
import { getOffice, type OfficeRoom } from "./api";
import { PLAN, step, sync, stroll, type OfficeActor, type Walker } from "./officeSim";
import { T, W, H, drawRoom, drawFurniture, drawClock, drawEmptySeat, drawPerson, drawBubble, lookOf, signOf, workingDesks } from "./officePixel";
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

// The shirt colours of the pixel people (officePixel.ts), for the legend and the list.
const BODY: Record<OfficeActor["kind"], string> = { aurora: "#8b55e8", agente: "#25a691", copia: "#7fd8cb", professor: "#d97757", chefe: "#2e3d6e" };
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
    const r = canvas.getBoundingClientRect(); const s = r.width / W;
    const x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s;
    let best: Walker | null = null; let bd = 12;
    for (const w of walkersRef.current) { const p = feet(w); const d = Math.hypot(p.x - x, p.y - 11 - y); if (d < bd) { bd = d; best = w; } }
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
        <canvas ref={canvasRef} className="office-canvas" width={W * 3} height={H * 3} aria-label={`Sala ${room?.name || ""}: ${people.filter((a) => a.state !== "desligado").length} pessoas`}
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

// ---------------- Drawing (pixel art: officePixel.ts) ----------------
/** Where someone's feet are on the small canvas (seated: a little up, on the chair or the sofa). */
function feet(w: Walker) {
  const seated = w.seat && w.spot;
  return { x: w.x * T + 8, y: w.y * T + (seated ? (w.spot!.kind === "sofa" ? 10 : 12) : 14) };
}
type Pose = "stand" | "walk" | "sit" | "sitFront";
function poseOf(w: Walker): { pose: Pose; facing: Walker["facing"] } {
  if (w.path.length) return { pose: "walk", facing: w.facing };
  if (w.seat && w.spot) return { pose: w.spot.face === "up" ? "sit" : "sitFront", facing: w.spot.face };
  return { pose: "stand", facing: w.spot?.face || w.facing };
}

let low: HTMLCanvasElement | null = null, room: HTMLCanvasElement | null = null;
function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, walkers: Walker[], t: number, hover: string | null, selected: string | null) {
  if (!low) { low = document.createElement("canvas"); low.width = W; low.height = H; }
  if (!room) { room = document.createElement("canvas"); room.width = W; room.height = H; drawRoom(room.getContext("2d")!); }
  const c = low.getContext("2d")!;
  c.imageSmoothingEnabled = false;
  c.drawImage(room, 0, 0);
  drawClock(c, new Date());
  const working = workingDesks(walkers);
  // Furniture, empty chairs and people in depth order (lower on the floor is drawn later).
  const items: Array<{ y: number; draw: () => void }> = [];
  for (const f of PLAN.furniture) if (f.kind !== "glass") items.push({ y: (f.y + f.h) * T - (f.kind === "shelf" || f.kind === "whiteboard" ? 8 : 0), draw: () => drawFurniture(c, f, working, t) });
  const seated = new Set(walkers.filter((w) => w.seat && w.spot).map((w) => `${w.spot!.x},${w.spot!.y}`));
  for (const s of PLAN.spots) if ((s.kind === "desk" || s.kind === "meeting") && !seated.has(`${s.x},${s.y}`)) items.push({ y: s.y * T + 10, draw: () => drawEmptySeat(c, s.x, s.y) });
  for (const w of walkers) {
    const p = feet(w); const { pose, facing } = poseOf(w);
    items.push({ y: p.y + (w.seat && w.spot?.kind === "sofa" ? T : 0), draw: () => drawPerson(c, p.x, p.y, w.actor, lookOf(w.actor), pose, facing, Math.floor(w.phase), t) });
  }
  items.sort((a, b) => a.y - b.y).forEach((i) => i.draw());
  // Signs over the heads of who has arrived.
  for (const w of walkers) { const sgn = signOf(w.actor.state, w.actor.kind); if (sgn && !w.path.length) { const p = feet(w); drawBubble(c, p.x + 1, p.y - (w.seat ? 25 : 27), sgn, t); } }
  // Enlarged without smoothing; the names sharp on top.
  const ratio = window.devicePixelRatio || 1; const shown = canvas.clientWidth || W * 3;
  const want = Math.max(W, Math.round(shown * ratio));
  if (canvas.width !== want) { canvas.width = want; canvas.height = Math.round(want * H / W); }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(low, 0, 0, canvas.width, canvas.height);
  const k = canvas.width / W;
  ctx.textAlign = "center";
  for (const w of walkers) {
    const lit = w.id === hover || w.id === selected; const a = w.actor; const p = feet(w);
    const text = lit ? `${a.kind === "aurora" && a.task ? `Aurora · ${a.task}` : a.name}: ${STATE_LABEL[a.state] || a.state}` : a.kind === "aurora" ? "Aurora" : a.name.length > 14 ? `${a.name.slice(0, 13)}…` : a.name;
    const size = Math.round((lit ? 4.6 : 3.6) * k); ctx.font = `700 ${size}px "Segoe UI", sans-serif`;
    const x = p.x * k, y = (p.y + 5) * k + size * 0.6;
    if (lit) { const wd = ctx.measureText(text).width + size; ctx.fillStyle = "rgba(23,20,31,0.88)"; ctx.fillRect(x - wd / 2, y - size, wd, size * 1.4); ctx.fillStyle = "#ffffff"; ctx.fillText(text, x, y); continue; }
    ctx.lineWidth = Math.max(2, k * 0.9); ctx.strokeStyle = "rgba(23,20,31,0.85)"; ctx.strokeText(text, x, y);
    ctx.fillStyle = "#f4f1e8"; ctx.fillText(text, x, y);
  }
}
