import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dismissKeeperFlag, getMemoryGraph, setKeeperEnabled, subscribeMemoryEvents, undoKeeperJoin, visitKeeper, type MemoryGraphSnapshot, type MemoryLiveEvent, type ModelSpeedSample } from "../api";
import { applyEvent, buildMemoryGraph, keeperFromSnapshot, reduceKeeper, reduceTurn, reviewOf, sectionProgress, type KeeperView, type TurnPhase, type TurnState, CATEGORY_COLOR, CATEGORY_LABEL, edgesOf, newFrozenAtlas, RELATION_LABEL, searchIds, steadyAtlas, type Category, type Filters, type ViewMode } from "./adapter";
import { cloudColor, fitDistance, layoutClouds, type CloudLayout } from "./clouds";
import type { AgentState, AgentTentacle, CameraCommand, Highlight, MapSettings, Merge, Quality, RecallBush } from "./LiveMapScene";
import type { Vec3 } from "./layout";
import ChatDock from "./ChatDock";
import "./livemap.css";

const LiveMapScene = lazy(() => import("./LiveMapScene"));
const ArchiveScene = lazy(() => import("./ArchiveScene"));

/**
 * Memórias / Mapa Vivo: the Aurora's memory as a field of clouds (one per section, the Zeladora's nodes) on an
 * instrument panel. Every bright point is a stored memory, every cloud a real grouping, every tentacle and wave
 * a real event (a search, a memory used in an answer, the Zeladora at work); every number on the panel is
 * counted from the memories and the live events. No demo data: with nothing stored, the map says so.
 */
