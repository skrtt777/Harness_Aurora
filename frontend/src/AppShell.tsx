import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import SkillsView from "./SkillsView";
import ChatView from "./ChatView";
import MemoryView from "./MemoryView";
import SettingsView from "./SettingsView";
import WelcomeGuide from "./WelcomeGuide";
import BrowserAgentView from "./BrowserAgentView";
import BrandMark from "./BrandMark";

// O bundle do Atlas 3D (Three.js + react-three-fiber) é o maior do app —
// carregá-lo de olhos fechados penalizava quem só quer conversar. Fica em
// chunk separado, baixado só quando a view "atlas"/"test" é realmente aberta.
const NeuralAtlas = lazy(() => import("./NeuralAtlas"));
import {
  cancelMessage as apiCancelMessage,
  correctMessage as apiCorrectMessage,
  createConversation,
  createProject,
  deleteConversation as apiDeleteConversation,
  duplicateConversation as apiDuplicateConversation,
  deleteProject as apiDeleteProject,
  getConversation,
  getMemoryStats,
  getPendingStage,
  getSavingsStats,
  getSettings,
  listConversations,
  listProjects,
  sendMessage as apiSendMessage,
  updateConversation as apiUpdateConversation,
  updateProject as apiUpdateProject,
  type Conversation,
  type ConversationWithMessages,
  type Project,
  type SavingsStats,
} from "./api";

type View = "chat" | "memory" | "atlas" | "test" | "settings" | "browser-agent" | "skills";

