import { useEffect, useMemo, useRef, useState } from "react";
import { getOffice, getHr, reviewHr, rehireAgent, type OfficeRoom, type HrSnapshot, type OfficeFicha } from "./api";
import { PLAN, step, sync, stroll, usePlan, useHQ, desksFor, type OfficeActor, type Walker, type Department } from "./officeSim";
import { T, size, drawRoom, drawFurniture, drawClock, drawWindows, drawLight, drawEmptySeat, drawPerson, drawBubble, lookOf, signOf, workingDesks, type Sign } from "./officePixel";
import "./office.css";

/**
 * The agents' office (app/office.js): one floor for everyone, each person with the project it works
 * on; every little person is a real session, agent, copy, teacher, the HR team or the boss, in the
 * state it is really in. They walk to their desks to work, sit with the teacher to review, meet with the boss on
 * team requests, take a coffee after a delivery and rest on the sofa when there is nothing to do.
 */

export const STATE_LABEL: Record<string, string> = {
  trabalhando: "Trabalhando", delegado: "Com o modelo forte", pensando: "Pensando", aguardando: "Esperando sua autorização", revisao: "Em revisão com o professor",
  refazendo: "Refazendo", conferindo: "Conferindo", chegando: "Chegando", reuniao: "Em reunião", cafe: "No cafezinho",
  descanso: "Descansando", cobrado: "Sendo cobrado", desligado: "Fora do escritório", supervisionando: "Supervisionando", cobrando: "Cobrando",
  premiando: "Premiando", orientando: "Orientando", desligando: "Desligando", entrevistando: "Recebendo um contratado", avaliando: "Avaliando a equipe",
};
const HR_KIND: Record<string, string> = { premio: "Prêmio", elogio: "Elogio", advertencia: "Plano de melhoria", demissao: "Desligamento", contratacao: "Contratação", recontratacao: "Recontratação", avaliacao: "Avaliação" };
const KIND_LABEL: Record<OfficeActor["kind"], string> = { aurora: "Aurora (sessão)", agente: "Agente", copia: "Cópia (conferência)", subagente: "Subagente", professor: "Professor", forte: "Claude/Codex fazendo (sem ver seus dados)", chefe: "Chefe", rh: "RH" };
/** How someone is called in the list and on hover: a session with its conversation ("Marina · Metas de outubro"). */
const who = (a: OfficeActor) => ((a.kind === "aurora" || a.kind === "subagente") && a.task ? `${a.name} · ${a.task}` : a.name);
/** The name on the floor, with the HR stars ("Cobrança ★2"). */
const ENGINE: Record<string, string> = { claude: "Claude", codex: "Codex" };
const tag = (a: OfficeActor) => `${a.name}${a.engine && ENGINE[a.engine] ? ` · ${ENGINE[a.engine]}` : ""}${a.stars ? ` ★${a.stars}` : ""}`;
const BUSY = new Set(["trabalhando", "delegado", "pensando", "aguardando", "revisao", "refazendo", "conferindo", "chegando", "reuniao"]);

// The shirt colours of the pixel people (officePixel.ts), for the legend and the list.
const BODY: Record<OfficeActor["kind"], string> = { aurora: "#8b55e8", agente: "#25a691", copia: "#7fd8cb", subagente: "#c4a3ff", professor: "#d97757", forte: "#d97757", chefe: "#2e3d6e", rh: "#e0a43a" };
const since = (ms?: number | null) => {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `há ${s} s` : s < 3600 ? `há ${Math.round(s / 60)} min` : `há ${Math.round(s / 3600)} h`;
};

