export type Project = {
  id: string;
  name: string;
  instructions: string;
  /** Pasta onde o agente trabalha (vazio = pastas liberadas nas configurações). */
  workspaceDir?: string;
  /** Set when the project belongs to a task agent (its chats live on the Agents page). */
  agentId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  projectId: string | null;
  title: string;
  provider: string;
  teacherProvider: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The comprovante (app/proof.js): where each number of an answer came from. */
export type ProofSource = { tool: string; file: string; name: string; sheet: string | null; cell: string | null; column: string | null; header: string[] | null; row: string[] | null; line: number | null; text: string };
export type ProofClaim = { raw: string; start: number; end: number; kind: 'dinheiro' | 'percentual' | 'data' | 'numero'; status: 'fonte' | 'conta' | 'pedido' | 'sem-prova'; source?: ProofSource; formula?: string; of?: string; others?: number };
export type Proof = { version: number; claims: ProofClaim[]; proven: number; total: number; seal: 'comprovado' | 'parcial' | 'sem-prova'; sources: string[] };
export type AgentStep = { tool: string; args: Record<string, unknown>; ok?: boolean; summary?: string; stage?: string; status?: "running" | "done" | "failed"; ms?: number };
export type TeacherReview = { reason: "errors" | "actions" | null; ms?: number; teacher: string; verdict?: "ok" | "fix"; problems?: string[]; lessonIds?: string[]; skillId?: string; redo?: "ok" | "com_erros" | "falhou"; skipped?: string; error?: string; signals?: string[] };
export type PendingApproval = { id: string; tool: string; summary: string; detail?: string; rule?: string | null; expiresAt?: string };
export type PlanItem = { text: string; status: "pending" | "in_progress" | "done" };
export type PendingTurn = { stage: string | null; steps: AgentStep[]; approval: PendingApproval | null; plan: PlanItem[] | null; partial?: string | null; order?: { deliver: string[]; rules: string[]; run: boolean } | null };
export type UsedSkill = { id: string; name: string; hash: string; partial: boolean };
export type ChatMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  memoryStatus?: "none" | "pending" | "complete" | "failed" | "interrupted";
  correctionOf?: string | null;
  provider?: string;
  memoryAccess: string[];
  memoryCreated: string[];
  createdAt: string;
  execution?: { context?: { skills?: UsedSkill[] } | null; toolSteps?: AgentStep[]; proof?: Proof | null; documentProofs?: { file: string; proof: Proof }[]; review?: TeacherReview | null; moves?: { from: string; to: string }[]; edits?: { file: string }[]; movesUndoneAt?: string } | null;
};

export type ConversationWithMessages = Conversation & { messages: ChatMessage[] };

export type Artifact = {
  id: string; messageId: string; name: string; language: string; previewable: boolean;
  relativePath: string; createdAt: string; start: number; end: number;
};
export type OpenArtifact = Artifact & { content: string; filePath: string };
export async function getArtifacts(conversationId: string): Promise<Artifact[]> {
  return (await request<{ artifacts: Artifact[] }>(`/conversations/${conversationId}/artifacts`)).artifacts;
}
export function openArtifact(conversationId: string, id: string): Promise<OpenArtifact> {
  return request(`/conversations/${conversationId}/artifacts/${id}/open`, { method: 'POST' });
}

export type MemoryScope = "global" | "project" | "conversation";
export type MemoryKind = "manual" | "extracted" | "imported";
export type MemoryRelationType = "belonging" | "thematic" | "derivation" | "correction";

export type MemoryEntry = {
  id: string;
  scope: MemoryScope;
  projectId: string | null;
  conversationId: string | null;
  title: string;
  content: string;
  tags: string[];
  kind: MemoryKind;
  source?: string;
  createdAt: string;
  updatedAt: string;
  relations?: string[];
  relationTypes?: Record<string, MemoryRelationType>;
  status?: "active" | "archived";
  stats?: { uses: number; helped: number; failed: number };
};

export type MemoryStat = { scope: MemoryScope; kind: MemoryKind; count: number };

export type ChatTurnResult = {
  ok: boolean;
  status: number;
  message?: ChatMessage;
  memoryAccess?: MemoryEntry[];
  memoryCreated?: MemoryEntry[];
  error?: string;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let session: Promise<string> | undefined;
async function sessionToken(): Promise<string> {
  if (!session) session = fetch("/api/session", { cache: "no-store" }).then(async r => {
    if (!r.ok) throw new Error("Não foi possível abrir a sessão local.");
    return (await r.json()).token as string;
  }).catch(error => { session = undefined; throw error; });
  return session;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers, "x-harness-token": await sessionToken() },
  });
  if (response.status === 401) session = undefined;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* Some responses (like a 204) may have no JSON body. */
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error?: string }).error)
        : `Falha na requisição (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

// ---------- Health ----------
export type ProviderInfo = { id: string; name: string; mode: string; model: string; configured: boolean };
export const getHealth = () =>
  request<{ ok: boolean; version?: string; provider: ProviderInfo }>("/health");
export const getProviders = () => request<{ providers: ProviderInfo[] }>("/providers").then((r) => r.providers);

// ---------- Projects ----------
export const listProjects = () => request<{ projects: Project[] }>("/projects").then((r) => r.projects);
export const createProject = (data: { name: string; instructions?: string }) =>
  request<Project>("/projects", { method: "POST", body: JSON.stringify(data) });
export const updateProject = (id: string, patch: Partial<Pick<Project, "name" | "instructions" | "workspaceDir">>) =>
  request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deleteProject = (id: string) => request<{ ok: true }>(`/projects/${id}`, { method: "DELETE" });

// ---------- Conversations ----------
/** Full-text search over conversation titles and message content (active conversations only). */
export const searchConversations = (query: string) =>
  request<{ conversations: Conversation[] }>(`/conversations/search?q=${encodeURIComponent(query)}`).then((r) => r.conversations);
export const listConversations = (projectId?: string, archived = false) => {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (archived) params.set("archived", "1");
  const qs = params.toString();
  return request<{ conversations: Conversation[] }>(`/conversations${qs ? `?${qs}` : ""}`).then((r) => r.conversations);
};
export const createConversation = (data: {
  projectId?: string | null;
  title?: string;
  provider?: string;
  teacherProvider?: string;
}) => request<Conversation>("/conversations", { method: "POST", body: JSON.stringify(data) });
export const getConversation = (id: string) => request<ConversationWithMessages>(`/conversations/${id}`);
export const updateConversation = (id: string, patch: { title?: string; projectId?: string | null; archived?: boolean }) =>
  request<Conversation>(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deleteConversation = (id: string) => request<{ ok: true }>(`/conversations/${id}`, { method: "DELETE" });
export const duplicateConversation = (id: string) => request<Conversation>(`/conversations/${id}/duplicate`, { method: "POST" });
export const sendMessage = (conversationId: string, message: string, contextLimit?: number) =>
  request<ChatTurnResult>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message, contextLimit }),
  }).catch((error: ApiError) => ({ ok: false, status: error.status, error: error.message }) as ChatTurnResult);
export const correctMessage = (conversationId: string, messageId: string, note?: string) =>
  request<{ message: ChatMessage; memoryCreated: MemoryEntry[] }>(
    `/conversations/${conversationId}/messages/${messageId}/correct`,
    { method: "POST", body: JSON.stringify({ note }) },
  );
export const getPendingStage = (conversationId: string) =>
  request<{ stage: string | null }>(`/conversations/${conversationId}/pending`).then((r) => r.stage);
export const getPendingTurn = (conversationId: string) =>
  request<PendingTurn>(`/conversations/${conversationId}/pending`).then((r) => ({ stage: r.stage ?? null, steps: r.steps ?? [], approval: r.approval ?? null, plan: r.plan ?? null, order: r.order ?? null }));
export const resolveApproval = (conversationId: string, approvalId: string, approved: boolean, always = false) =>
  request<{ resolved: boolean }>(`/conversations/${conversationId}/approval`, { method: "POST", body: JSON.stringify({ id: approvalId, approved, always }) });
export const cancelMessage = (conversationId: string) =>
  request<{ cancelled: boolean }>(`/conversations/${conversationId}/cancel`, { method: "POST" });

// ---------- Memories ----------
export const listMemories = (filters: Partial<{ scope: MemoryScope; projectId: string; conversationId: string; kind: MemoryKind; query: string }> = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, String(value));
  const qs = params.toString();
  return request<{ memories: MemoryEntry[] }>(`/memories${qs ? `?${qs}` : ""}`).then((r) => r.memories);
};
export const createMemory = (data: {
  scope: MemoryScope;
  projectId?: string;
  conversationId?: string;
  title: string;
  content: string;
  tags?: string[];
  kind?: MemoryKind;
  source?: string;
}) => request<MemoryEntry>("/memories", { method: "POST", body: JSON.stringify(data) });
export const updateMemory = (id: string, patch: Partial<Pick<MemoryEntry, "title" | "content" | "tags">>) =>
  request<MemoryEntry>(`/memories/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deleteMemory = (id: string) => request<{ ok: true }>(`/memories/${id}`, { method: "DELETE" });
