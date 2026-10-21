import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dismissKeeperFlag, getMemoryGraph, setKeeperEnabled, subscribeMemoryEvents, undoKeeperJoin, visitKeeper, type MemoryGraphSnapshot, type MemoryLiveEvent } from "../api";
import { applyEvent, buildMemoryGraph, keeperFromSnapshot, reduceKeeper, reduceTurn, sectionProgress, type KeeperView, type TurnPhase, type TurnState, CATEGORY_COLOR, CATEGORY_LABEL, edgesOf, newFrozenAtlas, RELATION_LABEL, searchIds, steadyAtlas, type Category, type Filters, type ViewMode } from "./adapter";
import { layoutTree } from "./tree";
import type { AgentState, AgentTentacle, CameraCommand, Highlight, MapSettings, Merge, Quality, RecallBush } from "./LiveMapScene";
import type { Vec3 } from "./layout";
import ChatDock from "./ChatDock";
import "./livemap.css";

const LiveMapScene = lazy(() => import("./LiveMapScene"));

/**
 * Memórias / Mapa Vivo: the Aurora's memory as a living search tree on an instrument panel. Every leaf is a
 * stored memory, every branch a real grouping, every wave and glowing path a real event (a search, a memory
 * used in an answer, the Zeladora at work); every number on the panel is counted from the memories and the live
 * events. No demo data: with nothing stored, the map says so.
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
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem("aurora-livemap-panels") === "open"; } catch { return false; } });
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
  useEffect(() => { try { localStorage.setItem("aurora-livemap-settings", JSON.stringify({ quality: settings.quality, labels: settings.labels, paused: settings.paused, autoFocus: settings.autoFocus })); } catch { /* private mode */ } }, [settings]);

  // The semantic atlas held steady for the session (adapter.steadyAtlas): a new memory joins its neighbours'
  // cluster instead of the server's re-clustering moving every group. "Reorganizar" starts it over.
  const frozen = useRef(newFrozenAtlas());
  const steady = useCallback((s: MemoryGraphSnapshot) => ({ ...s, atlas: steadyAtlas(s.atlas, frozen.current) }), []);
  const load = useCallback(() => getMemoryGraph().then((s) => { setSnap(steady(s)); setKeeper((k) => { const base = keeperFromSnapshot(s.keeper); return !k || !base ? k || base : { ...base, current: k.current ?? base.current, trail: k.trail.length ? k.trail : base.trail, links: k.links, flags: k.flags.length > base.flags.length ? k.flags : base.flags, growth: k.growth, prunes: k.prunes.length > base.prunes.length ? k.prunes : base.prunes }; }); setError(""); setEvents((old) => (old.length ? old : s.events)); }).catch((e: Error) => setError(e.message)), [steady]);
  useEffect(() => { void load(); }, [load]);
  const reorganize = useCallback(() => { frozen.current = newFrozenAtlas(); void load(); }, [load]);
  const quietRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => { void getMemoryGraph().then((s) => setSnap(steady(s))).catch(() => {}); }, 1500);
  }, [steady]);

  // ---------- Live events: incremental changes, pulses for what really happened ----------
  const snapRef = useRef(snap); snapRef.current = snap;
  const graphRef = useRef<ReturnType<typeof buildMemoryGraph> | null>(null);
  const layoutRef = useRef<ReturnType<typeof layoutTree> | null>(null);
  useEffect(() => subscribeMemoryEvents((event) => {
    if (event.type === "hello") return;
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
        const p = layoutRef.current?.nodes.get(event.id);
        const last = keeperView.current;
        const far = !last.target || (p && Math.hypot(p[0] - last.target[0], p[1] - last.target[1]) > (layoutRef.current?.tree.R || 400) * 0.18);
        if (p && (keeperArea.current !== event.area || (far && Date.now() - last.at > 2500))) {
          const target: Vec3 = [p[0] + (dockOpenRef.current ? (layoutRef.current?.tree.R || 400) * 0.12 : 0), p[1], p[2]];
          keeperArea.current = event.area || null;
          keeperView.current = { target, at: Date.now() };
          setCamera({ target, distance: (layoutRef.current?.tree.R || 400) * 1.1, key: Date.now() });
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
        if (box && first) { setFocusClusterId(first.clusterId); setCamera({ target: box.center, distance: Math.min((layoutRef.current?.tree.R || 400) * 1.45, 120 + box.radius * 3), key: Date.now() }); }
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
  const layout = useMemo(() => (graph ? layoutTree(graph, snap) : null), [graph, snap]);
  const R = layout?.tree.R || 400;
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
    setCamera({ target: agent.target, distance: Math.min(R * 1.45, 60 + spread * 2.2), key: Date.now() });
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
    setCamera({ target: p, distance: R * 0.32, key: Date.now() });
  }, [layout, nodeById, R]);
  const fit = useCallback(() => {
    if (!layout) return;
    // With the chat open beside the map, the tree moves left and a little back so none of it hides behind it.
    const R = layout.tree.R, dock = dockOpenRef.current;
    setFocusClusterId(null); setCamera({ target: [dock ? R * 0.3 : 0, R * 0.56, 0], distance: R * (dock ? 1.72 : 1.56), key: Date.now() });
  }, [layout]);
  // The first time the map has a tree: the whole of it in view.
  const fitted = useRef(false);
  useEffect(() => { if (layout && !fitted.current) { fitted.current = true; fit(); } }, [layout, fit]);
  const focusCluster = useCallback((id: string, double: boolean) => {
    const box = layout?.clusters.get(id); if (!box) return;
    if (double) { setFocusClusterId(id); setCamera({ target: box.center, distance: Math.min(layout!.tree.R * 1.45, 60 + box.radius * 2.6), key: Date.now() }); return; }
    setExpanded((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    setFocusClusterId(id);
  }, [layout]);

  // Keyboard: "/" search, Esc clears, F fits, P pauses, L labels.
  const searchRef = useRef<HTMLInputElement>(null);
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
  const focusIndex = focused && graph ? graph.clusters.indexOf(focused) + 1 : 0;
  const recallNodes = (lastRecall?.ids || snap?.recalls?.[0]?.used || []).map((id) => nodeById.get(id)).filter(Boolean);
  const recentRate = events.filter((e) => Date.now() - Date.parse(e.at) < 10 * 60_000).length;
  const bushes = useMemo<RecallBush[]>(() => {
    const stored = (snap?.recalls || []).map((r) => ({ id: r.id, at: r.at, prompt: r.prompt, used: r.used }));
    const live = lastRecall && !stored.some((r) => Math.abs(Date.parse(r.at) - Date.parse(lastRecall.at)) < 5000) ? [{ id: `live:${lastRecall.at}`, at: lastRecall.at, prompt: turn?.message || "pergunta agora", used: lastRecall.ids }] : [];
    return [...live, ...stored].filter((r) => r.used.length);
  }, [snap?.recalls, lastRecall, turn?.message]);

  if (error && !snap) return <section className="livemap"><div className="lm-state"><h2>Mapa Vivo indisponível</h2><p>{error}</p><button className="lm-btn" onClick={() => void load()}>Tentar de novo</button></div></section>;
  if (!snap || !graph || !layout) return <section className="livemap"><div className="lm-state"><p>Carregando as memórias…</p></div></section>;

  return (
    <section className="livemap" aria-label="Mapa Vivo de Memórias">
      <header className="lm-top">
        <div className="lm-head">
          <b>| MEMÓRIA VIVA / AURORA</b>
          <nav className="lm-tabs" aria-label="Modo de visão">
            {MODES.map(([id, label]) => <button key={id} aria-pressed={mode === id} className={mode === id ? "on" : ""} onClick={() => { setMode(id); setFocusClusterId(null); setExpanded(new Set()); }}>{label}</button>)}
          </nav>
          <div className="lm-metrics" aria-label="Indicadores">
            <span>memórias <b>{graph.stats.memories}</b></span>
            <span>conexões <b className="teal">{graph.stats.edges}</b></span>
            <span>agrupamentos <b>{graph.stats.clusters}</b></span>
            <span>consultadas <b className="pink">{lastRecall?.ids.length ?? 0}</b></span>
            {keeper?.enabled && <>
              <span>lidas <b className="teal">{keeper.readIds.length}/{graph.stats.memories}</b></span>
              <span>ligações <b>{keeper.stats.linked}</b></span>
              <span>compactadas <b>{keeper.stats.compacted + keeper.stats.joined}</b></span>
              <span>marcas <b className="yellow">{keeper.flags.length}</b></span>
              <span>nódulos <b className="teal">{keeper.nodes.length || graph.stats.clusters}</b></span>
              {keeper.stats.pruned > 0 && <span>podadas <b>{keeper.stats.pruned}</b></span>}
            </>}
            <span className={`lm-live ${live ? "on" : ""}`} title={live ? "Recebendo os eventos da memória ao vivo" : "Sem conexão com os eventos ao vivo"}>{live ? "ao vivo" : "sem conexão"}</span>
          </div>
        </div>
        <SectionChart graph={graph} sections={sections} focusClusterId={focusClusterId} onPick={(id) => focusCluster(id, true)} />
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

      <div className="lm-stage">
        <div className="lm-title" aria-live="polite">
        {turn && !turn.ended ? <>
          <h1>{String(STEPS.findIndex(([x]) => x === turn.phase) + 1).padStart(2, "0")} {STEPS.find(([x]) => x === turn.phase)![1].toUpperCase()}</h1>
          <p>{turn.phase === "busca" ? `avaliando ${turn.scanned.length} memórias` : turn.phase === "consulta" ? `${turn.recalled.length} memórias no contexto · respondendo` : turn.phase === "resposta" ? `usou ${turn.used.length} · criou ${turn.created.length}` : `“${turn.message.slice(0, 60)}”`}{turn.conversationId && turn.conversationId === dockConversation ? " · nesta conversa" : ""}</p>
        </> : !focused && keeperCluster && keeper?.phase === "andando" ? <>
          <h1>{String(graph.clusters.indexOf(keeperCluster) + 1).padStart(2, "0")} {keeperCluster.label.toUpperCase()}</h1>
          <p>zeladora lendo · {sections.get(keeperCluster.id)?.read ?? 0}/{keeperCluster.nodeIds.length} memórias · {keeperCluster.sublabel}</p>
        </> : <>
          <h1>{String(focusIndex || 0).padStart(2, "0")} {(focused?.label || "memória da aurora").toUpperCase()}</h1>
          <p>{focused ? `${focused.nodeIds.length} memórias · ${focused.sublabel}` : `${graph.stats.memories} memórias · ${graph.stats.clusters} agrupamentos`}</p>
        </>}
        </div>

        {graph.nodes.length === 0 ? (
          <div className="lm-state"><h2>{snap.memories.length ? "Nenhuma memória com esses filtros" : "Ainda não há memórias"}</h2><p>{snap.memories.length ? "Mude os filtros ou a busca." : "As memórias aparecem aqui assim que a Aurora guardar a primeira — em conversas, lições do professor ou importações."}</p></div>
        ) : gl ? (
          <Suspense fallback={<div className="lm-state"><p>Preparando o mapa…</p></div>}>
            <LiveMapScene graph={graph} layout={layout} settings={settings} selectedId={selectedId} hoveredId={hoveredId} focusClusterId={focusClusterId} expanded={expanded} highlights={highlights} camera={camera} agent={agent} keeper={keeper} sections={sections}
              readSet={keeper?.enabled && keeper.running && keeper.phase === "andando" && keeper.readIds.length ? readSet : null} merges={merges} recalls={bushes} onUserMove={onUserMove}
              onHover={setHoveredId} onSelect={(id) => { setSelectedId(id); if (id) setFocusClusterId(nodeById.get(id)?.clusterId || null); }} onCluster={focusCluster} onContextLost={() => setGl(false)} />
          </Suspense>
        ) : (
          <FallbackList graph={graph} onSelect={goTo} />
        )}
        {gl && graph.nodes.length > 0 && <ul className={`lm-legend ${dockOpen ? "with-dock" : ""}`} aria-label="Legenda">
          <li className="busca">busca · memórias avaliadas</li>
          <li className="consulta">caminho · memórias usadas</li>
          <li className="zeladora">zeladora · lendo</li>
          <li className="criada">memória criada</li>
        </ul>}
        <ChatDock open={dockOpen} onToggle={() => setDockOpen((v) => !v)} onGoTo={goTo} onConversation={setDockConversation} projectId={filters.projectId || null} />
        {hoveredId && nodeById.get(hoveredId) && hoveredId !== selectedId && (
          <div className="lm-hover" role="status">
            <i style={{ background: CATEGORY_COLOR[nodeById.get(hoveredId)!.category] }} />{nodeById.get(hoveredId)!.memory.title}
            <small>{CATEGORY_LABEL[nodeById.get(hoveredId)!.category]} · {edgesOf(graph, hoveredId).length} conexões</small>
          </div>
        )}
        {selected && (
          <aside className={`lm-side ${dockOpen ? "with-dock" : ""}`} aria-label="Memória selecionada">
            <header><span className="lm-cat" style={{ color: CATEGORY_COLOR[selected.category] }}>{CATEGORY_LABEL[selected.category]}</span><button className="lm-x" onClick={() => setSelectedId(null)} aria-label="Fechar">×</button></header>
            <h2>{selected.memory.title}</h2>
            {selected.memory.sensitive ? <p className="lm-muted">Conteúdo sensível: não aparece no mapa. Abra na Memória para ver.</p> : <p>{selected.memory.snippet}{(selected.memory.snippet || "").length >= 280 ? "…" : ""}</p>}
            <dl>
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
                return other && <li key={e.id}><button onClick={() => goTo(other.id)}><i style={{ background: CATEGORY_COLOR[other.category] }} />{other.label}<small>{e.kind === "relacao" ? RELATION_LABEL[e.type || ""] || e.type : `similaridade ${Math.round(e.weight * 100)}%`}</small></button></li>;
              })}
              {edgesOf(graph, selected.id).length === 0 && <li className="lm-muted">Sem conexões medidas ainda.</li>}
            </ul>
            <div className="lm-actions">
              {selected.memory.conversationId && onOpenConversation && <button className="lm-btn" onClick={() => onOpenConversation(selected.memory.conversationId!)}>abrir conversa de origem</button>}
              {onOpenMemory && <button className="lm-btn" onClick={onOpenMemory}>ver na memória</button>}
              {keeper?.enabled && <button className="lm-btn lm-call" onClick={() => callKeeper([selected.memory.id, ...(nodeById.get(selected.memory.id) ? graph.clusters.find((c) => c.id === nodeById.get(selected.memory.id)!.clusterId)?.nodeIds.filter((x) => x !== selected.memory.id).slice(0, 11) || [] : [])], selected.memory.title)}>chamar a zeladora aqui</button>}
              {callNote && <small className="lm-muted">{callNote}</small>}
            </div>
          </aside>
        )}
      </div>

      <div className="lm-strip" aria-label="Linha do tempo">
        <Barcode events={events} />
        <div className="lm-strip-row">
          <Activity events={events} />
        <ol className={`lm-steps ${turn ? "on" : ""}`} aria-label="O turno da Aurora agora">
          {STEPS.map(([id, label], i) => {
            const at = turn ? STEPS.findIndex(([x]) => x === turn.phase) : -1;
            const state = !turn ? "" : i < at || (turn.ended && i <= at) ? "done" : i === at ? "now" : "";
            const detail = !turn ? "" : id === "pergunta" ? turn.message : id === "busca" ? (turn.scanned.length ? `${turn.scanned.length} avaliadas · melhor ${turn.scanned[0].score.toFixed(2).replace(".", ",")}` : "") : id === "consulta" ? (turn.recalled.length ? `${turn.recalled.length} no contexto` : "") : turn.phase === "resposta" ? `usou ${turn.used.length} · criou ${turn.created.length}` : "";
            return <li key={id} className={state}><b>{String(i + 1).padStart(2, "0")} {label}</b><span>{detail || (turn ? "…" : "aguardando uma pergunta")}</span></li>;
          })}
        </ol>
          <Growth memories={snap.memories} />
        </div>
      </div>

      <footer className={`lm-panels ${panelOpen ? "" : "closed"}`} aria-label="Indicadores da memória">
        <button className="lm-panel-toggle" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>{panelOpen ? "recolher indicadores" : "indicadores"}</button>
        {panelOpen && <>
          <div className="lm-panel">
            <h4>atividade <span>{recentRate} em 10 min</span></h4>
            <ol className="lm-log">
              {events.length === 0 && <li className="lm-muted">Nenhum evento desde que o app abriu.</li>}
              {events.slice(0, 14).map((e, i) => (
                <li key={`${e.seq}-${i}`} className={e.type}><time>{fmtTime(e.at)}</time><b className={e.type === "keeper" ? `lm-act-${e.action}` : ""}>{e.type === "keeper" ? KEEPER_LABEL[e.action || ""] || e.action : EVENT_LABEL[e.type] || e.type}</b><span>{e.type === "keeper" ? keeperLine(e) : e.type === "recalled" ? `${e.ids?.length || 0} memórias · ${convTitle.get(e.conversationId || "") || "conversa"}` : e.type === "scanned" ? `${e.candidates?.length || 0} candidatas · melhor ${(e.candidates?.[0]?.score ?? 0).toFixed(2).replace(".", ",")}` : e.type === "turn-start" ? `“${(e.message || "").slice(0, 40)}”` : e.type === "answered" ? `usou ${e.used?.length || 0} · criou ${e.created?.length || 0}` : e.type === "turn-end" ? convTitle.get(e.conversationId || "") || "conversa" : e.title || nodeById.get(e.id || "")?.label || (e.id || "").slice(0, 8)}</span></li>
              ))}
            </ol>
          </div>
          <div className="lm-panel">
            <h4>seções <span>{graph.stats.clusters}{keeper?.enabled ? ` · ${[...sections.values()].filter((x) => x.state === "feito").length} feitas` : ""}</span></h4>
            <ul className="lm-bars lm-sections">
              {graph.clusters.slice(0, 9).map((c) => {
                const sec = sections.get(c.id);
                const share = sec ? (sec.total ? sec.read / sec.total : 0) : 1;
                return <li key={c.id} className={`${c.id === focusClusterId ? "on" : ""} ${sec?.state === "lendo" ? "reading" : sec?.state === "na fila" ? "queued" : ""}`}><button onClick={() => focusCluster(c.id, true)}><span>{c.label}</span><b>{sec ? `${sec.read}/${sec.total}` : c.nodeIds.length}</b><i style={{ width: `${Math.max(share * 100, sec ? 0 : 4)}%`, background: CATEGORY_COLOR[c.category] }} /></button>{keeper?.enabled && <button className="lm-call-mini" title={`Chamar a zeladora para organizar “${c.label}” agora`} aria-label={`Chamar a zeladora para ${c.label}`} onClick={() => callKeeper(c.nodeIds, c.label)}>⌖</button>}</li>;
              })}
            </ul>
          </div>
          <div className="lm-panel">
            <h4>categorias <span>distribuição</span></h4>
            <Radar values={graph.stats.byCategory} />
          </div>
          <div className="lm-panel">
            <h4>vínculos <span>{graph.stats.edges}</span></h4>
            <Histogram bins={graph.stats.similarity} />
            <ul className="lm-kv">
              <li><span>relações explícitas</span><b>{graph.stats.edgesByKind.relacao}</b></li>
              <li><span>por similaridade</span><b>{graph.stats.edgesByKind.semantica}</b></li>
              {Object.entries(graph.stats.relationTypes).slice(0, 3).map(([t, n]) => <li key={t}><span>{RELATION_LABEL[t] || t}</span><b>{n}</b></li>)}
            </ul>
          </div>
          <div className="lm-panel">
            <h4>consulta atual <span>{lastRecall ? fmtTime(lastRecall.at) : snap.recalls[0] ? fmtTime(snap.recalls[0].at) : "—"}</span></h4>
            {recallNodes.length === 0 ? <p className="lm-muted">Nenhuma memória consultada ainda nesta sessão.</p> : (
              <ul className="lm-recall">
                {recallNodes.slice(0, 8).map((n) => <li key={n!.id}><button onClick={() => goTo(n!.id)}><i style={{ background: CATEGORY_COLOR[n!.category] }} />{n!.label}</button></li>)}
              </ul>
            )}
            {!lastRecall && snap.recalls[0] && <small className="lm-muted">última resposta: “{snap.recalls[0].prompt.slice(0, 60)}”</small>}
          </div>
          <div className="lm-panel lm-keeper">
            <h4>zeladora <span>{!keeper ? "—" : !keeper.running ? "não roda aqui" : !keeper.enabled ? "desligada" : keeper.phase === "descansando" ? `descansa até ${keeper.restUntil ? fmtTime(keeper.restUntil) : "…"}` : keeper.phase}</span></h4>
            {!keeper ? <p className="lm-muted">A zeladora roda no app instalado e anda pelas memórias sozinha.</p> : <>
              <div className="lm-k-head"><b>{keeper.areaLabel || (keeper.phase === "descansando" ? "ronda completa" : "—")}</b><button className="lm-btn" onClick={() => void setKeeperEnabled(!keeper.enabled).then((k) => setKeeper((v) => (v ? { ...v, enabled: k.enabled } : v)))}>{keeper.enabled ? "desligar" : "ligar"}</button></div>
              <div className="lm-k-stats">
                <span><b>{keeper.stats.read}</b>lidas</span><span><b>{keeper.stats.linked}</b>ligadas</span><span><b>{keeper.stats.compacted + keeper.stats.joined}</b>compactadas</span><span><b>{keeper.flags.length}</b>marcas</span>
              </div>
              <div className="lm-k-stats">
                <span><b>{keeper.nodes.length || "—"}</b>nódulos</span><span><b>{keeper.stats.born}</b>nasceram</span><span><b>{keeper.stats.folded}</b>recolhidos</span><span><b>{keeper.stats.pruned}</b>podadas</span>
              </div>
              {keeper.prunes.slice(0, 2).map((p) => <div key={p.id} className="lm-k-item prune"><span title={`${p.reason}${p.byTitle ? ` · no lugar dela: ${p.byTitle}` : ""}`}>✂ {p.title || "memória"} · {p.reason}</span><button onClick={() => void undoKeeperJoin(p.id).then(() => { setKeeper((v) => (v ? { ...v, prunes: v.prunes.filter((x) => x.id !== p.id) } : v)); void load(); })}>desfazer</button></div>)}
              {keeper.compactions.slice(0, 2).map((c) => <div key={c.id} className="lm-k-item"><span title={`${c.from.length} memórias do mesmo pensamento viraram uma`}>compactou {c.from.length}: {c.title || label(c.id)}</span><button onClick={() => goTo(c.id)}>ver</button><button onClick={() => void undoKeeperJoin(c.id).then(() => setKeeper((v) => (v ? { ...v, compactions: v.compactions.filter((x) => x.id !== c.id) } : v)))}>desfazer</button></div>)}
              {keeper.flags.slice(0, 2).map((f) => <div key={`${f.id}-${f.otherId}`} className={`lm-k-item flag ${f.otherId ? "" : "vague"}`}><span title={f.reason}>⚑ {f.title || label(f.id)} · {f.reason}</span><button onClick={() => goTo(f.id)}>ver</button><button onClick={() => void dismissKeeperFlag(f.id, f.otherId ?? undefined).then(() => setKeeper((v) => (v ? { ...v, flags: v.flags.filter((x) => !(x.id === f.id && x.otherId === f.otherId)) } : v)))}>ok</button></div>)}
              {keeper.joins.slice(0, 2).map((j) => <div key={j.archived} className="lm-k-item"><span title={`${j.archivedTitle} → ${j.title}`}>juntou: {j.archivedTitle || "cópia"}</span><button onClick={() => void undoKeeperJoin(j.archived).then(() => setKeeper((v) => (v ? { ...v, joins: v.joins.filter((x) => x.archived !== j.archived) } : v)))}>desfazer</button></div>)}
            </>}
          </div>
        </>}
      </footer>
    </section>
  );
}