const MODES: [ViewMode, string][] = [["geral", "visão geral"], ["pasta", "por pasta / projeto"], ["conversa", "por conversa"]];
const EVENT_LABEL: Record<string, string> = { created: "criada", updated: "atualizada", archived: "arquivada", restored: "restaurada", deleted: "apagada", recalled: "consultada", scanned: "buscou", "turn-start": "pergunta", "turn-end": "fim", answered: "respondeu", keeper: "zeladora" };
// The Zeladora's actions in the log, the reference's crawl log (read · link · flag · walk).
const KEEPER_LABEL: Record<string, string> = { called: "chamada", read: "lê", link: "liga", join: "junta", compact: "compacta", flag: "marca", walk: "anda", rest: "descansa", round: "ronda", error: "erro", prune: "poda", arrival: "chegou", adopt: "adota", plant: "planta", "node-born": "nódulo +", "node-gone": "nódulo −" };
// The steps of a turn, as the reference's sections: each lights up when its real event arrives.
const STEPS: [Phase, string][] = [["pergunta", "pergunta"], ["busca", "busca na memória"], ["consulta", "memórias no contexto"], ["resposta", "resposta"]];
type Phase = TurnPhase;
type Turn = TurnState;
const PERIODS: [number, string][] = [[0, "todo o período"], [1, "últimas 24 h"], [7, "últimos 7 dias"], [30, "últimos 30 dias"], [90, "últimos 90 dias"]];
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const prefersReduced = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const webglAvailable = () => { try { const c = document.createElement("canvas"); return Boolean(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } };
const loadSettings = (): MapSettings => {
  const base: MapSettings = { paused: false, quality: "alta", labels: true, reducedMotion: prefersReduced(), autoFocus: true };
  try { return { ...base, ...JSON.parse(localStorage.getItem("aurora-livemap-settings") || "{}") }; } catch { return base; }
};

type Props = { onOpenConversation?: (id: string) => void; onOpenMemory?: () => void };

export default function LiveMapView({ onOpenConversation, onOpenMemory }: Props) {
  const [snap, setSnap] = useState<MemoryGraphSnapshot | null>(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [mode, setMode] = useState<ViewMode>("geral");
  const [filters, setFilters] = useState<Filters>({});
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<MapSettings>(loadSettings);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusClusterId, setFocusClusterId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [highlights, setHighlights] = useState<Map<string, Highlight>>(new Map());
  const [events, setEvents] = useState<MemoryLiveEvent[]>([]);
  // The local model's speed, call by call (its own stream: many calls per answer, they would flood the log).
  const [speed, setSpeed] = useState<ModelSpeedSample[]>([]);
  const [lastRecall, setLastRecall] = useState<{ ids: string[]; at: string; conversationId?: string | null } | null>(null);
  const [camera, setCamera] = useState<CameraCommand>(null);
  // Auto foco: the camera goes by itself to what is happening — never while the person is moving the map
  // (it waits 10 s after the last touch), and never when it is off.
  const activityMode = settings.autoFocus;
  const userMovedAt = useRef(0);
  const onUserMove = useCallback(() => { userMovedAt.current = Date.now(); }, []);
  const [merges, setMerges] = useState<Merge[]>([]);
  const lastPos = useRef(new Map<string, Vec3>());
  const [callNote, setCallNote] = useState("");
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem("aurora-livemap-panels") !== "closed"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("aurora-livemap-panels", panelOpen ? "open" : "closed"); } catch { /* private mode */ } }, [panelOpen]);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [keeper, setKeeper] = useState<KeeperView | null>(null);
  const keeperArea = useRef<string | null>(null);
  const keeperView = useRef<{ target: Vec3 | null; at: number }>({ target: null, at: 0 });
  const [dockOpen, setDockOpen] = useState(true);
  const dockOpenRef = useRef(dockOpen); dockOpenRef.current = dockOpen;
  const [dockConversation, setDockConversation] = useState<string | null>(null);
  const turnTimer = useRef<number | null>(null);
  const [gl, setGl] = useState(webglAvailable);
  const refreshTimer = useRef<number | null>(null);
  useEffect(() => { try { localStorage.setItem("aurora-livemap-settings", JSON.stringify({ quality: settings.quality, labels: settings.labels, paused: settings.paused, autoFocus: settings.autoFocus, scene: settings.scene })); } catch { /* private mode */ } }, [settings]);

  // The semantic atlas held steady for the session (adapter.steadyAtlas): a new memory joins its neighbours'
  // cluster instead of the server's re-clustering moving every group. "Reorganizar" starts it over.
  const frozen = useRef(newFrozenAtlas());
  const steady = useCallback((s: MemoryGraphSnapshot) => ({ ...s, atlas: steadyAtlas(s.atlas, frozen.current) }), []);
  const load = useCallback(() => getMemoryGraph().then((s) => { setSnap(steady(s)); setSpeed((old) => (old.length ? old : s.speed?.calls || [])); setKeeper((k) => { const base = keeperFromSnapshot(s.keeper); return !k || !base ? k || base : { ...base, current: k.current ?? base.current, trail: k.trail.length ? k.trail : base.trail, links: k.links, flags: k.flags.length > base.flags.length ? k.flags : base.flags, growth: k.growth, prunes: k.prunes.length > base.prunes.length ? k.prunes : base.prunes }; }); setError(""); setEvents((old) => (old.length ? old : s.events)); }).catch((e: Error) => setError(e.message)), [steady]);
  useEffect(() => { void load(); }, [load]);
  const reorganize = useCallback(() => { frozen.current = newFrozenAtlas(); void load(); }, [load]);
  const quietRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => { void getMemoryGraph().then((s) => setSnap(steady(s))).catch(() => {}); }, 1500);
  }, [steady]);

  // ---------- Live events: incremental changes, pulses for what really happened ----------
  const snapRef = useRef(snap); snapRef.current = snap;
  const graphRef = useRef<ReturnType<typeof buildMemoryGraph> | null>(null);
  const layoutRef = useRef<CloudLayout | null>(null);
  useEffect(() => subscribeMemoryEvents((event) => {
    if (event.type === "hello") return;
    if (event.type === "speed") { setSpeed((old) => [...old, event as unknown as ModelSpeedSample].slice(-40)); return; }
    setEvents((old) => [event, ...old].slice(0, 80));
    const now = performance.now();
    // ---- the turn as it happens (pergunta → busca → consulta → resposta), only from real events ----
    setTurn((t) => reduceTurn(t, event));
    // ---- the Zeladora: where she is, what she reads, links, joins and flags ----
    if (event.type === "keeper") {
      setKeeper((k) => reduceKeeper(k, event));
      const mark = (ids: (string | undefined)[], kind: Highlight["kind"]) => setHighlights((old) => { const next = new Map(old); for (const id of ids) if (id) next.set(id, { kind, at: now }); return next; });
      const note = (id: string | undefined, kind: Highlight["kind"], text: string) => id && setHighlights((old) => new Map(old).set(id, { kind, at: now, note: text }));
      if (event.action === "read") { if (event.kind === "vaga") note(event.id, "flagged", "▶ vaga"); else note(event.id, "read", event.kind || "lida"); }
      if (event.action === "link") mark([event.from, event.to], "linked");
      if (event.action === "flag" && event.otherId) mark([event.id, event.otherId], "flagged");
      if (event.action === "join") mark([event.kept], "joined");
      if (event.action === "compact") note(event.id, "joined", `compactou ${event.merged?.length || 0}`);
      if (event.action === "adopt") note(event.id, "created", `entrou em ${event.label || "um nódulo"}`);
      // She pulls the memories into one: they fly from where they were (kept even after they leave the map).
      const where = (id?: string) => (id ? lastPos.current.get(id) : undefined);
      const merge = (from: (string | undefined)[], to?: string) => {
        const points = from.map(where).filter(Boolean) as Vec3[];
        const dest = where(to) || points[0];
        if (points.length && dest) setMerges((old) => [...old.filter((m) => Date.now() - m.at < 3000), { from: points, to: dest, at: Date.now() }]);
      };
      if (event.action === "compact") merge(event.merged || [], event.merged?.[0]);
      if (event.action === "join") merge([event.archived], event.kept);
      // Activity mode: the camera goes with her when she enters another area (not on every memory).
      // Activity mode: the camera keeps her in view — on entering another section, or when she has walked
      // away from where the camera looks (at most every 2.5 s; the chat beside the map is accounted for).
      if (event.action === "read" && event.id && autoOk() && !(turnRef.current && !turnRef.current.ended)) {
        const L = layoutRef.current;
        const ci = L?.cloudOf.get(event.id);
        const cloud = ci !== undefined ? L!.clouds[ci] : undefined;
        if (L && cloud && keeperArea.current !== cloud.id) {
          // The camera goes to the section she enters (the whole cloud in view, the chat beside it accounted for).
          const distance = Math.min(L.R * 2.3, Math.max(320, cloud.r * 4.4));
          const target: Vec3 = [cloud.x + (dockOpenRef.current ? distance * 0.16 : 0), cloud.y, 0];
          keeperArea.current = cloud.id;
          keeperView.current = { target, at: Date.now() };
          setCamera({ target, distance, key: Date.now() });
        }
      }
    }
    if (event.type === "turn-start" && turnTimer.current) window.clearTimeout(turnTimer.current);
    if (event.type === "answered") for (const id of event.created || []) setHighlights((old) => new Map(old).set(id, { kind: "created", at: now }));
    if (event.type === "turn-end") {
      if (turnTimer.current) window.clearTimeout(turnTimer.current);
    }
    if (event.type === "recalled" && event.ids?.length) {
      setLastRecall({ ids: event.ids, at: event.at, conversationId: event.conversationId });
      setHighlights((old) => {
        const next = new Map(old);
        const scores = new Map((turnRef.current?.scanned || []).map((c) => [c.id, c.score]));
        for (const id of event.ids!) next.set(id, { kind: "recalled", at: now, score: scores.get(id) });
        return next;
      });
      if (autoOk()) {
        const first = graphRef.current?.nodes.find((n) => event.ids!.includes(n.id));
        const box = first && layoutRef.current?.clusters.get(first.clusterId);
        if (box && first) { setFocusClusterId(first.clusterId); setCamera({ target: box.center, distance: Math.min((layoutRef.current?.R || 400) * 2.3, 160 + box.radius * 3.6), key: Date.now() }); }
      }
    }
    if (event.type === "created" && event.id) setHighlights((old) => new Map(old).set(event.id!, { kind: "created", at: now }));
    const current = snapRef.current;
    if (current) {
      const { snapshot, needsRefresh } = applyEvent(current, event);
      if (snapshot !== current) setSnap(snapshot);
      if (needsRefresh) quietRefresh();
    }
  }, setLive), [quietRefresh]);
  const activityModeRef = useRef(activityMode); activityModeRef.current = activityMode;
  const autoOk = () => activityModeRef.current && Date.now() - userMovedAt.current > 10_000;
  const turnRef = useRef(turn); turnRef.current = turn;

  const label = useCallback((id?: string) => (id ? nodeByIdRef.current.get(id)?.label || id.slice(0, 8) : ""), []);
  const keeperLine = (e: MemoryLiveEvent) =>
    e.action === "read" ? `${label(e.id)}${e.kind ? ` · ${e.kind}` : ""}` : e.action === "compact" ? `${e.merged?.length || 0} memórias → ${e.title || label(e.id)}` : e.action === "link" ? `${label(e.from)} ↔ ${label(e.to)}` : e.action === "join" ? `${e.archivedTitle || "cópia"} → ${e.title || label(e.kept)}`
      : e.action === "prune" ? `${e.title || "memória"} · ${e.reason || "obsoleta"}` : e.action === "arrival" ? `${e.title || label(e.id)}` : e.action === "adopt" ? `${e.title || label(e.id)} → ${e.label || "nódulo"}`
      : e.action === "plant" ? `${e.nodes?.length || 0} nódulos` : e.action === "node-born" ? `${e.label} · ${e.members || 0} memórias${e.parentLabel ? ` · saiu de ${e.parentLabel}` : " · assunto novo"}` : e.action === "node-gone" ? `${e.label}${e.intoLabel ? ` → ${e.intoLabel}` : " · vazio"}`
      : e.action === "flag" ? `${e.title || label(e.id)} · ${e.reason || ""}` : e.action === "walk" ? `${e.label} · ${e.total} memórias` : e.action === "called" ? `${e.label || "a seu pedido"} · ${e.total || 0} memórias` : e.action === "rest" ? "ronda completa" : e.action === "round" ? `ronda ${e.round} · ${e.total} memórias` : e.reason || "";

  // ---------- Graph and layout (only when the data, the mode or the filters change) ----------
  const graph = useMemo(() => (snap ? buildMemoryGraph(snap, { mode, filters }) : null), [snap, mode, filters]);
  const layout = useMemo(() => (graph ? layoutClouds(graph, snap) : null), [graph, snap]);
  const R = layout?.R || 400;
  graphRef.current = graph; layoutRef.current = layout;
  if (layout) for (const [id, p] of layout.nodes) lastPos.current.set(id, p);
  const nodeById = useMemo(() => new Map((graph?.nodes || []).map((n) => [n.id, n])), [graph]);
  const nodeByIdRef = useRef(nodeById); nodeByIdRef.current = nodeById;
  const projectName = useMemo(() => new Map((snap?.projects || []).map((p) => [p.id, p.name])), [snap]);
  const convTitle = useMemo(() => new Map((snap?.conversations || []).map((c) => [c.id, c.title])), [snap]);

  // ---------- The Aurora's agent for the turn: where she goes and what she reaches ----------
  const agent: AgentState = useMemo(() => {
    if (!turn || !layout) return null;
    const known = (id: string) => layout.nodes.has(id);
    const max = Math.max(0.001, ...turn.scanned.map((c) => c.score));
    const chosen = new Set([...turn.recalled, ...turn.used]);
    const tentacles: AgentTentacle[] = [
      ...turn.scanned.filter((c) => known(c.id) && !chosen.has(c.id)).slice(0, 24).map((c, i) => ({ id: c.id, kind: "scanned" as const, strength: c.score / max, order: i })),
      ...[...chosen].filter(known).map((id, i) => ({ id, kind: (turn.recalled.includes(id) ? "recalled" : "used") as AgentTentacle["kind"], strength: 1, order: 6 + i })),
      ...turn.created.filter(known).map((id, i) => ({ id, kind: "created" as const, strength: 1, order: 10 + i })),
    ];
    // Her place: the centre of what she is reaching for (the chosen ones first, else the best candidates).
    const focus = (chosen.size ? [...chosen] : turn.scanned.slice(0, 6).map((c) => c.id)).filter(known);
    const target: Vec3 | null = focus.length ? (([0, 1, 2] as const).map((a) => focus.reduce((sum, id) => sum + layout.nodes.get(id)![a], 0) / focus.length) as Vec3) : null;
    return { key: turn.key, target, tentacles, ended: turn.ended };
  }, [turn, layout]);
  // The activity mode follows her (the reference's camera walking from section to section).
  const followed = useRef("");
  useEffect(() => {
    if (!activityMode || Date.now() - userMovedAt.current < 10_000 || !agent?.target || agent.ended) return;
    const key = `${agent.key}:${turn?.phase}`;
    if (followed.current === key) return;
    followed.current = key;
    const spread = Math.max(40, ...agent.tentacles.map((t) => { const p = layout?.nodes.get(t.id); return p ? Math.hypot(p[0] - agent.target![0], p[1] - agent.target![1]) : 0; }));
    setCamera({ target: agent.target, distance: Math.min(R * 2.3, 200 + spread * 2.6), key: Date.now() });
  }, [agent, activityMode, turn?.phase, layout, R]);

  // Search: results light up, the camera goes to the best one.
  const results = useMemo(() => (graph && query.trim() ? searchIds(graph, query) : []), [graph, query]);
  useEffect(() => {
    setHighlights((old) => {
      const next = new Map([...old].filter(([, h]) => h.kind !== "search"));
      for (const id of results.slice(0, 40)) if (!next.has(id)) next.set(id, { kind: "search", at: performance.now() });
      return next;
    });
  }, [results]);
  const goTo = useCallback((id: string) => {
    const p = layout?.nodes.get(id); if (!p) return;
    setSelectedId(id); setFocusClusterId(nodeById.get(id)?.clusterId || null);
    setCamera({ target: p, distance: 300, key: Date.now() });
  }, [layout, nodeById, R]);
  const fit = useCallback(() => {
    if (!layout) return;
    // The whole field in the part of the stage the chat does not cover (the field moves left of it).
    const el = stageRef.current, dock = dockOpenRef.current;
    const w = el?.clientWidth || 1200, h = el?.clientHeight || 520;
    const covered = dock ? Math.min(352, w * 0.42) : 0;
    const distance = fitDistance(layout, (w - covered) / h);
    const wpp = (2 * distance * Math.tan(Math.PI / 8)) / h;
    setFocusClusterId(null); setCamera({ target: [(covered / 2) * wpp, 0, 0], distance, key: Date.now() });
  }, [layout]);
  // The first time the map has a tree: the whole of it in view.
  const fitted = useRef(false);
  useEffect(() => { if (layout && !fitted.current) { fitted.current = true; fit(); } }, [layout, fit]);
  const focusCluster = useCallback((id: string, double: boolean) => {
    const box = layout?.clusters.get(id); if (!box) return;
    if (double) { setFocusClusterId(id); setCamera({ target: box.center, distance: Math.min(layout!.R * 2.3, 120 + box.radius * 3.6), key: Date.now() }); return; }
    setExpanded((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    setFocusClusterId(id);
  }, [layout]);

  // Keyboard: "/" search, Esc clears, F fits, P pauses, L labels.
  const searchRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") { if (e.key === "Escape") (e.target as HTMLElement).blur(); return; }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "Escape") { setSelectedId(null); setFocusClusterId(null); setExpanded(new Set()); }
      else if (e.key.toLowerCase() === "f") fit();
      else if (e.key.toLowerCase() === "p") setSettings((s) => ({ ...s, paused: !s.paused }));
      else if (e.key.toLowerCase() === "l") setSettings((s) => ({ ...s, labels: !s.labels }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit]);

  // Fewer particles by itself with many memories (the brief's "reduce density automatically").
  useEffect(() => { if (graph && graph.nodes.length > 2500 && settings.quality === "alta") setSettings((s) => ({ ...s, quality: "media" })); }, [graph, settings.quality]);

  const selected = selectedId ? nodeById.get(selectedId) || null : null;
  const focused = focusClusterId ? graph?.clusters.find((c) => c.id === focusClusterId) || null : null;
  // The sections (one per thought) as the Zeladora goes through them.
  const sections = useMemo(() => (graph ? sectionProgress(graph, keeper) : new Map()), [graph, keeper]);
  const readSet = useMemo(() => new Set(keeper?.readIds || []), [keeper?.readIds]);
  // Call her: "come and organize these memories now" (a section, or one memory).
  const callKeeper = (ids: string[], label: string) => {
    setCallNote("");
    void visitKeeper(ids, label).then((r) => setCallNote(`zeladora a caminho: ${r.queued} memórias`)).catch((e: Error) => setCallNote(e.message));
  };
  const keeperCluster = keeper?.current && graph ? graph.clusters.find((c) => c.nodeIds.includes(keeper.current!)) || null : null;
  const bushes = useMemo<RecallBush[]>(() => {
    const stored = (snap?.recalls || []).map((r) => ({ id: r.id, at: r.at, prompt: r.prompt, used: r.used }));
    const live = lastRecall && !stored.some((r) => Math.abs(Date.parse(r.at) - Date.parse(lastRecall.at)) < 5000) ? [{ id: `live:${lastRecall.at}`, at: lastRecall.at, prompt: turn?.message || "pergunta agora", used: lastRecall.ids }] : [];
    return [...live, ...stored].filter((r) => r.used.length);
  }, [snap?.recalls, lastRecall, turn?.message]);
  // The Paper Lab's split: proven memories apart from the ones still in review (the Zeladora's flags count).
  const review = useMemo(() => {
    const flagged = new Set((keeper?.flags || []).flatMap((f) => [f.id, f.otherId || ""]));
    let proven = 0;
    for (const n of graph?.nodes || []) if (reviewOf(n.memory, flagged.has(n.id)) === "comprovada") proven += 1;
    const total = graph?.nodes.length || 0;
    return { proven, pending: total - proven, total, flags: keeper?.flags.length || 0 };
  }, [graph, keeper?.flags]);
  // The health of the memory: the share proven, less a little for each open flag (0–100), and its history.
  const health = review.total ? Math.max(0, Math.round((100 * review.proven) / review.total - review.flags * 2)) : 0;
  const healthLog = useRef<number[]>([]);
  if (healthLog.current[healthLog.current.length - 1] !== health) healthLog.current = [...healthLog.current, health].slice(-48);
  const colorOf = useCallback((id: string | null | undefined) => { const c = id ? layout?.clouds.find((x) => x.id === id) : undefined; return c ? cloudColor(c.index) : "#d7dde6"; }, [layout]);

  if (error && !snap) return <section className="livemap"><div className="lm-state"><h2>Mapa Vivo indisponível</h2><p>{error}</p><button className="lm-btn" onClick={() => void load()}>Tentar de novo</button></div></section>;
  if (!snap || !graph || !layout) return <section className="livemap"><div className="lm-state"><p>Carregando as memórias…</p></div></section>;

  // The section the title speaks of: the Zeladora's while she reads, else the one in focus.
  const titleCluster = turn && !turn.ended ? null : !focused && keeperCluster && keeper?.phase === "andando" ? keeperCluster : focused;
  const order = layout.clouds.map((c) => c.id);
  const titleIndex = titleCluster ? order.indexOf(titleCluster.id) + 1 : 0;
  const perMinute = events.filter((e) => Date.now() - Date.parse(e.at) < 60_000).length;

  return (
    <section className="livemap" aria-label="Mapa Vivo de Memórias">
      <header className="lm-top">
        <div className="lm-head">
          <b>MEMÓRIA <span>aurora</span></b>
          <nav className="lm-tabs" aria-label="Modo de visão">
            {MODES.map(([id, label]) => <button key={id} aria-pressed={mode === id} className={mode === id ? "on" : ""} onClick={() => { setMode(id); setFocusClusterId(null); setExpanded(new Set()); }}>{label}</button>)}
          </nav>
          <div className="lm-metrics" aria-label="Indicadores">
            <span>memórias <b>{graph.stats.memories}</b></span>
            <span>nódulos <b>{layout.clouds.length}</b></span>
            <span>comprovadas <b className="teal">{review.proven}</b></span>
            <span>em revisão <b className="yellow">{review.pending}</b></span>
            <span>conexões <b>{graph.stats.edges}</b></span>
            {keeper?.enabled && <>
              <span>lidas <b>{keeper.readIds.length}/{graph.stats.memories}</b></span>
              <span>ligações <b className="yellow">{keeper.stats.linked}</b></span>
              <span>marcas <b className="pink">{keeper.flags.length}</b></span>
              {keeper.stats.pruned > 0 && <span>podadas <b>{keeper.stats.pruned}</b></span>}
            </>}
            <span className={`lm-live ${live ? "on" : ""}`} title={live ? "Recebendo os eventos da memória ao vivo" : "Sem conexão com os eventos ao vivo"}>{live ? "ao vivo" : "sem conexão"}</span>
          </div>
        </div>
        <SectionTabs layout={layout} graph={graph} sections={sections} active={titleCluster?.id || null} focusClusterId={focusClusterId} onPick={(id) => focusCluster(id, true)} />
      </header>

      <div className="lm-tools" role="toolbar" aria-label="Busca, filtros e controles">
        <input ref={searchRef} className="lm-search" type="search" placeholder="buscar memória, tag ou id  ( / )" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && results[0]) goTo(results[0]); }} aria-label="Buscar memória" />
        {query && <span className="lm-count">{results.length} encontrada(s)</span>}
        <select aria-label="Pasta ou projeto" value={filters.projectId || ""} onChange={(e) => setFilters({ ...filters, projectId: e.target.value || undefined })}>
          <option value="">todas as pastas</option>
          {snap.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select aria-label="Conversa" value={filters.conversationId || ""} onChange={(e) => setFilters({ ...filters, conversationId: e.target.value || undefined })}>
          <option value="">todas as conversas</option>
          {snap.conversations.filter((c) => snap.memories.some((m) => m.conversationId === c.id)).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <select aria-label="Período" value={filters.sinceDays || 0} onChange={(e) => setFilters({ ...filters, sinceDays: Number(e.target.value) || undefined })}>
          {PERIODS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
        </select>
        <select aria-label="Relevância" value={filters.minRelevance || 0} onChange={(e) => setFilters({ ...filters, minRelevance: Number(e.target.value) || undefined })}>
          <option value={0}>toda relevância</option><option value={0.05}>já usadas</option><option value={0.4}>comprovadas</option>
        </select>
        <div className="lm-chips" role="group" aria-label="Categorias">
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => {
            const on = !filters.categories?.length || filters.categories.includes(c);
            return <button key={c} aria-pressed={on} className={on ? "on" : ""} style={{ ["--c" as string]: CATEGORY_COLOR[c] }} title={CATEGORY_LABEL[c]} onClick={() => {
              const all = Object.keys(CATEGORY_LABEL) as Category[];
              const current = filters.categories?.length ? filters.categories : all;
              const next = current.includes(c) ? current.filter((x) => x !== c) : [...current, c];
              setFilters({ ...filters, categories: next.length === all.length ? undefined : next });
            }}><i />{CATEGORY_LABEL[c].toLowerCase()} <b>{graph.stats.byCategory[c]}</b></button>;
          })}
        </div>
        <div className="lm-controls">
          <div className="lm-scene-toggle" role="group" aria-label="Cena">
            <button className="lm-btn" aria-pressed={settings.scene !== "arquivo"} onClick={() => setSettings((s) => ({ ...s, scene: "nuvens" }))} title="As nuvens de memória (2D)">nuvens</button>
            <button className="lm-btn" aria-pressed={settings.scene === "arquivo"} onClick={() => setSettings((s) => ({ ...s, scene: "arquivo" }))} title="O arquivo vivo em 3D: torres de estantes, livros e a Zeladora robô">arquivo 3D</button>
          </div>
          <button className="lm-btn" onClick={fit} title="Ajustar a vista (F)">ajustar</button>
          <button className="lm-btn" onClick={reorganize} title="Refazer os agrupamentos semânticos com todas as memórias de agora">reorganizar</button>
          <button className="lm-btn" aria-pressed={activityMode} onClick={() => setSettings((s) => ({ ...s, autoFocus: !s.autoFocus }))} title="A câmera vai sozinha até o que está acontecendo (a Zeladora, as memórias de uma pergunta). Pausa 10 s quando você mexe no mapa.">auto foco {activityMode ? "on" : "off"}</button>
          <button className="lm-btn" aria-pressed={settings.paused} onClick={() => setSettings((s) => ({ ...s, paused: !s.paused }))} title="Pausar o movimento (P)">{settings.paused ? "retomar" : "pausar"}</button>
          <button className="lm-btn" aria-pressed={settings.labels} onClick={() => setSettings((s) => ({ ...s, labels: !s.labels }))} title="Rótulos (L)">rótulos</button>
          <select aria-label="Qualidade e partículas" value={settings.quality} onChange={(e) => setSettings((s) => ({ ...s, quality: e.target.value as Quality }))}>
            <option value="alta">qualidade alta</option><option value="media">média</option><option value="baixa">baixa (poucas partículas)</option>
          </select>
        </div>
      </div>

      <div className="lm-stage" ref={stageRef}>
        <div className="lm-title" aria-live="polite" style={{ ["--c" as string]: turn && !turn.ended ? "#ff9a55" : titleCluster ? colorOf(titleCluster.id) : "#d7dde6" }}>
        {turn && !turn.ended ? <>
          <h1>{String(STEPS.findIndex(([x]) => x === turn.phase) + 1).padStart(2, "0")} {STEPS.find(([x]) => x === turn.phase)![1].toUpperCase()}</h1>
          <p>{turn.phase === "busca" ? `avaliando ${turn.scanned.length} memórias` : turn.phase === "consulta" ? `${turn.recalled.length} memórias no contexto · respondendo` : turn.phase === "resposta" ? `usou ${turn.used.length} · criou ${turn.created.length}` : `“${turn.message.slice(0, 60)}”`}{turn.conversationId && turn.conversationId === dockConversation ? " · nesta conversa" : ""}</p>
        </> : titleCluster ? <>
          <h1>{String(titleIndex).padStart(2, "0")} {titleCluster.label.toUpperCase()}</h1>
          <p>{titleCluster === keeperCluster && keeper?.phase === "andando" ? `zeladora lendo · ${sections.get(titleCluster.id)?.read ?? 0}/${titleCluster.nodeIds.length} memórias` : `${titleCluster.nodeIds.length} memórias`} · {titleCluster.sublabel}</p>
        </> : <>
          <h1>00 MEMÓRIA DA AURORA</h1>
          <p>{graph.stats.memories} memórias · {layout.clouds.length} nódulos · {review.proven} comprovadas · {review.pending} em revisão</p>
        </>}
        </div>

        {graph.nodes.length === 0 ? (
          <div className="lm-state"><h2>{snap.memories.length ? "Nenhuma memória com esses filtros" : "Ainda não há memórias"}</h2><p>{snap.memories.length ? "Mude os filtros ou a busca." : "As memórias aparecem aqui assim que a Aurora guardar a primeira — em conversas, lições do professor ou importações."}</p></div>
        ) : gl ? (
          <Suspense fallback={<div className="lm-state"><p>Preparando o mapa…</p></div>}>
            {settings.scene === "arquivo" ? <ArchiveScene graph={graph} layout={layout} settings={settings} selectedId={selectedId} hoveredId={hoveredId} focusClusterId={focusClusterId} highlights={highlights} camera={camera} agent={agent} keeper={keeper} sections={sections}
              readSet={null} merges={merges} recalls={bushes} onUserMove={onUserMove}
              onHover={setHoveredId} onSelect={(id) => { setSelectedId(id); if (id) setFocusClusterId(nodeById.get(id)?.clusterId || null); }} onCluster={focusCluster} onContextLost={() => setGl(false)} /> :
            <LiveMapScene graph={graph} layout={layout} settings={settings} selectedId={selectedId} hoveredId={hoveredId} focusClusterId={focusClusterId} highlights={highlights} camera={camera} agent={agent} keeper={keeper} sections={sections}
              readSet={keeper?.enabled && keeper.running && keeper.phase === "andando" && keeper.readIds.length ? readSet : null} merges={merges} recalls={bushes} onUserMove={onUserMove}
              onHover={setHoveredId} onSelect={(id) => { setSelectedId(id); if (id) setFocusClusterId(nodeById.get(id)?.clusterId || null); }} onCluster={focusCluster} onContextLost={() => setGl(false)} />}
          </Suspense>
        ) : (
          <FallbackList graph={graph} onSelect={goTo} />
        )}
        {gl && graph.nodes.length > 0 && <ul className={`lm-legend ${dockOpen ? "with-dock" : ""}`} aria-label="Legenda">
          <li className="ok">comprovada</li>
          <li className="rev">em revisão</li>
          <li className="zeladora">zeladora · lendo</li>
          <li className="consulta">aurora · memórias usadas</li>
          <li className="criada">memória criada</li>
        </ul>}
        <ChatDock open={dockOpen} onToggle={() => setDockOpen((v) => !v)} onGoTo={goTo} onConversation={setDockConversation} projectId={filters.projectId || null} />
        {hoveredId && nodeById.get(hoveredId) && hoveredId !== selectedId && (
          <div className="lm-hover" role="status">
            <i style={{ background: colorOf(nodeById.get(hoveredId)!.clusterId) }} />{nodeById.get(hoveredId)!.memory.title}
            <small>{graph.clusters.find((c) => c.id === nodeById.get(hoveredId)!.clusterId)?.label || "—"} · {reviewOf(nodeById.get(hoveredId)!.memory) === "comprovada" ? "comprovada" : "em revisão"} · {edgesOf(graph, hoveredId).length} conexões</small>
          </div>
        )}
        {selected && (
          <aside className={`lm-side ${dockOpen ? "with-dock" : ""}`} aria-label="Memória selecionada">
            <header><span className="lm-cat" style={{ color: colorOf(selected.clusterId) }}>{graph.clusters.find((c) => c.id === selected.clusterId)?.label || CATEGORY_LABEL[selected.category]}</span><button className="lm-x" onClick={() => setSelectedId(null)} aria-label="Fechar">×</button></header>
            <h2>{selected.memory.title}</h2>
            {selected.memory.sensitive ? <p className="lm-muted">Conteúdo sensível: não aparece no mapa. Abra na Memória para ver.</p> : <p>{selected.memory.snippet}{(selected.memory.snippet || "").length >= 280 ? "…" : ""}</p>}
            <dl>
              <dt>estado</dt><dd>{reviewOf(selected.memory, Boolean(keeper?.flags.some((f) => f.id === selected.id || f.otherId === selected.id))) === "comprovada" ? "comprovada" : "em revisão (ainda não usada, ou marcada pela zeladora)"}</dd>
              <dt>origem</dt><dd>{selected.memory.scope === "global" ? "memória geral" : selected.memory.scope === "project" ? `pasta: ${projectName.get(selected.memory.projectId || "") || "—"}` : `conversa: ${convTitle.get(selected.memory.conversationId || "") || "—"}`}</dd>
              <dt>tipo</dt><dd>{selected.memory.kind === "extracted" ? "extraída da conversa" : selected.memory.kind === "imported" ? "importada" : "manual"}{selected.memory.source ? ` · ${selected.memory.source}` : ""}</dd>
              <dt>criada</dt><dd>{fmtDate(selected.memory.createdAt)}</dd>
              <dt>atualizada</dt><dd>{fmtDate(selected.memory.updatedAt)}</dd>
              <dt>uso</dt><dd>{selected.memory.uses} vezes · ajudou {selected.memory.helped} · falhou {selected.memory.failed}</dd>
              {selected.memory.tags.length > 0 && <><dt>tags</dt><dd>{selected.memory.tags.join(", ")}</dd></>}
              <dt>id</dt><dd className="lm-mono">{selected.id}</dd>
            </dl>
            <h3>conexões ({edgesOf(graph, selected.id).length})</h3>
            <ul className="lm-links">
              {edgesOf(graph, selected.id).slice(0, 40).map((e) => {
                const other = nodeById.get(e.from === selected.id ? e.to : e.from);
                return other && <li key={e.id}><button onClick={() => goTo(other.id)}><i style={{ background: colorOf(other.clusterId) }} />{other.label}<small>{e.kind === "relacao" ? RELATION_LABEL[e.type || ""] || e.type : `similaridade ${Math.round(e.weight * 100)}%`}</small></button></li>;
              })}
              {edgesOf(graph, selected.id).length === 0 && <li className="lm-muted">Sem conexões medidas ainda.</li>}
            </ul>
            <div className="lm-actions">
              {selected.memory.conversationId && onOpenConversation && <button className="lm-btn" onClick={() => onOpenConversation(selected.memory.conversationId!)}>abrir conversa de origem</button>}
              {onOpenMemory && <button className="lm-btn" onClick={onOpenMemory}>ver na memória</button>}
              {keeper?.enabled && <button className="lm-btn lm-call" onClick={() => callKeeper([selected.memory.id, ...(graph.clusters.find((c) => c.id === selected.clusterId)?.nodeIds.filter((x) => x !== selected.memory.id).slice(0, 11) || [])], selected.memory.title)}>chamar a zeladora aqui</button>}
              {callNote && <small className="lm-muted">{callNote}</small>}
            </div>
          </aside>
        )}
      </div>

      <div className="lm-strip" aria-label="Linha do tempo">
        <Barcode events={events} />
        <SpeedMonitor calls={speed} />
        {turn && <ol className="lm-steps on" aria-label="O turno da Aurora agora">
          {STEPS.map(([id, label], i) => {
            const at = turn ? STEPS.findIndex(([x]) => x === turn.phase) : -1;
            const state = !turn ? "" : i < at || (turn.ended && i <= at) ? "done" : i === at ? "now" : "";
            const detail = !turn ? "" : id === "pergunta" ? turn.message : id === "busca" ? (turn.scanned.length ? `${turn.scanned.length} avaliadas · melhor ${turn.scanned[0].score.toFixed(2).replace(".", ",")}` : "") : id === "consulta" ? (turn.recalled.length ? `${turn.recalled.length} no contexto` : "") : turn.phase === "resposta" ? `usou ${turn.used.length} · criou ${turn.created.length}` : "";
            return <li key={id} className={state}><b>{String(i + 1).padStart(2, "0")} {label}</b><span>{detail || "…"}</span></li>;
          })}
        </ol>}
      </div>

      <footer className={`lm-panels ${panelOpen ? "" : "closed"}`} aria-label="Instrumentos da memória">
        <button className="lm-panel-toggle" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>{panelOpen ? "recolher instrumentos" : "instrumentos"}</button>
        {panelOpen && <>
          <div className="lm-panel">
            <h4>registro <span>{perMinute} e/min</span></h4>
            <ol className="lm-log">
              {events.length === 0 && <li className="lm-muted">Nenhum evento desde que o app abriu.</li>}
              {events.slice(0, 13).map((e, i) => (
                <li key={`${e.seq}-${i}`} className={e.type}><time>{fmtTime(e.at)}</time><b className={e.type === "keeper" ? `lm-act-${e.action}` : ""}>{e.type === "keeper" ? KEEPER_LABEL[e.action || ""] || e.action : EVENT_LABEL[e.type] || e.type}</b><span>{e.type === "keeper" ? keeperLine(e) : e.type === "recalled" ? `${e.ids?.length || 0} memórias · ${convTitle.get(e.conversationId || "") || "conversa"}` : e.type === "scanned" ? `${e.candidates?.length || 0} candidatas · melhor ${(e.candidates?.[0]?.score ?? 0).toFixed(2).replace(".", ",")}` : e.type === "turn-start" ? `“${(e.message || "").slice(0, 40)}”` : e.type === "answered" ? `usou ${e.used?.length || 0} · criou ${e.created?.length || 0}` : e.type === "turn-end" ? convTitle.get(e.conversationId || "") || "conversa" : e.title || nodeById.get(e.id || "")?.label || (e.id || "").slice(0, 8)}</span></li>
              ))}
            </ol>
          </div>
          <div className="lm-panel">
            <h4>nódulos <span>{layout.clouds.length}{keeper?.enabled ? ` · ${[...sections.values()].filter((x) => x.state === "feito").length} feitos` : ""}</span></h4>
            <ul className="lm-bars lm-sections">
              {layout.clouds.slice(0, 9).map((cl) => {
                const c = graph.clusters.find((x) => x.id === cl.id); if (!c) return null;
                const sec = sections.get(c.id);
                const share = sec ? (sec.total ? sec.read / sec.total : 0) : 1;
                return <li key={c.id} className={`${c.id === focusClusterId ? "on" : ""} ${sec?.state === "lendo" ? "reading" : sec?.state === "na fila" ? "queued" : ""}`}><button onClick={() => focusCluster(c.id, true)}><span>{c.label}</span><b>{sec ? `${sec.read}/${sec.total}` : c.nodeIds.length}</b><i style={{ width: `${Math.max(share * 100, sec ? 0 : 4)}%`, background: cloudColor(cl.index) }} /></button>{keeper?.enabled && <button className="lm-call-mini" title={`Chamar a zeladora para organizar “${c.label}” agora`} aria-label={`Chamar a zeladora para ${c.label}`} onClick={() => callKeeper(c.nodeIds, c.label)}>⌖</button>}</li>;
              })}
            </ul>
          </div>
          <div className="lm-panel">
            <h4>cobertura <span>{keeper?.enabled ? "lidas na ronda" : "comprovadas"}</span></h4>
            <Coverage layout={layout} graph={graph} sections={sections} keeperOn={Boolean(keeper?.enabled)} active={titleCluster?.id || null} />
          </div>
          <div className="lm-panel">
            <h4>calor <span>{graph.stats.memories}</span></h4>
            <Heat layout={layout} graph={graph} sections={sections} keeperOn={Boolean(keeper?.enabled)} />
            <ul className="lm-kv">
              <li><span>lidas</span><b>{keeper?.stats.read ?? 0}</b></li>
              <li><span>ligadas</span><b className="yellow">{keeper?.stats.linked ?? 0}</b></li>
              <li><span>marcadas</span><b className="pink">{keeper?.flags.length ?? 0}</b></li>
              <li><span>podadas</span><b>{keeper?.stats.pruned ?? 0}</b></li>
            </ul>
          </div>
          <div className="lm-panel">
            <h4>saúde <span>ao vivo</span></h4>
            <Health value={health} log={healthLog.current} />
            <small className="lm-k-foot"><b>{review.proven}</b> comprovadas · <b className="yellow">{review.pending}</b> em revisão{review.flags ? <> · <b className="pink">{review.flags}</b> marcas</> : null}</small>
          </div>
          <div className="lm-panel lm-code-panel">
            <h4>zeladora.py <span>{keeper?.enabled && keeper.running ? keeper.phase : keeper ? "desligada" : "—"}</span></h4>
            <KeeperCode keeper={keeper} nodes={layout.clouds.length} where={keeperCluster?.label || null} />
          </div>
          <div className="lm-panel lm-keeper">
            <h4>revisão <span>{!keeper ? "—" : !keeper.running ? "não roda aqui" : !keeper.enabled ? "desligada" : keeper.phase === "descansando" ? `descansa até ${keeper.restUntil ? fmtTime(keeper.restUntil) : "…"}` : keeper.saying?.text || keeper.phase}</span></h4>
            {!keeper ? <p className="lm-muted">A zeladora roda no app instalado e anda pelas memórias sozinha.</p> : <>
              <div className="lm-k-head"><b>{keeper.areaLabel || (keeper.phase === "descansando" ? "ronda completa" : "—")}</b><button className="lm-btn" onClick={() => void setKeeperEnabled(!keeper.enabled).then((k) => setKeeper((v) => (v ? { ...v, enabled: k.enabled } : v)))}>{keeper.enabled ? "desligar" : "ligar"}</button></div>
              <div className="lm-k-stats">
                <span><b>{keeper.nodes.length || layout.clouds.length}</b>nódulos</span><span><b>{keeper.stats.born}</b>nasceram</span><span><b>{keeper.stats.folded}</b>recolhidos</span><span><b>{keeper.stats.compacted + keeper.stats.joined}</b>juntadas</span>
              </div>
              {keeper.prunes.slice(0, 2).map((p) => <div key={p.id} className="lm-k-item prune"><span title={`${p.reason}${p.byTitle ? ` · no lugar dela: ${p.byTitle}` : ""}`}>✂ {p.title || "memória"} · {p.reason}</span><button onClick={() => void undoKeeperJoin(p.id).then(() => { setKeeper((v) => (v ? { ...v, prunes: v.prunes.filter((x) => x.id !== p.id) } : v)); void load(); })}>desfazer</button></div>)}
              {keeper.flags.slice(0, 3).map((f) => <div key={`${f.id}-${f.otherId}`} className={`lm-k-item flag ${f.otherId ? "" : "vague"}`}><span title={f.reason}>⚑ {f.title || label(f.id)} · {f.reason}</span><button onClick={() => goTo(f.id)}>ver</button><button onClick={() => void dismissKeeperFlag(f.id, f.otherId ?? undefined).then(() => setKeeper((v) => (v ? { ...v, flags: v.flags.filter((x) => !(x.id === f.id && x.otherId === f.otherId)) } : v)))}>ok</button></div>)}
              {keeper.compactions.slice(0, 1).map((c) => <div key={c.id} className="lm-k-item"><span title={`${c.from.length} memórias do mesmo pensamento viraram uma`}>compactou {c.from.length}: {c.title || label(c.id)}</span><button onClick={() => goTo(c.id)}>ver</button><button onClick={() => void undoKeeperJoin(c.id).then(() => setKeeper((v) => (v ? { ...v, compactions: v.compactions.filter((x) => x.id !== c.id) } : v)))}>desfazer</button></div>)}
              {keeper.joins.slice(0, 1).map((j) => <div key={j.archived} className="lm-k-item"><span title={`${j.archivedTitle} → ${j.title}`}>juntou: {j.archivedTitle || "cópia"}</span><button onClick={() => void undoKeeperJoin(j.archived).then(() => setKeeper((v) => (v ? { ...v, joins: v.joins.filter((x) => x.archived !== j.archived) } : v)))}>desfazer</button></div>)}
              {!keeper.prunes.length && !keeper.flags.length && !keeper.compactions.length && !keeper.joins.length && <p className="lm-muted">Nada esperando a sua revisão.</p>}
            </>}
          </div>
        </>}
      </footer>
    </section>
  );
}

