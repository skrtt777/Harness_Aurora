import { useEffect, useMemo, useState } from "react";
import { getHealth, getProviders, listConversations, searchConversations, type Conversation, type Project, type ProviderInfo, type SavingsStats } from "./api";
import BrandMark from "./BrandMark";
import Icon from "./Icon";

type View = "chat" | "memory" | "atlas" | "test" | "settings" | "skills" | "agents";

type Props = {
  projects: Project[];
  conversations: Conversation[];
  activeConversationId: string | null;
  activeView: View;
  memoryCount: number;
  savings: SavingsStats | null;
  newConversationProvider: string;
  onSelectNewConversationProvider: (id: string) => void;
  newConversationTeacher: string;
  onSelectNewConversationTeacher: (id: string) => void;
  onSelectView: (view: View) => void;
  onSelectConversation: (id: string) => void;
  onNewConversation: (projectId?: string | null) => void;
  onNewProject: (name: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onMoveConversation: (id: string, projectId: string | null) => void;
  onArchiveConversation: (id: string, archived: boolean) => void;
  onDeleteConversation: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onConfigureProject: (project: Project) => void;
  onDeleteProject: (id: string) => void;
  /** Off-canvas drawer state below the 900px breakpoint — see AppShell.tsx. */
  mobileOpen?: boolean;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

type RowProps = {
  conversation: Conversation;
  active: boolean;
  projects: Project[];
  onSelect: () => void;
  onRename: (title: string) => void;
  onMove: (projectId: string | null) => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
};

function ConversationRow({ conversation, active, projects, onSelect, onRename, onMove, onArchive, onDelete }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  if (moving) {
    return (
      <div className="sb-row editing">
        <select
          className="field"
          autoFocus
          aria-label={`Mover "${conversation.title}" para outro projeto`}
          defaultValue={conversation.projectId ?? ""}
          onChange={(e) => {
            onMove(e.target.value || null);
            setMoving(false);
          }}
          onBlur={() => setMoving(false)}
        >
          <option value="">Sem projeto</option>
          {projects.filter((p) => !p.agentId).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (editing) {
    return (
      <form
        className="sb-row editing"
        onSubmit={(e) => {
          e.preventDefault();
          onRename(draft.trim() || conversation.title);
          setEditing(false);
        }}
      >
        <input
          className="field"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            onRename(draft.trim() || conversation.title);
            setEditing(false);
          }}
        />
      </form>
    );
  }
  return (
    <div className={`sb-row ${active ? "active" : ""}`}>
      <button className="sb-row-main" onClick={onSelect}>
        <span className="sb-row-title">{conversation.title}</span>
        <span className="sb-row-meta">{timeAgo(conversation.updatedAt)}</span>
      </button>
      <div className="sb-row-actions">
        <button className="btn-icon" aria-label="Renomear conversa" onClick={() => setEditing(true)}>
          <Icon name="edit" size={13} />
        </button>
        <button className="btn-icon" aria-label="Mover para outro projeto" onClick={() => setMoving(true)}>
          <Icon name="folder" size={13} />
        </button>
        {conversation.archivedAt ? (
          <button className="btn-icon" aria-label="Desarquivar conversa" onClick={() => onArchive(false)}>
            <Icon name="unarchive" size={13} />
          </button>
        ) : (
          <button className="btn-icon" aria-label="Arquivar conversa" onClick={() => onArchive(true)}>
            <Icon name="archive" size={13} />
          </button>
        )}
        <button
          className="btn-icon"
          aria-label="Excluir conversa"
          onClick={() => {
            if (confirm(`Excluir "${conversation.title}"? Esta ação não pode ser desfeita.`)) onDelete();
          }}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
  );
}

export default function Sidebar({
  projects,
  conversations,
  activeConversationId,
  activeView,
  memoryCount,
  newConversationProvider,
  onSelectNewConversationProvider,
  newConversationTeacher,
  onSelectNewConversationTeacher,
  onSelectView,
  onSelectConversation,
  onNewConversation,
  onNewProject,
  onRenameConversation,
  onMoveConversation,
  onArchiveConversation,
  onDeleteConversation,
  onRenameProject,
  onConfigureProject,
  onDeleteProject,
  mobileOpen,
}: Props) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedList, setArchivedList] = useState<Conversation[] | null>(null);
  const [archivedLoading, setArchivedLoading] = useState(false);

  useEffect(() => {
    if (!archivedOpen) return;
    setArchivedLoading(true);
    listConversations(undefined, true)
      .then(setArchivedList)
      .catch(() => setArchivedList([]))
      .finally(() => setArchivedLoading(false));
  }, [archivedOpen]);

  const handleArchiveToggle = (id: string, archived: boolean) => {
    onArchiveConversation(id, archived);
    if (!archived) setArchivedList((list) => list?.filter((c) => c.id !== id) ?? list);
  };

  useEffect(() => {
    getHealth()
      .then((health) => setAppVersion(health.version ?? null))
      .catch(() => setAppVersion(null));
    getProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  // Instant client-side title match while the debounced server search (which
  // also covers message content, not just titles) is still in flight —
  // avoids a blank list flashing on every keystroke.
  const [contentResults, setContentResults] = useState<{ query: string; conversations: Conversation[] } | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setContentResults(null);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      searchConversations(q)
        .then((results) => { if (!stale) setContentResults({ query: q, conversations: results }); })
        .catch(() => {});
    }, 300);
    return () => { stale = true; clearTimeout(timer); };
  }, [query]);

  const filtered = useMemo(() => {
    const trimmed = query.trim();
    const active = conversations.filter((c) => !c.archivedAt);
    if (!trimmed) return active;
    if (contentResults?.query === trimmed) return contentResults.conversations;
    const q = trimmed.toLowerCase();
    return active.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query, contentResults]);

  // Task agents' projects live on the Agents page, not in the sidebar.
  const visibleProjects = useMemo(() => projects.filter((p) => !p.agentId), [projects]);

  const byProject = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    const ungrouped: Conversation[] = [];
    for (const conversation of filtered) {
      if (conversation.projectId) {
        map.set(conversation.projectId, [...(map.get(conversation.projectId) || []), conversation]);
      } else {
        ungrouped.push(conversation);
      }
    }
    return { map, ungrouped };
  }, [filtered]);

  const providerLabel = newConversationProvider === "local" ? "Local" : newConversationProvider === "claude" ? "Claude" : "Codex";
  const rowProps = (conversation: Conversation): RowProps => ({
    conversation,
    active: activeView === "chat" && conversation.id === activeConversationId,
    projects,
    onSelect: () => onSelectConversation(conversation.id),
    onRename: (title) => onRenameConversation(conversation.id, title),
    onMove: (projectId) => onMoveConversation(conversation.id, projectId),
    onArchive: (archived) => handleArchiveToggle(conversation.id, archived),
    onDelete: () => onDeleteConversation(conversation.id),
  });

  return (
    <aside id="app-sidebar" className={`sb ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="sb-top">
        <BrandMark />
      </div>

      <div className="sb-new">
        <button className="sb-new-main" onClick={() => onNewConversation(null)}>
          <Icon name="compose" size={15} />
          <span>Nova conversa</span>
        </button>
        <details className="sb-model">
          <summary aria-label="Modelo das próximas conversas">
            {providerLabel} <Icon name="down" size={12} />
          </summary>
          <div className="sb-popover" role="group" aria-label="Modelo das próximas conversas">
            <div className="sb-popover-label">Modelo das próximas conversas</div>
            {providers.map((p) => (
              <button
                key={p.id}
                className={`sb-popover-item ${newConversationProvider === p.id ? "selected" : ""}`}
                onClick={() => onSelectNewConversationProvider(p.id)}
              >
                <span>{p.name}</span>
                {newConversationProvider === p.id && <Icon name="check" size={13} />}
              </button>
            ))}
            {newConversationProvider === "local" && (
              <>
                <div className="sb-popover-label">Professor que revisa a IA local</div>
                {["codex", "claude"].map((id) => (
                  <button key={id} className={`sb-popover-item ${newConversationTeacher === id ? "selected" : ""}`} onClick={() => onSelectNewConversationTeacher(id)}>
                    <span>{id === "codex" ? "Codex" : "Claude"}</span>
                    {newConversationTeacher === id && <Icon name="check" size={13} />}
                  </button>
                ))}
              </>
            )}
          </div>
        </details>
      </div>

      <label className="sb-search">
        <Icon name="search" size={14} />
        <input placeholder="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar conversas" />
      </label>

      <nav className="sb-nav" aria-label="Páginas">
        <button className={`sb-link ${activeView === "memory" ? "active" : ""}`} onClick={() => onSelectView("memory")}>
          <Icon name="memory" size={15} />
          <span>Memória</span>
          <span className="sb-count">{memoryCount.toLocaleString("pt-BR")}</span>
        </button>
        <button className={`sb-link ${activeView === "agents" ? "active" : ""}`} onClick={() => onSelectView("agents")}>
          <Icon name="briefcase" size={15} />
          <span>Agentes</span>
        </button>
        <button className={`sb-link ${activeView === "skills" ? "active" : ""}`} onClick={() => onSelectView("skills")}>
          <Icon name="puzzle" size={15} />
          <span>Skills e regras</span>
        </button>
      </nav>

      <div className="sb-scroll">
        <section className="sb-group">
          <div className="sb-group-head">
            <span>Projetos</span>
            <button className="btn-icon sb-group-action" onClick={() => setCreatingProject(true)} aria-label="Novo projeto">
              <Icon name="plus" size={13} />
            </button>
          </div>
          {creatingProject && (
            <form
              className="sb-row editing"
              onSubmit={(e) => {
                e.preventDefault();
                if (projectDraft.trim()) onNewProject(projectDraft.trim());
                setProjectDraft("");
                setCreatingProject(false);
              }}
            >
              <input className="field" autoFocus placeholder="Nome do projeto" value={projectDraft} onChange={(e) => setProjectDraft(e.target.value)} onBlur={() => setCreatingProject(false)} />
            </form>
          )}
          {visibleProjects.length === 0 && !creatingProject && <p className="sb-empty">Nenhum projeto ainda.</p>}
          {visibleProjects.map((project) => {
            const items = byProject.map.get(project.id) || [];
            const isCollapsed = collapsed[project.id];
            return (
              <div className="sb-project" key={project.id}>
                <div className="sb-row sb-project-row">
                  <button className="sb-row-main" onClick={() => setCollapsed((c) => ({ ...c, [project.id]: !c[project.id] }))} aria-expanded={!isCollapsed}>
                    <span className={`sb-caret ${isCollapsed ? "closed" : ""}`}>
                      <Icon name="down" size={12} />
                    </span>
                    <span className="sb-row-title">{project.name}</span>
                    {items.length > 0 && <span className="sb-row-meta">{items.length}</span>}
                  </button>
                  <div className="sb-row-actions">
                    <button className="btn-icon" onClick={() => onNewConversation(project.id)} aria-label="Nova conversa neste projeto">
                      <Icon name="plus" size={13} />
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => {
                        const name = prompt("Novo nome do projeto:", project.name);
                        if (name?.trim()) onRenameProject(project.id, name.trim());
                      }}
                      aria-label="Renomear projeto"
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <button className="btn-icon" onClick={() => onConfigureProject(project)} aria-label="Configurar pasta e instruções do projeto">
                      <Icon name="gear" size={13} />
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => {
                        if (confirm(`Excluir o projeto "${project.name}"? As conversas continuam existindo, sem projeto.`)) onDeleteProject(project.id);
                      }}
                      aria-label="Excluir projeto"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
                {!isCollapsed && (
                  <div className="sb-project-items">
                    {items.map((conversation) => (
                      <ConversationRow key={conversation.id} {...rowProps(conversation)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section className="sb-group">
          <div className="sb-group-head">
            <span>Conversas</span>
          </div>
          {byProject.ungrouped.length === 0 && <p className="sb-empty">Nenhuma conversa por aqui.</p>}
          {byProject.ungrouped.map((conversation) => (
            <ConversationRow key={conversation.id} {...rowProps(conversation)} />
          ))}
        </section>

        <details className="sb-group sb-archived" onToggle={(e) => setArchivedOpen(e.currentTarget.open)}>
          <summary className="sb-group-head">
            <span>Arquivadas</span>
            <span className="sb-caret">
              <Icon name="down" size={12} />
            </span>
          </summary>
          {archivedLoading && <p className="sb-empty">Carregando…</p>}
          {!archivedLoading && archivedList?.length === 0 && <p className="sb-empty">Nenhuma conversa arquivada.</p>}
          {!archivedLoading && archivedList?.map((conversation) => <ConversationRow key={conversation.id} {...rowProps(conversation)} />)}
        </details>
      </div>

      <div className="sb-bottom">
        <button className={`sb-link ${activeView === "settings" ? "active" : ""}`} onClick={() => onSelectView("settings")}>
          <Icon name="gear" size={15} />
          <span>Configurações</span>
          {appVersion && <span className="sb-count">v{appVersion}</span>}
        </button>
      </div>
    </aside>
  );
}