/** The categories' real counts on a small radar (4 axes). */
function Radar({ values }: { values: Record<Category, number> }) {
  const keys = Object.keys(values) as Category[];
  const max = Math.max(1, ...Object.values(values));
  const pt = (i: number, r: number) => { const a = -Math.PI / 2 + (i / keys.length) * Math.PI * 2; return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r]; };
  const poly = keys.map((k, i) => pt(i, 8 + (values[k] / max) * 34).join(",")).join(" ");
  return (
    <svg className="lm-radar" viewBox="0 0 100 100" role="img" aria-label={keys.map((k) => `${CATEGORY_LABEL[k]}: ${values[k]}`).join("; ")}>
      {[14, 28, 42].map((r) => <polygon key={r} points={keys.map((_, i) => pt(i, r).join(",")).join(" ")} className="grid" />)}
      <polygon points={poly} className="area" />
      {keys.map((k, i) => { const [x, y] = pt(i, 47); return <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="middle">{CATEGORY_LABEL[k].split(" ")[0].toUpperCase().slice(0, 4)} {values[k]}</text>; })}
    </svg>
  );
}

/** The measured similarities of the semantic links, 0.5 to 1.0. */
function Histogram({ bins }: { bins: number[] }) {
  const max = Math.max(1, ...bins);
  return (
    <div className="lm-hist" role="img" aria-label={`Similaridade dos vínculos: ${bins.map((b, i) => `${50 + i * 10}–${60 + i * 10}%: ${b}`).join("; ")}`}>
      {bins.map((b, i) => <div key={i} title={`${50 + i * 10}–${60 + i * 10}%: ${b}`}><i style={{ height: `${(b / max) * 100}%` }} /><span>{50 + i * 10}</span></div>)}
    </div>
  );
}