type Graph = ReturnType<typeof buildMemoryGraph>;
type Sections = Map<string, { read: number; total: number; state: string }>;
const short3 = (s: string) => s.replace(/[^a-z0-9à-ú]/gi, "").slice(0, 3).toUpperCase();
/** A section's share for the instruments: read in this round while the Zeladora works, else the share proven. */
function shareOf(graph: Graph, id: string, sections: Sections, keeperOn: boolean): number {
  const c = graph.clusters.find((x) => x.id === id); if (!c || !c.nodeIds.length) return 0;
  const s = sections.get(id);
  if (keeperOn && s) return s.total ? s.read / s.total : 0;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return c.nodeIds.filter((m) => byId.get(m) && reviewOf(byId.get(m)!.memory) === "comprovada").length / c.nodeIds.length;
}

/**
 * The tabs of the sections (the reference's role · objective · context …): each section a tab, the active one
 * filled with its colour, the ones the Zeladora finished bright, a thin bar of how much of each she has read.
 */
function SectionTabs({ layout, graph, sections, active, focusClusterId, onPick }: { layout: CloudLayout; graph: Graph; sections: Sections; active: string | null; focusClusterId: string | null; onPick: (id: string) => void }) {
  const tabs = layout.clouds.slice(0, 12);
  if (tabs.length < 2) return null;
  return (
    <nav className="lm-sectabs" aria-label="Nódulos da memória">
      {tabs.map((c) => {
        const cl = graph.clusters.find((x) => x.id === c.id); if (!cl) return null;
        const s = sections.get(c.id);
        const on = c.id === active || c.id === focusClusterId;
        return (
          <button key={c.id} className={`${on ? "on" : ""} ${s?.state === "feito" ? "done" : ""}`} style={{ ["--c" as string]: cloudColor(c.index), ["--p" as string]: `${s && s.total ? (100 * s.read) / s.total : 0}%` }} onClick={() => onPick(c.id)} title={`${cl.label} · ${cl.nodeIds.length} memórias`}>
            {cl.label}
          </button>
        );
      })}
    </nav>
  );
}

