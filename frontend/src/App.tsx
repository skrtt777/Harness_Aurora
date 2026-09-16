import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type { CameraCommand } from "./MemoryScene";
import {
  createDemoMemories,
  groupColor,
  groupKey,
  importMemories,
  linkMemories,
  type Memory,
  type MemoryKind,
  type MemoryScope,
} from "./data";
import { buildGraph, traceOrigin } from "./graph";
import {
  addMessage,
  loadConversations,
  newConversation,
  saveConversations,
  type Conversation,
} from "./history";
const MemoryScene = lazy(() => import("./MemoryScene"));
const scopeLabels: Record<MemoryScope, string> = {
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
function downloadJSON(memories: Memory[]) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(memories, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "aurora-memorias.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function App() {
  const [memories, setMemories] = useState<Memory[]>(initialMemories);
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState<"all" | MemoryKind>("all"),
    [scope, setScope] = useState<"all" | MemoryScope>("all"),
    [project, setProject] = useState("all");
  const [cad, setCad] = useState(true),
    [wireframe, setWireframe] = useState(false),
    [orthographic, setOrthographic] = useState(false),
    [focus, setFocus] = useState(false),
    [view, setView] = useState<"map" | "list">("map");
  const [motion, setMotion] = useState(
      () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [quality, setQuality] = useState<"low" | "high">("high"),
    [stats, setStats] = useState(""),
    [notice, setNotice] = useState(""),
    [page, setPage] = useState(0);
  const [command, setCommand] = useState<CameraCommand>({
    serial: 0,
    view: "overview",
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const [conversations, setConversations] = useState<Conversation[]>(() => {
      const items = loadConversations();
      return items.length ? items : [newConversation()];
    }),
    [activeConversationId, setActiveConversationId] = useState(""),
    [chatOpen, setChatOpen] = useState(false),
    [draft, setDraft] = useState(""),
    [sending, setSending] = useState(false);
  useEffect(() => {
    if (!activeConversationId && conversations[0])
      setActiveConversationId(conversations[0].id);
    try {
      saveConversations(conversations);
    } catch {
      setNotice("O navegador não conseguiu salvar o histórico.");
    }
  }, [conversations, activeConversationId]);
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
  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ||
    conversations[0];
  const graph = useMemo(() => buildGraph(memories), [memories]);
  const selected = graph.byId.get(selectedId || "");
  const origin = useMemo(
    () => traceOrigin(memories, selectedId),
    [memories, selectedId],
  );
  const topics = useMemo(
    () => [...new Set(memories.flatMap((m) => m.tags))].slice(0, 8),
    [memories],
  );
  const filtered = useMemo(
    () =>
      memories.filter(
        (m) =>
          (kind === "all" || m.kind === kind) &&
          (scope === "all" || m.scope === scope) &&
          (project === "all" || groupKey(m) === project) &&
          (!query ||
            `${m.title} ${m.content} ${m.project || ""} ${m.folder || ""} ${m.conversation || ""} ${m.tags.join(" ")}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase())),
      ),
    [memories, kind, scope, project, query],
  );
  useEffect(() => {
    setPage(0);
  }, [filtered]);
  useEffect(() => {
    if (selectedId && !filtered.some((m) => m.id === selectedId))
      setSelectedId(null);
  }, [filtered, selectedId]);
  const demos = memories.filter((m) => m.kind === "demo").length;
  const contexts = memories.length - demos;
  const datasetLabel =
    memories.length === 0
      ? "Coleção vazia"
      : demos === memories.length
        ? "Demonstração sintética"
        : demos
          ? "Coleção mista"
          : "Memórias de contexto";
  const camera = (view: CameraCommand["view"], id?: string) =>
    setCommand((c) => ({ serial: c.serial + 1, view, id }));
  const select = (id: string) => setSelectedId(id);
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
  };
  const selectRelated = (id: string) => {
    clearFilters();
    setSelectedId(id);
  };
  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("O JSON deve ter no máximo 10 MB.");
      const next = importMemories(JSON.parse(await file.text()));
      setMemories(next);
      setSelectedId(null);
      clearFilters();
      camera("overview");
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        setNotice(
          `${next.length} memórias importadas e salvas neste navegador.`,
        );
      } catch {
        setNotice(
          "Coleção carregada. O armazenamento está cheio; exporte o JSON antes de fechar.",
        );
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Falha ao importar JSON.",
      );
    }
    e.target.value = "";
  };
  const startConversation = () => {
    const c = newConversation();
    setConversations((items) => [c, ...items]);
    setActiveConversationId(c.id);
    setChatOpen(true);
  };
  const sendMessage = async () => {
    const message = draft.trim();
    if (!message || sending || !activeConversation) return;
    const now = new Date().toISOString();
    let updated = addMessage(activeConversation, {
      id: `message-${Date.now()}`,
      role: "user",
      content: message,
      createdAt: now,
    });
    setConversations((items) =>
      items.map((c) => (c.id === updated.id ? updated : c)),
    );
    setDraft("");
    setSending(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await response.json();
      const answer = data.text || data.error || "(resposta vazia)";
      updated = addMessage(updated, {
        id: `message-${Date.now() + 1}`,
        role: "assistant",
        content: answer,
        createdAt: new Date().toISOString(),
        provider: "Codex",
        memoryAccess: data.memoryAccess || [],
      });
      setConversations((items) =>
        items.map((c) => (c.id === updated.id ? updated : c)),
      );
    } catch (error) {
      updated = addMessage(updated, {
        id: `message-${Date.now() + 1}`,
        role: "assistant",
        content: `Não foi possível conectar ao Codex. ${error instanceof Error ? error.message : "Erro desconhecido."}`,
        createdAt: new Date().toISOString(),
        provider: "Sistema",
      });
      setConversations((items) =>
        items.map((c) => (c.id === updated.id ? updated : c)),
      );
    } finally {
      setSending(false);
    }
  };
  return (
    <div
      className={`shell ${focus ? "focus-mode" : ""} ${chatOpen ? "chat-mode" : ""}`}
    >
      {!focus && (
        <aside className="rail">
          <div className="logo">
            <span>◈</span>
            <div>
              <strong>AURORA</strong>
              <small>MEMORY ATLAS</small>
            </div>
          </div>
          <button className="new-conversation" onClick={startConversation}>
            ＋ Nova conversa
          </button>
          <div className="rail-section">
            <label>EXPLORAR MEMÓRIA</label>
            <button
              className={`rail-link ${project === "all" && scope === "all" ? "active" : ""}`}
              onClick={() => {
                clearFilters();
                setChatOpen(false);
                setView("map");
              }}
            >
              ◈ <span>Todas as memórias</span>
              <b>{memories.length.toLocaleString("pt-BR")}</b>
            </button>
            <button
              className={`rail-link ${scope === "general" ? "active" : ""}`}
              onClick={() => {
                setScope("general");
                setProject("all");
                setChatOpen(false);
              }}
            >
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
                  setChatOpen(false);
                }}
              >
                <i style={{ background: g.color }} />
                <span>{g.label}</span>
                <b>{g.count}</b>
              </button>
            ))}
          </div>
          <div className="rail-section categories">
            <label>ASSUNTOS</label>
            <div className="topic-buttons">
              {topics.map((t) => (
                <button
                  className={query === t ? "on" : ""}
                  key={t}
                  onClick={() => {
                    setQuery(query === t ? "" : t);
                    setChatOpen(false);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="rail-section conversations">
            <label>CONVERSAS RECENTES</label>
            {conversations.slice(0, 4).map((c) => (
              <button
                key={c.id}
                className={`conversation-link ${chatOpen && c.id === activeConversationId ? "current" : ""}`}
                onClick={() => {
                  setActiveConversationId(c.id);
                  setChatOpen(true);
                }}
              >
                <span>◌</span>
                <span>{c.title}</span>
              </button>
            ))}
          </div>
          <div className="rail-bottom">
            <div className="demo-note">
              <span className="live-dot" /> {datasetLabel}
              <small>
                {contexts} contexto · {demos} demonstração
              </small>
            </div>
            <label className="import-button">
              ↑ Importar JSON
              <input
                type="file"
                accept="application/json,.json"
                onChange={importFile}
              />
            </label>
            <button
              className="export-button"
              onClick={() => downloadJSON(memories)}
            >
              ↓ Exportar coleção
            </button>
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
              placeholder="Pesquisar memórias, projetos, decisões…"
            />
            <kbd>Ctrl K</kbd>
          </div>
          <div className="toolbar-actions">
            <button
              className="tool-button"
              onClick={() => setChatOpen(!chatOpen)}
            >
              {chatOpen ? "◈ Atlas 3D" : "◌ Conversas"}
            </button>
            <button
              onClick={() => setCad(!cad)}
              aria-pressed={cad}
              className={cad ? "tool-button on" : "tool-button"}
            >
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
        {chatOpen ? (
          <section className="chat-page">
            <div className="chat-page-head">
              <div>
                <div className="overline">CONVERSA</div>
                <h1>{activeConversation?.title || "Nova conversa"}</h1>
                <p>Histórico local · preservado neste dispositivo</p>
              </div>
              <button className="new-conversation" onClick={startConversation}>
                ＋ Nova conversa
              </button>
            </div>
            <div className="chat-messages">
              {activeConversation?.messages.length ? (
                activeConversation.messages.map((m) => (
                  <div className={`chat-message ${m.role}`} key={m.id}>
                    <div className="chat-avatar">
                      {m.role === "user" ? "EU" : "✦"}
                    </div>
                    <div>
                      <div className="chat-meta">
                        {m.role === "user" ? "VOCÊ" : m.provider || "CODEX"} ·{" "}
                        {new Date(m.createdAt).toLocaleString("pt-BR")}
                      </div>
                      <div className="chat-content">{m.content}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="chat-empty">
                  Comece uma nova conversa com o Codex.
                  <br />
                  <small>O histórico será salvo automaticamente.</small>
                </div>
              )}
            </div>
            <div className="chat-composer">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Escreva uma mensagem…"
                rows={2}
              />
              <button onClick={sendMessage} disabled={sending || !draft.trim()}>
                {sending ? "…" : "Enviar"} ↗
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="titlebar">
              <div>
                <div className="overline">
                  EXPLORADOR NEURAL <span>/</span>{" "}
                  {cad ? "ESTÚDIO CAD" : "VISÃO ESPACIAL"}
                </div>
                <h1>
                  Nossa memória<span>3D</span>
                </h1>
                <p>Contextos conectados. Cada memória, uma nova ramificação.</p>
              </div>
              <div className="view-toggle">
                <button
                  className={view === "map" ? "selected" : ""}
                  onClick={() => setView("map")}
                >
                  ◉ Mapa 3D
                </button>
                <button
                  className={view === "list" ? "selected" : ""}
                  onClick={() => setView("list")}
                >
                  ☷ Lista
                </button>
              </div>
            </section>
            <div className="filterbar">
              <label>
                Origem
                <select
                  aria-label="Filtrar origem"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                >
                  <option value="all">Todas</option>
                  <option value="context">Contexto</option>
                  <option value="demo">Demonstração</option>
                </select>
              </label>
              <label>
                Escopo
                <select
                  aria-label="Filtrar escopo"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as typeof scope)}
                >
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
                <select
                  aria-label="Filtrar projeto"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                >
                  <option value="all">Todos</option>
                  {graph.groups.map((g) => (
                    <option key={g.id}>{g.label}</option>
                  ))}
                </select>
              </label>
              {(query ||
                scope !== "all" ||
                kind !== "all" ||
                project !== "all") && (
                <button className="clear-filter" onClick={clearFilters}>
                  Limpar filtros ×
                </button>
              )}
              <span className="result-count">
                {filtered.length.toLocaleString("pt-BR")} /{" "}
                {memories.length.toLocaleString("pt-BR")}
              </span>
            </div>
            {view === "map" ? (
              <div className="scene-wrap">
                <Suspense
                  fallback={
                    <div className="scene-fallback">Preparando a rede 3D…</div>
                  }
                >
                  <MemoryScene
                    memories={filtered}
                    allMemories={memories}
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
                  <div className="overline">
                    {selected ? "ESTRUTURA SELECIONADA" : "REDE DE CONTEXTOS"}
                  </div>
                  <strong>
                    {selected?.title ||
                      `${graph.groups.length} grupos · ${graph.edges.length} conexões`}
                  </strong>
                  <small>
                    {selected
                      ? `X ${selected.position[0].toFixed(2)} · Y ${selected.position[1].toFixed(2)} · Z ${selected.position[2].toFixed(2)} u.c.`
                      : "Cores por projeto · agrupamento visual"}
                  </small>
                </div>
                {filtered.length === 0 && (
                  <div className="no-results">
                    <h2>Nenhuma memória encontrada</h2>
                    <button onClick={clearFilters}>Limpar filtros</button>
                  </div>
                )}
                <div className="view-presets" aria-label="Vistas da câmera">
                  {(["overview", "front", "top", "side"] as const).map(
                    (preset, i) => (
                      <button
                        key={preset}
                        onClick={() => camera(preset, selectedId || undefined)}
                        title={
                          [
                            "Vista isométrica",
                            "Vista frontal",
                            "Vista superior",
                            "Vista lateral",
                          ][i]
                        }
                      >
                        {["ISO", "FRENTE", "TOPO", "LADO"][i]}
                      </button>
                    ),
                  )}
                </div>
                <div className="scene-legend">
                  <span>
                    <i style={{ background: "#65e2d4" }} /> Neurônio / memória
                  </span>
                  <span>
                    <i style={{ background: "#ffcf94" }} /> Relação selecionada
                  </span>
                  <small>
                    Pulsos ilustrativos · {motion ? "ativos" : "pausados"}
                  </small>
                </div>
                <div className="scene-controls">
                  <button
                    aria-pressed={orthographic}
                    onClick={() => setOrthographic(!orthographic)}
                  >
                    {orthographic ? "Ortográfica" : "Perspectiva"}
                  </button>
                  <button
                    aria-pressed={wireframe}
                    onClick={() => setWireframe(!wireframe)}
                  >
                    Wireframe
                  </button>
                  <button
                    aria-pressed={motion}
                    onClick={() => setMotion(!motion)}
                  >
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
            ) : (
              <div className="list-view">
                <div className="list-table-head">
                  <span>MEMÓRIA / CONTEÚDO</span>
                  <span>ESCOPO</span>
                </div>
                {filtered.slice(page * 100, (page + 1) * 100).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => select(m.id)}
                    className={
                      m.id === selectedId ? "list-row selected" : "list-row"
                    }
                  >
                    <span
                      className="list-node"
                      style={{ background: groupColor(groupKey(m)) }}
                    />
                    <span>
                      <strong>{m.title}</strong>
                      <small>{m.content}</small>
                    </span>
                    <em>{scopeLabels[m.scope]}</em>
                  </button>
                ))}
                {!filtered.length && (
                  <div className="list-empty">Nenhuma memória encontrada.</div>
                )}
                <div className="pagination">
                  <button
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Anterior
                  </button>
                  <span>
                    Página {page + 1} de{" "}
                    {Math.max(1, Math.ceil(filtered.length / 100))}
                  </span>
                  <button
                    disabled={(page + 1) * 100 >= filtered.length}
                    onClick={() => setPage((p) => p + 1)}
                  >
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
                  <span className="mouse-help">
                    Arraste: girar · Shift: mover · Scroll: zoom
                  </span>
                  <label>
                    Qualidade{" "}
                    <select
                      aria-label="Qualidade gráfica"
                      value={quality}
                      onChange={(e) =>
                        setQuality(e.target.value as typeof quality)
                      }
                    >
                      <option value="high">Alta</option>
                      <option value="low">Leve</option>
                    </select>
                  </label>
                </>
              )}
            </div>
          </>
        )}
      </main>
      {!focus && !chatOpen && (
        <aside className={`inspector ${selected ? "has-selection" : ""}`}>
          <div className="inspector-head">
            <div>
              <span className="overline">INSPEÇÃO DA MEMÓRIA</span>
              <h2>
                {selected ? "Neurônio selecionado" : "Explore uma conexão"}
              </h2>
            </div>
            {selected && (
              <button
                aria-label="Fechar inspeção"
                onClick={() => setSelectedId(null)}
              >
                ×
              </button>
            )}
          </div>
          {selected ? (
            <>
              <div
                className="detail-hero"
                style={{ borderColor: groupColor(groupKey(selected)) }}
              >
                <span
                  className="detail-symbol"
                  style={{ color: groupColor(groupKey(selected)) }}
                >
                  ✳
                </span>
                <strong>{selected.title}</strong>
                <small>
                  {selected.kind === "demo"
                    ? "DEMONSTRAÇÃO SINTÉTICA"
                    : "CONTEXTO IMPORTADO"}
                </small>
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
                  <dt>Coordenadas</dt>
                  <dd>
                    {selected.position.map((v) => v.toFixed(2)).join(" / ")}{" "}
                    u.c.
                  </dd>
                </dl>
                <div className="tags">
                  {selected.tags.map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                </div>
                <button
                  className="inspect-button"
                  onClick={() => inspect(selected.id)}
                >
                  ◎ Inspecionar em 3D
                </button>
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
                    RELAÇÕES DIRETAS{" "}
                    <b>
                      {selected.relations.length +
                        (graph.incoming.get(selected.id)?.length || 0)}
                    </b>
                  </label>
                  {selected.relations.map((id) => {
                    const r = graph.byId.get(id);
                    return (
                      r && (
                        <button
                          key={`out:${id}`}
                          onClick={() => selectRelated(id)}
                        >
                          <i />
                          {r.title}
                          <small>
                            →{" "}
                            {
                              relationLabels[
                                selected.relationTypes?.[id] || "thematic"
                              ]
                            }
                          </small>
                        </button>
                      )
                    );
                  })}
                  {graph.incoming.get(selected.id)?.map((edge) => (
                    <button
                      key={edge.key}
                      onClick={() => selectRelated(edge.from.id)}
                    >
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
                <div className="empty-glyph">✳</div>
                <h3>Uma rede que você pode explorar.</h3>
                <p>
                  Clique em uma memória para ver seu conteúdo, origem e
                  conexões.
                </p>
                <small>Duplo clique aproxima o neurônio.</small>
              </div>
              <div className="anatomy-guide">
                <div className="overline">ANATOMIA VISUAL</div>
                <p>
                  <b>01</b> Núcleo <span>Conteúdo da memória</span>
                </p>
                <p>
                  <b>02</b> Dendritos <span>Ramificações orgânicas</span>
                </p>
                <p>
                  <b>03</b> Sinapses <span>Relações entre registros</span>
                </p>
                <small>
                  Representação conceitual. Grupos são organizadores visuais;
                  medidas em unidades da cena.
                </small>
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
                : "Visualização em lista"}
            </small>
          </div>
        </aside>
      )}
    </div>
  );
}
