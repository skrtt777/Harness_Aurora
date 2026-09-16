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
export const getHealth = () => request<{ ok: boolean; provider: { id: string; name: string; configured: boolean } }>("/health");

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
export const createConversation = (data: { projectId?: string | null; title?: string }) =>
  request<Conversation>("/conversations", { method: "POST", body: JSON.stringify(data) });
export const getConversation = (id: string) => request<ConversationWithMessages>(`/conversations/${id}`);
export const updateConversation = (id: string, patch: { title?: string; projectId?: string | null }) =>
  request<Conversation>(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deleteConversation = (id: string) => request<{ ok: true }>(`/conversations/${id}`, { method: "DELETE" });
export const sendMessage = (conversationId: string, message: string, contextLimit?: number) =>
  request<ChatTurnResult>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message, contextLimit }),
  }).catch((error: ApiError) => ({ ok: false, status: error.status, error: error.message }) as ChatTurnResult);

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
}) => request<MemoryEntry>("/memories", { method: "POST", body: JSON.stringify(data) });
export const updateMemory = (id: string, patch: Partial<Pick<MemoryEntry, "title" | "content" | "tags">>) =>
  request<MemoryEntry>(`/memories/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deleteMemory = (id: string) => request<{ ok: true }>(`/memories/${id}`, { method: "DELETE" });
export const getMemoryStats = () => request<{ stats: MemoryStat[] }>("/memories/stats").then((r) => r.stats);