/** The coverage radar: one axis per section (the biggest seven), how much of each is read / proven. */
function Coverage({ layout, graph, sections, keeperOn, active }: { layout: CloudLayout; graph: Graph; sections: Sections; keeperOn: boolean; active: string | null }) {
  const axes = layout.clouds.slice(0, 7);
  if (axes.length < 3) return <p className="lm-muted">Poucos nódulos para o radar.</p>;
  const vals = axes.map((c) => shareOf(graph, c.id, sections, keeperOn));
  const pt = (i: number, r: number) => { const a = -Math.PI / 2 + (i / axes.length) * Math.PI * 2; return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r]; };
  const poly = vals.map((v, i) => pt(i, 4 + v * 36).join(",")).join(" ");
  const color = active ? cloudColor(layout.clouds.find((c) => c.id === active)?.index ?? 0) : "#9fb0c4";
  return (
    <svg className="lm-radar" viewBox="0 0 100 100" role="img" aria-label={axes.map((c, i) => `${graph.clusters.find((x) => x.id === c.id)?.label}: ${Math.round(vals[i] * 100)}%`).join("; ")}>
      {[13, 26, 40].map((r) => <polygon key={r} points={axes.map((_, i) => pt(i, r).join(",")).join(" ")} className="grid" />)}
      {axes.map((_, i) => { const [x, y] = pt(i, 40); return <line key={i} x1="50" y1="50" x2={x} y2={y} className="grid" />; })}
      <polygon points={poly} className="area" style={{ fill: `color-mix(in srgb, ${color} 30%, transparent)`, stroke: color }} />
      {axes.map((c, i) => { const [x, y] = pt(i, 47); return <text key={c.id} x={x} y={y} textAnchor="middle" dominantBaseline="middle">{short3(graph.clusters.find((g) => g.id === c.id)?.label || "")}</text>; })}
    </svg>
  );
}

