import "./config.js";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { authorize, readJson, httpError } from "./httpSecurity.js";
import { getDb } from "./db.js";
import { importMemories } from "./memoryImport.js";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProviderConfig, parseCodexOutput, runCodex } from "./codex.js";
import { buildProviderConfig as buildClaudeProviderConfig, runClaude } from "./claude.js";
import { buildProviderConfig as buildLocalProviderConfig, runLocal } from "./local.js";
import {
  CURATED_MODELS,
  getLocalStatus,
  runOllamaSetup,
  setLocalModel,
} from "./ollamaSetup.js";
import {
  createConversation,
  createMemory,
  createProject,
  createRelation,
  deleteConversation,
  deleteMemory,
  deleteProject,
  getConversation,
  getConversationWithMessages,
  getMessage,
  addMessage,
  listConversations,
  listMemories,
  listMessages,
  listProjects,
  countMemories,
  getSavingsStats,
  selectRelevantMemories,
  updateConversation,
  updateMemory,
  updateProject,
  getProject,
  getSetting,
} from "./store.js";
import { extractAndStoreMemories } from "./memoryExtractor.js";
import { correctLocalAnswer } from "./correction.js";
import { refineLocalAnswer } from "./localRefine.js";
import {
  fetchCommunityManifest,
  fetchCommunityBundle,
  resolveCommunityManifestUrl,
} from "./community.js";
import { startTurn, setStage, getStage, endTurn, cancelTurn } from "./pendingTurns.js";
import { createRun, pushStep, finishRun, getRun, getActiveRun, cancelRun } from "./agentRuns.js";
import { getOrLaunchBrowserContext, installChromium, isChromiumInstalled, runBrowserAgent } from "./browserAgent.js";
import { extractRunnableHtml, materializeSandboxFile, readSandboxFile } from "./sandboxCode.js";

const KNOWN_PROVIDERS = ["codex", "claude", "local"];

const root = dirname(fileURLToPath(import.meta.url));
const distDir = join(root, "..", "frontend", "dist");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const appVersion = JSON.parse(readFileSync(join(root, "..", "package.json"), "utf8")).version;

/**
 * Builds the prompt actually sent to Codex: project instructions (if any),
 * then the memories selected for this specific conversation/project/global
 * scope, then the user's task. This is the piece that makes memory
 * functional rather than cosmetic — the model reads back its own notes.
 */
