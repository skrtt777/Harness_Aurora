import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dismissKeeperFlag, getMemoryGraph, setKeeperEnabled, subscribeMemoryEvents, undoKeeperJoin, type MemoryGraphSnapshot, type MemoryLiveEvent } from "../api";
import { applyEvent, buildMemoryGraph, keeperFromSnapshot, reduceKeeper, reduceTurn, type KeeperView, type TurnPhase, type TurnState, CATEGORY_COLOR, CATEGORY_LABEL, edgesOf, newFrozenAtlas, RELATION_LABEL, searchIds, steadyAtlas, type Category, type Filters, type ViewMode } from "./adapter";
import { layoutGraph } from "./layout";
import type { AgentState, AgentTentacle, CameraCommand, Highlight, MapSettings, Quality } from "./LiveMapScene";
import type { Vec3 } from "./layout";
import ChatDock from "./ChatDock";
import "./livemap.css";

const LiveMapScene = lazy(() => import("./LiveMapScene"));

/**
 * Memórias / Mapa Vivo: the Aurora's memory as a navigable universe. Every point is a stored memory, every
 * line a real relation or a measured similarity, every pulse a real event (a memory recalled into a turn,
 * created, found by a search). No demo data: with nothing stored, the map says so.
 */
const MODES: [ViewMode, string][] = [["geral", "visão geral"], ["pasta", "por pasta / projeto"], ["conversa", "por conversa"]];
const EVENT_LABEL: Record<string, string> = { created: "criada", updated: "atualizada", archived: "arquivada", restored: "restaurada", deleted: "apagada", recalled: "consultada", scanned: "buscou", "turn-start": "pergunta", "turn-end": "fim", answered: "respondeu", keeper: "zeladora" };
// The Zeladora's actions in the log, the reference's crawl log (read · link · flag · walk).
const KEEPER_LABEL: Record<string, string> = { read: "lê", link: "liga", join: "junta", flag: "marca", walk: "anda", rest: "descansa", round: "ronda", error: "erro" };
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
  const base: MapSettings = { paused: false, quality: "alta", labels: true, reducedMotion: prefersReduced() };
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
  const [activityMode, setActivityMode] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [keeper, setKeeper] = useState<KeeperView | null>(null);
  const keeperArea = useRef<string | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [dockConversation, setDockConversation] = useState<string | null>(null);
  const turnTimer = useRef<number | null>(null);
  const [gl, setGl] = useState(webglAvailable);
  const refreshTimer = useRef<number | null>(null);
  useEffect(() => { try { localStorage.setItem("aurora-livemap-settings", JSON.stringify({ quality: settings.quality, labels: settings.labels, paused: settings.paused })); } catch { /* private mode */ } }, [settings]);

  // The semantic atlas held steady for the session (adapter.steadyAtlas): a new memory joins its neighbours'
  // cluster instead of the server's re-clustering moving every group. "Reorganizar" starts it over.
  const frozen = useRef(newFrozenAtlas());
  const steady = useCallback((s: MemoryGraphSnapshot) => ({ ...s, atlas: steadyAtlas(s.atlas, frozen.current) }), []);
  const load = useCallback(() => getMemoryGraph().then((s) => { setSnap(steady(s)); setKeeper((k) => { const base = keeperFromSnapshot(s.keeper); return !k || !base ? k || base : { ...base, current: k.current ?? base.current, trail: k.trail.length ? k.trail : base.trail, links: k.links, flags: k.flags.length > base.flags.length ? k.flags : base.flags }; }); setError(""); setEvents((old) => (old.length ? old : s.events)); }).catch((e: Error) => setError(e.message)), [steady]);
  useEffect(() => { void load(); }, [load]);
  const reorganize = useCallback(() => { frozen.current = newFrozenAtlas(); void load(); }, [load]);
  const quietRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => { void getMemoryGraph().then((s) => setSnap(steady(s))).catch(() => {}); }, 1500);
  }, [steady]);

  // ---------- Live events: incremental changes, pulses for what really happened ----------
  const snapRef = useRef(snap); snapRef.current = snap;
  const graphRef = useRef<ReturnType<typeof buildMemoryGraph> | null>(null);
  const layoutRef = useRef<ReturnType<typeof layoutGraph> | null>(null);
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
      if (event.action === "read") mark([event.id], "read");
      if (event.action === "link") mark([event.from, event.to], "linked");
      if (event.action === "flag") mark([event.id, event.otherId], "flagged");
      if (event.action === "join") mark([event.kept], "joined");
      // Activity mode: the camera goes with her when she enters another area (not on every memory).
      if (event.action === "read" && event.id && activityModeRef.current && !(turnRef.current && !turnRef.current.ended) && keeperArea.current !== event.area) {
        const p = layoutRef.current?.nodes.get(event.id);
        if (p) { keeperArea.current = event.area || null; setCamera({ target: p, distance: 150, key: Date.now() }); }
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
      if (activityModeRef.current) {
        const first = graphRef.current?.nodes.find((n) => event.ids!.includes(n.id));
        const box = first && layoutRef.current?.clusters.get(first.clusterId);
        if (box && first) { setFocusClusterId(first.clusterId); setCamera({ target: box.center, distance: 120 + box.radius * 3, key: Date.now() }); }
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
  const turnRef = useRef(turn); turnRef.current = turn;

  const label = useCallback((id?: string) => (id ? nodeByIdRef.current.get(id)?.label || id.slice(0, 8) : ""), []);
  const keeperLine = (e: MemoryLiveEvent) =>
    e.action === "read" ? label(e.id) : e.action === "link" ? `${label(e.from)} ↔ ${label(e.to)}` : e.action === "join" ? `${e.archivedTitle || "cópia"} → ${e.title || label(e.kept)}`
      : e.action === "flag" ? `${e.title || label(e.id)} · ${e.reason || ""}` : e.action === "walk" ? `${e.label} · ${e.total} memórias` : e.action === "rest" ? "ronda completa" : e.action === "round" ? `ronda ${e.round} · ${e.total} memórias` : e.reason || "";

  // ---------- Graph and layout (only when the data, the mode or the filters change) ----------
  const graph = useMemo(() => (snap ? buildMemoryGraph(snap, { mode, filters }) : null), [snap, mode, filters]);
  const layout = useMemo(() => (graph ? layoutGraph(graph, snap) : null), [graph, snap]);
  graphRef.current = graph; layoutRef.current = layout;
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
    if (!activityMode || !agent?.target || agent.ended) return;
    const key = `${agent.key}:${turn?.phase}`;
    if (followed.current === key) return;
    followed.current = key;
    const spread = Math.max(40, ...agent.tentacles.map((t) => { const p = layout?.nodes.get(t.id); return p ? Math.hypot(p[0] - agent.target![0], p[1] - agent.target![1]) : 0; }));
    setCamera({ target: agent.target, distance: Math.min(520, 60 + spread * 2.2), key: Date.now() });
  }, [agent, activityMode, turn?.phase, layout]);

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
    setCamera({ target: p, distance: 70, key: Date.now() });
  }, [layout, nodeById]);
  const fit = useCallback(() => {
    if (!layout) return;
    const far = Math.max(60, ...[...layout.clusters.values()].map((c) => Math.hypot(c.center[0], c.center[1]) + c.radius));
    setFocusClusterId(null); setCamera({ target: [0, 0, 0], distance: far * 2.1, key: Date.now() });
  }, [layout]);
  const focusCluster = useCallback((id: string, double: boolean) => {
    const box = layout?.clusters.get(id); if (!box) return;
    if (double) { setFocusClusterId(id); setCamera({ target: box.center, distance: 50 + box.radius * 2.1, key: Date.now() }); return; }
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
  const focusIndex = focused && graph ? graph.clusters.indexOf(focused) + 1 : 0;
  const recallNodes = (lastRecall?.ids || snap?.recalls?.[0]?.used || []).map((id) => nodeById.get(id)).filter(Boolean);
  const recentRate = events.filter((e) => Date.now() - Date.parse(e.at) < 10 * 60_000).length;

  if (error && !snap) return <section className="livemap"><div className="lm-state"><h2>Mapa Vivo indisponível</h2><p>{error}</p><button className="lm-btn" onClick={() => void load()}>Tentar de novo</button></div></section>;
  if (!snap || !graph || !layout) return <section className="livemap"><div className="lm-state"><p>Carregando as memórias…</p></div></section>;

  return (
    <section className="livemap" aria-label="Mapa Vivo de Memórias">
      <header className="lm-top">
        <div className="lm-metrics" aria-label="Indicadores">
          <span>memórias <b>{graph.stats.memories}</b></span>
          <span>conexões <b className="teal">{graph.stats.edges}</b></span>
          <span>agrupamentos <b>{graph.stats.clusters}</b></span>
          <span>consultadas <b className="pink">{lastRecall?.ids.length ?? 0}</b></span>
          <span className={`lm-live ${live ? "on" : ""}`} title={live ? "Recebendo os eventos da memória ao vivo" : "Sem conexão com os eventos ao vivo"}>{live ? "ao vivo" : "sem conexão"}</span>
        </div>
        <nav className="lm-tabs" aria-label="Modo de visão">
          {MODES.map(([id, label]) => <button key={id} aria-pressed={mode === id} className={mode === id ? "on" : ""} onClick={() => { setMode(id); setFocusClusterId(null); setExpanded(new Set()); }}>{label}</button>)}
        </nav>
      </header>

      <ol className={`lm-steps ${turn ? "on" : ""}`} aria-label="O turno da Aurora agora">
        {STEPS.map(([id, label], i) => {
          const at = turn ? STEPS.findIndex(([x]) => x === turn.phase) : -1;
          const state = !turn ? "" : i < at || (turn.ended && i <= at) ? "done" : i === at ? "now" : "";
          const detail = !turn ? "" : id === "pergunta" ? turn.message : id === "busca" ? (turn.scanned.length ? `${turn.scanned.length} avaliadas · melhor ${turn.scanned[0].score.toFixed(2).replace(".", ",")}` : "") : id === "consulta" ? (turn.recalled.length ? `${turn.recalled.length} no contexto` : "") : turn.phase === "resposta" ? `usou ${turn.used.length} · criou ${turn.created.length}` : "";
          return <li key={id} className={state}><b>{String(i + 1).padStart(2, "0")} {label}</b><span>{detail || (turn ? "…" : "aguardando uma pergunta")}</span></li>;
        })}
      </ol>

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
          <button className="lm-btn" aria-pressed={activityMode} onClick={() => setActivityMode((v) => !v)} title="Seguir as memórias consultadas pela Aurora">atividade {activityMode ? "on" : "off"}</button>
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
        </> : <>
          <h1>{String(focusIndex || 0).padStart(2, "0")} {(focused?.label || "memória da aurora").toUpperCase()}</h1>
          <p>{focused ? `${focused.nodeIds.length} memórias · ${focused.sublabel}` : `${graph.stats.memories} memórias · ${graph.stats.clusters} agrupamentos`}</p>
        </>}
        </div>

        {graph.nodes.length === 0 ? (
          <div className="lm-state"><h2>{snap.memories.length ? "Nenhuma memória com esses filtros" : "Ainda não há memórias"}</h2><p>{snap.memories.length ? "Mude os filtros ou a busca." : "As memórias aparecem aqui assim que a Aurora guardar a primeira — em conversas, lições do professor ou importações."}</p></div>
        ) : gl ? (
          <Suspense fallback={<div className="lm-state"><p>Preparando o mapa…</p></div>}>
            <LiveMapScene graph={graph} layout={layout} settings={settings} selectedId={selectedId} hoveredId={hoveredId} focusClusterId={focusClusterId} expanded={expanded} highlights={highlights} camera={camera} agent={agent} keeper={keeper}
              onHover={setHoveredId} onSelect={(id) => { setSelectedId(id); if (id) setFocusClusterId(nodeById.get(id)?.clusterId || null); }} onCluster={focusCluster} onContextLost={() => setGl(false)} />
          </Suspense>
        ) : (
          <FallbackList graph={graph} onSelect={goTo} />
        )}
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
            </div>
          </aside>
        )}
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
            <h4>agrupamentos <span>{graph.stats.clusters}</span></h4>
            <ul className="lm-bars">
              {graph.clusters.slice(0, 8).map((c) => {
                const max = Math.max(...graph.clusters.map((x) => x.nodeIds.length));
                return <li key={c.id} className={c.id === focusClusterId ? "on" : ""}><button onClick={() => focusCluster(c.id, true)}><span>{c.label}</span><b>{c.nodeIds.length}</b><i style={{ width: `${(c.nodeIds.length / max) * 100}%`, background: CATEGORY_COLOR[c.category] }} /></button></li>;
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
            <h4>zeladora <span>{!keeper ? "—" : !keeper.enabled ? "desligada" : keeper.phase === "descansando" ? `descansa até ${keeper.restUntil ? fmtTime(keeper.restUntil) : "…"}` : keeper.phase}</span></h4>
            {!keeper ? <p className="lm-muted">A zeladora roda no app instalado e anda pelas memórias sozinha.</p> : <>
              <div className="lm-k-head"><b>{keeper.areaLabel || (keeper.phase === "descansando" ? "ronda completa" : "—")}</b><button className="lm-btn" onClick={() => void setKeeperEnabled(!keeper.enabled).then((k) => setKeeper((v) => (v ? { ...v, enabled: k.enabled } : v)))}>{keeper.enabled ? "desligar" : "ligar"}</button></div>
              <div className="lm-k-stats">
                <span><b>{keeper.stats.read}</b>lidas</span><span><b>{keeper.stats.linked}</b>ligadas</span><span><b>{keeper.stats.joined}</b>juntadas</span><span><b>{keeper.flags.length}</b>conflitos</span>
              </div>
              {keeper.areas.slice(0, 4).map((a) => <div key={a.key} className={`lm-k-area ${a.key === keeper.area ? "now" : ""}`} style={{ ["--p" as string]: `${a.total ? (a.read / a.total) * 100 : 0}%` }}><span>{a.label}</span><span>{a.read}/{a.total}</span><i /></div>)}
              {keeper.flags.slice(0, 2).map((f) => <div key={`${f.id}-${f.otherId}`} className="lm-k-item flag"><span title={f.reason}>⚑ {f.title || label(f.id)} · {f.reason}</span><button onClick={() => goTo(f.id)}>ver</button><button onClick={() => void dismissKeeperFlag(f.id, f.otherId).then(() => setKeeper((v) => (v ? { ...v, flags: v.flags.filter((x) => !(x.id === f.id && x.otherId === f.otherId)) } : v)))}>ok</button></div>)}
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