/** The heat grid (the reference's word heat): a row per section, twelve cells, filled by its share. */
function Heat({ layout, graph, sections, keeperOn }: { layout: CloudLayout; graph: Graph; sections: Sections; keeperOn: boolean }) {
  const rows = layout.clouds.slice(0, 7);
  return (
    <div className="lm-heat" role="img" aria-label="Calor por nódulo">
      {rows.map((c) => {
        const v = shareOf(graph, c.id, sections, keeperOn);
        const filled = Math.round(v * 12);
        return <div key={c.id}><span>{short3(graph.clusters.find((g) => g.id === c.id)?.label || "")}</span>{Array.from({ length: 12 }, (_, k) => <i key={k} style={k < filled ? { background: cloudColor(c.index) } : undefined} />)}</div>;
      })}
    </div>
  );
}

/** The memory's health (the reference's spec score): a gauge 0–100 and how it moved. */
function Health({ value, log }: { value: number; log: number[] }) {
  const pts = log.length > 1 ? log.map((v, i) => `${(i / (log.length - 1)) * 100},${30 - (v / 100) * 26}`).join(" ") : "0,16 100,16";
  const a = Math.PI * 0.75, span = Math.PI * 1.5;
  const arc = (u: number) => { const ang = a + span * u; return [50 + Math.cos(ang) * 28, 52 + Math.sin(ang) * 28]; };
  const [x0, y0] = arc(0), [x1, y1] = arc(Math.max(0.001, value / 100));
  const large = value / 100 * span > Math.PI ? 1 : 0;
  const color = value >= 70 ? "#e8c46f" : value >= 40 ? "#e88fa6" : "#ff7a4d";
  return (
    <div className="lm-health">
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} style={{ stroke: "#e8c46f" }} /></svg>
      <svg viewBox="0 0 100 86" role="img" aria-label={`saúde da memória ${value} de 100`}>
        <path d={`M ${x0} ${y0} A 28 28 0 1 1 ${arc(1)[0]} ${arc(1)[1]}`} className="track" />
        <path d={`M ${x0} ${y0} A 28 28 0 ${large} 1 ${x1} ${y1}`} style={{ stroke: color }} className="value" />
        <text x="50" y="57" textAnchor="middle" className="num">{value}</text>
        <text x="50" y="70" textAnchor="middle" className="cap">saúde</text>
      </svg>
    </div>
  );
}

