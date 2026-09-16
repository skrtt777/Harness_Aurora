import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProviderConfig, parseCodexOutput, runCodex } from "./codex.js";
import {
  createConversation,
  createMemory,
  createProject,
  deleteConversation,
  deleteMemory,
  deleteProject,
  getConversation,
  getConversationWithMessages,
  addMessage,
  listConversations,
  listMemories,
  listProjects,
  countMemories,
  selectRelevantMemories,
  updateConversation,
  updateMemory,
  updateProject,
  getProject,
} from "./store.js";
import { extractAndStoreMemories } from "./memoryExtractor.js";

const root = dirname(fileURLToPath(import.meta.url));
const distDir = join(root, "..", "frontend", "dist");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

/**
 * Builds the prompt actually sent to Codex: project instructions (if any),
 * then the memories selected for this specific conversation/project/global
 * scope, then the user's task. This is the piece that makes memory
 * functional rather than cosmetic — the model reads back its own notes.
 */
export function buildPrompt({ input, memories = [], instructions = "", limit = 12000 }) {
  const max = Math.max(1000, Number(limit) || 12000);
  const sections = [];
  if (instructions?.trim()) sections.push(`Instruções do projeto:\n${instructions.trim()}`);
  if (memories.length) {
    const memoryText = memories.map((m) => `- ${m.title}: ${m.content}`).join("\n");
    sections.push(`Memórias relevantes:\n${memoryText}`);
  }
  const prefix = sections.length ? `${sections.join("\n\n")}\n\nTarefa atual:\n` : "Tarefa atual:\n";
  const available = Math.max(0, max - prefix.length);
  return prefix + String(input).slice(-available);
}

/**
 * Runs one full chat turn for a conversation: persists the user message
 * immediately (so it survives even if Codex fails), asks Codex for a
 * reply using memory scoped to this conversation → its project → global,
 * persists the assistant reply, then triggers automatic memory extraction
 * for that exchange.
 */
