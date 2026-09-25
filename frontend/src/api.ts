export type Project = {
  id: string;
  name: string;
  instructions: string;
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
  execution?: { context?: { skills?: UsedSkill[] } | null } | null;
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

class ApiError extends Error {
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
export const updateProject = (id: string, patch: Partial<Pick<Project, "name" | "instructions">>) =>
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

// ---------- Settings (Central de Configurações) ----------
export type Settings = {
  onboardingCompleted: boolean;
  defaultProvider: string;
  defaultTeacher: string;
  communityManifestUrl: string;
  communityManifestUrlIsDefault?: boolean;
  sandboxDir: string;
};
export const getSettings = () => request<Settings>("/settings");
export const updateSettings = (
  patch: Partial<Pick<Settings, "defaultProvider" | "defaultTeacher" | "communityManifestUrl" | "sandboxDir" | "onboardingCompleted">>,
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

// ---------- Browser agent (controle de navegador via OCR + modelo local) ----------
export type BrowserAgentStep = {
  stage:
    | "preparing-browser"
    | "downloading-browser"
    | "observing"
    | "thinking"
    | "acted"
    | "invalid-action"
    | "error"
    | "finished";
  step?: number;
  url?: string;
  action?: { action: string; target?: string; text?: string; url?: string; key?: string; dy?: number; ms?: number; reason?: string };
  execResult?: { ok: boolean; error?: string; clickedAt?: { x: number; y: number }; finished?: boolean };
  raw?: string;
  message?: string;
  reason?: string;
  at: string;
};
export type BrowserAgentResult = {
  ok: boolean;
  done?: boolean;
  cancelled?: boolean;
  reason?: string;
  error?: string;
  history?: unknown[];
};
export type BrowserAgentRunStatus = {
  status: "running" | "done" | "error" | "cancelled";
  steps: BrowserAgentStep[];
  result: BrowserAgentResult | null;
};
export const getActiveBrowserAgent = () => request<{ runId: string | null }>("/browser-agent/active");
export const startBrowserAgent = (goal: string) =>
  request<{ runId: string }>("/browser-agent/start", { method: "POST", body: JSON.stringify({ goal }) });
export const getBrowserAgentStatus = (runId: string) =>
  request<BrowserAgentRunStatus>(`/browser-agent/${runId}/status`);
export const cancelBrowserAgent = (runId: string) =>
  request<{ cancelled: boolean }>(`/browser-agent/${runId}/cancel`, { method: "POST" });

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
