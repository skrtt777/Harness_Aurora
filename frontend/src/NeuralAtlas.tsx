import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { CameraCommand } from "./MemoryScene";
import {
  createDemoMemories,
  groupColor,
  groupKey,
  importMemories,
  layoutMemories,
  linkMemories,
  memoryHealth,
  type Health,
  type Memory,
  type MemoryCluster,
  type MemoryKind,
  type MemoryScope,
} from "./data";
import { buildGraph, traceOrigin } from "./graph";
import { deleteMemory, getCentralMemories, getMemoryAtlas, getSystemVitals, listConversations, listMemories, listProjects, setMemoryStatus, updateMemory, type SystemVitals } from "./api";

const MemoryScene = lazy(() => import("./MemoryScene"));
const MemoryFlow = lazy(() => import("./MemoryFlow"));
const scopeLabels: Record<MemoryScope, string> = {
  central: "Central compartilhada",
  general: "Geral",
  project: "Projeto / pasta",
  conversation: "Conversa",
};
const relationLabels = {
  belonging: "Pertencimento",
  thematic: "Temática",
  derivation: "Derivação",
  correction: "Correção",
};
const storageKey = "aurora-memory-collection-v1";

function initialMemories() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return importMemories(JSON.parse(saved));
  } catch {
    /* A damaged saved collection does not break startup. */
  }
  return linkMemories(createDemoMemories(1000));
}

/**
 * Pulls the harness's real memory (the same store the chat reads and writes
 * to — see MemoryView.tsx) and reshapes it into the atlas's visual Memory
 * type. Real memories have no persisted 3D position, so positions are laid
 * out deterministically by id; relations, however, are the real ones
 * extracted by the backend (see app/memoryExtractor.js), not fabricated.
 * Returns [] when there is nothing real yet, so the caller can fall back to
 * the demo collection.
 */
async function loadRealMemoriesAsAtlas(): Promise<{ memories: Memory[]; clusters: MemoryCluster[] }> {
  const [entries, projects, conversations, shared, atlas] = await Promise.all([listMemories(), listProjects(), listConversations(), getCentralMemories('',500), getMemoryAtlas().catch(() => null)]);
  if (!entries.length && !shared.length) return { memories: [], clusters: [] };
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const conversationById = new Map(conversations.map((c) => [c.id, c]));
  // Archived memories stay in the database but leave the atlas (and the prompt).
  const mapped: Memory[] = entries.filter((entry) => entry.status !== "archived").map((entry) => {
    const conversation = entry.conversationId ? conversationById.get(entry.conversationId) : undefined;
    const projectId = entry.projectId || conversation?.projectId || undefined;
    return {
      id: entry.id,
      title: entry.title,
      content: entry.content,
      scope: entry.scope === "global" ? "general" : entry.scope,
      kind: "context",
      project: projectId ? projectNames.get(projectId) : undefined,
      conversation: conversation?.title,
      source: entry.source || (entry.kind === "extracted" ? "Extraído automaticamente pela IA" : "Memória manual"),
      date: new Date(entry.createdAt).toLocaleDateString("pt-BR"),
      tags: entry.tags,
      position: [0, 0, 0],
      relations: entry.relations ?? [],
      relationTypes: entry.relationTypes ?? {},
    };
  });
  mapped.push(...shared.map((m):Memory=>({id:m.id,title:m.title,content:m.content,tags:m.tags,scope:'central',kind:'context',source:m.source,date:new Date(m.updatedAt).toLocaleDateString('pt-BR'),position:[0,0,0],relations:[],relationTypes:{}})));
  // Meaning map from the backend: position by embedding, topic cluster, usage, neighbours.
  // Memories it doesn't cover (central cache, archived) keep the grouped layout.
  const placed = new Map((atlas?.memories ?? []).map((a) => [a.id, a]));
  const withMap = mapped.map((m): Memory => {
    const a = placed.get(m.id);
    return a ? { ...m, position: a.position, cluster: a.cluster, stats: a.stats, neighbors: a.neighbors, duplicates: a.duplicates } : m;
  });
  const missing = new Set(withMap.filter((m) => !placed.has(m.id)).map((m) => m.id));
  return { memories: layoutMemories(withMap, missing), clusters: atlas?.clusters ?? [] };
}