/** Without WebGL (or after the GPU context was lost): the same data as a navigable list. */
function FallbackList({ graph, onSelect }: { graph: ReturnType<typeof buildMemoryGraph>; onSelect: (id: string) => void }) {
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

/**
 * The instrument's top chart: the biggest sections side by side, with how many memories each holds (white),
 * how much they are used (orange) and, while the Zeladora walks, how much of each she has read (teal).
 */
function SectionChart({ graph, sections, focusClusterId, onPick }: { graph: ReturnType<typeof buildMemoryGraph>; sections: Map<string, { read: number; total: number; state: string }>; focusClusterId: string | null; onPick: (id: string) => void }) {
  const top = [...graph.clusters].sort((a, b) => b.nodeIds.length - a.nodeIds.length).slice(0, 7);
  if (top.length < 2) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const most = Math.max(1, ...top.map((c) => c.nodeIds.length));
  const use = top.map((c) => c.nodeIds.reduce((s, id) => s + (byId.get(id)?.relevance || 0), 0) / Math.max(1, c.nodeIds.length));
  const mostUse = Math.max(0.001, ...use);
  const x = (i: number) => 20 + (i / (top.length - 1)) * 960;
  const line = (v: number[]) => v.map((y, i) => `${x(i)},${54 - y * 44}`).join(" ");
  const counts = top.map((c) => c.nodeIds.length / most);
  const reads = top.map((c) => { const s = sections.get(c.id); return s && s.total ? s.read / s.total : 0; });
  return (
    <div className="lm-chart" role="img" aria-label={top.map((c, i) => `${c.label}: ${c.nodeIds.length} memórias, uso ${Math.round(use[i] * 100)}%`).join("; ")}>
      <div className="lm-chart-labels">
        {top.map((c, i) => <button key={c.id} className={c.id === focusClusterId ? "on" : ""} style={{ left: `${x(i) / 10}%`, transform: `translateX(${i === 0 ? "-2%" : i === top.length - 1 ? "-98%" : "-50%"})` }} onClick={() => onPick(c.id)} title={`${c.label} · ${c.nodeIds.length} memórias`}>{c.label} <b>({c.nodeIds.length})</b></button>)}
      </div>
      <svg viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="1000" y1="54" y2="54" className="axis" />
        <polyline points={line(counts)} className="s-count" />
        <polyline points={line(use.map((u) => u / mostUse))} className="s-use" />
        {sections.size > 0 && <polyline points={line(reads)} className="s-read" />}
        {counts.map((v, i) => <line key={i} x1={x(i)} x2={x(i)} y1={54 - v * 44 - 3} y2={54 - v * 44 + 3} className="tick" />)}
      </svg>
    </div>
  );
}

const TICK: Record<string, number> = { recalled: 1, answered: 0.9, "turn-start": 0.8, created: 0.75, scanned: 0.6, keeper: 0.35, updated: 0.5 };
/** The live events as a barcode, oldest left, newest right: one tick per real event (taller for a question's). */
function Barcode({ events }: { events: MemoryLiveEvent[] }) {
  const list = [...events].slice(0, 140).reverse();
  return (
    <div className="lm-barcode" role="img" aria-label={`${events.length} eventos da memória desde que o app abriu`}>
      <span>eventos ao vivo · {events.length}</span>
      <div>{list.map((e, i) => <i key={`${e.seq}-${i}`} className={e.type === "keeper" ? `k-${e.action}` : e.type} style={{ height: `${Math.round((TICK[e.type] ?? 0.4) * 100)}%` }} title={`${fmtTime(e.at)} · ${EVENT_LABEL[e.type] || e.type}${e.type === "keeper" && e.action ? ` · ${KEEPER_LABEL[e.action] || e.action}` : ""}`} />)}</div>
    </div>
  );
}

/** Events per minute over the last 30 minutes. */
function Activity({ events }: { events: MemoryLiveEvent[] }) {
  const now = Date.now();
  const bins = new Array(30).fill(0);
  for (const e of events) { const m = Math.floor((now - Date.parse(e.at)) / 60_000); if (m >= 0 && m < 30) bins[29 - m] += 1; }
  const max = Math.max(1, ...bins);
  return (
    <div className="lm-mini">
      <span>atividade · {bins[29]}/min agora</span>
      <svg viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true"><polyline points={bins.map((b, i) => `${i * (300 / 29)},${37 - (b / max) * 33}`).join(" ")} className="s-act" /></svg>
    </div>
  );
}

/** How the memory grew: memories stored over time (all of them, oldest to now). */
function Growth({ memories }: { memories: MemoryGraphSnapshot["memories"] }) {
  const times = memories.map((m) => Date.parse(m.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
  if (times.length < 2) return <div className="lm-mini"><span>crescimento · {times.length} memórias</span></div>;
  const t0 = times[0], t1 = Math.max(times[times.length - 1], t0 + 1);
  const pts: string[] = [];
  const step = Math.max(1, Math.floor(times.length / 120));
  for (let i = 0; i < times.length; i += step) pts.push(`${((times[i] - t0) / (t1 - t0)) * 300},${37 - ((i + 1) / times.length) * 33}`);
  pts.push(`300,4`);
  const days = Math.max(1, Math.round((t1 - t0) / 86_400_000));
  return (
    <div className="lm-mini right">
      <span>crescimento · {times.length} memórias em {days} {days === 1 ? "dia" : "dias"}</span>
      <svg viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true"><polyline points={pts.join(" ")} className="s-grow" /></svg>
    </div>
  );
}
