import { useMemo, useState } from "react";
import type { Conversation, Project } from "./api";

type View = "chat" | "memory" | "atlas";

type Props = {
  projects: Project[];
  conversations: Conversation[];
  activeConversationId: string | null;
  activeView: View;
  memoryCount: number;
  onSelectView: (view: View) => void;
  onSelectConversation: (id: string) => void;
  onNewConversation: (projectId?: string | null) => void;
  onNewProject: (name: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
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

function ConversationRow({
  conversation,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  if (editing) {
    return (
      <form
        className="conv-row editing"
        onSubmit={(e) => {
          e.preventDefault();
          onRename(draft.trim() || conversation.title);
          setEditing(false);
        }}
      >
        <input
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
    <div className={`conv-row ${active ? "active" : ""}`}>
      <button className="conv-title" onClick={onSelect} title={conversation.title}>
        <span>{conversation.title}</span>
        <small>{timeAgo(conversation.updatedAt)}</small>
      </button>
      <div className="conv-actions">
        <button aria-label="Renomear conversa" onClick={() => setEditing(true)} title="Renomear">
          ✎
        </button>
        <button
          aria-label="Excluir conversa"
          onClick={() => {
            if (confirm(`Excluir "${conversation.title}"? Esta ação não pode ser desfeita.`)) onDelete();
          }}
          title="Excluir"
        >
          ×
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
  onSelectView,
  onSelectConversation,
  onNewConversation,
  onNewProject,
  onRenameConversation,
  onDeleteConversation,
  onRenameProject,
  onDeleteProject,
}: Props) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
  }, [conversations, query]);

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

  return (
    <aside className="app-sidebar">
      <div className="app-logo">
        <span>◈</span>
        <div>
          <strong>AURORA</strong>
          <small>HARNESS</small>
        </div>
      </div>

      <button className="new-conversation" onClick={() => onNewConversation(null)}>
        ＋ Nova conversa
      </button>

      <div className="sidebar-search">
        <span>⌕</span>
        <input placeholder="Buscar conversas…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar conversas" />
      </div>

      <nav className="sidebar-scroll">
        <div className="sidebar-block">
          <div className="sidebar-block-head">
            <label>PROJETOS</label>
            {creatingProject ? (
              <form
                className="project-new-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (projectDraft.trim()) onNewProject(projectDraft.trim());
                  setProjectDraft("");
                  setCreatingProject(false);
                }}
              >
                <input
                  autoFocus
                  placeholder="Nome do projeto"
                  value={projectDraft}
                  onChange={(e) => setProjectDraft(e.target.value)}
                  onBlur={() => setCreatingProject(false)}
                />
              </form>
            ) : (
              <button className="mini-action" onClick={() => setCreatingProject(true)} aria-label="Novo projeto">
                ＋
              </button>
            )}
          </div>
          {projects.length === 0 && !creatingProject && <p className="sidebar-empty">Nenhum projeto ainda.</p>}
          {projects.map((project) => {
            const items = byProject.map.get(project.id) || [];
            const isCollapsed = collapsed[project.id];
            return (
              <div className="project-group" key={project.id}>
                <div className="project-head">
                  <button className="project-toggle" onClick={() => setCollapsed((c) => ({ ...c, [project.id]: !c[project.id] }))}>
                    <i className={isCollapsed ? "chevron closed" : "chevron"} />
                    <span>{project.name}</span>
                    <b>{items.length}</b>
                  </button>
                  <div className="project-actions">
                    <button
                      title="Nova conversa neste projeto"
                      onClick={() => onNewConversation(project.id)}
                      aria-label="Nova conversa neste projeto"
                    >
                      ＋
                    </button>
                    <button
                      title="Renomear projeto"
                      onClick={() => {
                        const name = prompt("Novo nome do projeto:", project.name);
                        if (name?.trim()) onRenameProject(project.id, name.trim());
                      }}
                      aria-label="Renomear projeto"
                    >
                      ✎
                    </button>
                    <button
                      title="Excluir projeto"
                      onClick={() => {
                        if (confirm(`Excluir o projeto "${project.name}"? As conversas continuam existindo, sem projeto.`))
                          onDeleteProject(project.id);
                      }}
                      aria-label="Excluir projeto"
                    >
                      ×
                    </button>
                  </div>
                </div>
                {!isCollapsed &&
                  items.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      active={activeView === "chat" && conversation.id === activeConversationId}
                      onSelect={() => onSelectConversation(conversation.id)}
                      onRename={(title) => onRenameConversation(conversation.id, title)}
                      onDelete={() => onDeleteConversation(conversation.id)}
                    />
                  ))}
              </div>
            );
          })}
        </div>

        <div className="sidebar-block">
          <label>CONVERSAS</label>
          {byProject.ungrouped.length === 0 && <p className="sidebar-empty">Nenhuma conversa por aqui.</p>}
          {byProject.ungrouped.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={activeView === "chat" && conversation.id === activeConversationId}
              onSelect={() => onSelectConversation(conversation.id)}
              onRename={(title) => onRenameConversation(conversation.id, title)}
              onDelete={() => onDeleteConversation(conversation.id)}
            />
          ))}
        </div>
      </nav>

      <div className="sidebar-bottom">
        <button className={`rail-link ${activeView === "memory" ? "active" : ""}`} onClick={() => onSelectView("memory")}>
          ⌁ <span>Memória</span>
          <b>{memoryCount.toLocaleString("pt-BR")}</b>
        </button>
        <button className={`rail-link ${activeView === "atlas" ? "active" : ""}`} onClick={() => onSelectView("atlas")}>
          ◈ <span>Atlas 3D</span>
          <b className="beta-tag">beta</b>
        </button>
      </div>
    </aside>
  );
}