/**
 * What the Zeladora runs, as the reference's crawler.py: her real loop (app/memoryKeeper.js) in a few lines,
 * the line she is on lit, with the values of now beside it.
 */
function KeeperCode({ keeper, nodes, where }: { keeper: KeeperView | null; nodes: number; where: string | null }) {
  const act = keeper?.enabled && keeper.running ? keeper.saying?.action || (keeper.phase === "descansando" ? "rest" : "walk") : "";
  const kind = keeper?.current ? keeper.kinds[keeper.current] : undefined;
  const lines: [string, string, string[]][] = [
    ["# zeladora.py · cuida da memória", "", []],
    ["nos = cuidar_nodulos()", String(nodes), ["plant", "adopt", "node-born", "node-gone", "arrival"]],
    ["for no in nos:", "", ["round"]],
    ["  andar_ate(no)", where || "", ["walk", "called"]],
    ["  for mem in no.memorias:", "", []],
    ["    tipo = ler(mem)", kind || "", ["read"]],
    ["    if tipo == \"vaga\": marcar(mem)", "", ["flag"]],
    ["    ligar_parecidas(mem)", "", ["link"]],
    ["    juntar_copias(mem)", "", ["join", "compact"]],
    ["    if obsoleta(mem): podar(mem)", "", ["prune"]],
    ["descansar()", keeper?.restUntil ? fmtTime(keeper.restUntil) : "", ["rest"]],
  ];
  return (
    <ol className="lm-code">
      {lines.map(([code, value, acts], i) => <li key={i} className={`${i === 0 ? "comment" : ""} ${act && acts.includes(act) ? "now" : ""}`}><code>{code}</code>{value && <em>{value}</em>}</li>)}
    </ol>
  );
}