export default function AppShell() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ConversationWithMessages | null>(null);
  const [view, setView] = useState<View>("chat");
  const [guideOpen, setGuideOpen] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const selectedRef = useRef(activeConversationId);
  selectedRef.current = activeConversationId;
  const sending = Boolean(activeConversationId && busyIds.has(activeConversationId));
  const [operationError, setOperationError] = useState("");
  const bootStarted = useRef(false);
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [memoryTotal, setMemoryTotal] = useState(0);
  const [savings, setSavings] = useState<SavingsStats | null>(null);
  const [bootError, setBootError] = useState("");
  const [newConversationProvider, setNewConversationProvider] = useState("codex");
  const [newConversationTeacher, setNewConversationTeacher] = useState("codex");
  // Off-canvas sidebar drawer below the 900px breakpoint (see styles.css).
  // Harmless at desktop widths: the CSS that reacts to "mobile-open" only
  // exists inside that same media query, so toggling this above 900px has
  // no visual effect.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  const refreshMemoryTotal = useCallback(async () => {
    try {
      const stats = await getMemoryStats();
      setMemoryTotal(stats.reduce((sum, row) => sum + row.count, 0));
    } catch {
      // The badge is a nicety; a transient failure here should not block the UI.
    }
  }, []);

  const refreshSavings = useCallback(async () => {
    try {
      setSavings(await getSavingsStats());
    } catch {
      // Same as the memory badge: a nicety, not worth blocking the UI over.
    }
  }, []);

  const refreshLists = useCallback(async () => {
    const [projectList, conversationList] = await Promise.all([listProjects(), listConversations()]);
    setProjects(projectList);
    setConversations(conversationList);
    return conversationList;
  }, []);

  useEffect(() => {
    if (bootStarted.current) return;
    bootStarted.current = true;
    (async () => {
      try {
        // Preferências salvas na Central de Configurações (Marco 2) — antes
        // disso, toda nova sessão sempre voltava pro Codex, mesmo que o
        // usuário só use o modelo Local, por exemplo.
        const settings = await getSettings().catch(() => null);
        if (settings) {
          setNewConversationProvider(settings.defaultProvider);
          setNewConversationTeacher(settings.defaultTeacher);
          setGuideOpen(!settings.onboardingCompleted);
        }

        const conversationList = await refreshLists();
        await Promise.all([refreshMemoryTotal(), refreshSavings()]);
        if (conversationList.length) {
          setActiveConversationId(conversationList[0].id);
        } else {
          const created = await createConversation({
            provider: settings?.defaultProvider,
            teacherProvider: settings?.defaultTeacher,
          });
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
    let stale = false;
    setActiveConversation(null);
    setLoadingConversation(true);
    getConversation(activeConversationId)
      .then(c => { if (!stale) setActiveConversation(c); })
      .catch(error => { if (!stale) setOperationError(error.message); })
      .finally(() => { if (!stale) setLoadingConversation(false); });
    return () => { stale = true; };
  }, [activeConversationId]);

  const extractingMemory = Boolean(activeConversation?.messages.some(m => m.memoryStatus === "pending"));
  useEffect(() => {
    if (!activeConversationId || !extractingMemory || sending) return;
    let stale = false;
    const timer = setInterval(() => {
      getConversation(activeConversationId).then(c => {
        if (!stale && selectedRef.current === c.id && !busyRef.current.has(c.id)) {
          setActiveConversation(c);
          void refreshMemoryTotal();
        }
      }).catch(() => {});
    }, 1500);
    return () => { stale = true; clearInterval(timer); };
  }, [activeConversationId, extractingMemory, sending, refreshMemoryTotal]);

  const activeProject = useMemo(
    () => (activeConversation?.projectId ? projects.find((p) => p.id === activeConversation.projectId) || null : null),
    [activeConversation, projects],
  );

  const handleNewConversation = useCallback(
    async (projectId?: string | null) => {
      const created = await createConversation({
        projectId: projectId || null,
        provider: newConversationProvider,
        teacherProvider: newConversationTeacher,
      });
      setConversations((items) => [created, ...items]);
      setActiveConversationId(created.id);
      setView("chat");
    },
    [newConversationProvider, newConversationTeacher],
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

  const handleMoveConversation = useCallback(
    async (id: string, projectId: string | null) => {
      const updated = await apiUpdateConversation(id, { projectId });
      setConversations((items) => items.map((c) => (c.id === id ? updated : c)));
      setActiveConversation((c) => (c && c.id === id ? { ...c, projectId: updated.projectId } : c));
    },
    [],
  );

  const handleDuplicateConversation = useCallback(async (id: string) => {
    const duplicated = await apiDuplicateConversation(id);
    setConversations((items) => [duplicated, ...items]);
    setActiveConversationId(duplicated.id);
    setView("chat");
  }, []);

  const handleArchiveConversation = useCallback(
    async (id: string, archived: boolean) => {
      await apiUpdateConversation(id, { archived });
      // Archiving/unarchiving moves the conversation in or out of the
      // default (active-only) list — a full refetch is simpler and always
      // correct here, unlike rename/move which just patch a field on a
      // conversation that stays in the same list either way.
      await refreshLists();
    },
    [refreshLists],
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
      const id = activeConversationId;
      if (!id || busyRef.current.has(id)) return false;
      busyRef.current.add(id); setBusyIds(new Set(busyRef.current));
      setOperationError("");
      const temporaryId = `pending-${Date.now()}`;
      setActiveConversation(c => c?.id === id ? { ...c, messages: [...c.messages, {
        id: temporaryId, conversationId: id, role: 'user', content: message,
        memoryAccess: [], memoryCreated: [], createdAt: new Date().toISOString(),
      }] } : c);
      try {
        const result = await apiSendMessage(id, message);
        const [refreshedConversation] = await Promise.all([
          getConversation(id), refreshLists(), refreshMemoryTotal(), refreshSavings(),
        ]);
        if (selectedRef.current === id) setActiveConversation(refreshedConversation);
        if (!result.ok) setOperationError(result.error || "Não foi possível enviar a mensagem.");
        return result.ok;
      } catch (error) {
        setOperationError(error instanceof Error ? error.message : "Falha ao enviar.");
        return false;
      } finally {
        setActiveConversation(c => c?.id === id ? { ...c, messages: c.messages.filter(m => m.id !== temporaryId) } : c);
        busyRef.current.delete(id); setBusyIds(new Set(busyRef.current));
        if (selectedRef.current === id) setPendingStage(null);
      }
    },
    [activeConversationId, refreshLists, refreshMemoryTotal, refreshSavings],
  );

  // Local turns can now take minutes (retries + self-review, all free/local)
  // — poll for a human-readable stage instead of a static "pensando…" so it
  // doesn't look frozen, and stop the moment sending finishes either way.
  useEffect(() => {
    if (!sending || !activeConversationId) {
      setPendingStage(null);
      return;
    }
    let cancelled = false;
    const poll = () => {
      getPendingStage(activeConversationId)
        .then((stage) => {
          if (!cancelled) setPendingStage(stage);
        })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 1200);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sending, activeConversationId]);

  const handleCancel = useCallback(async () => {
    if (!activeConversationId) return;
    await apiCancelMessage(activeConversationId).catch(() => {});
  }, [activeConversationId]);

  const handleCorrect = useCallback(
    async (messageId: string, note: string) => {
      const id = activeConversationId;
      if (!id) return;
      if (busyRef.current.has(id)) throw new Error("Aguarde a operação atual ou cancele-a.");
      busyRef.current.add(id); setBusyIds(new Set(busyRef.current));
      try {
        await apiCorrectMessage(id, messageId, note || undefined);
        const [refreshedConversation] = await Promise.all([
          getConversation(id), refreshMemoryTotal(), refreshSavings(),
        ]);
        if (selectedRef.current === id) setActiveConversation(refreshedConversation);
      } finally {
        busyRef.current.delete(id); setBusyIds(new Set(busyRef.current));
        if (selectedRef.current === id) setPendingStage(null);
      }
    },
    [activeConversationId, refreshMemoryTotal, refreshSavings],
  );

  if (bootError) {
    return (
      <div className="boot-error">
        <h1>Não foi possível iniciar o Harness Aurora</h1>
        <p>{bootError}</p>
        <p>Feche e abra o app de novo. Se persistir, reinstale a versão mais recente.</p>
      </div>
    );
  }

  if (view === "atlas" || view === "test") {
    return (
      <div className="app-shell atlas-takeover">
        <header className="atlas-topbar">
          <button className="atlas-back" onClick={() => setView("chat")}>
            ← Voltar para o chat
          </button>
          <span className="atlas-topbar-title">
            Atlas 3D <em>· {view === "atlas" ? "modo real" : "modo teste"}</em>
          </span>
          <BrandMark compact />
        </header>
        <Suspense fallback={<div className="atlas-loading">Carregando o Atlas 3D…</div>}>
          <NeuralAtlas variant={view === "atlas" ? "real" : "test"} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <button className="menu-toggle" onClick={() => setSidebarOpen(open => !open)} aria-label={sidebarOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={sidebarOpen} aria-controls="app-sidebar">
        {sidebarOpen ? '✕' : '☰'}
      </button>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        projects={projects}
        conversations={conversations}
        activeConversationId={activeConversationId}
        activeView={view}
        memoryCount={memoryTotal}
        savings={savings}
        newConversationProvider={newConversationProvider}
        onSelectNewConversationProvider={setNewConversationProvider}
        newConversationTeacher={newConversationTeacher}
        onSelectNewConversationTeacher={setNewConversationTeacher}
        mobileOpen={sidebarOpen}
        onSelectView={(v) => {
          setView(v);
          setSidebarOpen(false);
        }}
        onSelectConversation={(id) => {
          if(id!==activeConversationId){setActiveConversation(null);setLoadingConversation(true);}
          setActiveConversationId(id);
          setView("chat");
          setSidebarOpen(false);
        }}
        onNewConversation={(projectId) => {
          void handleNewConversation(projectId).catch(e => setOperationError(e.message));
          setSidebarOpen(false);
        }}
        onNewProject={(...args) => { void handleNewProject(...args).catch(e => setOperationError(e.message)); }}
        onRenameConversation={(...args) => { void handleRenameConversation(...args).catch(e => setOperationError(e.message)); }}
        onMoveConversation={(...args) => { void handleMoveConversation(...args).catch(e => setOperationError(e.message)); }}
        onArchiveConversation={(...args) => { void handleArchiveConversation(...args).catch(e => setOperationError(e.message)); }}
        onDeleteConversation={(...args) => { void handleDeleteConversation(...args).catch(e => setOperationError(e.message)); }}
        onRenameProject={(...args) => { void handleRenameProject(...args).catch(e => setOperationError(e.message)); }}
        onDeleteProject={(...args) => { void handleDeleteProject(...args).catch(e => setOperationError(e.message)); }}
      />
      <main className="app-main">
        {operationError && <p role="alert" className="memory-form-error">{operationError} <button onClick={() => setOperationError("")}>Fechar</button></p>}
        {view === "chat" && (
          <ChatView
            conversation={activeConversation}
            project={activeProject}
            loading={loadingConversation}
            sending={sending}
            pendingStage={pendingStage}
            lastMemoryCreatedCount={0}
            onSend={handleSend}
            onCancel={handleCancel}
            onCorrect={handleCorrect}
            onRenameTitle={(title) => { if (activeConversationId) void handleRenameConversation(activeConversationId, title).catch(e => setOperationError(e.message)); }}
            onDuplicate={() => { if (activeConversationId) void handleDuplicateConversation(activeConversationId).catch(e => setOperationError(e.message)); }}
          />
        )}
        {view === "memory" && (
          <MemoryView projects={projects} conversations={conversations} onMemoriesChanged={refreshMemoryTotal} />
        )}
        {view === "settings" && (
          <SettingsView
            onOpenGuide={() => setGuideOpen(true)}
            onDefaultsChanged={(provider, teacher) => {
              setNewConversationProvider(provider);
              setNewConversationTeacher(teacher);
            }}
          />
        )}
        {view === "browser-agent" && <BrowserAgentView />}
        {view === "skills" && <SkillsView />}
      </main>
      {guideOpen && <WelcomeGuide onClose={(settings) => { setGuideOpen(false); if (settings) { setView('settings'); setSidebarOpen(false); } }} />}
    </div>
  );
}