function downloadJSON(memories: Memory[]) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(memories, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "aurora-memorias.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Props = {
  /**
   * "real" loads and only ever shows the harness's actual memory (see
   * MemoryView.tsx) — never falls back to synthetic data. "test" is an
   * offline sandbox seeded with synthetic demo records (or a manually
   * imported/saved JSON collection); it never touches the real backend
   * memory. The two variants share every bit of visualization/filtering
   * logic below — only data loading and a handful of labels/actions differ.
   */
  variant: "real" | "test";
};

/**
 * The visual "memory atlas": a WebGL exploration of memory. In "real" mode
 * it loads the same real memory the chat reads and writes — see
 * MemoryView.tsx — via loadRealMemoriesAsAtlas() and never invents data. In
 * "test" mode it's a synthetic 1,000-record sandbox (or a saved/imported
 * JSON collection) that never writes back to the backend.
 */
export default function NeuralAtlas({ variant }: Props) {
  const [memories, setMemories] = useState<Memory[]>(() => (variant === "test" ? initialMemories() : []));
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [clusters, setClusters] = useState<MemoryCluster[]>([]),
    [health, setHealth] = useState<Health>("all"),
    [clusterFilter, setClusterFilter] = useState<number | null>(null),
    [editing, setEditing] = useState(false),
    [editDraft, setEditDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [railOpen, setRailOpen] = useState(false),
    [pulses, setPulses] = useState<Map<string, number>>(() => new Map()),
    [liveNote, setLiveNote] = useState(""),
    [vitals, setVitals] = useState<SystemVitals | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState<"all" | MemoryKind>("all"),
    [scope, setScope] = useState<"all" | MemoryScope>("all"),
    [project, setProject] = useState("all");
  const [cad, setCad] = useState(true),
    [wireframe, setWireframe] = useState(false),
    [orthographic, setOrthographic] = useState(false),
    [focus, setFocus] = useState(false),
    [view, setView] = useState<"map" | "flow" | "list">("map");
  const [motion, setMotion] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    [quality, setQuality] = useState<"low" | "high">("high"),
    [stats, setStats] = useState(""),
    [notice, setNotice] = useState(""),
    [page, setPage] = useState(0);
  const [command, setCommand] = useState<CameraCommand>({ serial: 0, view: "overview" });
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion(!media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        setFocus(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const graph = useMemo(() => buildGraph(memories), [memories]);
  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;
  const selected = graph.byId.get(selectedId || "");
  const origin = useMemo(() => traceOrigin(memories, selectedId), [memories, selectedId]);
  const topics = useMemo(() => [...new Set(memories.flatMap((m) => m.tags))].slice(0, 8), [memories]);
  const filtered = useMemo(
    () =>
      memories.filter(
        (m) =>
          (kind === "all" || m.kind === kind) &&
          (scope === "all" || m.scope === scope) &&
          (project === "all" || groupKey(m) === project) &&
          (clusterFilter === null || m.cluster === clusterFilter) &&
          (health === "all" ||
            (health === "helpful" && memoryHealth(m).helpful) ||
            (health === "unused" && memoryHealth(m).unused) ||
            (health === "failing" && memoryHealth(m).failing) ||
            (health === "duplicates" && memoryHealth(m).duplicate)) &&
          (!query ||
            `${m.title} ${m.content} ${m.project || ""} ${m.folder || ""} ${m.conversation || ""} ${m.tags.join(" ")}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase())),
      ),
    [memories, kind, scope, project, query, health, clusterFilter],
  );
  const healthCounts = useMemo(() => {
    const counts = { helpful: 0, unused: 0, failing: 0, duplicates: 0 };
    for (const m of memories) {
      const h = memoryHealth(m);
      if (h.helpful) counts.helpful++;
      if (h.unused) counts.unused++;
      if (h.failing) counts.failing++;
      if (h.duplicate) counts.duplicates++;
    }
    return counts;
  }, [memories]);
  const hasUsage = memories.some((m) => m.stats);
  useEffect(() => {
    setPage(0);
  }, [filtered]);
  useEffect(() => {
    if (selectedId && !filtered.some((m) => m.id === selectedId)) setSelectedId(null);
  }, [filtered, selectedId]);

  const demos = memories.filter((m) => m.kind === "demo").length;
  const contexts = memories.length - demos;
  const datasetLabel =
    memories.length === 0 ? "Coleção vazia" : demos === memories.length ? "Demonstração sintética" : demos ? "Coleção mista" : "Memórias de contexto";
  const camera = (view: CameraCommand["view"], id?: string) => setCommand((c) => ({ serial: c.serial + 1, view, id }));
  const select = (id: string) => { setSelectedId(id); setEditing(false); };
  const runAction = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      await syncRealMemory();
      setNotice(done);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  };
  const inspect = (id: string) => {
    setSelectedId(id);
    setView("map");
    setCad(true);
    camera("inspect", id);
  };
  const clearFilters = () => {
    setQuery("");
    setKind("all");
    setScope("all");
    setProject("all");
    setHealth("all");
    setClusterFilter(null);
  };
  const selectRelated = (id: string) => {
    clearFilters();
    setSelectedId(id);
  };
  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("O JSON deve ter no máximo 10 MB.");
      const next = importMemories(JSON.parse(await file.text()));
      setMemories(next);
      setSelectedId(null);
      clearFilters();
      camera("overview");
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        setNotice(`${next.length} memórias importadas e salvas neste navegador.`);
      } catch {
        setNotice("Coleção carregada. O armazenamento está cheio; exporte o JSON antes de fechar.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao importar JSON.");
    }
    e.target.value = "";
  };

  const syncGeneration = useRef(0);
  useEffect(() => () => { syncGeneration.current++; }, []);
  const syncRealMemory = useCallback(async () => {
    const generation = ++syncGeneration.current;
    setSyncing(true);
    try {
      const { memories: real, clusters: realClusters } = await loadRealMemoriesAsAtlas();
      if (generation !== syncGeneration.current) return;
      setMemories(real);
      setClusters(realClusters);
      setSelectedId(null);
      if (real.length) {
        setMemories(real);
        setConnected(true);
        setSelectedId(null);
        clearFilters();
        camera("overview");
        setNotice(`${real.length.toLocaleString("pt-BR")} memórias reais do harness carregadas.`);
      } else {
        setConnected(false);
        setNotice("Ainda não há memória real gerada. Converse no chat para começar a criá-la.");
      }
    } catch {
      setNotice("Não foi possível conectar à memória real agora. Confirme que a API local está rodando.");
    } finally {
      if (generation === syncGeneration.current) setSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (variant === "real") syncRealMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  // Live: while the Atlas is open, usage is re-read every few seconds; a memory
  // the chat just used pulses, without losing the selection or the filters.
  useEffect(() => {
    if (variant !== "real" || !connected) return;
    let stopped = false;
    const timer = setInterval(async () => {
      const atlas = await getMemoryAtlas().catch(() => null);
      if (!atlas || stopped) return;
      const fresh = new Map(atlas.memories.map((a) => [a.id, a]));
      const changed = (m: Memory) => { const a = fresh.get(m.id); return !!a && (a.stats.uses !== m.stats?.uses || a.stats.helped !== m.stats?.helped || a.stats.failed !== m.stats?.failed); };
      const used = memoriesRef.current.filter((m) => m.stats && (fresh.get(m.id)?.stats.uses ?? 0) > m.stats.uses);
      if (memoriesRef.current.some(changed)) setMemories((current) => current.map((m) => (changed(m) ? { ...m, stats: fresh.get(m.id)!.stats } : m)));
      if (used.length) {
        const now = performance.now();
        setPulses((previous) => { const next = new Map(previous); used.forEach((m) => next.set(m.id, now)); return next; });
        setLiveNote(`Usada agora: ${used[0].title}${used.length > 1 ? ` e mais ${used.length - 1}` : ""}`);
      }
    }, 8000);
    return () => { stopped = true; clearInterval(timer); };
  }, [variant, connected]);
  // Symbiosis: the PC's load and whether Aurora is thinking, read live.
  useEffect(() => {
    if (!connected) return;
    let stopped = false;
    const read = () => getSystemVitals().then((v) => { if (!stopped) setVitals(v); }).catch(() => {});
    read();
    const timer = setInterval(read, 1500);
    return () => { stopped = true; clearInterval(timer); };
  }, [connected]);
  useEffect(() => {
    if (!liveNote) return;
    const timer = setTimeout(() => setLiveNote(""), 6000);
    return () => clearTimeout(timer);
  }, [liveNote]);

  return (
    <div className={`shell aurora-atlas ${focus ? "focus-mode" : ""} ${railOpen ? "rail-open" : ""}`}>
      {railOpen && <div className="rail-backdrop" onClick={() => setRailOpen(false)} />}
      {!focus && (
        <aside className="rail">
          <div className="logo">
            <img className="atlas-symbol" src="/brand/aurora-symbol.png" alt="" />
            <div>
              <strong>Atlas Aurora</strong>
              <small>{variant === "test" ? "AMBIENTE DE TESTE" : "MEMÓRIA VISUAL · BETA"}</small>
            </div>
          </div>
          {variant === "real" ? (
            <div className={`atlas-disclaimer ${connected ? "connected" : ""}`}>
              {connected
                ? "Suas memórias e conexões reais. A central aparece em grupo separado (até 500 referências do cache)."
                : "Ainda não há memória real gerada. Converse no chat para começar a criá-la, ou visite a aba Teste para experimentar com dados sintéticos."}
            </div>
          ) : (
            <div className="atlas-disclaimer">
              Ambiente de teste — dados sintéticos, não afeta sua memória real.
            </div>
          )}
          <div className="rail-section">
            <label>EXPLORAR MEMÓRIA</label>
            <button
              className={`rail-link ${project === "all" && scope === "all" ? "active" : ""}`}
              onClick={() => {
                clearFilters();
                setView("map");
              }}
            >
              ◈ <span>Todas as memórias</span>
              <b>{memories.length.toLocaleString("pt-BR")}</b>
            </button>
            <button className={`rail-link ${scope === "general" ? "active" : ""}`} onClick={() => { setScope("general"); setProject("all"); }}>
              ⌁ <span>Contexto geral</span>
              <b>{memories.filter((m) => m.scope === "general").length}</b>
            </button>
          </div>
          <div className="rail-section">
            <label>PROJETOS E CONTEXTOS</label>
            {graph.groups.map((g) => (
              <button
                className={`rail-link ${project === g.label ? "active" : ""}`}
                key={g.id}
                onClick={() => {
                  clearFilters();
                  setProject(g.label);
                }}
              >
                <i style={{ background: g.color }} />
                <span>{g.label}</span>
                <b>{g.count}</b>
              </button>
            ))}
          </div>
          {hasUsage && (
            <div className="rail-section">
              <label>SAÚDE DA MEMÓRIA</label>
              {([
                ["helpful", "Ajudam", "#55a583"],
                ["unused", "Nunca usadas", "#5c6370"],
                ["failing", "Mais falham", "#e75e78"],
                ["duplicates", "Possíveis duplicadas", "#d6a24a"],
              ] as const).map(([id, label, color]) => (
                <button key={id} className={`rail-link ${health === id ? "active" : ""}`} onClick={() => { setHealth(health === id ? "all" : id); setView("map"); }}>
                  <i style={{ background: color }} />
                  <span>{label}</span>
                  <b>{healthCounts[id]}</b>
                </button>
              ))}
            </div>
          )}
          {clusters.length > 0 && (
            <div className="rail-section">
              <label>ASSUNTOS (POR SIGNIFICADO)</label>
              {clusters.filter((c) => c.id >= 0).sort((a, b) => b.count - a.count).map((c) => (
                <button key={c.id} className={`rail-link ${clusterFilter === c.id ? "active" : ""}`} onClick={() => setClusterFilter(clusterFilter === c.id ? null : c.id)}>
                  <span>{c.label}</span>
                  <b>{c.count}</b>
                </button>
              ))}
            </div>
          )}
          <div className="rail-section categories">
            <label>ASSUNTOS</label>
            <div className="topic-buttons">
              {topics.map((t) => (
                <button className={query === t ? "on" : ""} key={t} onClick={() => setQuery(query === t ? "" : t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="rail-bottom">
            <div className="demo-note">
              <span className="live-dot" /> {datasetLabel}
              <small>
                {contexts} contexto · {demos} demonstração
              </small>
            </div>
            {variant === "real" ? (
              <button className="export-button" onClick={syncRealMemory} disabled={syncing}>
                {syncing ? "…" : "↻"} Sincronizar memória real
              </button>
            ) : (
              <>
                <label className="import-button">
                  ↑ Importar JSON
                  <input type="file" accept="application/json,.json" onChange={importFile} />
                </label>
                <button className="export-button" onClick={() => downloadJSON(memories)}>
                  ↓ Exportar coleção
                </button>
              </>
            )}
          </div>
        </aside>
      )}
      <main className="main-panel">
        <header className="toolbar">
          <div className="search">
            <span>⌕</span>
            <input
              ref={searchRef}
              aria-label="Pesquisar memórias"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && filtered[0]) inspect(filtered[0].id); }}
              placeholder="Pesquisar memórias, projetos, decisões… (Enter vai até a primeira)"
            />
            <kbd>Ctrl K</kbd>
          </div>
          <div className="toolbar-actions">
            <button className="tool-button filters-toggle" aria-expanded={railOpen} onClick={() => setRailOpen(!railOpen)}>
              ☰ Filtros
            </button>
            <button onClick={() => setCad(!cad)} aria-pressed={cad} className={cad ? "tool-button on" : "tool-button"}>
              ⌗ CAD
            </button>
            <button className="tool-button" onClick={() => setFocus(!focus)}>
              ⛶ {focus ? "Sair do foco" : "Foco"}
            </button>
          </div>
        </header>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button aria-label="Fechar aviso" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}
        <section className="titlebar">
          <div>
            <div className="overline">
              EXPLORADOR NEURAL <span>/</span> {cad ? "ESTÚDIO CAD" : "VISÃO ESPACIAL"}
            </div>
            <h1>
              {variant === "test" ? (
                <>
                  Atlas de <span>Teste</span>
                </>
              ) : (
                <>
                  Atlas visual<span>3D</span>
                </>
              )}
            </h1>
            <p>
              {variant === "test"
                ? "Ambiente de testes com dados sintéticos — não afeta sua memória real."
                : "Sua memória real, explorada em 3D e 2D."}
            </p>
          </div>
          <div className="view-toggle">
            <button className={view === "map" ? "selected" : ""} onClick={() => setView("map")}>
              ◉ Mapa 3D
            </button>
            <button className={view === "flow" ? "selected" : ""} onClick={() => setView("flow")}>
              ⌗ Vizinhança
            </button>
            <button className={view === "list" ? "selected" : ""} onClick={() => setView("list")}>
              ☷ Lista
            </button>
          </div>
        </section>
        <div className="filterbar">
          <label>
            Origem
            <select aria-label="Filtrar origem" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="all">Todas</option>
              <option value="context">Contexto</option>
              <option value="demo">Demonstração</option>
            </select>
          </label>
          <label>
            Escopo
            <select aria-label="Filtrar escopo" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="all">Todos</option>
              {Object.entries(scopeLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Projeto
            <select aria-label="Filtrar projeto" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="all">Todos</option>
              {graph.groups.map((g) => (
                <option key={g.id}>{g.label}</option>
              ))}
            </select>
          </label>
          {(query || scope !== "all" || kind !== "all" || project !== "all" || health !== "all" || clusterFilter !== null) && (
            <button className="clear-filter" onClick={clearFilters}>
              Limpar filtros ×
            </button>
          )}
          <span className="result-count">
            {filtered.length.toLocaleString("pt-BR")} / {memories.length.toLocaleString("pt-BR")}
          </span>
        </div>
        {view === "map" ? (
          <div className="scene-wrap">
            <Suspense fallback={<div className="scene-fallback">Preparando a rede 3D…</div>}>
              <MemoryScene
                memories={filtered}
                allMemories={memories}
                clusters={clusters}
                pulses={pulses}
                vitals={vitals}
                onCluster={(id) => setClusterFilter(id)}
                selectedId={selectedId}
                onSelect={select}
                onFocus={inspect}
                onGroup={(key) => {
                  clearFilters();
                  setProject(key);
                }}
                cad={cad}
                wireframe={wireframe}
                orthographic={orthographic}
                motion={motion}
                quality={quality}
                command={command}
                onFallback={() => setView("list")}
                onStats={setStats}
              />
            </Suspense>
            <div className="scene-caption">
              <div className="overline">{selected ? "ESTRUTURA SELECIONADA" : "REDE DE CONTEXTOS"}</div>
              <strong>{selected?.title || (clusters.length ? `${clusters.filter((c) => c.id >= 0).length} assuntos · ${memories.length} memórias` : `${graph.groups.length} grupos · ${graph.edges.length} conexões`)}</strong>
              <small>
                {selected
                  ? clusters.find((c) => c.id === selected.cluster)?.label || groupKey(selected)
                  : clusters.length ? "Perto = assunto parecido · cores por projeto" : "Cores por projeto · agrupamento visual"}
              </small>
            </div>
            {liveNote && (
              <div className="live-note" role="status">
                <i className="live-dot" /> {liveNote}
              </div>
            )}
            {filtered.length === 0 && (
              <div className="no-results">
                <h2>Nenhuma memória encontrada</h2>
                <button onClick={clearFilters}>Limpar filtros</button>
              </div>
            )}
            <div className="view-presets" aria-label="Vistas da câmera">
              {(["overview", "front", "top", "side"] as const).map((preset, i) => (
                <button key={preset} onClick={() => camera(preset, selectedId || undefined)} title={["Vista isométrica", "Vista frontal", "Vista superior", "Vista lateral"][i]}>
                  {["ISO", "FRENTE", "TOPO", "LADO"][i]}
                </button>
              ))}
            </div>
            <div className="scene-legend">
              <span>
                <i style={{ background: "#75eaff" }} /> Maior = ajudou mais vezes
              </span>
              <span>
                <i style={{ background: "#3b4048" }} /> Apagada = nunca usada
              </span>
              <span>
                <i style={{ background: "#e75e78" }} /> Vermelha = mais falha que ajuda
              </span>
              <small>Linhas ligam memórias parecidas</small>
            </div>
            <div className="scene-controls">
              <button aria-pressed={orthographic} onClick={() => setOrthographic(!orthographic)}>
                {orthographic ? "Ortográfica" : "Perspectiva"}
              </button>
              <button aria-pressed={wireframe} onClick={() => setWireframe(!wireframe)}>
                Wireframe
              </button>
              <button aria-pressed={motion} onClick={() => setMotion(!motion)}>
                {motion ? "Pausar" : "Animar"}
              </button>
              <button
                onClick={() => {
                  setSelectedId(null);
                  camera("overview");
                }}
              >
                Visão geral
              </button>
            </div>
          </div>
        ) : view === "flow" ? (
          <Suspense fallback={<div className="scene-fallback">Preparando o fluxograma…</div>}>
            <MemoryFlow memories={filtered} allMemories={memories} clusters={clusters} selectedId={selectedId} onSelect={select} />
          </Suspense>
        ) : (
          <div className="list-view">
            <div className="list-table-head">
              <span>MEMÓRIA / CONTEÚDO</span>
              <span>ESCOPO</span>
            </div>
            {filtered.slice(page * 100, (page + 1) * 100).map((m) => (
              <button key={m.id} onClick={() => select(m.id)} className={m.id === selectedId ? "list-row selected" : "list-row"}>
                <span className="list-node" style={{ background: groupColor(groupKey(m)) }} />
                <span>
                  <strong>{m.title}</strong>
                  <small>{m.content}</small>
                </span>
                <em>{scopeLabels[m.scope]}</em>
              </button>
            ))}
            {!filtered.length && <div className="list-empty">Nenhuma memória encontrada.</div>}
            <div className="pagination">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </button>
              <span>
                Página {page + 1} de {Math.max(1, Math.ceil(filtered.length / 100))}
              </span>
              <button disabled={(page + 1) * 100 >= filtered.length} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </button>
            </div>
          </div>
        )}
        <div className="statusline">
          <span>
            <i className="live-dot" /> {datasetLabel}
          </span>
          {view === "map" && (
            <>
              <span className="mouse-help">Arraste: girar · Shift: mover · Scroll: zoom</span>
              <label>
                Qualidade{" "}
                <select aria-label="Qualidade gráfica" value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
                  <option value="high">Alta</option>
                  <option value="low">Leve</option>
                </select>
              </label>
            </>
          )}
        </div>
      </main>
      {!focus && (
        <aside className={`inspector ${selected ? "has-selection" : ""}`}>
          <div className="inspector-head">
            <div>
              <span className="overline">INSPEÇÃO DA MEMÓRIA</span>
              <h2>{selected ? "Memória selecionada" : "Explore uma conexão"}</h2>
            </div>
            {selected && (
              <button aria-label="Fechar inspeção" onClick={() => setSelectedId(null)}>
                ×
              </button>
            )}
          </div>
          {selected ? (
            <>
              <div className="detail-hero" style={{ borderColor: groupColor(groupKey(selected)) }}>
                <img className="detail-symbol atlas-symbol" src="/brand/aurora-symbol.png" alt="" />
                <strong>{selected.title}</strong>
                <small>{variant === "real" ? "MEMÓRIA REAL" : selected.kind === "demo" ? "DEMONSTRAÇÃO SINTÉTICA" : "CONTEXTO IMPORTADO"}</small>
              </div>
              <div className="detail-body">
                <p>{selected.content}</p>
                <dl>
                  <dt>Escopo</dt>
                  <dd>{scopeLabels[selected.scope]}</dd>
                  <dt>Projeto / pasta</dt>
                  <dd>{selected.folder || selected.project || "—"}</dd>
                  <dt>Conversa</dt>
                  <dd>{selected.conversation || "—"}</dd>
                  <dt>Fonte</dt>
                  <dd>{selected.source || "Não informada"}</dd>
                  {selected.date && (
                    <>
                      <dt>Data</dt>
                      <dd>{selected.date}</dd>
                    </>
                  )}
                  {selected.cluster !== undefined && selected.cluster >= 0 && (
                    <>
                      <dt>Assunto</dt>
                      <dd>{clusters.find((c) => c.id === selected.cluster)?.label}</dd>
                    </>
                  )}
                </dl>
                {selected.stats && (
                  <div className="usage">
                    <div className="usage-numbers">
                      <span><b>{selected.stats.uses}</b> usos</span>
                      <span className="ok"><b>{selected.stats.helped}</b> ajudou</span>
                      <span className="bad"><b>{selected.stats.failed}</b> falhou</span>
                    </div>
                    <div className="usage-bar" aria-hidden="true">
                      <i className="ok" style={{ flex: selected.stats.helped }} />
                      <i className="bad" style={{ flex: selected.stats.failed }} />
                      <i style={{ flex: Math.max(0, selected.stats.uses - selected.stats.helped - selected.stats.failed) || (selected.stats.uses ? 0 : 1) }} />
                    </div>
                    <small>
                      {memoryHealth(selected).failing ? "Esta memória mais atrapalha do que ajuda: considere editar ou arquivar."
                        : memoryHealth(selected).unused ? "Ainda não entrou em nenhuma resposta."
                          : memoryHealth(selected).helpful ? "Esteve em respostas que deram certo." : "Usada em respostas, sem veredito do professor."}
                    </small>
                  </div>
                )}
                {(selected.duplicates?.length ?? 0) > 0 && (
                  <p className="duplicate-warning">Quase igual a {selected.duplicates!.length === 1 ? "outra memória" : `${selected.duplicates!.length} memórias`}: veja em Parecidas e arquive a repetida.</p>
                )}
                {variant === "real" && selected.scope !== "central" && (
                  editing ? (
                    <div className="memory-edit-inline">
                      <textarea rows={5} value={editDraft} onChange={(e) => setEditDraft(e.target.value)} aria-label="Conteúdo da memória" />
                      <div>
                        <button disabled={busy} onClick={() => setEditing(false)}>Cancelar</button>
                        <button className="primary" disabled={busy || !editDraft.trim()} onClick={() => void runAction(async () => { await updateMemory(selected.id, { content: editDraft }); setEditing(false); }, "Memória atualizada.")}>Salvar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="memory-actions-inline">
                      <button disabled={busy} onClick={() => { setEditDraft(selected.content); setEditing(true); }}>Editar</button>
                      <button disabled={busy} onClick={() => void runAction(() => setMemoryStatus(selected.id, "archived").then(() => undefined), "Memória arquivada: sai das respostas e do mapa, mas não é apagada.")}>Arquivar</button>
                      <button disabled={busy} className="danger" onClick={() => { if (confirm(`Excluir "${selected.title}"? Esta ação não pode ser desfeita.`)) void runAction(() => deleteMemory(selected.id).then(() => undefined), "Memória excluída."); }}>Excluir</button>
                    </div>
                  )
                )}
                <div className="tags">
                  {selected.tags.map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                </div>
                <button className="inspect-button" onClick={() => inspect(selected.id)}>
                  ◎ Inspecionar em 3D
                </button>
                {(selected.neighbors?.length ?? 0) > 0 && (
                  <div className="related">
                    <label>
                      PARECIDAS <b>{selected.neighbors!.length}</b>
                    </label>
                    {selected.neighbors!.map((n) => {
                      const r = graph.byId.get(n.id);
                      return r && (
                        <button key={`n:${n.id}`} onClick={() => selectRelated(n.id)}>
                          <i />
                          {r.title}
                          <small>{Math.round(n.similarity * 100)}% parecida{selected.duplicates?.includes(n.id) ? " · duplicada?" : ""}</small>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="related">
                  <label>
                    REDE DE ORIGEM <b>{origin.order.length}</b>
                  </label>
                  {origin.order.length > 1 ? (
                    <>
                      <small>Relações de pertencimento e derivação.</small>
                      {origin.order.map((m, i) => (
                        <button key={m.id} onClick={() => selectRelated(m.id)}>
                          <em>{i === 0 ? "●" : "↳"}</em>
                          {m.title}
                        </button>
                      ))}
                    </>
                  ) : (
                    <p>Nenhuma origem vinculada a este registro.</p>
                  )}
                </div>
                <div className="related">
                  <label>
                    RELAÇÕES DIRETAS <b>{selected.relations.length + (graph.incoming.get(selected.id)?.length || 0)}</b>
                  </label>
                  {selected.relations.map((id) => {
                    const r = graph.byId.get(id);
                    return (
                      r && (
                        <button key={`out:${id}`} onClick={() => selectRelated(id)}>
                          <i />
                          {r.title}
                          <small>→ {relationLabels[selected.relationTypes?.[id] || "thematic"]}</small>
                        </button>
                      )
                    );
                  })}
                  {graph.incoming.get(selected.id)?.map((edge) => (
                    <button key={edge.key} onClick={() => selectRelated(edge.from.id)}>
                      <i />
                      {edge.from.title}
                      <small>← {relationLabels[edge.type]}</small>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="empty-inspector">
                <div className="empty-glyph"><img className="atlas-symbol" src="/brand/aurora-symbol.png" alt="" /></div>
                <h3>Uma rede que você pode explorar.</h3>
                <p>Clique em uma memória para ver seu conteúdo, origem e conexões.</p>
                <small>Duplo clique aproxima a memória.</small>
              </div>
              <div className="anatomy-guide">
                <div className="overline">COMO LER O MAPA</div>
                <p>
                  <b>01</b> Posição <span>Memórias perto falam de assuntos parecidos</span>
                </p>
                <p>
                  <b>02</b> Tamanho e brilho <span>Maior = ajudou mais; apagada = nunca usada</span>
                </p>
                <p>
                  <b>03</b> Linhas <span>Ligam as memórias mais parecidas</span>
                </p>
                <p>
                  <b>04</b> Você · Aurora · Este PC <span>A energia corre de cada um às memórias que vieram dele: acelera quando você mexe no mapa, quando a Aurora pensa e com a carga real do PC</span>
                </p>
                <small>Use Saúde da memória, à esquerda, para achar as que nunca são usadas, as que atrapalham e as repetidas.</small>
              </div>
            </>
          )}
          <div className="performance">
            <span className="overline">RENDERIZAÇÃO LOCAL</span>
            <small>
              {view === "map"
                ? motion
                  ? stats || "Medindo a cena…"
                  : "Animação pausada · renderização sob demanda"
                : view === "flow"
                  ? `${graph.groups.length} grupos · ${graph.edges.length} conexões`
                  : "Visualização em lista"}
            </small>
          </div>
        </aside>
      )}
    </div>
  );
}