export async function handleChatTurn({ conversationId, message, contextLimit, env = process.env }) {
  const conversation = await getConversation(conversationId);
  if (!conversation) return { ok: false, status: 404, error: "Conversa não encontrada." };

  const trimmed = String(message || "").trim();
  if (!trimmed) return { ok: false, status: 400, error: "A mensagem é obrigatória." };

  await addMessage({ conversationId, role: "user", content: trimmed });

  if (conversation.title === "Nova conversa") {
    const title = trimmed.slice(0, 42) + (trimmed.length > 42 ? "…" : "");
    await updateConversation(conversationId, { title });
  }

  const project = conversation.projectId ? await getProject(conversation.projectId) : null;
  const relevant = await selectRelevantMemories(trimmed, {
    conversationId,
    projectId: conversation.projectId,
  });
  const prompt = buildPrompt({
    input: trimmed,
    memories: relevant,
    instructions: project?.instructions || "",
    limit: contextLimit,
  });

  const result = await runCodex(prompt, env);

  if (!result.ok) {
    const errorMessage = await addMessage({
      conversationId,
      role: "assistant",
      content: result.error,
      provider: "Sistema",
    });
    return { ok: false, status: result.status, error: result.error, message: errorMessage };
  }

  const memoryCreated = await extractAndStoreMemories({
    conversationId,
    userMessage: trimmed,
    assistantMessage: result.text,
    env,
  });

  const assistantMessage = await addMessage({
    conversationId,
    role: "assistant",
    content: result.text,
    provider: "Codex",
    memoryAccess: relevant.map((m) => m.id),
    memoryCreated: memoryCreated.map((m) => m.id),
  });

  return {
    ok: true,
    status: 200,
    message: assistantMessage,
    memoryAccess: relevant,
    memoryCreated,
    usage: result.usage,
    threadId: result.threadId,
  };
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  if (body.length > 1_000_000) throw new Error("Payload muito grande");
  return JSON.parse(body || "{}");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = join(distDir, requested.replace(/^\/+/, ""));
  if (!safePath.startsWith(distDir)) return false;
  try {
    const content = await readFile(safePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".json": "application/json; charset=utf-8",
    };
    response.writeHead(200, { "content-type": types[extname(safePath)] || "application/octet-stream" });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

export function createServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || host}`);
    const { pathname } = url;
    const method = request.method;

    try {
      // ---------- Health ----------
      if (method === "GET" && pathname === "/api/health") {
        return sendJson(response, 200, { ok: true, provider: buildProviderConfig() });
      }

      // ---------- Projects ----------
      if (method === "GET" && pathname === "/api/projects") {
        return sendJson(response, 200, { projects: await listProjects() });
      }
      if (method === "POST" && pathname === "/api/projects") {
        const body = await readJson(request);
        if (!String(body.name || "").trim()) return sendJson(response, 400, { error: "O nome do projeto é obrigatório." });
        return sendJson(response, 201, await createProject(body));
      }
      let match = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (match) {
        const [, id] = match;
        if (method === "GET") {
          const project = await getProject(id);
          return project ? sendJson(response, 200, project) : sendJson(response, 404, { error: "Projeto não encontrado." });
        }
        if (method === "PATCH") {
          const body = await readJson(request);
          const project = await updateProject(id, body);
          return project ? sendJson(response, 200, project) : sendJson(response, 404, { error: "Projeto não encontrado." });
        }
        if (method === "DELETE") {
          const removed = await deleteProject(id);
          return removed ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: "Projeto não encontrado." });
        }
      }

      // ---------- Conversations ----------
      if (method === "GET" && pathname === "/api/conversations") {
        const projectId = url.searchParams.get("projectId") || undefined;
        return sendJson(response, 200, { conversations: await listConversations({ projectId }) });
      }
      if (method === "POST" && pathname === "/api/conversations") {
        const body = await readJson(request);
        try {
          const conversation = await createConversation({
            projectId: body.projectId || null,
            title: body.title || "Nova conversa",
          });
          return sendJson(response, 201, conversation);
        } catch (error) {
          return sendJson(response, 400, { error: error.message });
        }
      }
      match = pathname.match(/^\/api\/conversations\/([^/]+)$/);
      if (match) {
        const [, id] = match;
        if (method === "GET") {
          const conversation = await getConversationWithMessages(id);
          return conversation ? sendJson(response, 200, conversation) : sendJson(response, 404, { error: "Conversa não encontrada." });
        }
        if (method === "PATCH") {
          const body = await readJson(request);
          try {
            const conversation = await updateConversation(id, body);
            return conversation ? sendJson(response, 200, conversation) : sendJson(response, 404, { error: "Conversa não encontrada." });
          } catch (error) {
            return sendJson(response, 400, { error: error.message });
          }
        }
        if (method === "DELETE") {
          const removed = await deleteConversation(id);
          return removed ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: "Conversa não encontrada." });
        }
      }
      match = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (match) {
        const [, id] = match;
        const body = await readJson(request);
        const result = await handleChatTurn({
          conversationId: id,
          message: body.message,
          contextLimit: body.contextLimit,
        });
        return sendJson(response, result.status, result);
      }

      // ---------- Memories ----------
      if (method === "GET" && pathname === "/api/memories/stats") {
        return sendJson(response, 200, { stats: await countMemories() });
      }
      if (method === "GET" && pathname === "/api/memories") {
        const filters = {
          scope: url.searchParams.get("scope") || undefined,
          projectId: url.searchParams.get("projectId") || undefined,
          conversationId: url.searchParams.get("conversationId") || undefined,
          kind: url.searchParams.get("kind") || undefined,
          query: url.searchParams.get("query") || undefined,
        };
        return sendJson(response, 200, { memories: await listMemories(filters) });
      }
      if (method === "POST" && pathname === "/api/memories") {
        const body = await readJson(request);
        try {
          const memory = await createMemory({ ...body, kind: body.kind || "manual" });
          return sendJson(response, 201, memory);
        } catch (error) {
          return sendJson(response, 400, { error: error.message });
        }
      }
      match = pathname.match(/^\/api\/memories\/([^/]+)$/);
      if (match) {
        const [, id] = match;
        if (method === "PATCH") {
          const body = await readJson(request);
          const memory = await updateMemory(id, body);
          return memory ? sendJson(response, 200, memory) : sendJson(response, 404, { error: "Memória não encontrada." });
        }
        if (method === "DELETE") {
          const removed = await deleteMemory(id);
          return removed ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: "Memória não encontrada." });
        }
      }

      if (method === "GET" && await serveStatic(response, pathname)) return;
      sendJson(response, 404, { error: "Rota não encontrada." });
    } catch (error) {
      sendJson(response, 500, { error: error.message || "Erro interno." });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(port, host, () => {
    console.log(`AI Harness disponível em http://${host}:${port}`);
  });
}

export { parseCodexOutput, buildProviderConfig };