/** Without WebGL (or after the GPU context was lost): the same data as a navigable list. */
function FallbackList({ graph, onSelect }: { graph: Graph; onSelect: (id: string) => void }) {
  return (
    <div className="lm-fallback">
      <p className="lm-muted">O mapa 3D precisa de aceleração gráfica (WebGL), que não está disponível agora. As mesmas memórias, em lista:</p>
      {graph.clusters.map((c) => (
        <details key={c.id} open={c.general}>
          <summary style={{ color: CATEGORY_COLOR[c.category] }}>{c.label} · {c.nodeIds.length}</summary>
          <ul>{c.nodeIds.map((id) => { const n = graph.nodes.find((x) => x.id === id)!; return <li key={id}><button onClick={() => onSelect(id)}>{n.memory.title}</button></li>; })}</ul>
        </details>
      ))}
    </div>
  );
}

const TICK: Record<string, number> = { recalled: 1, answered: 0.9, "turn-start": 0.8, created: 0.75, scanned: 0.6, keeper: 0.35, updated: 0.5 };
/** The live events as a barcode, oldest left, newest right: one tick per real event (taller for a question's). */
function Barcode({ events }: { events: MemoryLiveEvent[] }) {
  const list = [...events].slice(0, 160).reverse();
  return (
    <div className="lm-barcode" role="img" aria-label={`${events.length} eventos da memória desde que o app abriu`}>
      <span>eventos ao vivo · {events.length}</span>
      <div>{list.map((e, i) => <i key={`${e.seq}-${i}`} className={e.type === "keeper" ? `k-${e.action}` : e.type} style={{ height: `${Math.round((TICK[e.type] ?? 0.4) * 100)}%` }} title={`${fmtTime(e.at)} · ${EVENT_LABEL[e.type] || e.type}${e.type === "keeper" && e.action ? ` · ${KEEPER_LABEL[e.action] || e.action}` : ""}`} />)}</div>
    </div>
  );
}

