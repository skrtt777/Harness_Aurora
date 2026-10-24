import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dismissKeeperFlag, getMemoryGraph, setKeeperEnabled, subscribeMemoryEvents, undoKeeperJoin, visitKeeper, type MemoryGraphSnapshot, type MemoryLiveEvent, type ModelSpeedSample } from "../api";
import { applyEvent, buildMemoryGraph, keeperFromSnapshot, reduceKeeper, reduceTurn, reviewOf, sectionProgress, type GraphCluster, type KeeperView, type TurnPhase, type TurnState, CATEGORY_COLOR, CATEGORY_LABEL, newFrozenAtlas, searchIds, steadyAtlas, type Category, type Filters, type ViewMode } from "./adapter";
import { categoryColor } from "./chip";
import { auroraChipSource, clusterOrder, mockChipSource } from "./chipSources";
import type { ChipCommand } from "./MemoryChip";
import ChatDock from "./ChatDock";
import "./livemap.css";

const MemoryChip = lazy(() => import("./MemoryChip"));

/**
 * Memórias / Mapa Vivo: the Aurora's memory as a silicon chip (MemoryChip.tsx: a nucleus per group, a cell per
 * memory, six levels of zoom down to each memory's embedding) on an instrument panel. Every cell is a stored
 * memory, every nucleus a real grouping, every light and packet a real event (a search, a memory used in an
 * answer, the Zeladora at work); every number on the panel is counted from the memories and the live events. The
 * modes (geral / pasta / conversa), the filters, the search, the chat and the node tabs all drive the chip. No demo
 * data unless asked for ("simular"): with nothing stored, the map says so.
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

type Props = { onOpenConversation?: (id: string) => void; onOpenMemory?: () => void };

export default function LiveMapView({ onOpenConversation, onOpenMemory }: Props) {
  const [snap, setSnap] = useState<MemoryGraphSnapshot | null>(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [mode, setMode] = useState<ViewMode>("geral");
  const [filters, setFilters] = useState<Filters>({});
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusClusterId, setFocusClusterId] = useState<string | null>(null);
  const [command, setCommand] = useState<ChipCommand>(null);
  const [events, setEvents] = useState<MemoryLiveEvent[]>([]);
  // The local model's speed, call by call (its own stream: many calls per answer, they would flood the log).
  const [speed, setSpeed] = useState<ModelSpeedSample[]>([]);
  const [callNote, setCallNote] = useState("");
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem("aurora-livemap-panels") !== "closed"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("aurora-livemap-panels", panelOpen ? "open" : "closed"); } catch { /* private mode */ } }, [panelOpen]);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [keeper, setKeeper] = useState<KeeperView | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [, setDockConversation] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);

  // The semantic atlas held steady for the session (adapter.steadyAtlas): a new memory joins its neighbours'
  // cluster instead of the server's re-clustering moving every group. "Reorganizar" starts it over.
  const frozen = useRef(newFrozenAtlas());
  const steady = useCallback((s: MemoryGraphSnapshot) => ({ ...s, atlas: steadyAtlas(s.atlas, frozen.current) }), []);
  const load = useCallback(() => getMemoryGraph().then((s) => { setSnap(steady(s)); setSpeed((old) => (old.length ? old : s.speed?.calls || [])); setKeeper((k) => { const base = keeperFromSnapshot(s.keeper); return !k || !base ? k || base : { ...base, current: k.current ?? base.current, trail: k.trail.length ? k.trail : base.trail, links: k.links, flags: k.flags.length > base.flags.length ? k.flags : base.flags, growth: k.growth, prunes: k.prunes.length > base.prunes.length ? k.prunes : base.prunes }; }); setError(""); setEvents((old) => (old.length ? old : s.events)); }).catch((e: Error) => setError(e.message)), [steady]);
  useEffect(() => { void load(); }, [load]);
  const quietRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => { void getMemoryGraph().then((s) => setSnap(steady(s))).catch(() => {}); }, 1500);
  }, [steady]);

  // ---------- The chip's source: the real memory seen through this page's mode and filters (or a simulation) ----------
  const [chipMock, setChipMock] = useState(false);
  const viewRef = useRef({ mode, filters }); viewRef.current = { mode, filters };
  const chipSource = useMemo(() => (chipMock
    ? mockChipSource(Number(new URLSearchParams(window.location.search).get("chipmock")) || 240)
    : auroraChipSource({ load: () => getMemoryGraph().then(steady), view: () => viewRef.current })), [chipMock, steady]);
  // Another mode or other filters: the chip regroups (quietly: nothing was written or forgotten).
  const firstView = useRef(true);
  useEffect(() => { if (firstView.current) { firstView.current = false; return; } chipSource.resync?.(); }, [mode, filters, chipSource]);
  const reorganize = useCallback(() => { frozen.current = newFrozenAtlas(); void load().then(() => chipSource.resync?.()); }, [load, chipSource]);

  // ---------- Live events: the turn, the Zeladora, the log (the chip listens on its own) ----------
  const snapRef = useRef(snap); snapRef.current = snap;
  useEffect(() => subscribeMemoryEvents((event) => {
    if (event.type === "hello") return;
    if (event.type === "speed") { setSpeed((old) => [...old, event as unknown as ModelSpeedSample].slice(-40)); return; }
    setEvents((old) => [event, ...old].slice(0, 80));
    setTurn((t) => reduceTurn(t, event));
    if (event.type === "keeper") setKeeper((k) => reduceKeeper(k, event));
    const current = snapRef.current;
    if (current) {
      const { snapshot, needsRefresh } = applyEvent(current, event);
      if (snapshot !== current) setSnap(snapshot);
      if (needsRefresh) quietRefresh();
    }
  }, setLive), [quietRefresh]);

  const label = useCallback((id?: string) => (id ? nodeByIdRef.current.get(id)?.label || id.slice(0, 8) : ""), []);
  const keeperLine = (e: MemoryLiveEvent) =>
    e.action === "read" ? `${label(e.id)}${e.kind ? ` · ${e.kind}` : ""}` : e.action === "compact" ? `${e.merged?.length || 0} memórias → ${e.title || label(e.id)}` : e.action === "link" ? `${label(e.from)} ↔ ${label(e.to)}` : e.action === "join" ? `${e.archivedTitle || "cópia"} → ${e.title || label(e.kept)}`
      : e.action === "prune" ? `${e.title || "memória"} · ${e.reason || "obsoleta"}` : e.action === "arrival" ? `${e.title || label(e.id)}` : e.action === "adopt" ? `${e.title || label(e.id)} → ${e.label || "nódulo"}`
      : e.action === "plant" ? `${e.nodes?.length || 0} nódulos` : e.action === "node-born" ? `${e.label} · ${e.members || 0} memórias${e.parentLabel ? ` · saiu de ${e.parentLabel}` : " · assunto novo"}` : e.action === "node-gone" ? `${e.label}${e.intoLabel ? ` → ${e.intoLabel}` : " · vazio"}`
      : e.action === "flag" ? `${e.title || label(e.id)} · ${e.reason || ""}` : e.action === "walk" ? `${e.label} · ${e.total} memórias` : e.action === "called" ? `${e.label || "a seu pedido"} · ${e.total || 0} memórias` : e.action === "rest" ? "ronda completa" : e.action === "round" ? `ronda ${e.round} · ${e.total} memórias` : e.reason || "";

  // ---------- Graph (only when the data, the mode or the filters change) ----------
  const graph = useMemo(() => (snap ? buildMemoryGraph(snap, { mode, filters }) : null), [snap, mode, filters]);
  // The nuclei in the chip's order (biggest first): the instruments use the same order and colours.
  const ordered = useMemo(() => (graph ? clusterOrder(graph) : []), [graph]);
  const colorOf = useCallback((id: string | null | undefined) => { const i = ordered.findIndex((c) => c.id === id); return i >= 0 ? categoryColor(i) : "#d7dde6"; }, [ordered]);
  const nodeById = useMemo(() => new Map((graph?.nodes || []).map((n) => [n.id, n])), [graph]);
  const nodeByIdRef = useRef(nodeById); nodeByIdRef.current = nodeById;
  const convTitle = useMemo(() => new Map((snap?.conversations || []).map((c) => [c.id, c.title])), [snap]);

  // Search: what it finds is ringed on the chip; Enter goes to the best one.
  const results = useMemo(() => (graph && query.trim() ? searchIds(graph, query) : []), [graph, query]);
  const goTo = useCallback((id: string) => { setSelectedId(id); setFocusClusterId(nodeById.get(id)?.clusterId || null); setCommand({ kind: "memory", id, key: Date.now() }); }, [nodeById]);
  const focusCluster = useCallback((id: string) => { setFocusClusterId(id); setCommand({ kind: "nucleus", id, key: Date.now() }); }, []);

  // Keyboard: "/" search (the chip has its own keys: Enter, Esc, + / −, arrows).
  const searchRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") { if (e.key === "Escape") (e.target as HTMLElement).blur(); return; }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const focused = focusClusterId ? graph?.clusters.find((c) => c.id === focusClusterId) || null : null;
  // The sections (one per thought) as the Zeladora goes through them.
  const sections = useMemo(() => (graph ? sectionProgress(graph, keeper) : new Map()), [graph, keeper]);
  // Call her: "come and organize these memories now" (a section, or one memory).
  const callKeeper = (ids: string[], label: string) => {
    setCallNote("");
    void visitKeeper(ids, label).then((r) => setCallNote(`zeladora a caminho: ${r.queued} memórias`)).catch((e: Error) => setCallNote(e.message));
  };
  const keeperCluster = keeper?.current && graph ? graph.clusters.find((c) => c.nodeIds.includes(keeper.current!)) || null : null;
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

  // What the chip's card can also do with a memory (it is the Aurora's: its conversation, the Memória view, the Zeladora).
  const extraActions = useCallback((id: string) => {
    const n = nodeByIdRef.current.get(id); if (!n) return null;
    return <>
      {n.memory.conversationId && onOpenConversation && <button onClick={() => onOpenConversation(n.memory.conversationId!)}>abrir conversa de origem</button>}
      {onOpenMemory && <button onClick={onOpenMemory}>ver na memória</button>}
      {keeper?.enabled && graph && <button onClick={() => callKeeper([id, ...(graph.clusters.find((c) => c.id === n.clusterId)?.nodeIds.filter((x) => x !== id).slice(0, 11) || [])], n.memory.title)}>chamar a zeladora aqui</button>}
      {callNote && <small className="lm-muted">{callNote}</small>}
    </>;
  }, [onOpenConversation, onOpenMemory, keeper?.enabled, graph, callNote]);

  if (error && !snap) return <section className="livemap"><div className="lm-state"><h2>Mapa Vivo indisponível</h2><p>{error}</p><button className="lm-btn" onClick={() => void load()}>Tentar de novo</button></div></section>;
  if (!snap || !graph) return <section className="livemap"><div className="lm-state"><p>Carregando as memórias…</p></div></section>;

  // The section the tabs light: the Zeladora's while she reads, else the one in focus.
  const titleCluster = turn && !turn.ended ? null : !focused && keeperCluster && keeper?.phase === "andando" ? keeperCluster : focused;
  const perMinute = events.filter((e) => Date.now() - Date.parse(e.at) < 60_000).length;

  return (
    <section className="livemap" aria-label="Mapa Vivo de Memórias">
      <header className="lm-top">
        <div className="lm-head">
          <b>MEMÓRIA <span>aurora</span></b>
          <nav className="lm-tabs" aria-label="Modo de visão">
            {MODES.map(([id, label]) => <button key={id} aria-pressed={mode === id} className={mode === id ? "on" : ""} onClick={() => { setMode(id); setFocusClusterId(null); }}>{label}</button>)}
          </nav>
          <div className="lm-metrics" aria-label="Indicadores">
            <span>memórias <b>{graph.stats.memories}</b></span>
            <span>nódulos <b>{ordered.length}</b></span>
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
        <SectionTabs ordered={ordered} sections={sections} active={titleCluster?.id || null} focusClusterId={focusClusterId} onPick={focusCluster} />
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
          <button className="lm-btn" onClick={reorganize} title="Refazer os agrupamentos semânticos com todas as memórias de agora">reorganizar</button>
          <button className="lm-btn" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void stageRef.current?.requestFullscreen?.(); }} title="O chip na tela inteira (Esc sai)">tela cheia</button>
        </div>
      </div>

      <div className="lm-stage" ref={stageRef}>
        {graph.nodes.length === 0 && !chipMock ? (
          <div className="lm-state"><h2>{snap.memories.length ? "Nenhuma memória com esses filtros" : "Ainda não há memórias"}</h2><p>{snap.memories.length ? "Mude os filtros ou a busca." : "As memórias aparecem aqui assim que a Aurora guardar a primeira — em conversas, lições do professor ou importações."}</p><button className="lm-btn" onClick={() => setChipMock(true)}>ver uma simulação</button></div>
        ) : (
          <Suspense fallback={<div className="lm-state"><p>Preparando o chip…</p></div>}>
            <MemoryChip source={chipSource} onSwitchSource={() => setChipMock((m) => !m)} inset={dockOpen ? 372 : 0} command={command} highlight={results.slice(0, 200)}
              extraActions={chipMock ? undefined : extraActions} onSelect={(id) => { setSelectedId(id); if (id) setFocusClusterId(nodeByIdRef.current.get(id)?.clusterId || null); }} />
          </Suspense>
        )}
        <ChatDock open={dockOpen} onToggle={() => setDockOpen((v) => !v)} onGoTo={goTo} onConversation={setDockConversation} projectId={filters.projectId || null} />
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
            <h4>nódulos <span>{ordered.length}{keeper?.enabled ? ` · ${[...sections.values()].filter((x) => x.state === "feito").length} feitos` : ""}</span></h4>
            <ul className="lm-bars lm-sections">
              {ordered.slice(0, 9).map((c, ci) => {
                const sec = sections.get(c.id);
                const share = sec ? (sec.total ? sec.read / sec.total : 0) : 1;
                return <li key={c.id} className={`${c.id === focusClusterId ? "on" : ""} ${sec?.state === "lendo" ? "reading" : sec?.state === "na fila" ? "queued" : ""}`}><button onClick={() => focusCluster(c.id)}><span>{c.label}</span><b>{sec ? `${sec.read}/${sec.total}` : c.nodeIds.length}</b><i style={{ width: `${Math.max(share * 100, sec ? 0 : 4)}%`, background: categoryColor(ci) }} /></button>{keeper?.enabled && <button className="lm-call-mini" title={`Chamar a zeladora para organizar “${c.label}” agora`} aria-label={`Chamar a zeladora para ${c.label}`} onClick={() => callKeeper(c.nodeIds, c.label)}>⌖</button>}</li>;
              })}
            </ul>
          </div>
          <div className="lm-panel">
            <h4>cobertura <span>{keeper?.enabled ? "lidas na ronda" : "comprovadas"}</span></h4>
            <Coverage ordered={ordered} graph={graph} sections={sections} keeperOn={Boolean(keeper?.enabled)} active={titleCluster?.id || null} />
          </div>
          <div className="lm-panel">
            <h4>calor <span>{graph.stats.memories}</span></h4>
            <Heat ordered={ordered} graph={graph} sections={sections} keeperOn={Boolean(keeper?.enabled)} />
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
            <KeeperCode keeper={keeper} nodes={ordered.length} where={keeperCluster?.label || null} />
          </div>
          <div className="lm-panel lm-keeper">
            <h4>revisão <span>{!keeper ? "—" : !keeper.running ? "não roda aqui" : !keeper.enabled ? "desligada" : keeper.phase === "descansando" ? `descansa até ${keeper.restUntil ? fmtTime(keeper.restUntil) : "…"}` : keeper.saying?.text || keeper.phase}</span></h4>
            {!keeper ? <p className="lm-muted">A zeladora roda no app instalado e anda pelas memórias sozinha.</p> : <>
              <div className="lm-k-head"><b>{keeper.areaLabel || (keeper.phase === "descansando" ? "ronda completa" : "—")}</b><button className="lm-btn" onClick={() => void setKeeperEnabled(!keeper.enabled).then((k) => setKeeper((v) => (v ? { ...v, enabled: k.enabled } : v)))}>{keeper.enabled ? "desligar" : "ligar"}</button></div>
              <div className="lm-k-stats">
                <span><b>{keeper.nodes.length || ordered.length}</b>nódulos</span><span><b>{keeper.stats.born}</b>nasceram</span><span><b>{keeper.stats.folded}</b>recolhidos</span><span><b>{keeper.stats.compacted + keeper.stats.joined}</b>juntadas</span>
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
function SectionTabs({ ordered, sections, active, focusClusterId, onPick }: { ordered: GraphCluster[]; sections: Sections; active: string | null; focusClusterId: string | null; onPick: (id: string) => void }) {
  const tabs = ordered.slice(0, 12);
  if (tabs.length < 2) return null;
  return (
    <nav className="lm-sectabs" aria-label="Nódulos da memória">
      {tabs.map((cl, i) => {
        const c = cl;
        const s = sections.get(c.id);
        const on = c.id === active || c.id === focusClusterId;
        return (
          <button key={c.id} className={`${on ? "on" : ""} ${s?.state === "feito" ? "done" : ""}`} style={{ ["--c" as string]: categoryColor(i), ["--p" as string]: `${s && s.total ? (100 * s.read) / s.total : 0}%` }} onClick={() => onPick(c.id)} title={`${cl.label} · ${cl.nodeIds.length} memórias`}>
            {cl.label}
          </button>
        );
      })}
    </nav>
  );
}

/** The coverage radar: one axis per section (the biggest seven), how much of each is read / proven. */
function Coverage({ ordered, graph, sections, keeperOn, active }: { ordered: GraphCluster[]; graph: Graph; sections: Sections; keeperOn: boolean; active: string | null }) {
  const axes = ordered.slice(0, 7);
  if (axes.length < 3) return <p className="lm-muted">Poucos nódulos para o radar.</p>;
  const vals = axes.map((c) => shareOf(graph, c.id, sections, keeperOn));
  const pt = (i: number, r: number) => { const a = -Math.PI / 2 + (i / axes.length) * Math.PI * 2; return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r]; };
  const poly = vals.map((v, i) => pt(i, 4 + v * 36).join(",")).join(" ");
  const ai = ordered.findIndex((c) => c.id === active), color = ai >= 0 ? categoryColor(ai) : "#9fb0c4";
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
function Heat({ ordered, graph, sections, keeperOn }: { ordered: GraphCluster[]; graph: Graph; sections: Sections; keeperOn: boolean }) {
  const rows = ordered.slice(0, 7);
  return (
    <div className="lm-heat" role="img" aria-label="Calor por nódulo">
      {rows.map((c, ci) => {
        const v = shareOf(graph, c.id, sections, keeperOn);
        const filled = Math.round(v * 12);
        return <div key={c.id}><span>{short3(graph.clusters.find((g) => g.id === c.id)?.label || "")}</span>{Array.from({ length: 12 }, (_, k) => <i key={k} style={k < filled ? { background: categoryColor(ci) } : undefined} />)}</div>;
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