export const setMemoryStatus = (id: string, status: "active" | "archived") => request<MemoryEntry>(`/memories/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
export type MemoryUsage = { uses: number; helped: number; failed: number };
export type AtlasMemory = { id: string; position: [number, number, number]; cluster: number; neighbors: { id: string; similarity: number }[]; duplicates: string[]; stats: MemoryUsage };
export type AtlasCluster = { id: number; label: string; count: number; center: [number, number, number] };
export type SystemVitals = {
  cpu: number | null;
  memory: number;
  gpu: { load: number; memory: number; name: string } | null;
  cores: number;
  aurora: { thinking: boolean; stage: string | null; active: number };
  at: number;
};
export const getSystemVitals = () => request<SystemVitals>("/system/vitals");
export type RecallResult = {
  query: string;
  selective: boolean;
  limit: number;
  embeddings: boolean;
  selected: { id: string; title: string; scope: string; rank: number; score: number | null; similarity: number | null; titleMatches: string[]; contentMatches: number }[];
  near: { id: string; title: string; scope: string; similarity: number; why: string }[];
};
export type RecentRecall = { id: string; conversationId: string; conversationTitle: string; at: string; prompt: string; used: string[]; created: string[] };
export const probeRecall = (query: string, projectId?: string) => request<RecallResult>("/memories/recall", { method: "POST", body: JSON.stringify({ query, projectId }) });
export const getRecentRecalls = () => request<{ recalls: RecentRecall[] }>("/memories/recent-recalls?limit=12");
export const getMemoryAtlas = () => request<{ model: string; memories: AtlasMemory[]; clusters: AtlasCluster[] }>("/memories/atlas");
export const getMemoryStats = () => request<{ stats: MemoryStat[] }>("/memories/stats").then((r) => r.stats);
export const createMemoryRelation = (fromId: string, toId: string, type: MemoryRelationType) =>
  request<{ ok: true }>(`/memories/${fromId}/relations`, { method: "POST", body: JSON.stringify({ toId, type }) });

// ---------- Savings ----------
export type SavingsStats = {
  localTurns: number;
  corrections: number;
  baselineCalls: number;
  actualCalls: number;
  savedCalls: number;
  savingsPercent: number;
};
export const getSavingsStats = () => request<SavingsStats>("/savings");

// ---------- Conhecimento da empresa ----------
export type KnowledgeSource = { id: string; name: string; path: string; department: string; paidAllowed: boolean; documents: number; failed: number; indexedAt: string | null; lastError: string | null; job: { total: number; done: number; current: string | null; finished?: boolean } | null };
export type KnowledgeDocument = { title: string; type: string; summary: string; flow: string[]; ocr?: boolean; relPath: string; path: string; source: string; updatedAt: string };
export type KnowledgeCategory = { category: string; documents: KnowledgeDocument[] };
export const getKnowledgeSources = () => request<{ sources: KnowledgeSource[] }>("/knowledge/sources").then((r) => r.sources);
export const createKnowledgeSource = (data: { name: string; department: string; path: string; paidAllowed: boolean }) => request<KnowledgeSource>("/knowledge/sources", { method: "POST", body: JSON.stringify(data) });
export const updateKnowledgeSource = (id: string, patch: Partial<Pick<KnowledgeSource, "name" | "department" | "paidAllowed">>) => request<KnowledgeSource>(`/knowledge/sources/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deleteKnowledgeSource = (id: string) => request<{ ok: boolean }>(`/knowledge/sources/${id}`, { method: "DELETE" });
export const reindexKnowledgeSource = (id: string) => request<{ started: boolean }>(`/knowledge/sources/${id}/reindex`, { method: "POST", body: "{}" });
export const getKnowledgeMap = () => request<{ map: KnowledgeCategory[] }>("/knowledge/map").then((r) => r.map);
export type KnowledgeSuggestion = { id: string; sourceId: string; docId: string; relPath: string; title: string; field: "title" | "summary" | "keywords" | "type" | "category" | "flow"; previous: string | string[] | null; value: string | string[]; reason: string; teacher: string };
export type KnowledgeReview = { teacher: string; reviewed: number; taxonomy: string; suggestions: number; ms: number };
export const reviewKnowledgeSource = (id: string, authorized: boolean) => request<KnowledgeReview>(`/knowledge/sources/${id}/review`, { method: "POST", body: JSON.stringify({ authorized }) });
export const getKnowledgeSuggestions = () => request<{ suggestions: KnowledgeSuggestion[] }>("/knowledge/suggestions").then((r) => r.suggestions);
export const decideKnowledgeSuggestion = (id: string, action: "accept" | "reject") => request<{ ok: true }>(`/knowledge/suggestions/${id}`, { method: "POST", body: JSON.stringify({ action }) });
/** Sector folder found automatically (network drive, SharePoint or a folder the person named). */
export type DiscoveredFolder = { path: string; department: string; name: string; origin: string; documents: number; registered: boolean };
export const discoverKnowledgeFolders = (roots: string[]) => request<{ folders: DiscoveredFolder[] }>("/knowledge/discover", { method: "POST", body: JSON.stringify({ roots }) }).then((r) => r.folders);
export const createKnowledgeSourcesBulk = (folders: { path: string; department: string; name?: string }[]) => request<{ sources: KnowledgeSource[] }>("/knowledge/sources/bulk", { method: "POST", body: JSON.stringify({ folders }) }).then((r) => r.sources);
export const getPersonalFolders = () => request<{ folders: { name: string; path: string }[]; drives: string[] }>("/setup/personal-folders");

// ---------- Avaliação contínua do agente local ----------
export type AgentEvalResult = { id: string; area: string; passed: boolean; ms: number; steps: number; error: string | null; answer: string };
export type AgentEvalRun = { id: string; createdAt: string; model: string; withMemories: boolean; memoryCount: number; passed: number; total: number; summary: { byArea: Record<string, { passed: number; total: number }> }; results: AgentEvalResult[] };
export type AgentEvalState = { status: { running: boolean; progress?: { index: number; total: number; task: string } | null }; runs: AgentEvalRun[] };
export const getAgentEval = () => request<AgentEvalState>("/agent-eval");
export const startAgentEval = (withMemories: boolean) => request<{ id: string }>("/agent-eval/run", { method: "POST", body: JSON.stringify({ withMemories }) });
export const cancelAgentEval = () => request<{ cancelled: boolean }>("/agent-eval/cancel", { method: "POST", body: "{}" });

// ---------- Settings (Central de Configurações) ----------
export type AgentMode = "manual" | "auto" | "plan";
export type Settings = {
  onboardingCompleted: boolean;
  defaultProvider: string;
  defaultTeacher: string;
  communityManifestUrl: string;
  communityManifestUrlIsDefault?: boolean;
  sandboxDir: string;
  /** Quantas vezes o modelo local tenta corrigir sozinho um erro detectado antes de desistir (0–5, padrão 2). */
  localMaxFixAttempts: number;
  /** Tamanho da janela de contexto (num_ctx) enviada ao Ollama, em tokens (2048–32768, padrão 8192). */
  localContextTokens: number;
  /** O chat pode agir no computador (navegador, web, apps, arquivos, comandos). */
  agentToolsEnabled: boolean;
  /** Navegador que o chat controla: Chromium da Aurora ou o Chrome do usuário. */
  browserBackend: "aurora" | "chrome";
  /** Pastas onde o chat lê e salva arquivos sem pedir autorização. */
  agentAllowedRoots: string[];
  /** Uso pessoal: ler e procurar em qualquer disco sem pedir (senhas e sistema continuam pedindo). */
  fullComputerAccess: boolean;
  /** Como a pessoa usa a Aurora, escolhido nos primeiros passos. */
  usageProfile: "pessoal" | "empresa" | "ambos" | null;
  /** manual: pergunta toda alteração; auto: livre na pasta do projeto; plan: só olha. */
  agentMode: AgentMode;
  /** Comandos que o usuário escolheu "sempre permitir". */
  agentAlwaysAllow: { tool: string; prefix: string }[];
  /** actions: revisa erros e entregas que alteraram algo; errors: só erros; off: nunca. */
  teacherMode: "actions" | "errors" | "off";
  teacherDailyLimit: number;
  teacherUsedToday: number;
  /** on: Claude/Codex fazem a tarefa de verdade quando a IA local não consegue. */
  escalationMode: "on" | "off";
  /** espelho: o modelo forte vê só uma cópia com valores falsos e o script roda aqui; livre: vê a pasta real. */
  paidPrivacy: "espelho" | "censura" | "livre";
  /** ativa: o modelo forte faz primeiro o que faz melhor (arquivos, gráficos, análises); quando_falha: só depois de a local falhar. */
  paidHelp: "ativa" | "quando_falha";
  engineDailyLimit: number;
  engineUsedToday: number;
  /** Cada modelo forte: instalado e, se estiver sem limite de uso, até quando. */
  engines: Record<string, { label?: string; installed: boolean; limitedUntil: number | null; reason: string | null }>;
};
export const getSettings = () => request<Settings>("/settings");
export const updateSettings = (
  patch: Partial<Pick<Settings, "defaultProvider" | "defaultTeacher" | "communityManifestUrl" | "sandboxDir" | "onboardingCompleted" | "localMaxFixAttempts" | "localContextTokens" | "agentToolsEnabled" | "browserBackend" | "agentAllowedRoots" | "agentMode" | "agentAlwaysAllow" | "teacherMode" | "teacherDailyLimit" | "escalationMode" | "paidPrivacy" | "paidHelp" | "engineDailyLimit" | "fullComputerAccess" | "usageProfile">>,
) => request<Settings>("/settings", { method: "PUT", body: JSON.stringify(patch) });

// ---------- Local model (Ollama) setup ----------
export type LocalStatus = {
  selection?: 'automatic' | 'manual' | 'environment';
  installed: boolean;
  running: boolean;
  modelReady: boolean;
  ready: boolean;
  model: string;
  platform: string;
};
export type LocalModelOption = { id: string; label: string; size: string; recommendedRamGb: number };
export type LocalSetupEvent = {
  stage:
    | "checking"
    | "downloading-installer"
    | "installing"
    | "installed"
    | "starting"
    | "server-ready"
    | "pulling"
    | "ready"
    | "done"
    | "failed"
    | "error";
  model?: string;
  status?: string;
  completed?: number;
  total?: number;
  message?: string;
  manual?: boolean;
  url?: string;
};

export const getLocalStatus = () => request<LocalStatus>("/local/status");
export type ModelExperiment = {model:string;baseModel:string;training:{trainableParameters:number;examples:number;seconds:number;changedTensors:number};decision:{passed:boolean;reason:string;gainPoints:number;tokenRatio:number;checks:{name:string;passed:boolean}[];baseline:{passed:number;total:number;tokens:number};candidate:{passed:number;total:number;tokens:number}};limitations:string[]};
export const getModelExperiment = () => request<{experiment:ModelExperiment|null}>("/local/training").then(r=>r.experiment);
export const getLocalModels = () => request<{ models: LocalModelOption[] }>("/local/models").then((r) => r.models);
export const setLocalModel = (model: string) =>
  request<{ model: string }>("/local/model", { method: "PUT", body: JSON.stringify({ model }) });

/**
 * Opens the SSE stream that drives the whole "usuário não configura nada"
 * flow (install → start → pull, with progress). Returns a function that
 * closes the connection, so callers can clean up on unmount.
 */
export function watchLocalSetup(onEvent: (event: LocalSetupEvent) => void): () => void {
  const controller = new AbortController();
  void (async () => {
    const response = await fetch("/api/local/setup", {
      method: "POST", body: "{}", signal: controller.signal,
      headers: { "content-type": "application/json", "x-harness-token": await sessionToken() },
    });
    if (!response.ok || !response.body) throw new Error(`Falha ao preparar modelo (${response.status}).`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let terminal = false;
    try {
      while (!terminal) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (!frame.startsWith("data: ")) continue;
          const event = JSON.parse(frame.slice(6)) as LocalSetupEvent;
          if (!controller.signal.aborted) onEvent(event);
          if (["done", "failed", "error"].includes(event.stage)) terminal = true;
        }
        if (done) break;
      }
      if (!terminal && !controller.signal.aborted) throw new Error("Conexão encerrada antes de concluir a preparação. Tente novamente.");
    } finally { await reader.cancel().catch(() => {}); }
  })().catch(error => {
    if (!controller.signal.aborted) onEvent({ stage: "error", message: error.message });
  });
  return () => controller.abort();
}