/**
 * The local model's speed as it runs (the Strata video's monitor): how fast the last answer was written and its
 * prompt read, how much came from the cache, the last calls as a line, and a warning when it falls well below
 * what is normal for that model on this machine (a game or another program holding the graphics card).
 */
function SpeedMonitor({ calls }: { calls: ModelSpeedSample[] }) {
  const measured = calls.filter((c) => c.writeTps != null && (c.outTokens || 0) >= 24);
  const last = measured[measured.length - 1] || calls[calls.length - 1];
  if (!last) return <div className="lm-speed"><span>velocidade do modelo · aparece na próxima resposta da Aurora</span></div>;
  const max = Math.max(1, ...measured.map((c) => c.writeTps || 0), last.normal || 0);
  const pts = measured.length > 1 ? measured.map((c, i) => `${(i / (measured.length - 1)) * 200},${28 - ((c.writeTps || 0) / max) * 24}`).join(" ") : "";
  const normalY = last.normal ? 28 - (last.normal / max) * 24 : null;
  const num = (v: number | null | undefined, d = 0) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: d }));
  return (
    <div className={`lm-speed ${last.slow ? "slow" : ""}`} role="status" aria-label="Velocidade do modelo local">
      <span>velocidade · <b>{last.model}</b></span>
      <span>escreve <b>{num(last.writeTps)}</b> t/s</span>
      <span>lê <b>{num(last.readTps)}</b> t/s</span>
      <span>cache <b>{last.cacheShare == null ? "—" : `${Math.round(last.cacheShare * 100)}%`}</b></span>
      {last.normal ? <span>normal <b>{num(last.normal)}</b> t/s</span> : null}
      <svg viewBox="0 0 200 30" preserveAspectRatio="none" aria-hidden="true">
        {normalY != null && <line x1="0" x2="200" y1={normalY} y2={normalY} className="normal" />}
        {pts && <polyline points={pts} />}
      </svg>
      {last.slow && <em>abaixo do normal ({num(last.writeTps)} de {num(last.normal)} t/s): a placa de vídeo pode estar ocupada por outro programa</em>}
    </div>
  );
}