export default function OfficeView({ onOpenConversation, onOpenAgents }: { onOpenConversation: (id: string) => void; onOpenAgents: () => void }) {
  const [rooms, setRooms] = useState<OfficeRoom[]>([]);
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [fichas, setFichas] = useState<OfficeFicha[]>([]);
  const [hr, setHr] = useState<HrSnapshot | null>(null);
  const [hrBusy, setHrBusy] = useState(false);
  const [hrOpen, setHrOpen] = useState(() => { try { return localStorage.getItem("aurora-office-hr") !== "0"; } catch { return true; } });
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [rows, setRows] = useState(() => size().H / T);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const walkersRef = useRef<Walker[]>([]);
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null); selectedRef.current = selected;

  // The office now, every 1.5 s while the window is visible.
  useEffect(() => {
    let stop = false; let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (document.visibilityState === "visible") {
        try { const o = await getOffice(); if (!stop) { setRooms(o.rooms); setFichas(o.fichas || []); if (o.departments) setDepartments((d) => (d && d.length === o.departments!.length ? d : o.departments!)); setError(""); } }
        catch (e) { if (!stop) setError(e instanceof Error ? e.message : String(e)); }
      }
      if (!stop) timer = setTimeout(load, 1500);
    };
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, []);
  const room = rooms[0];
  // The HR report card, every 10 s.
  useEffect(() => {
    let stop = false; let timer: ReturnType<typeof setTimeout>;
    const load = async () => { if (document.visibilityState === "visible") { try { const h = await getHr(); if (!stop) setHr(h); } catch { /* the office still works */ } } if (!stop) timer = setTimeout(load, 10000); };
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, []);
  useEffect(() => { try { localStorage.setItem("aurora-office-hr", hrOpen ? "1" : "0"); } catch { /* private window */ } }, [hrOpen]);
  const hrAct = async (run: () => Promise<HrSnapshot>) => { setHrBusy(true); try { setHr(await run()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setHrBusy(false); } };
  // Another room: a fresh floor (everyone at their place); the same room: they walk to the new spots.
  const lastRoom = useRef<string | null>(null);
  useEffect(() => {
    if (!room) return;
    const actors = room.actors.filter((a) => a.state !== "desligado");
    // The Sede when the Harness sends its departments; else the room that grows with the team.
    const grew = departments ? useHQ(departments) : usePlan(desksFor(actors.filter((a) => a.kind !== "chefe").length));
    if (grew || lastRoom.current !== room.id) { walkersRef.current = sync([], actors, Date.now()); lastRoom.current = room.id; setRows(size().H / T); }
    else walkersRef.current = sync(walkersRef.current, actors, Date.now());
  }, [room, departments]);

  // The animation: walk, then draw (fewer frames when the person prefers less motion).
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0; let last = performance.now();
    const frame = (t: number) => {
      // At most ~30 frames a second, like the chat's aurora: at the monitor's own rate (170 on a
      // 165 Hz screen, 15/10) the whole floor was redrawn for nothing while the local model shares the GPU.
      if (t - last < 32) { raf = requestAnimationFrame(frame); return; }
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
    const r = canvas.getBoundingClientRect(); const s = r.width / size().W;
    const x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s;
    let best: Walker | null = null; let bd = 12;
    for (const w of walkersRef.current) { const p = feet(w); const d = Math.hypot(p.x - x, p.y - 11 - y); if (d < bd) { bd = d; best = w; } }
    return best;
  };
  const people = useMemo(() => (room?.actors || []).slice().sort((a, b) => Number(BUSY.has(b.state)) - Number(BUSY.has(a.state)) || a.name.localeCompare(b.name)), [room]);
  const chosen = people.find((a) => a.id === selected) || null;
  const busy = (room?.actors || []).filter((a) => a.kind !== "chefe" && a.kind !== "rh" && BUSY.has(a.state)).length;

  return <section className="office-view page-skin" aria-label="Escritório dos agentes">
    <header className="page-header-row">
      <div>
        <h1 className="page-title">Escritório</h1>
        <p className="office-lede">A Sede da Aurora: cada pedido percorre a linha (Recepção, Arquivo, Biblioteca, o departamento da área, Revisão, Conferência, Expedição), e cada pessoa está na sala do que está fazendo agora.{busy > 0 ? ` ${busy} trabalhando agora.` : ""}</p>
      </div>
    </header>
    {error && <p role="alert" className="office-error">Não consegui ler o escritório: {error}</p>}
    <div className="office-body">
      <div className="office-stage">
        <canvas ref={canvasRef} className="office-canvas" style={{ aspectRatio: `${PLAN.cols} / ${rows}` }} width={size().W * 3} height={size().H * 3} aria-label={`${room?.name || "Escritório"}: ${people.filter((a) => a.state !== "desligado").length} pessoas`}
          onMouseMove={(e) => { const w = pick(e); hoverRef.current = w?.id || null; e.currentTarget.style.cursor = w ? "pointer" : "default"; }}
          onMouseLeave={() => { hoverRef.current = null; }}
          onClick={(e) => setSelected(pick(e)?.id || null)} />
        <ul className="office-legend" aria-label="Legenda">
          {(["aurora", "subagente", "agente", "copia", "professor", "forte", "rh", "chefe"] as const).map((k) => <li key={k}><span className="office-dot" style={{ background: BODY[k] }} />{KIND_LABEL[k]}</li>)}
        </ul>
      </div>
      <aside className="office-side" aria-label="Quem está na sala">
        {chosen ? <div className="office-card">
          <p className="office-kind">{KIND_LABEL[chosen.kind]}{chosen.department ? ` · ${chosen.department}` : ""}{chosen.project ? ` · ${chosen.project}` : ""}</p>
          <h2>{tag(chosen)}</h2>
          {chosen.kind === "aurora" && chosen.task && <p className="office-task">Conversa: {chosen.task}</p>}
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
        <section className="hq-fichas" aria-label="Pedidos na linha">
          <h2 className="hq-side-title">Pedidos na linha</h2>
          {fichas.length ? fichas.map((f) => <article key={f.id} className={`hq-ficha ${f.step === 3 ? "done" : ""}`}>
            <header>
              <ol className="hq-steps" aria-label="Etapa">
                {["O pedido", "O time trabalha", "A entrega"].map((s, i) => <li key={s} className={i + 1 < f.step ? "feito" : i + 1 === f.step ? "agora" : ""}><b>{i + 1 < f.step ? "✓" : i + 1}</b>{s}</li>)}
              </ol>
              <button className="hq-ficha-title" onClick={() => onOpenConversation(f.id)} title="Abrir a conversa"><strong>{f.title}</strong><small>{f.who ? `${f.who} · ` : ""}{f.areaName}{f.endedAt ? ` · entregue ${since(f.endedAt)}` : f.since ? ` · ${since(f.since)}` : ""}</small></button>
            </header>
            {f.order && (f.order.deliver.length > 0 || f.order.rules.length > 0 || f.order.run) && <p className="hq-order" title="Ordem de serviço da Recepção">{[f.order.deliver.length ? `Entregar: ${f.order.deliver.join(", ")}` : "", f.order.rules.length ? `Regras: ${f.order.rules.join("; ")}` : "", f.order.run ? "Rodar e mostrar a saída" : ""].filter(Boolean).join(" · ")}</p>}
        <ol className="hq-line" aria-label="Estações">
              {f.stations.map((s) => <li key={s.id} className={`s-${s.state}`} title={s.state === "pulado" ? "Não precisou" : s.state}>{s.label}</li>)}
            </ol>
          </article>) : <p className="office-hint">Nenhum pedido na linha agora. Quando você pedir algo, a ficha aparece aqui e anda pelas salas.</p>}
        </section>
        <h2 className="hq-side-title">Pessoas</h2>
        <ul className="office-people">
          {people.map((a) => <li key={a.id}>
            <button className={a.id === selected ? "active" : ""} onClick={() => setSelected(a.id)}>
              <span className="office-dot" style={{ background: BODY[a.kind] }} />
              <span className="office-who">{a.stars ? `${who(a)} ★${a.stars}` : who(a)}{a.room && PLAN.rooms ? <small className="office-proj">{`${PLAN.rooms.find((r) => r.id === a.room)?.name || a.room}${a.project && a.kind !== "rh" && a.kind !== "chefe" && a.project !== "Conversas soltas" ? ` · ${a.project}` : ""}`}</small> : a.project && a.kind !== "rh" && a.kind !== "chefe" ? <small className="office-proj">{a.project}</small> : null}</span>
              <span className={`office-state s-${a.state}`}>{STATE_LABEL[a.state] || a.state}</span>
            </button>
          </li>)}
        </ul>
      </aside>
    </div>
    <section className="office-hr" aria-label="RH dos agentes">
      <header className="office-hr-head">
        <div>
          <h2>RH dos agentes</h2>
          <p className="office-lede">{hr ? `${hr.team.map((m) => `${m.name} (${m.role.toLowerCase()})`).join(" e ")} avaliam cada agente pelas entregas reais: estrela para nota ${hr.rules.reward}+, plano de melhoria abaixo de ${hr.rules.warn}, desligamento e substituto abaixo de ${hr.rules.dismiss} depois do plano.${hr.lastReview ? ` Última avaliação ${since(Date.parse(hr.lastReview))}.` : ""}` : "Carregando…"}</p>
        </div>
        <div className="office-actions">
          <button disabled={hrBusy} onClick={() => hrAct(reviewHr)}>{hrBusy ? "Avaliando…" : "Avaliar agora"}</button>
          <button className="ghost" aria-expanded={hrOpen} onClick={() => setHrOpen(!hrOpen)}>{hrOpen ? "Esconder" : "Mostrar"}</button>
        </div>
      </header>
      {hrOpen && hr && <div className="office-hr-body">
        <div className="office-hr-table">
          {hr.report.length ? <table>
            <thead><tr><th>Agente</th><th>Nota</th><th>Entregas</th><th>Estrelas</th><th>Situação</th></tr></thead>
            <tbody>{hr.report.map((c) => <tr key={c.agentId} className={c.status === "demitido" ? "off" : ""}>
              <td>{c.name}{c.department ? <small> · {c.department}</small> : null}</td>
              <td className="num">{c.score === null ? "—" : c.score}{c.trend ? <small className={c.trend > 0 ? "up" : "down"}> {c.trend > 0 ? "▲" : "▼"}{Math.abs(c.trend)}</small> : null}</td>
              <td className="num">{c.runs ? `${c.delivered}/${c.runs}${c.failed ? ` · ${c.failed} falha${c.failed > 1 ? "s" : ""}` : ""}` : "—"}</td>
              <td className="num">{c.stars ? "★".repeat(Math.min(c.stars, 5)) + (c.stars > 5 ? `+${c.stars - 5}` : "") : "—"}</td>
              <td>{c.status === "demitido" ? <button className="ghost" disabled={hrBusy} onClick={() => hrAct(() => rehireAgent(c.agentId))}>Recontratar</button> : !c.enabled ? "Desligado" : c.score === null || c.runs < hr.rules.minRuns ? "Em experiência" : c.warnings ? `Em plano de melhoria` : "Ativo"}</td>
            </tr>)}</tbody>
          </table> : <p className="office-hint">Ainda não há agentes de tarefa. Crie um em Agentes para o RH começar a avaliar.</p>}
        </div>
        <ul className="office-hr-events" aria-label="Decisões do RH">
          {hr.events.filter((e) => e.kind !== "avaliacao").slice(0, 8).map((e) => <li key={e.id}>
            <span className={`office-hr-kind k-${e.kind}`}>{HR_KIND[e.kind] || e.kind}</span>
            <span><strong>{e.title}</strong>{e.detail ? ` — ${e.detail}` : ""}<small> {e.by ? `${e.by}, ` : ""}{since(Date.parse(e.at))}</small></span>
          </li>)}
          {!hr.events.some((e) => e.kind !== "avaliacao") && <li className="office-hint">Nenhuma decisão ainda: o RH avalia a cada hora, depois de 3 entregas de cada agente.</li>}
        </ul>
      </div>}
    </section>
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

const lookHash = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
let low: HTMLCanvasElement | null = null, room: HTMLCanvasElement | null = null, roomPlan: unknown = null;
function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, walkers: Walker[], t: number, hover: string | null, selected: string | null) {
  const { W, H } = size();
  if (!low || low.height !== H) { low = document.createElement("canvas"); low.width = W; low.height = H; }
  if (!room || roomPlan !== PLAN) { room = document.createElement("canvas"); room.width = W; room.height = H; drawRoom(room.getContext("2d")!); roomPlan = PLAN; }
  const c = low.getContext("2d")!;
  c.imageSmoothingEnabled = false;
  c.drawImage(room, 0, 0);
  const now = new Date(); if (!PLAN.rooms) { drawWindows(c, now); drawClock(c, now); }
  const working = workingDesks(walkers);
  // Furniture, empty chairs and people in depth order (lower on the floor is drawn later).
  const items: Array<{ y: number; draw: () => void }> = [];
  for (const f of PLAN.furniture) if (f.kind !== "glass") items.push({ y: (f.y + f.h) * T - (f.kind === "shelf" || f.kind === "whiteboard" ? 8 : 0), draw: () => drawFurniture(c, f, working, t) });
  const seated = new Set(walkers.filter((w) => w.seat && w.spot).map((w) => `${w.spot!.x},${w.spot!.y}`));
  for (const s of PLAN.spots) if ((s.kind === "desk" || s.kind === "meeting") && s.sit && !seated.has(`${s.x},${s.y}`)) items.push({ y: s.y * T + 10, draw: () => drawEmptySeat(c, s.x, s.y) });
  for (const w of walkers) {
    const p = feet(w); const { pose, facing } = poseOf(w);
    items.push({ y: p.y + (w.seat && w.spot?.kind === "sofa" ? T : 0), draw: () => drawPerson(c, p.x, p.y, w.actor, lookOf(w.actor), pose, facing, Math.floor(w.phase), t, w.carry ?? null) });
  }
  items.sort((a, b) => a.y - b.y).forEach((i) => i.draw());
  // Evening and night: dimmer, the screens of who works glowing.
  drawLight(c, now, PLAN.furniture.filter((f) => f.kind === "desk" && working.has(f.desk!)).map((f) => ({ x: f.x * T + 9, y: f.y * T - 6 })));
  // Signs over the heads of who has arrived: at the shelves a book, at the server a terminal, a
  // conversation in turns (one talks, then the other).
  // In a meeting one speaks at a time (the boss more often), in turns of 1.6 s.
  const meeting = walkers.filter((w) => !w.path.length && w.spot?.kind === "meeting");
  const order = [...meeting.filter((w) => w.actor.kind === "chefe"), ...meeting].map((w) => w.id);
  const speaker = order.length ? order[Math.floor(t / 1.6) % order.length] : null;
  for (const w of walkers) {
    if (w.path.length) continue;
    if (w.spot?.kind === "meeting" && meeting.length > 2 && w.id !== speaker) continue;
    let sgn: Sign | null = w.spot?.kind === "shelf" ? "book" : w.spot?.kind === "server" ? "term" : w.spot?.kind === "pace" ? "think" : w.carry === "paper" ? "paper" : signOf(w.actor.state, w.actor.kind);
    const talking = w.chatWith ? walkers.find((o) => o.id === w.chatWith && !o.path.length) : null;
    if (talking) sgn = "talk";
    if (sgn === "talk" && w.id !== speaker && Math.floor(t / 1.6 + (talking ? (w.id < talking.id ? 0 : 1) : (lookHash(w.id) % 2))) % 2) continue;
    if (sgn) { const p = feet(w); drawBubble(c, p.x + 1, p.y - (w.seat ? 25 : 27), sgn, t); }
  }
  // Enlarged without smoothing; the names sharp on top.
  const ratio = window.devicePixelRatio || 1; const shown = canvas.clientWidth || W * 3;
  const want = Math.max(W, Math.round(shown * ratio));
  if (canvas.width !== want || canvas.height !== Math.round(want * H / W)) { canvas.width = want; canvas.height = Math.round(want * H / W); }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(low, 0, 0, canvas.width, canvas.height);
  const k = canvas.width / W;
  // The Sede: each room's name on its board, and the name of each desk of the areas.
  if (PLAN.rooms) {
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (const r of PLAN.rooms) {
      ctx.font = `700 ${Math.round(6.2 * k)}px "Segoe UI", sans-serif`; ctx.fillStyle = "#f4f1e8";
      ctx.fillText(r.name, (r.x * T + 13) * k, (r.y * T + (r.y === 0 ? 7 : 8)) * k);
    }
    ctx.font = `600 ${Math.round(4 * k)}px "Segoe UI", sans-serif`; ctx.textAlign = "center";
    for (const f of PLAN.furniture) if (f.kind === "desk" && f.label) { const tx = (f.x * T + T) * k, ty = (f.y * T + 21) * k; const wd = ctx.measureText(f.label).width + 3 * k; ctx.fillStyle = "rgba(23,20,31,0.72)"; ctx.fillRect(tx - wd / 2, ty - 2.6 * k, wd, 5.2 * k); ctx.fillStyle = "#f2d9a0"; ctx.fillText(f.label, tx, ty); }
    ctx.textBaseline = "alphabetic";
  }
  ctx.textAlign = "center";
  for (const w of walkers) {
    const lit = w.id === hover || w.id === selected; const a = w.actor; const p = feet(w);
    if (!lit && w.spot?.kind === "meeting" && !w.path.length && meeting.length > 6 && w.id !== speaker) continue;      // a crowd: only who speaks
    const short = a.kind === "copia" ? a.name.replace(/ de .*/, "") : a.name.length > 14 ? `${a.name.slice(0, 13)}…` : a.name;
    const text = lit ? `${who(a)}: ${STATE_LABEL[a.state] || a.state}` : a.stars ? `${short} ★${a.stars}` : short;
    const size = Math.round((lit ? 4.6 : 3.6) * k); ctx.font = `700 ${size}px "Segoe UI", sans-serif`;
    const x = p.x * k, y = (p.y + 5) * k + size * 0.6;
    if (lit) { const wd = ctx.measureText(text).width + size; ctx.fillStyle = "rgba(23,20,31,0.88)"; ctx.fillRect(x - wd / 2, y - size, wd, size * 1.4); ctx.fillStyle = "#ffffff"; ctx.fillText(text, x, y); continue; }
    ctx.lineWidth = Math.max(2, k * 0.9); ctx.strokeStyle = "rgba(23,20,31,0.85)"; ctx.strokeText(text, x, y);
    ctx.fillStyle = "#f4f1e8"; ctx.fillText(text, x, y);
  }
}