// O agente de navegador roda hoje só como skill dentro de uma execução por
// etapas (ver app/skills/browser-agent/SKILL.md e app/workflows.js) — não
// tem mais uma tela dedicada, então não há wrapper de API aqui.

// ---------- Sandbox de execução (rodar código gerado pelo modelo local) ----------
export type SandboxRunResult = { ok: true; filePath: string; previewUrl: string };
export const runSandbox = (conversationId: string, messageId: string) =>
  request<SandboxRunResult>(`/conversations/${conversationId}/messages/${messageId}/sandbox`, { method: "POST" });

/**
 * Opens a URL in the user's actual default browser when running inside the
 * Electron app (window.harness, exposed by electron/preload-main.cjs), or
 * falls back to a plain new tab — the only option a normal webpage has —
 * when it isn't (dev mode in a browser, this project's own tests).
 */
/** The path of a file dropped on the window: only in the desktop app ("" in a browser). */
export function droppedFilePath(file: File): string {
  const harness = (window as unknown as { harness?: { pathForFile?: (f: File) => string } }).harness;
  return harness?.pathForFile?.(file) || '';
}

export function openExternalUrl(url: string) {
  const harness = (window as unknown as { harness?: { openExternal?: (url: string) => void } }).harness;
  if (harness?.openExternal) harness.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

/** Native folder picker when running inside Electron; null when unavailable (caller falls back to a text field). */
export async function pickFolder(): Promise<string | null> {
  const harness = (window as unknown as { harness?: { pickFolder?: () => Promise<string | null> } }).harness;
  if (!harness?.pickFolder) return null;
  return harness.pickFolder();
}

type FileBridge = { openFile?: (file: string) => Promise<boolean>; showInFolder?: (file: string) => Promise<boolean> };
const fileBridge = () => (window as unknown as { harness?: FileBridge }).harness;
/** Opening files needs the Electron app; in a plain browser the chat only shows the path. */
export const canOpenFiles = () => Boolean(fileBridge()?.openFile);
export const openDeliveredFile = (file: string) => fileBridge()?.openFile?.(file);
export const showDeliveredFile = (file: string) => fileBridge()?.showInFolder?.(file);

/** Files a turn's actions wrote ("Criei C:\…\x.docx (DOCX, 900 bytes).", "Salvei …", "Editei ….") */
export function deliveredFiles(steps: { tool: string; ok?: boolean; summary?: string }[] = []): string[] {
  const files = steps.filter((s) => s.ok && ["write_document", "write_file", "edit_file"].includes(s.tool))
    .map((s) => /^(?:Criei|Salvei|Editei) (.+?)(?: \(|\.$|$)/.exec(s.summary || "")?.[1])
    .filter((f): f is string => Boolean(f));
  return [...new Set(files)];
}

// ---------- Auto-update (electron-updater via GitHub Releases; Electron only) ----------
export type UpdateStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date"; checkedAt?: string }
  | { status: "downloading"; version?: string; percent?: number }
  | { status: "ready"; version?: string }
  | { status: "error"; message?: string };
export type UpdateState = UpdateStatus & { packaged: boolean; currentVersion: string };
type HarnessUpdater = {
  getUpdateState?: () => Promise<UpdateState>;
  checkForUpdates?: () => Promise<UpdateState>;
  installUpdate?: () => Promise<boolean>;
  onUpdateStatus?: (callback: (status: UpdateStatus) => void) => () => void;
};
const harnessUpdater = () => (window as unknown as { harness?: HarnessUpdater }).harness;

/** Null outside Electron (dev mode in a browser, tests) — caller hides the update UI entirely. */
export async function getUpdateState(): Promise<UpdateState | null> {
  return (await harnessUpdater()?.getUpdateState?.()) ?? null;
}
export async function checkForUpdates(): Promise<UpdateState | null> {
  return (await harnessUpdater()?.checkForUpdates?.()) ?? null;
}
export async function installUpdate(): Promise<boolean> {
  return (await harnessUpdater()?.installUpdate?.()) ?? false;
}
/** Subscribes to live progress; returns an unsubscribe function (no-op outside Electron). */
export function subscribeUpdateStatus(callback: (status: UpdateStatus) => void): () => void {
  return harnessUpdater()?.onUpdateStatus?.(callback) ?? (() => {});
}

// ---------- Community memories (pull-only) ----------
export type CommunityBundleInfo = { id: string; file: string; title: string; description: string; tags: string[] };
export type MemoryExportEnvelope = {
  format: "harness-aurora-memories";
  version: 1;
  exportedAt: string;
  memories: MemoryEntry[];
};
export const getCommunityManifest = () =>
  request<{ bundles: CommunityBundleInfo[] }>("/community/manifest").then((r) => r.bundles);
export const getCommunityBundle = (file: string) => request<MemoryExportEnvelope>(`/community/bundles/${file}`);

export type PublicMemory = { title:string; content:string; tags:string[] };
export type CentralConfig = { downloadEnabled:boolean; shareEnabled:boolean; crossChatEnabled:boolean; intervalHours:number };
export type CentralStatus = { config:CentralConfig; repo:string; count:number; state:{ nextAt?:string; lastSuccessAt?:string; downloadedAt?:string; error?:string|null; changedBundles?:number }; contributions:{id:string;memory:PublicMemory;status:string;createdAt:string;issueUrl?:string;error?:string}[] };
export const getCentralStatus = () => request<CentralStatus>('/central/status');
export const setCentralConfig = (patch:Partial<CentralConfig>) => request<CentralStatus>('/central/config',{method:'PATCH',body:JSON.stringify(patch)});
export const syncCentralMemory = () => request<CentralStatus>('/central/sync',{method:'POST',body:'{}'});
export const getCentralMemories = (query='',limit=100) => request<{memories:(PublicMemory&{id:string;source:string;updatedAt:string})[]}>(`/central/memories?query=${encodeURIComponent(query)}&limit=${limit}`).then(r=>r.memories);
export const checkCentralGitHub = () => request<{login:string}>('/central/github',{method:'POST',body:'{}'});
export const previewCentralContribution = (memory:PublicMemory) => request<{id:string;memory:PublicMemory}>('/central/preview',{method:'POST',body:JSON.stringify(memory)});
export const approveCentralContribution = (memory:PublicMemory,expectedId:string,consent:boolean) => request<CentralStatus>('/central/contributions',{method:'POST',body:JSON.stringify({memory,expectedId,consent})});
export const cancelCentralContribution = (id:string) => request<CentralStatus>(`/central/contributions/${id}/cancel`,{method:'POST',body:'{}'});

export const importMemories = (envelope: unknown) => request<{ imported: number; skipped: number; relationsCreated: number }>("/memories/import", { method: "POST", body: JSON.stringify(envelope) });


export type SkillInfo = { id:string; name:string; description:string; source:string; enabled:boolean; hash:string; estimatedTokens:number;compatibility?:{status:string;reasons:string[]} };
export type WorkflowStep = {id:number;title:string;instruction:string;acceptance:string;format:string;dependsOn:number[];status:string;attempts:number;artifact:string;artifactHash:string;evidence:string[];testsSource?:string;validation?:{status:string;limitation?:string;functional?:{passedCases:string[];totalCases:number}}};
export type Workflow = {id:string;conversationId:string;goal:string;status:string;error?:string;acceptanceHash:string;teacherNotes?:string;teacherError?:string;steps:WorkflowStep[];budget:{maxCalls:number;maxTokens:number;maxDurationMs:number};stats:{localCalls:number;teacherCalls:number;inputTokens:number;outputTokens:number;estimatedTokens:number;elapsedMs:number;reuses:number}};
export const listSkills=()=>request<{skills:SkillInfo[]}>('/skills').then(r=>r.skills);
export const readSkill=(id:string)=>request<SkillInfo & {body:string;text:string;resources:string[]}>('/skills/'+encodeURIComponent(id));
export const importSkill=(data:{content?:string;hermesPath?:string;skillId?:string})=>request<SkillInfo>('/skills/import',{method:'POST',body:JSON.stringify(data)});
export const enableSkill=(id:string,enabled:boolean)=>request('/skills/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({enabled})});
/** Publish a skill's SKILL.md to another harness' folder (agents · claude · codex · hermes). */
export const publishSkill=(id:string,target:string)=>request<{ok:true;path:string}>('/skills/'+encodeURIComponent(id)+'/publish',{method:'POST',body:JSON.stringify({target})});
export const getHermesSkills=()=>request<{revision:string;skills:{name:string;path:string}[]}>('/skills/hermes');
export const getRuntimePolicy=()=>request<{rules:Record<string,string>}>('/runtime-policy');
export const listWorkflows=(id:string)=>request<{workflows:Workflow[]}>('/conversations/'+id+'/workflows').then(r=>r.workflows);
export const createWorkflow=(id:string,goal:string,budget:Record<string,number>,baseWorkflowId?:string,functionalContracts?:unknown,knowledgeMode='none')=>request<Workflow>('/conversations/'+id+'/workflows',{method:'POST',body:JSON.stringify({goal,budget,baseWorkflowId,functionalContracts,knowledgeMode})});
export const getWorkflow=(id:string)=>request<Workflow>('/workflows/'+id);
export const runWorkflow=(id:string)=>request('/workflows/'+id+'/run',{method:'POST'});
export const cancelWorkflow=(id:string)=>request('/workflows/'+id+'/cancel',{method:'POST'});
export const reviewWorkflow=(id:string,data:{accepted:boolean;note:string;stepId?:number;artifactHash:string})=>request<Workflow>('/workflows/'+id+'/review',{method:'POST',body:JSON.stringify(data)});

export const teachWorkflow=(id:string)=>request<Workflow>('/workflows/'+id+'/teach',{method:'POST'});

export const readSkillResource=(id:string,resource:string)=>request<{text:string}>('/skills/'+encodeURIComponent(id)+'?resource='+encodeURIComponent(resource));

export const recheckWorkflow=(id:string,stepId:number)=>request<Workflow>('/workflows/'+id+'/recheck',{method:'POST',body:JSON.stringify({stepId})});

export type SkillCatalogResult={meta:{total:number;generatedAt:string;syncedAt:string}|null;total:number;overallTotal:number;restrictedToCurated:boolean;page:number;limit:number;sources:{source:string;count:number;curated:boolean}[];skills:{id:string;name:string;description:string;source:string;identifier:string;importable:boolean}[]};
export const searchSkillCatalog=(q='',source='',page=0,includeAll=false)=>request<SkillCatalogResult>('/skills/catalog?'+new URLSearchParams({q,source,page:String(page),...(includeAll?{all:'1'}:{})}));
export const syncSkillCatalog=()=>request('/skills/catalog/sync',{method:'POST'});
export const importCatalogSkill=(id:string)=>request<SkillInfo>('/skills/catalog/'+id+'/import',{method:'POST'});
export type EngineKnowledge={id:string;status:string;title:string;goal:string;old:string;fixed:string;evidence:{checks:number;workflowId:string}[];scope:{projectId?:string;conversationId?:string}};
export type EngineMetrics={attempted:number;passedContracts:number;humanAccepted:number;measuredTokens:number;estimatedTokens:number;tokensPerPassed:number|null;elapsedMs:number;references:number;reuses:number};
export type EngineEvaluation={id:string;model:string;seeds:number[];taskCount:number;scope:string;arms:{name:string;runs:number;passed:number;tokens:number;elapsedMs:number;calls:number;repairCalls:number;completeUsage:boolean}[]};
export const getEngineSummary=()=>request<{version:string;knowledge:EngineKnowledge[];metrics:EngineMetrics}>('/engine/summary');
export const getEngineEvaluation=()=>request<{evaluation:EngineEvaluation|null}>('/engine/evaluation').then(r=>r.evaluation);
export const reviewEngineKnowledge=(id:string,accepted:boolean)=>request('/engine/knowledge/'+id+'/review',{method:'POST',body:JSON.stringify({accepted})});

// ---------- Task agents (app/agents.js, app/agentScheduler.js) ----------
export type AgentTrigger =
  | { type: "manual" }
  | { type: "schedule"; everyMinutes?: number; at?: string; weekdays?: number[]; request?: string; quiet?: boolean; quietFrom?: string; quietTo?: string; checklist?: string }
  | { type: "file"; folder: string; pattern?: string; request?: string; quiet?: boolean };
export type TaskAgent = {
  id: string; name: string; kind: "setor" | "pessoal"; mission: string; department: string | null; workDir: string;
  tools: string[] | null; trigger: AgentTrigger; enabled: boolean; projectId: string | null; createdAt: string; updatedAt: string;
  /** Who does the work: the local Aurora, or Claude/Codex without seeing the data (a copy with fake values). */
  engine: AgentEngine;
};
export type AgentEngine = "local" | "claude" | "codex" | "hermes" | "openclaw" | `api-${string}`;
export type AgentRun = {
  id: string; agentId: string; conversationId: string | null; request: string; trigger: "manual" | "schedule" | "file" | "orquestrador"; status: "running" | "done" | "failed";
  startedAt: string; finishedAt: string | null; answer: string | null; files: string[]; steps: number | null; error: string | null;
  moves?: { from: string; to: string }[]; edits?: { file: string }[]; undoneAt?: string | null; quiet?: boolean;
};
export type NewTaskAgent = { name: string; kind: "setor" | "pessoal"; mission: string; department?: string | null; workDir: string; trigger?: AgentTrigger; engine?: AgentEngine };

export const listTaskAgents = () => request<{ agents: TaskAgent[]; runs: AgentRun[] }>("/agents");
export const createTaskAgent = (agent: NewTaskAgent) => request<{ agent: TaskAgent }>("/agents", { method: "POST", body: JSON.stringify(agent) }).then((r) => r.agent);
export const updateTaskAgent = (id: string, patch: Partial<NewTaskAgent> & { enabled?: boolean }) => request<{ agent: TaskAgent }>(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).then((r) => r.agent);
export const deleteTaskAgent = (id: string) => request<{ deleted: boolean }>(`/agents/${id}`, { method: "DELETE" });
/** Puts back the files a run moved; what could not go back is listed with the reason. */
export const undoAgentRun = (runId: string) => request<{ restored: string[]; skipped: { file: string; reason: string }[] }>(`/agents/runs/${runId}/undo`, { method: "POST" });
/** Puts back the files a chat answer moved. */
export const undoMessageMoves = (messageId: string) => request<{ restored: string[]; skipped: { file: string; reason: string }[] }>(`/messages/${messageId}/undo-moves`, { method: "POST" });
export const runTaskAgent = (id: string, requestText: string) => request<{ started: boolean }>(`/agents/${id}/run`, { method: "POST", body: JSON.stringify({ request: requestText }) });
export const listTaskAgentRuns = (id: string) => request<{ runs: AgentRun[] }>(`/agents/${id}/runs`).then((r) => r.runs);
export const createSectorAgents = (baseDir: string) => request<{ agents: TaskAgent[] }>("/agents/sector", { method: "POST", body: JSON.stringify({ baseDir }) }).then((r) => r.agents);

// ---------- Orchestrator (app/orchestrator.js) ----------
export type PlannedTask = { agentId: string; agentName: string; request: string; dependsOn?: string[] };
export type OrchestrationResult = PlannedTask & { status: string; files: string[]; answer: string; error: string | null; conversationId?: string | null };
export type Orchestration = { id: string; request: string; plan: PlannedTask[]; status: "running" | "done" | "partial" | "failed"; startedAt: string; finishedAt: string | null; results: OrchestrationResult[]; summaryFile: string | null };
export const planTeamRequest = (requestText: string) => request<{ tasks: PlannedTask[]; planner: string }>("/agents/plan", { method: "POST", body: JSON.stringify({ request: requestText }) });
export const startTeamRequest = (requestText: string, tasks: PlannedTask[]) => request<{ id: string }>("/agents/orchestrate", { method: "POST", body: JSON.stringify({ request: requestText, tasks }) });
export const listOrchestrations = () => request<{ orchestrations: Orchestration[] }>("/agents/orchestrations").then((r) => r.orchestrations);

/** Every agent run as a CSV (audit trail), saved through the browser's download. */
export const exportAgentRuns = () => downloadCsv("/api/agents/runs.csv", "aurora-agentes");
/** Every action the agent took (wrote, moved, ran, sent) in any conversation: the audit trail. */
export const exportAudit = () => downloadCsv("/api/audit.csv", "aurora-acoes");

async function downloadCsv(path: string, name: string) {
  const response = await fetch(path, { headers: { "x-harness-token": await sessionToken() } });
  if (!response.ok) throw new Error(`Falha ao exportar (${response.status}).`);
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The desktop app asks for the Agents screen (a click on an agent's notification). */
export function onShowAgents(callback: () => void): () => void {
  const harness = (window as unknown as { harness?: { onShowAgents?: (cb: () => void) => () => void } }).harness;
  return harness?.onShowAgents?.(callback) ?? (() => {});
}

let lastWarm = 0;
/** Loads the local model while the person types (at most once a minute; the app ignores it outside the desktop). */
export function warmLocalModel() {
  if (Date.now() - lastWarm < 60_000) return;
  lastWarm = Date.now();
  void request<{ warming: boolean }>("/local/warm", { method: "POST" }).catch(() => {});
}

/** An MCP server the person plugged in (e-mail, calendar…) and what it gives the agent. */
export type McpServer = { name: string; command: string; args: string[]; env?: Record<string, string>; enabled: boolean };
export type McpStatus = { name: string; status: "ativo" | "erro" | "desligado"; tools: string[]; error?: string };
export const getMcp = () => request<{ servers: McpServer[]; status: McpStatus[] }>("/mcp");
export const saveMcp = (servers: McpServer[]) => request<{ servers: McpServer[]; status: McpStatus[] }>("/mcp", { method: "PUT", body: JSON.stringify({ servers }) });

/** The desktop app asks to open a conversation (a click on an authorization notification). */
export function onOpenConversationRequest(callback: (id: string) => void): () => void {
  const harness = (window as unknown as { harness?: { onOpenConversation?: (cb: (id: string) => void) => () => void } }).harness;
  return harness?.onOpenConversation?.(callback) ?? (() => {});
}

/** The video card the local model uses (name, memory in GB), or null when it runs on the processor. */
export type GpuInfo = { name: string; memoryGb: number | null; freeGb: number | null } | null;
export const getLocalHardware = () => request<{ gpu: GpuInfo }>("/local/hardware");

/** The computer map: what is where on the PC (names, types, sizes and dates only). */
export type MapNode = { path: string; name: string; kind: string | null; label: string | null; files: number; bytes: number; size: string; subdirs: number; newest: string | null };
export type MapStatus = { running: boolean; dirs: number; files: number; reread: number; startedAt: string | null; finishedAt: string | null; error: string | null };
export const getComputerMap = () => request<{ enabled: boolean; status: MapStatus; roots: MapNode[] }>("/map");
export const setComputerMap = (enabled: boolean) => request<{ enabled: boolean; status: MapStatus; roots: MapNode[] }>("/map", { method: "PUT", body: JSON.stringify({ enabled }) });
export const getMapChildren = (path: string) => request<{ children: MapNode[] }>(`/map/children?path=${encodeURIComponent(path)}`).then((r) => r.children);
export const searchComputerMap = (q: string) => request<{ files: { path: string; size: string; modified: string | null }[]; folders: MapNode[] }>(`/map/search?q=${encodeURIComponent(q)}`);

/** "Sobre você": what the person wrote, and what the Aurora learned from what they said. */
export type UserProfile = { text: string; learned: { text: string; at: string }[] };
export const getUserProfile = () => request<UserProfile>("/profile");
export const saveUserProfile = (patch: Partial<UserProfile>) => request<UserProfile>("/profile", { method: "PUT", body: JSON.stringify(patch) });

/** Celular (Telegram): the person's bot, linked to their chat. The token is never read back. */
export type TelegramStatus = { configured: boolean; running: boolean; bot: string | null; error: string | null; linked: boolean; pairCode: string | null };
export const getTelegram = () => request<TelegramStatus>("/telegram");
export const connectTelegram = (token: string) => request<TelegramStatus>("/telegram", { method: "PUT", body: JSON.stringify({ token }) });
export const disconnectTelegram = () => request<TelegramStatus>("/telegram", { method: "DELETE" });
export const testTelegram = () => request<{ sent: boolean }>("/telegram/test", { method: "POST" });

/** What the Aurora made today and yesterday (its diary). */
export type DiaryEntry = { day: "hoje" | "ontem"; time: string; title: string; files: string[]; moved: number; undone: boolean };
export const getDiary = () => request<{ entries: DiaryEntry[] }>("/diary").then((r) => r.entries);

// Briefings (app/briefs.js): how a complete delivery of each kind looks.
export interface Brief {
  name: string; title: string; triggers: string[]; avoid: string[]; options: string[];
  disabled: boolean; body: string; text: string; source: "bundled" | "user" | "edited";
}
export const listBriefs = () => request<{ briefs: Brief[] }>("/briefs").then((r) => r.briefs);
export const saveBrief = (content: string) => request<Brief>("/briefs", { method: "POST", body: JSON.stringify({ content }) });
export const setBriefEnabled = (name: string, enabled: boolean) => request<Brief>(`/briefs/${name}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
export const deleteBrief = (name: string) => request<{ brief: Brief | null }>(`/briefs/${name}`, { method: "DELETE" });

// Privacidade (LGPD, art. 18): what the Aurora keeps about a person or a client.
export interface SubjectSearch {
  term: string; total: number; profile: number;
  memories: { id: string; scope: string; title: string; excerpt: string }[];
  conversations: { id: string; title: string; messages: number }[];
}
export const searchSubject = (q: string) => request<SubjectSearch>(`/privacy/search?q=${encodeURIComponent(q)}`);
export const exportSubject = (term: string) => request<Record<string, unknown>>("/privacy/export", { method: "POST", body: JSON.stringify({ term }) });
export const eraseSubject = (term: string) => request<{ memoriesDeleted: number; messagesRedacted: number; conversationsRenamed: number; profileRedacted: boolean }>("/privacy/erase", { method: "POST", body: JSON.stringify({ term, confirm: true }) });

export type BenchMaterial = { id: string; projectId: string; title: string; note: string; source: string; fileName: string | null; sha256: string | null; hasPreview: boolean; createdAt: string };
export type BenchDecision = { id: string; content: string; materialIds: string[]; memoryId: string | null; createdAt: string };
export type BenchSnapshot = { project: { id: string; name: string }; revision: number; executor: string; materials: BenchMaterial[]; decisions: BenchDecision[] };
export type BenchDecisionInput = { operationKey: string; expectedRevision: number; materialIds: string[]; content: string };
export const getBench = (id: string) => request<BenchSnapshot>(`/projects/${encodeURIComponent(id)}/bench`);
export const getBenchPreview = (project: string, id: string) => request<{ image: string; mime: string }>(`/projects/${encodeURIComponent(project)}/bench/materials/${encodeURIComponent(id)}/preview`);
export const saveBenchDecision = (project: string, body: BenchDecisionInput) => request<BenchDecision>(`/projects/${encodeURIComponent(project)}/bench/decisions`, { method: 'POST', body: JSON.stringify(body) });

// The agents' office (app/office.js): the rooms and who is in them, each a real session, agent or teacher.
export type OfficeRoom = { id: string; name: string; kind: "equipe" | "projeto" | "geral"; actors: import("./officeSim").OfficeActor[] };
// The Sede (app/headquarters.js): its departments, and each request's ficha through the delivery line.
export type OfficeFicha = { id: string; title: string; area: string; areaName: string; who: string | null; step: 1 | 2 | 3; since?: number | null; endedAt?: number; order?: { deliver: string[]; rules: string[]; run: boolean } | null; stations: Array<{ id: string; label: string; state: "feito" | "agora" | "pulado" | "falta" | "falhou" }> };
export const getOffice = () => request<{ rooms: OfficeRoom[]; departments?: import("./officeSim").Department[]; fichas?: OfficeFicha[]; updatedAt: string }>("/office");

// The HR team (app/hr.js): each agent's grade from its real deliveries, and what HR decided.
export type HrCard = { agentId: string; name: string; department: string | null; enabled: boolean; score: number | null; runs: number; delivered: number; corrected: number; failed: number; trend: number; stars: number; warnings: number; status: string; lessons: string[]; replacedBy: string | null; replaces: string | null };
export type HrEvent = { id: string; agentId: string | null; kind: string; title: string; detail: string | null; score: number | null; by: string | null; relatedId: string | null; at: string };
export type HrSnapshot = { team: Array<{ id: string; name: string; role: string }>; rules: Record<string, number>; report: HrCard[]; events: HrEvent[]; lastReview: string | null };
export const getHr = () => request<HrSnapshot>("/hr");
export const reviewHr = () => request<HrSnapshot>("/hr/review", { method: "POST", body: "{}" });
export const rehireAgent = (agentId: string) => request<HrSnapshot>("/hr/rehire", { method: "POST", body: JSON.stringify({ agentId }) });

// ---------- Engines by API key (app/apiEngines.js) ----------
export type ApiEnginePreset = { kind: "anthropic" | "openai"; label: string; baseUrl?: string; model?: string; models?: string[] };
export type ApiEngine = { id: string; label: string; kind: "anthropic" | "openai"; baseUrl: string; model: string; hasKey: boolean; keyHint: string };
export type EngineState = { label: string; api: boolean; installed: boolean; limitedUntil: number | null; reason: string | null; probe?: { ok: boolean; at: number; reason: string | null } | null };
/** Installing Hermes / OpenClaw from Configurações, and opening their own setup wizard. */
export type InstallJob = { jobId: string; id: string; label: string; state: "instalando" | "instalado" | "falhou"; lines: string[]; startedAt: number; endedAt: number | null; code: number | null };
export const installEngine = (id: string) => request<InstallJob>(`/engines/${id}/install`, { method: "POST", body: "{}" });
export const installProgress = (jobId: string) => request<InstallJob>(`/engines/install/${jobId}`);
export const openEngineSetup = (id: string) => request<{ ok: boolean; command: string }>(`/engines/${id}/setup`, { method: "POST", body: "{}" });
/** Each strong engine tried for real: one (id), or the ones not tested today. */
export const probeEngines = (id?: string) => request<{ status: Record<string, EngineState> }>("/engines/probe", { method: "POST", body: JSON.stringify(id ? { id } : {}) }).then((r) => r.status);
export const listApiEngines = () => request<{ engines: ApiEngine[]; presets: Record<string, ApiEnginePreset>; status: Record<string, EngineState> }>("/engines");
export const saveApiEngine = (engine: { id?: string; preset?: string; label?: string; kind?: string; baseUrl?: string; model?: string; apiKey?: string }) => request<{ engine: ApiEngine }>("/engines", { method: "POST", body: JSON.stringify(engine) }).then((r) => r.engine);
export const deleteApiEngine = (id: string) => request<{ deleted: boolean }>(`/engines/${encodeURIComponent(id)}`, { method: "DELETE" });
export const testApiEngine = (id: string) => request<{ ok: boolean; ms: number; error: string | null }>(`/engines/${encodeURIComponent(id)}/test`, { method: "POST" });

// ---------- WhatsApp (app/whatsapp.js), a channel of the gateway (app/gateway.js) ----------
export type WhatsappStatus = { status: "desligado" | "conectando" | "aguardando_qr" | "conectado"; qr: string | null; number: string | null; linked: boolean; mode: "proprio" | "numero"; pairCode: string | null; error: string | null; lastClose?: { code: number | null; reason: string; at: string } | null };
export const getWhatsapp = () => request<WhatsappStatus>("/whatsapp");
export const enableWhatsapp = (own = false) => request<WhatsappStatus>("/whatsapp", { method: "PUT", body: JSON.stringify({ own }) });
export const disableWhatsapp = () => request<WhatsappStatus>("/whatsapp", { method: "DELETE" });
export const testWhatsapp = () => request<{ sent: boolean; error?: string }>("/whatsapp/test", { method: "POST" });

// ---------- Top secret (app/blind.js): secret terms and what went out to a paid AI ----------
export type EgressItem = { at: string; engine: string; kind: string; privacy: string; chars: number; text: string; files: string[] };
export const getSecretTerms = () => request<{ terms: string[] }>("/privacy/terms").then((r) => r.terms);
export const saveSecretTerms = (terms: string[]) => request<{ terms: string[] }>("/privacy/terms", { method: "PUT", body: JSON.stringify({ terms }) }).then((r) => r.terms);
export const listEgress = () => request<{ items: EgressItem[] }>("/privacy/egress").then((r) => r.items);

// ---------- Mapa Vivo de Memórias (app/memoryGraph.js, app/memoryEvents.js) ----------
export type GraphMemory = {
  id: string; title: string; scope: "global" | "project" | "conversation"; projectId: string | null; conversationId: string | null;
  kind: string; source: string | null; tags: string[]; snippet: string | null; sensitive: boolean;
  createdAt: string; updatedAt: string; uses: number; helped: number; failed: number; status: string;
};
export type MemoryLiveEvent = {
  type: "hello" | "created" | "updated" | "archived" | "restored" | "deleted" | "recalled" | "scanned" | "turn-start" | "turn-end" | "answered" | "keeper" | "speed";
  at: string; seq?: number; id?: string; ids?: string[]; title?: string; scope?: string; projectId?: string | null; conversationId?: string | null; kind?: string;
  /** scanned: the candidates the memory search really scored, best first. */
  candidates?: { id: string; score: number; similarity: number | null }[];
  /** turn-start: the person's message (start of it). */
  message?: string;
  /** answered: what the saved answer used and created. */
  used?: string[]; created?: string[]; ok?: boolean;
  /** keeper: what the Zeladora did (app/memoryKeeper.js). */
  action?: "round" | "walk" | "read" | "link" | "join" | "compact" | "flag" | "rest" | "called" | "error" | "prune" | "arrival" | "adopt" | "plant" | "node-born" | "node-gone";
  /** prune: the newer memory that replaced it. node-born / node-gone / adopt: the node and where it came from or went. */
  by?: string | null; byTitle?: string | null; node?: number; parent?: number | null; parentSection?: string | null; parentLabel?: string | null;
  into?: number | null; intoSection?: string | null; intoLabel?: string | null; members?: number; why?: string;
  /** plant: the first nodes she planted. */
  nodes?: { node: number; label: string; members: number }[];
  called?: boolean; back?: boolean;
  from?: string; to?: string; kept?: string; section?: string; sentences?: number; merged?: string[]; archived?: string; otherId?: string; reason?: string; similarity?: number;
  otherTitle?: string; archivedTitle?: string; label?: string; total?: number; index?: number; round?: number; until?: string; area?: string;
  areas?: { key: string; label: string; total: number }[];
  sections?: { key: string; label: string; total: number }[];
};
/** One answer of the local model: how fast it read and wrote, how much came from the cache (app/modelSpeed.js). */
export type ModelSpeedSample = { at: number; model: string; engine: string; readTps: number | null; writeTps: number | null; inTokens: number | null; outTokens: number | null; cachedTokens: number | null; cacheShare: number | null; wallMs: number | null; normal?: number | null; slow?: boolean };
export type MemoryGraphSnapshot = {
  generatedAt: string;
  memories: GraphMemory[];
  relations: { from: string; to: string; type: string }[];
  /** nodes: the clusters are the Zeladora's nodes (stable across reloads; she plants, splits and folds them). */
  atlas: { model: string; nodes?: boolean; clusters: { id: number; label: string; count: number; center: number[] }[]; points: { id: string; position: number[]; cluster: number; neighbors: { id: string; similarity: number; across?: boolean }[]; sig?: string }[] } | null;
  projects: { id: string; name: string }[];
  conversations: { id: string; title: string; projectId: string | null }[];
  recalls: { id: string; conversationId: string; conversationTitle: string; at: string; prompt: string; used: string[]; created: string[] }[];
  /** Archived memories and when (the chip's timeline). */
  forgotten?: { id: string; title: string; createdAt: string; archivedAt: string }[];
  events: MemoryLiveEvent[];
  keeper?: KeeperStateApi;
  speed?: { calls: ModelSpeedSample[]; normal: { writeTps: number | null; readTps: number | null } | null };
};
export type KeeperStateApi = {
  running: boolean; enabled: boolean; phase: string; round: number; current: string | null; area: string | null; areaLabel: string | null;
  restUntil: string | null; stats: { read: number; linked: number; joined: number; compacted?: number; flagged: number; pruned?: number; born?: number; folded?: number; adopted?: number };
  /** Her nodes (the sections of the map) and the obsolete memories she pruned (undo brings one back). */
  nodes?: { id: number; label: string; count: number; born?: string; parent?: number | null }[];
  prunes?: { id: string; title?: string; reason: string; by?: string | null; byTitle?: string | null; at: string }[];
  areas: { key: string; label: string; total: number; read: number }[];
  sections?: { key: string; label: string; total: number; read: number }[];
  compactions?: { id: string; from: string[]; title?: string; at: string }[];
  readIds?: string[]; visiting?: string | null;
  recent: (MemoryLiveEvent & { action: string; at: string })[];
  flags: { id: string; otherId: string | null; reason: string; title?: string; otherTitle?: string; similarity?: number; at?: string }[];
  last: { round: number; at: string; read: number; linked: number; joined: number; flagged: number } | null;
};
/** Memories of other harnesses (Hermes, OpenClaw) found on this computer, and bringing them in. */
export type HarnessFound = { harness: "hermes" | "openclaw"; files: { file: string; entries: number }[]; entries: number; sample: string[] };
export const listOtherHarnesses = () => request<{ harnesses: HarnessFound[] }>("/migrate/harnesses").then((r) => r.harnesses);
export const importOtherHarness = (harness: string) => request<{ harness: string; imported: number; skipped: number }>("/migrate/harnesses", { method: "POST", body: JSON.stringify({ harness }) });
export const getMemoryGraph = () => request<MemoryGraphSnapshot>("/memories/graph");
/** The real cosine of two memories' embeddings (null when one has none). */
export const getMemorySimilarity = (a: string, b: string) => request<{ similarity: number | null; model: string }>(`/memories/similarity?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
export const setKeeperEnabled = (enabled: boolean) => request<KeeperStateApi>("/memories/keeper", { method: "PUT", body: JSON.stringify({ enabled }) });
export const undoKeeperJoin = (id: string) => request<{ memory: unknown }>("/memories/keeper/undo", { method: "POST", body: JSON.stringify({ id }) });
export const visitKeeper = (ids: string[], label: string) => request<{ queued: number }>("/memories/keeper/visit", { method: "POST", body: JSON.stringify({ ids, label }) });
export const dismissKeeperFlag = (id: string, otherId?: string) => request<{ flags: KeeperStateApi["flags"] }>("/memories/keeper/dismiss", { method: "POST", body: JSON.stringify({ id, otherId }) });

/**
 * The live memory events (Server-Sent Events read with fetch, so the session token goes as a header).
 * Reconnects with a growing pause; returns the function that stops listening.
 */
export function subscribeMemoryEvents(onEvent: (event: MemoryLiveEvent) => void, onState?: (live: boolean) => void): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let wait = 1000;
  const loop = async () => {
    while (!stopped) {
      controller = new AbortController();
      try {
        const response = await fetch("/api/memories/live", { headers: { "x-harness-token": await sessionToken() }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        onState?.(true); wait = 1000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let cut;
          while ((cut = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
            const data = block.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
            if (data) { try { onEvent(JSON.parse(data)); } catch { /* a broken line is skipped */ } }
          }
        }
      } catch { /* closed, offline or stopped */ }
      onState?.(false);
      if (stopped) break;
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 30_000);
    }
  };
  void loop();
  return () => { stopped = true; controller?.abort(); };
}