export function buildPrompt({ input, memories = [], instructions = "", history = [], limit = 12000 }) {
  const max = Math.min(64000, Math.max(1000, Number(limit) || 12000));
  const sections = [];
  if (instructions?.trim()) sections.push(`Instruções do projeto:\n${instructions.trim()}`);

  // Templates (reusable code skeletons taught via a correction) are kept
  // separate from plain fact/rule memories and rendered as literal code to
  // adapt, since a weak local model copy-edits far more reliably than it
  // reconstructs boilerplate from a described rule.
  const templates = memories.filter((m) => m.tags?.includes("template"));
  const facts = memories.filter((m) => !m.tags?.includes("template"));

  if (facts.length) {
    const memoryText = facts.map((m) => `- ${m.title}: ${m.content}`).join("\n");
    sections.push(`Memórias relevantes (fatos e regras aprendidos antes — siga-os ao responder):\n${memoryText}`);
  }
  if (templates.length) {
    const templateText = templates.map((m) => `${m.title}:\n${m.content}`).join("\n\n---\n\n");
    sections.push(
      `Esqueleto(s) de código para adaptar (NÃO reescreva do zero — ajuste este código a partir daqui para atender o pedido atual):\n${templateText}`,
    );
  }

  const task = `Tarefa atual:\n${String(input)}`.slice(0, max);
  let remaining = Math.max(0, max - task.length - 2);
  const recent = history.filter(m => ["user", "assistant"].includes(m.role) && m.provider !== "Sistema")
    .map(m => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.content}`);
  const historyBudget = Math.min(remaining, Math.floor(max * 0.55));
  const historyText = recent.length && historyBudget > 25 ? `Histórico recente:\n${recent.join("\n\n").slice(-(historyBudget - 20))}` : "";
  remaining = Math.max(0, remaining - historyText.length - (historyText ? 2 : 0));
  const context = sections.join("\n\n").slice(0, remaining);
  return [context, historyText, task].filter(Boolean).join("\n\n").slice(0, max);
}

/**
 * Runs one full chat turn for a conversation: persists the user message
 * immediately (so it survives even if Codex fails), asks Codex for a
 * reply using memory scoped to this conversation → its project → global,
 * persists the assistant reply, then triggers automatic memory extraction
 * for that exchange.
 */
export async function handleChatTurn({ conversationId, message, contextLimit, env = process.env }) {
  let controller;
  try { controller = startTurn(conversationId); }
  catch (error) { return { ok: false, status: 409, error: error.message }; }
  try {
    const conversation = await getConversation(conversationId);
    if (!conversation) return { ok: false, status: 404, error: "Conversa não encontrada." };

    const trimmed = typeof message === "string" ? message.trim() : "";
    if (!trimmed) return { ok: false, status: 400, error: "A mensagem é obrigatória." };
    if (trimmed.length + 13 > Math.min(64000, Math.max(1000, Number(contextLimit) || 12000))) return { ok: false, status: 400, error: "A mensagem excede o limite de contexto. Divida-a em partes menores." };

    const history = await listMessages(conversationId);
    await addMessage({ conversationId, role: "user", content: trimmed });

    if (conversation.title === "Nova conversa") {
      const title = trimmed.slice(0, 42) + (trimmed.length > 42 ? "…" : "");
      await updateConversation(conversationId, { title });
    }

    const providerLabel =
      conversation.provider === "claude" ? "Claude" : conversation.provider === "local" ? "Local" : "Codex";

    // Keep ownership through retrieval, generation, refinement and persistence.
    const project = conversation.projectId ? await getProject(conversation.projectId) : null;
    const relevant = await selectRelevantMemories(trimmed, {
      conversationId,
      projectId: conversation.projectId,
    }, 12, env, controller.signal);
    const prompt = buildPrompt({
      input: trimmed,
      history,
      memories: relevant,
      instructions: project?.instructions || "",
      limit: contextLimit,
    });

    let result;
    try {
      if (conversation.provider === "local") {
        result = await runLocal(prompt, env, controller.signal);
        // For local conversations, spend a little extra free Ollama compute
        // (never Codex/Claude) trying to catch mistakes before the user sees
        // them: a syntax-check-and-retry pass for generated code, then a
        // self-review pass against the same memories already selected above.
        result = await refineLocalAnswer({
          task: prompt,
          result,
          memories: relevant,
          env,
          signal: controller.signal,
          onStage: (stage) => setStage(conversationId, stage),
        });
      } else {
        result = await (conversation.provider === "claude" ? runClaude : runCodex)(prompt, env, controller.signal);
      }
    } catch (error) {
      result = { ok: false, status: 502, error: error.message };
    }
    if (controller.signal.aborted) result = { ok: false, status: 499, error: "Mensagem cancelada." };

    if (!result.ok) {
      const cancelled = Boolean(controller?.signal.aborted);
      const errorMessage = await addMessage({
        conversationId,
        role: "assistant",
        content: cancelled ? "Mensagem cancelada." : result.error,
        provider: "Sistema",
      });
      return { ok: false, status: result.status, error: result.error, message: errorMessage, cancelled };
    }

    // Local conversations never call the teacher (Codex/Claude) on a normal
    // turn — that would burn a real API call on every message and defeat the
    // whole point of using a free local model. Teaching memory only comes from
    // the user explicitly hitting "Corrigir" (see the /correct route below).
    const memoryCreated = [];

    const assistantMessage = await addMessage({
      conversationId,
      role: "assistant",
      content: result.text,
      provider: providerLabel,
      memoryStatus: conversation.provider === "local" ? "none" : "pending",
      memoryAccess: relevant.map((m) => m.id),
      memoryCreated: memoryCreated.map((m) => m.id),
    });

    if (conversation.provider !== "local") {
      // The answer is durable and can be returned immediately; extraction is best effort.
      void extractAndStoreMemories({ conversationId, projectId: conversation.projectId,
        provider: conversation.provider, userMessage: trimmed, assistantMessage: result.text, env })
        .then(async memories => {
          const db = await getDb();
          db.prepare("UPDATE messages SET memory_created = ?, memory_status = 'complete' WHERE id = ?").run(JSON.stringify(memories.map(m => m.id)), assistantMessage.id);
        }).catch(async error => {
          console.warn("Extração de memória não concluída:", error.message);
          (await getDb()).prepare("UPDATE messages SET memory_status = 'failed' WHERE id = ?").run(assistantMessage.id);
        }).catch(() => {});
    }

    return {
      ok: true,
      status: 200,
      message: assistantMessage,
      memoryAccess: relevant,
      memoryCreated,
      usage: result.usage,
      threadId: result.threadId,
    };
  } finally { endTurn(conversationId, controller); }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "sandbox allow-scripts allow-pointer-lock; default-src 'none'; script-src 'unsafe-inline' https: blob:; style-src 'unsafe-inline' https:; img-src data: blob: https:; media-src data: blob: https:; font-src data: https:; connect-src https:; base-uri 'none'; form-action 'none'",
  });
  response.end(html);
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

export function createServer({ allowDev = !process.versions.electron } = {}) {
  const apiToken = randomBytes(32).toString("hex");
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const { pathname } = url;
      const method = request.method;
      authorize(request, url, apiToken, allowDev);
      if (method === "GET" && pathname === "/api/session") return sendJson(response, 200, { token: apiToken });
      // ---------- Health ----------
      if (method === "GET" && pathname === "/api/health") {
        return sendJson(response, 200, { ok: true, version: appVersion, provider: buildProviderConfig() });
      }
      if (method === "GET" && pathname === "/api/providers") {
        return sendJson(response, 200, {
          providers: [buildProviderConfig(), buildClaudeProviderConfig(), await buildLocalProviderConfig()],
        });
      }

      // ---------- Settings (Central de Configurações) ----------
      // A small, typed surface over the generic settings table — kept
      // narrow (known keys only) rather than exposing raw key/value CRUD,
      // so a stray key never leaks through this endpoint by accident.
      if (method === "GET" && pathname === "/api/settings") {
        const [defaultProvider, defaultTeacher, communityManifestUrl, sandboxDir] = await Promise.all([
          getSetting("default_provider", "codex"),
          getSetting("default_teacher", "codex"),
          getSetting("community_manifest_url"),
          getSetting("sandbox_dir"),
        ]);
        return sendJson(response, 200, {
          defaultProvider,
          defaultTeacher,
          communityManifestUrl: await resolveCommunityManifestUrl(process.env),
          communityManifestUrlIsDefault: !communityManifestUrl && !process.env.COMMUNITY_MANIFEST_URL,
          sandboxDir: sandboxDir || "",
        });
      }
      if (method === "PUT" && pathname === "/api/settings") {
        const body = await readJson(request);
        const values = {};
        if (body.defaultProvider !== undefined) {
          if (!KNOWN_PROVIDERS.includes(body.defaultProvider)) throw httpError(400, "Provedor padrão inválido.");
          values.default_provider = body.defaultProvider;
        }
        if (body.defaultTeacher !== undefined) {
          if (!["codex", "claude"].includes(body.defaultTeacher)) throw httpError(400, "Professor padrão inválido.");
          values.default_teacher = body.defaultTeacher;
        }
        if (body.communityManifestUrl !== undefined) {
          const value = body.communityManifestUrl.trim();
          if (value) {
            let parsed;
            try { parsed = new URL(value); } catch { throw httpError(400, "URL do manifesto inválida."); }
            if (!["http:", "https:"].includes(parsed.protocol)) throw httpError(400, "Use uma URL HTTP/HTTPS.");
          }
          values.community_manifest_url = value;
        }
        if (body.sandboxDir !== undefined) {
          const value = body.sandboxDir.trim();
          if (value && !/^(\/|[a-zA-Z]:[\\/])/.test(value)) throw httpError(400, "Informe uma pasta absoluta.");
          values.sandbox_dir = value;
        }
        const db = await getDb();
        db.exec("BEGIN IMMEDIATE");
        try {
          const save = db.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at");
          for (const [key, value] of Object.entries(values)) save.run(key, value, new Date().toISOString());
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        const [defaultProvider, defaultTeacher, communityManifestUrl, sandboxDir] = await Promise.all([
          getSetting("default_provider", "codex"),
          getSetting("default_teacher", "codex"),
          resolveCommunityManifestUrl(process.env),
          getSetting("sandbox_dir"),
        ]);
        return sendJson(response, 200, { defaultProvider, defaultTeacher, communityManifestUrl, sandboxDir: sandboxDir || "" });
      }

      // ---------- Local (Ollama) setup: makes the local model "just work" ----------
      if (method === "GET" && pathname === "/api/local/status") {
        return sendJson(response, 200, await getLocalStatus());
      }
      if (method === "GET" && pathname === "/api/local/models") {
        return sendJson(response, 200, { models: CURATED_MODELS });
      }
      if (method === "PUT" && pathname === "/api/local/model") {
        const body = await readJson(request);
        try {
          const model = await setLocalModel(body.model);
          return sendJson(response, 200, { model });
        } catch (error) {
          return sendJson(response, 400, { error: error.message });
        }
      }
      if (method === "POST" && pathname === "/api/local/setup") {
        await readJson(request);
        // Server-Sent Events: the frontend opens this with EventSource and
        // renders each stage (baixando instalador → instalando → iniciando
        // → baixando modelo com % → pronto) without polling. Plain HTTP,
        // no extra dependency, matches this server's no-framework style.
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const send = (event) => { if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`); };
        try {
          const result = await runOllamaSetup(process.env, send);
          send({ stage: result.ok ? "done" : "failed", ...result });
        } catch (error) {
          send({ stage: "error", message: error.message || "Falha inesperada ao preparar o modelo local." });
        }
        return response.end();
      }

      // ---------- Browser agent: local model + OCR drive a real browser ----------
      // POST starts a run in the background and returns its id immediately —
      // the run itself can take minutes (each step is a screenshot + OCR +
      // a full local-model call), so the frontend polls GET .../status the
      // same way it already polls /pending for local chat turns, instead of
      // holding one HTTP request open the whole time.
      if (method === "POST" && pathname === "/api/browser-agent/start") {
        const body = await readJson(request);
        const goal = String(body.goal || "").trim();
        if (!goal) return sendJson(response, 400, { error: "Descreva a tarefa que o agente deve realizar." });
        const { id, controller } = createRun();
        (async () => {
          try {
            if (!isChromiumInstalled()) {
              pushStep(id, { stage: "preparing-browser" });
              const installResult = await installChromium((event) => pushStep(id, event));
              if (!installResult.ok) {
                finishRun(id, { ok: false, error: installResult.error });
                return;
              }
            }
            const { page } = await getOrLaunchBrowserContext();
            const result = await runBrowserAgent({
              page,
              goal,
              signal: controller.signal,
              onStep: (event) => pushStep(id, event),
            });
            finishRun(id, result);
          } catch (error) {
            finishRun(id, { ok: false, error: error.message || "Falha inesperada no agente de navegador." });
          }
        })();
        return sendJson(response, 200, { runId: id });
      }
      if (method === "GET" && pathname === "/api/browser-agent/active") {
        return sendJson(response, 200, { runId: getActiveRun()?.id || null });
      }
      const agentStatusMatch = pathname.match(/^\/api\/browser-agent\/([^/]+)\/status$/);
      if (agentStatusMatch && method === "GET") {
        const [, id] = agentStatusMatch;
        const run = getRun(id);
        if (!run) return sendJson(response, 404, { error: "Execução não encontrada." });
        return sendJson(response, 200, { status: run.status, steps: run.steps, result: run.result });
      }
      const agentCancelMatch = pathname.match(/^\/api\/browser-agent\/([^/]+)\/cancel$/);
      if (agentCancelMatch && method === "POST") {
        const [, id] = agentCancelMatch;
        return sendJson(response, 200, { cancelled: cancelRun(id) });
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
        if (body.provider !== undefined && !KNOWN_PROVIDERS.includes(body.provider)) throw httpError(400, "Provedor inválido.");
        if (body.teacherProvider !== undefined && !["codex", "claude"].includes(body.teacherProvider)) throw httpError(400, "Professor inválido.");
        const provider = ["claude", "local"].includes(body.provider) ? body.provider : "codex";
        try {
          const conversation = await createConversation({
            projectId: body.projectId || null,
            title: body.title || "Nova conversa",
            provider,
            teacherProvider: body.teacherProvider === "claude" ? "claude" : "codex",
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
          cancelTurn(id);
          const removed = await deleteConversation(id);
          return removed ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: "Conversa não encontrada." });
        }
      }
      match = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (match) {
        if (method !== "POST") throw httpError(405, "Use POST para enviar mensagens.");
        const [, id] = match;
        const body = await readJson(request);
        const result = await handleChatTurn({
          conversationId: id,
          message: body.message,
          contextLimit: body.contextLimit,
        });
        return sendJson(response, result.status, result);
      }
      match = pathname.match(/^\/api\/conversations\/([^/]+)\/pending$/);
      if (match && method === "GET") {
        const [, id] = match;
        return sendJson(response, 200, { stage: getStage(id) });
      }
      match = pathname.match(/^\/api\/conversations\/([^/]+)\/cancel$/);
      if (match && method === "POST") {
        const [, id] = match;
        return sendJson(response, 200, { cancelled: cancelTurn(id) });
      }
      match = pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/correct$/);
      if (match && method === "POST") {
        const [, conversationId, messageId] = match;
        const conversation = await getConversation(conversationId);
        if (!conversation) return sendJson(response, 404, { error: "Conversa não encontrada." });

        const messages = await listMessages(conversationId);
        const flaggedIndex = messages.findIndex((m) => m.id === messageId);
        if (flaggedIndex < 1) return sendJson(response, 404, { error: "Mensagem não encontrada." });
        const flagged = messages[flaggedIndex];
        if (conversation.provider !== "local" || flagged.role !== "assistant" || flagged.provider !== "Local") return sendJson(response, 400, { error: "Só respostas do modelo local podem ser corrigidas." });
        const question = [...messages.slice(0, flaggedIndex)].reverse().find((m) => m.role === "user");
        if (!question) return sendJson(response, 400, { error: "Não foi possível encontrar a pergunta original." });

        const body = await readJson(request);
        if (messages.some(m => m.correctionOf === messageId)) return sendJson(response, 409, { error: "Esta mensagem já foi corrigida." });
        const correctionController = startTurn(conversationId);
        setStage(conversationId, "Consultando o professor…");
        try {
          const teacherProvider = conversation.teacherProvider === "claude" ? "claude" : "codex";
          const correction = await correctLocalAnswer({
            question: question.content,
            wrongAnswer: flagged.content,
            note: body.note,
            teacherProvider,
            signal: correctionController.signal,
          });
          if (correctionController.signal.aborted) return sendJson(response, 499, { error: "Correção cancelada." });
          if (!correction.ok) return sendJson(response, 502, { error: correction.error });

          const teacherLabel = teacherProvider === "claude" ? "Claude" : "Codex";
          const scope = conversation.projectId ? "project" : "global";
          const savedMemories = [];
          for (const candidate of correction.memories) {
            try {
              savedMemories.push(
                await createMemory({
                  scope,
                  projectId: conversation.projectId || undefined,
                  title: candidate.title,
                  content: candidate.content,
                  tags: candidate.tags,
                  kind: "extracted",
                  source: `Correção ensinada por ${teacherLabel} após resposta do modelo local`,
                }),
              );
            } catch {
              // A malformed teaching memory is skipped instead of failing the correction.
            }
          }
          if (correction.template) {
            try {
              savedMemories.push(
                await createMemory({
                  scope,
                  projectId: conversation.projectId || undefined,
                  title: `Template: ${correction.template.title}`,
                  content: correction.template.content,
                  tags: [...correction.template.tags, "template"],
                  kind: "extracted",
                  source: `Esqueleto ensinado por ${teacherLabel} após resposta do modelo local`,
                }),
              );
            } catch {
              // A malformed template is skipped instead of failing the correction.
            }
          }

          const correctionMessage = await addMessage({
            conversationId,
            role: "assistant",
            content: correction.answer || "O professor não conseguiu gerar uma correção.",
            provider: `${teacherLabel} (corrigindo)`,
            correctionOf: messageId,
            memoryCreated: savedMemories.map((m) => m.id),
          });
          return sendJson(response, 200, { message: correctionMessage, memoryCreated: savedMemories });
        } finally { endTurn(conversationId, correctionController); }
      }

      // ---------- Sandbox de execução (roda código gerado pelo modelo local de verdade) ----------
      // "Materializar" e "servir" recalculam o mesmo caminho de arquivo
      // (sandboxFilePath, em app/sandboxCode.js) a partir de
      // conversationId+conversationTitle+messageId — nenhuma tabela nova é
      // necessária só para lembrar "onde ficou o arquivo desta mensagem".
      match = pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/sandbox$/);
      if (match && method === "POST") {
        const [, conversationId, messageId] = match;
        const conversation = await getConversation(conversationId);
        if (!conversation) return sendJson(response, 404, { error: "Conversa não encontrada." });
        const message = await getMessage(messageId);
        if (!message || message.conversationId !== conversationId) {
          return sendJson(response, 404, { error: "Mensagem não encontrada." });
        }

        const sandboxDir = await getSetting("sandbox_dir");
        if (!sandboxDir) {
          return sendJson(response, 400, {
            error: "Escolha uma pasta para o sandbox de execução na Central de Configurações antes de rodar um código.",
          });
        }

        const extracted = extractRunnableHtml(message.content);
        if (!extracted) {
          return sendJson(response, 400, { error: "Não encontrei nenhum código executável nesta mensagem." });
        }

        try {
          const filePath = await materializeSandboxFile(sandboxDir, {
            conversationId,
            conversationTitle: conversation.title,
            messageId,
            html: extracted.html,
          });
          return sendJson(response, 200, {
            ok: true,
            filePath,
            previewUrl: `/api/conversations/${conversationId}/messages/${messageId}/sandbox/preview`,
          });
        } catch (error) {
          return sendJson(response, 500, {
            error: `Não foi possível salvar o arquivo (${error.message}). Confirme se a pasta escolhida existe e o Harness tem permissão de escrita nela.`,
          });
        }
      }
      match = pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/sandbox\/preview$/);
      if (match && method === "GET") {
        const [, conversationId, messageId] = match;
        const conversation = await getConversation(conversationId);
        const message = await getMessage(messageId);
        if (!message || message.conversationId !== conversationId) return sendHtml(response, 404, "<p>Mensagem não encontrada.</p>");
        const sandboxDir = await getSetting("sandbox_dir");
        if (!conversation || !sandboxDir) {
          return sendHtml(response, 404, "<p>Nada para mostrar ainda — clique em “Executar” na mensagem primeiro.</p>");
        }
        const html = await readSandboxFile(sandboxDir, { conversationId, conversationTitle: conversation.title, messageId });
        if (html === null) {
          return sendHtml(response, 404, "<p>Nada para mostrar ainda — clique em “Executar” na mensagem primeiro.</p>");
        }
        return sendHtml(response, 200, html);
      }

      // ---------- Memories ----------
      if (method === "POST" && pathname === "/api/memories/import") return sendJson(response, 200, await importMemories(await readJson(request)));
      if (method === "GET" && pathname === "/api/memories/stats") {
        return sendJson(response, 200, { stats: await countMemories() });
      }
      if (method === "GET" && pathname === "/api/savings") {
        return sendJson(response, 200, await getSavingsStats());
      }

      // ---------- Community memories (pull-only: never uploads anything) ----------
      if (method === "GET" && pathname === "/api/community/manifest") {
        try {
          return sendJson(response, 200, { bundles: await fetchCommunityManifest() });
        } catch (error) {
          return sendJson(response, 502, { error: error.message });
        }
      }
      match = pathname.match(/^\/api\/community\/bundles\/([^/]+)$/);
      if (match && method === "GET") {
        try {
          return sendJson(response, 200, await fetchCommunityBundle(match[1]));
        } catch (error) {
          return sendJson(response, 502, { error: error.message });
        }
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
      match = pathname.match(/^\/api\/memories\/([^/]+)\/relations$/);
      if (match && method === "POST") {
        const [, id] = match;
        const body = await readJson(request);
        try {
          await createRelation({ fromId: id, toId: body.toId, type: body.type });
          return sendJson(response, 201, { ok: true });
        } catch (error) {
          return sendJson(response, 400, { error: error.message });
        }
      }

      if (method === "GET" && await serveStatic(response, pathname)) return;
      sendJson(response, 404, { error: "Rota não encontrada." });
    } catch (error) {
      if (!response.headersSent) sendJson(response, error.status || 500, { error: error.message || "Erro interno." });
      else response.end();
    }
  });
  server.apiToken = apiToken;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(port, host, () => {
    console.log(`AI Harness disponível em http://${host}:${port}`);
  });
}

export { parseCodexOutput, buildProviderConfig };
