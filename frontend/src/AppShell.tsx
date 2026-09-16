import { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "./Sidebar";
import ChatView from "./ChatView";
import MemoryView from "./MemoryView";
import NeuralAtlas from "./NeuralAtlas";
import {
  createConversation,
  createProject,
  deleteConversation as apiDeleteConversation,
  deleteProject as apiDeleteProject,
  getConversation,
  getMemoryStats,
  listConversations,
  listProjects,
  sendMessage as apiSendMessage,
  updateConversation as apiUpdateConversation,
  updateProject as apiUpdateProject,
  type Conversation,
  type ConversationWithMessages,
  type Project,
} from "./api";

type View = "chat" | "memory" | "atlas";

export default function AppShell() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ConversationWithMessages | null>(null);
  const [view, setView] = useState<View>("chat");
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [memoryTotal, setMemoryTotal] = useState(0);
  const [bootError, setBootError] = useState("");

  const refreshMemoryTotal = useCallback(async () => {
    try {
      const stats = await getMemoryStats();
      setMemoryTotal(stats.reduce((sum, row) => sum + row.count, 0));
    } catch {
      // The badge is a nicety; a transient failure here should not block the UI.
    }
  }, []);

  const refreshLists = useCallback(async () => {
    const [projectList, conversationList] = await Promise.all([listProjects(), listConversations()]);
    setProjects(projectList);
    setConversations(conversationList);
    return conversationList;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const conversationList = await refreshLists();
        await refreshMemoryTotal();
        if (conversationList.length) {
          setActiveConversationId(conversationList[0].id);
        } else {
          const created = await createConversation({});
          setConversations([created]);
          setActiveConversationId(created.id);
        }
      } catch (error) {
        setBootError(error instanceof Error ? error.message : "Falha ao iniciar o harness.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeConversationId) {
      setActiveConversation(null);
      return;
    }
    setLoadingConversation(true);
    getConversation(activeConversationId)
      .then(setActiveConversation)
      .catch(() => setActiveConversation(null))
      .finally(() => setLoadingConversation(false));
  }, [activeConversationId]);

  const activeProject = useMemo(
    () => (activeConversation?.projectId ? projects.find((p) => p.id === activeConversation.projectId) || null : null),
    [activeConversation, projects],
  );

  const handleNewConversation = useCallback(
    async (projectId?: string | null) => {
      const created = await createConversation({ projectId: projectId || null });
      setConversations((items) => [created, ...items]);
      setActiveConversationId(created.id);
      setView("chat");
    },
    [],
  );

  const handleNewProject = useCallback(async (name: string) => {
    const created = await createProject({ name });
    setProjects((items) => [created, ...items]);
  }, []);

  const handleRenameConversation = useCallback(
    async (id: string, title: string) => {
      const updated = await apiUpdateConversation(id, { title });
      setConversations((items) => items.map((c) => (c.id === id ? updated : c)));
      setActiveConversation((c) => (c && c.id === id ? { ...c, title: updated.title } : c));
    },
    [],
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await apiDeleteConversation(id);
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);
      if (activeConversationId === id) {
        setActiveConversationId(remaining[0]?.id || null);
      }
    },
    [conversations, activeConversationId],
  );

  const handleRenameProject = useCallback(async (id: string, name: string) => {
    const updated = await apiUpdateProject(id, { name });
    setProjects((items) => items.map((p) => (p.id === id ? updated : p)));
  }, []);

  const handleDeleteProject = useCallback(async (id: string) => {
    await apiDeleteProject(id);
    await refreshLists();
  }, [refreshLists]);

  const handleSend = useCallback(
    async (message: string) => {
      if (!activeConversationId) return;
      setSending(true);
      try {
        await apiSendMessage(activeConversationId, message);
        const [refreshedConversation] = await Promise.all([
          getConversation(activeConversationId),
          refreshLists(),
          refreshMemoryTotal(),
        ]);
        setActiveConversation(refreshedConversation);
      } finally {
        setSending(false);
      }
    },
    [activeConversationId, refreshLists, refreshMemoryTotal],
  );

  if (bootError) {
    return (
      <div className="boot-error">
        <h1>Não foi possível iniciar o Harness Aurora</h1>
        <p>{bootError}</p>
        <p>Confirme que a API local (`npm start`) está rodando em 127.0.0.1:8787.</p>
      </div>
    );
  }

  if (view === "atlas") {
    return (
      <div className="app-shell atlas-takeover">
        <button className="atlas-back" onClick={() => setView("chat")}>
          ← Voltar para o chat
        </button>
        <NeuralAtlas />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        conversations={conversations}
        activeConversationId={activeConversationId}
        activeView={view}
        memoryCount={memoryTotal}
        onSelectView={setView}
        onSelectConversation={(id) => {
          setActiveConversationId(id);
          setView("chat");
        }}
        onNewConversation={handleNewConversation}
        onNewProject={handleNewProject}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
      />
      <main className="app-main">
        {view === "chat" && (
          <ChatView
            conversation={activeConversation}
            project={activeProject}
            loading={loadingConversation}
            sending={sending}
            lastMemoryCreatedCount={0}
            onSend={handleSend}
            onRenameTitle={(title) => activeConversationId && handleRenameConversation(activeConversationId, title)}
          />
        )}
        {view === "memory" && (
          <MemoryView projects={projects} conversations={conversations} onMemoriesChanged={refreshMemoryTotal} />
        )}
      </main>
    </div>
  );
}
