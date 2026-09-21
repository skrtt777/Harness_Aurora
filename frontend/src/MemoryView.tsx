import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import CentralMemoryPanel from './CentralMemoryPanel';
import {
  createMemory,
  importMemories,
  deleteMemory,
  getCommunityBundle,
  getCommunityManifest,
  getMemoryStats,
  listMemories,
  updateMemory,
  type CommunityBundleInfo,
  type Conversation,
  type MemoryEntry,
  type MemoryExportEnvelope,
  type MemoryKind,
  type MemoryScope,
  type MemoryStat,
  type Project,
} from "./api";

const EXPORT_FORMAT = "harness-aurora-memories";

function downloadMemories(memories: MemoryEntry[]) {
  const envelope: MemoryExportEnvelope = {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    memories,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `harness-aurora-memorias-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Props = {
  projects: Project[];
  conversations: Conversation[];
  onMemoriesChanged?: () => void;
};

const scopeLabels: Record<MemoryScope, string> = {
  global: "Geral",
  project: "Projeto",
  conversation: "Conversa",
};
const kindLabels: Record<MemoryKind, string> = {
  manual: "Manual",
  extracted: "Extraída pela IA",
  imported: "Importada",
};

function NewMemoryForm({
  projects,
  conversations,
  onCreated,
}: {
  projects: Project[];
  conversations: Conversation[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<MemoryScope>("global");
  const [projectId, setProjectId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button className="new-conversation memory-add-toggle" onClick={() => setOpen(true)}>
        ＋ Nova memória manual
      </button>
    );
  }

  const submit = async () => {
    setError("");
    if (!content.trim()) {
      setError("O conteúdo é obrigatório.");
      return;
    }
    if (scope === "project" && !projectId) {
      setError("Escolha um projeto.");
      return;
    }
    if (scope === "conversation" && !conversationId) {
      setError("Escolha uma conversa.");
      return;
    }
    try {
      await createMemory({
        scope,
        projectId: scope === "project" ? projectId : undefined,
        conversationId: scope === "conversation" ? conversationId : undefined,
        title: title.trim() || "Memória",
        content: content.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setTitle("");
      setContent("");
      setTags("");
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar memória.");
    }
  };

  return (
    <div className="memory-form-card">
      <div className="memory-form-row">
        <label>
          Escopo
          <select value={scope} onChange={(e) => setScope(e.target.value as MemoryScope)}>
            <option value="global">Geral</option>
            <option value="project">Projeto</option>
            <option value="conversation">Conversa</option>
          </select>
        </label>
        {scope === "project" && (
          <label>
            Projeto
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Selecione…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {scope === "conversation" && (
          <label>
            Conversa
            <select value={conversationId} onChange={(e) => setConversationId(e.target.value)}>
              <option value="">Selecione…</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea placeholder="Conteúdo da memória…" rows={2} value={content} onChange={(e) => setContent(e.target.value)} />
      <input placeholder="Tags separadas por vírgula" value={tags} onChange={(e) => setTags(e.target.value)} />
      {error && <p className="memory-form-error">{error}</p>}
      <div className="memory-form-actions">
        <button onClick={() => setOpen(false)}>Cancelar</button>
        <button className="primary" onClick={submit}>
          Salvar memória
        </button>
      </div>
    </div>
  );
}

function MemoryRow({
  memory,
  projectName,
  conversationName,
  onDeleted,
  onUpdated,
  onShare,
}: {
  memory: MemoryEntry;
  projectName?: string;
  conversationName?: string;
  onDeleted: () => void;
  onUpdated: () => void;
  onShare: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(memory.content);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="memory-row">
      {error && <p role="alert" className="memory-form-error">{error}</p>}
      <div className="memory-row-head">
        <span className={`scope-badge scope-${memory.scope}`}>{scopeLabels[memory.scope]}</span>
        <span className={`kind-badge kind-${memory.kind}`}>{kindLabels[memory.kind]}</span>
        <strong>{memory.title}</strong>
        <span className="memory-row-spacer" />
        <button
          aria-label="Editar"
          onClick={() => {
            setContent(memory.content);
            setEditing((v) => !v);
          }}
        >
          ✎
        </button>
        <button
          aria-label="Excluir"
          onClick={() => {
            if (confirm("Excluir esta memória?")) onDeleted();
          }}
        >
          ×
        </button>
      </div>
      {editing ? (
        <div className="memory-edit">
          <textarea rows={2} value={content} onChange={(e) => setContent(e.target.value)} />
          <div className="memory-form-actions">
            <button onClick={() => setEditing(false)}>Cancelar</button>
            <button
              className="primary"
              onClick={async () => {
                if (saving) return;
                setSaving(true); setError("");
                try { await updateMemory(memory.id, { content }); setEditing(false); onUpdated(); }
                catch (e) { setError(e instanceof Error ? e.message : "Falha ao salvar memória."); }
                finally { setSaving(false); }
              }}
            >
              Salvar
            </button>
          </div>
        </div>
      ) : (
        <p>{memory.content}</p>
      )}
      <div className="memory-row-foot">
        <button onClick={onShare}>Compartilhar cópia</button>
        {(projectName || conversationName) && <span>{projectName || conversationName}</span>}
        {memory.tags.map((t) => (
          <em key={t}>#{t}</em>
        ))}
        <small>{new Date(memory.createdAt).toLocaleString("pt-BR")}</small>
      </div>
    </div>
  );
}

export default function MemoryView({ projects, conversations, onMemoriesChanged }: Props) {
  const [shareDraft, setShareDraft] = useState<MemoryEntry|null>(null);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [stats, setStats] = useState<MemoryStat[]>([]);
  const [scope, setScope] = useState<"all" | MemoryScope>("all");
  const [kind, setKind] = useState<"all" | MemoryKind>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [importStatus, setImportStatus] = useState("");
  const [communityOpen, setCommunityOpen] = useState(false);
  const [communityBundles, setCommunityBundles] = useState<CommunityBundleInfo[] | null>(null);
  const [communityError, setCommunityError] = useState("");
  const [importingBundle, setImportingBundle] = useState<string | null>(null);

  const refreshId = useRef(0);
  useEffect(() => () => { refreshId.current++; }, []);
  const refresh = async () => {
    const id = ++refreshId.current;
    setLoading(true);
    try {
      const [list, statList] = await Promise.all([
        listMemories({
          scope: scope === "all" ? undefined : scope,
          kind: kind === "all" ? undefined : kind,
          query: query || undefined,
        }),
        getMemoryStats(),
      ]);
      if (id === refreshId.current) { setMemories(list); setStats(statList); }
    } catch (error) {
      if (id === refreshId.current) setImportStatus(error instanceof Error ? error.message : "Falha ao carregar memórias.");
    } finally {
      if (id === refreshId.current) setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, kind, query]);

  const totals = useMemo(() => {
    let global = 0;
    let project = 0;
    let conversation = 0;
    let extracted = 0;
    for (const row of stats) {
      if (row.scope === "global") global += row.count;
      if (row.scope === "project") project += row.count;
      if (row.scope === "conversation") conversation += row.count;
      if (row.kind === "extracted") extracted += row.count;
    }
    return { global, project, conversation, total: global + project + conversation, extracted };
  }, [stats]);

  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const conversationNames = useMemo(() => new Map(conversations.map((c) => [c.id, c.title])), [conversations]);

  const afterChange = () => {
    refresh();
    onMemoriesChanged?.();
  };

  const importEnvelope = async (parsed: unknown, _sourceLabel: string) => {
    const result = await importMemories(parsed);
    setImportStatus(`${result.imported} memórias importadas, ${result.relationsCreated} relações recriadas, ${result.skipped} já existentes.`);
    afterChange();
  };

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportStatus("Importando…");
    try {
      if (file.size > 990000) throw new Error("O arquivo deve ter no máximo 990 KB.");
      await importEnvelope(JSON.parse(await file.text()), "arquivo");
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Falha ao importar.");
    }
  };

  const toggleCommunity = async () => {
    const next = !communityOpen;
    setCommunityOpen(next);
    if (next && communityBundles === null) {
      setCommunityError("");
      try {
        setCommunityBundles(await getCommunityManifest());
      } catch (error) {
        setCommunityBundles([]);
        setCommunityError(error instanceof Error ? error.message : "Falha ao buscar memórias da comunidade.");
      }
    }
  };

  const importCommunityBundle = async (bundle: CommunityBundleInfo) => {
    setImportingBundle(bundle.id);
    setImportStatus("Importando…");
    try {
      await importEnvelope(await getCommunityBundle(bundle.file), `comunidade: ${bundle.title}`);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Falha ao importar da comunidade.");
    } finally {
      setImportingBundle(null);
    }
  };

  return (
    <section className="memory-page">
      <div className="titlebar">
        <div>
          <div className="overline">MEMÓRIA DO HARNESS</div>
          <h1>
            Tudo que a IA <span>lembra</span>
          </h1>
          <p>Central compartilhada, contexto de cada chat e sua coleção pessoal. Somente referências relevantes entram nas respostas.</p>
        </div>
      </div>

      <CentralMemoryPanel draft={shareDraft} onCloseDraft={()=>setShareDraft(null)} />
      <h2 className="personal-memory-heading">Memória pessoal · todos os chats</h2>
      <div className="memory-stats">
        <div className="card stat">
          <div className="stat-label">Total</div>
          <div className="stat-value">{totals.total.toLocaleString("pt-BR")}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Geral</div>
          <div className="stat-value">{(totals.global || 0).toLocaleString("pt-BR")}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Por projeto</div>
          <div className="stat-value">{(totals.project || 0).toLocaleString("pt-BR")}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Por conversa</div>
          <div className="stat-value">{(totals.conversation || 0).toLocaleString("pt-BR")}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Extraídas pela IA</div>
          <div className="stat-value">{totals.extracted.toLocaleString("pt-BR")}</div>
        </div>
      </div>

      <div className="filterbar">
        <label>
          Escopo
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="all">Todos</option>
            <option value="global">Geral</option>
            <option value="project">Projeto</option>
            <option value="conversation">Conversa</option>
          </select>
        </label>
        <label>
          Origem
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">Todas</option>
            <option value="manual">Manual</option>
            <option value="extracted">Extraída pela IA</option>
            <option value="imported">Importada</option>
          </select>
        </label>
        <div className="search" style={{ flex: 1, maxWidth: 320 }}>
          <span>⌕</span>
          <input placeholder="Pesquisar memórias…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <span className="result-count">{memories.length.toLocaleString("pt-BR")}</span>
        <button className="export-button" onClick={() => downloadMemories(memories)} disabled={!memories.length}>
          ↓ Exportar
        </button>
        <label className="import-button">
          ↑ Importar
          <input type="file" accept="application/json,.json" onChange={importFile} />
        </label>
        <button className="export-button" onClick={toggleCommunity}>
          🌐 Comunidade
        </button>
      </div>
      {importStatus && <p className="memory-import-status">{importStatus}</p>}

      {communityOpen && (
        <div className="community-panel">
          <p className="community-hint">
            Pacotes de importação manual. Este botão apenas baixa; o envio público é controlado separadamente na memória central e exige aprovação de cada cópia.
          </p>
          {communityError && <p className="memory-import-status">{communityError}</p>}
          {communityBundles === null && !communityError && <p className="sidebar-empty">Buscando…</p>}
          {communityBundles?.length === 0 && !communityError && (
            <p className="sidebar-empty">Nenhum pacote disponível no momento.</p>
          )}
          {communityBundles?.map((bundle) => (
            <div className="community-bundle" key={bundle.id}>
              <div className="community-bundle-text">
                <strong>{bundle.title}</strong>
                <p>{bundle.description}</p>
                <div className="community-tags">
                  {bundle.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
              <button onClick={() => importCommunityBundle(bundle)} disabled={importingBundle === bundle.id}>
                {importingBundle === bundle.id ? "Importando…" : "Importar"}
              </button>
            </div>
          ))}
        </div>
      )}

      <NewMemoryForm projects={projects} conversations={conversations} onCreated={afterChange} />

      <div className="memory-list">
        {loading && <p className="sidebar-empty">Carregando…</p>}
        {!loading && memories.length === 0 && <p className="sidebar-empty">Nenhuma memória encontrada com esses filtros.</p>}
        {memories.map((memory) => (
          <MemoryRow
            key={memory.id}
            memory={memory}
            projectName={memory.projectId ? projectNames.get(memory.projectId) : undefined}
            conversationName={memory.conversationId ? conversationNames.get(memory.conversationId) : undefined}
            onDeleted={async () => {
              try { await deleteMemory(memory.id); afterChange(); }
              catch (e) { setImportStatus(e instanceof Error ? e.message : "Falha ao excluir memória."); }
            }}
            onUpdated={afterChange}
            onShare={()=>setShareDraft(memory)}
          />
        ))}
      </div>
    </section>
  );
}
