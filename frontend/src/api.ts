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
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  provider?: string;
  memoryAccess: string[];
  memoryCreated: string[];
  createdAt: string;
};

export type ConversationWithMessages = Conversation & { messages: ChatMessage[] };

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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { "content-type": "application/json" },
    ...options,
  });
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
export const listConversations = (projectId?: string) =>
  request<{ conversations: Conversation[] }>(`/conversations${projectId ? `?projectId=${projectId}` : ""}`).then(
    (r) => r.conversations,
  );
export const createConversation = (data: {
  projectId?: string | null;
  title?: string;
  provider?: string;
  teacherProvider?: string;
}) => request<Conversation>("/conversations", { method: "POST", body: JSON.stringify(data) });
export const getConversation = (id: string) => request<ConversationWithMessages>(`/conversations/${id}`);
export const updateConversation = (id: string, patch: { title?: string; projectId?: string | null }) =>
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
