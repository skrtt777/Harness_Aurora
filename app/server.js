import "./config.js";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { engineSummary, reviewEngineKnowledge } from "./evidenceEngine.js";
import { localExperiment } from "./localModelRelease.js";
import { centralStatus, updateCentralConfig, listCentralMemories, previewContribution, approveContribution, cancelContribution, syncCentral, startCentralScheduler, githubIdentity } from "./centralMemory.js";
import { authorize, readJson, httpError } from "./httpSecurity.js";
import { getDb } from "./db.js";
import { undoChanges } from "./undoMoves.js";
import { listMcpServers, mcpStatus, saveMcpServers } from "./mcp.js";
import { detectGpu } from "./llamaServer.js";
import { clearComputerMap, mapChildren, mapSearch, mapStatus, scanComputer, startMapSchedule } from "./computerMap.js";
import { mapEnabled } from "./agentTools/computer.js";
import { getProfile, saveProfile } from "./profile.js";
import { connectTelegram, disconnectTelegram, notifyRunOnPhone, sendToPhone, startTelegram, stopTelegram, telegramStatus } from "./telegram.js";
import { importMemories } from "./memoryImport.js";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProviderConfig, parseCodexOutput } from "./codex.js";
import { buildProviderConfig as buildClaudeProviderConfig } from "./claude.js";
import { buildProviderConfig as buildLocalProviderConfig, LOCAL_SETTINGS_DEFAULTS, LOCAL_CONTEXT_TOKENS_RANGE, LOCAL_MAX_FIX_ATTEMPTS_RANGE } from "./local.js";
import { CURATED_MODELS, getLocalStatus, runOllamaSetup, setLocalModel } from "./ollamaSetup.js";
import { createConversation, createMemory, createProject, createRelation, deleteConversation, deleteMemory, deleteProject, getConversation, getConversationWithMessages, getMessage, addMessage, listConversations, searchConversations, duplicateConversation, listMemories, listMessages, listProjects, countMemories, getSavingsStats, updateConversation, updateMemory, setMemoryStatus, updateProject, getProject, getSetting, setSetting } from "./store.js";
import { correctLocalAnswer } from "./correction.js";
import { fetchCommunityManifest, fetchCommunityBundle, resolveCommunityManifestUrl } from "./community.js";
import { activeTurns, startTurn, setStage, getStage, getPartial, endTurn, cancelTurn, getTurnSteps, getApproval, resolveApproval, getTurnPlan } from "./pendingTurns.js";
import { AGENT_MODES } from "./agentPolicy.js";
import { cancelEvalRun, evalStatus, listEvalRuns, startEvalRun } from "./agentEvalRuns.js";
import { createSource, deleteSource, knowledgeMap, listSources, startIndexing, updateSource } from "./knowledge.js";
import { decideSuggestion, listSuggestions, reviewSourceCards } from "./knowledgeReview.js";
import { memoryAtlas } from "./memoryAtlas.js";
import { systemVitals } from "./systemVitals.js";
import { recallProbe, recentRecalls } from "./memoryRecall.js";
import { ACTION_TOOLS, TEACHER_MODES } from "./teacher.js";
import { protectPort } from "./agentTools/netGuard.js";
import { knownFolders } from "./agentTools/index.js";
import { computerRoots, discoverCompanyFolders, personalFolders } from "./fileAccess.js";
import * as taskAgents from "./agents.js";
import { onAutomaticRun, runStats, startAgentScheduler, stopAgentScheduler } from "./agentScheduler.js";
import { listOrchestrations, planRequest, startOrchestration } from "./orchestrator.js";
import { agentSettingsPayload, correctionContext, handleChatTurn, validateWorkspaceDir, warmLocalChat } from "./chatTurn.js";
import { BROWSER_BACKENDS } from "./browserBackend.js";
import { createRun, pushStep, finishRun, getRun, getActiveRun, cancelRun } from "./agentRuns.js";
import { getOrLaunchBrowserContext, installChromium, isChromiumInstalled, runBrowserAgent } from "./browserAgent.js";
import { extractRunnableHtml, materializeSandboxFile, readSandboxFile } from "./sandboxCode.js";
import { extractArtifacts, listArtifacts, materializeArtifact } from "./artifacts.js";
import { rules, DEFAULT_BUDGET } from "./economy.js";
import { listSkills, readSkill, importSkill, enableSkill, hermesCatalogue, importHermesSkill } from "./skills.js";
import { createWorkflow, listWorkflows, getWorkflow, runWorkflow, reviewWorkflow, cancelWorkflow, isWorkflowActive, acceptanceHash, teachWorkflow, recheckWorkflow } from "./workflows.js";
import { searchSkillCatalog, syncSkillCatalog, importCatalogSkill } from "./skillCatalog.js";
// Tests and scripts import these from here.
export { buildPrompt, handleChatTurn, agentHistory, asksForInformation, fileMentions, knowledgeQuery } from "./chatTurn.js";

const KNOWN_PROVIDERS = ["codex", "claude", "local"];

const root = dirname(fileURLToPath(import.meta.url));
const distDir = join(root, "..", "frontend", "dist");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const appVersion = JSON.parse(readFileSync(join(root, "..", "package.json"), "utf8")).version;

/** A spreadsheet download Excel opens as is (BOM, ";", one line per row). */
function sendCsv(response, name, header, rows) {
  const cell = (v) => { const s = String(v ?? "").replace(/\r?\n/g, " "); return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  response.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(`﻿${[header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n")}\r\n`);
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
      ".png": "image/png",
      ".gif": "image/gif",
      ".json": "application/json; charset=utf-8",
    };
    response.writeHead(200, { "content-type": types[extname(safePath)] || "application/octet-stream" });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

export function createServer({ allowDev = !process.versions.electron, centralSync = true, agentScheduler = Boolean(process.versions.electron), warmLocal = Boolean(process.versions.electron) } = {}) {
  const apiToken = randomBytes(32).toString("hex");
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const { pathname } = url;
      const method = request.method;
      authorize(request, url, apiToken, allowDev);
      if (method === "GET" && pathname === "/api/session") return sendJson(response, 200, { token: apiToken });

      if (pathname === '/api/central/status' && method === 'GET') return sendJson(response, 200, await centralStatus());
      if (pathname === '/api/central/config' && method === 'PATCH') return sendJson(response, 200, await updateCentralConfig(await readJson(request)));
      if (pathname === '/api/central/memories' && method === 'GET') {
        const limit = Number(url.searchParams.get('limit') || 100);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw httpError(400, 'Limite central inválido (1 a 500).');
        return sendJson(response, 200, { memories: await listCentralMemories((url.searchParams.get('query') || '').slice(0,500),limit) });
      }
      if (pathname === '/api/central/sync' && method === 'POST') return sendJson(response, 200, await syncCentral({ manual: true }));
      if (pathname === '/api/central/github' && method === 'POST') return sendJson(response, 200, await githubIdentity());
      if (pathname === '/api/central/preview' && method === 'POST') return sendJson(response, 200, await previewContribution(await readJson(request)));
      if (pathname === '/api/central/contributions' && method === 'POST') return sendJson(response, 201, await approveContribution(await readJson(request)));
      const centralCancel = pathname.match(/^\/api\/central\/contributions\/([a-f0-9]{64})\/cancel$/);
      if (centralCancel && method === 'POST') return sendJson(response, 200, await cancelContribution(centralCancel[1]));

      const artifactsMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/artifacts(?:\/([^/]+)\/open)?$/);
      if (artifactsMatch) {
        const [, conversationId, artifactId] = artifactsMatch;
        const conversation = await getConversationWithMessages(conversationId);
        if (!conversation) return sendJson(response, 404, { error: 'Conversa não encontrada.' });
        if (!artifactId && method === 'GET') return sendJson(response, 200, { artifacts: listArtifacts(conversation.messages) });
        if (artifactId && method === 'POST') {
          const artifact = conversation.messages.flatMap(extractArtifacts).find(item => item.id === artifactId);
          if (!artifact) return sendJson(response, 404, { error: 'Arquivo não encontrado nesta conversa.' });
          return sendJson(response, 200, await materializeArtifact(conversationId, artifact));
        }
      }

      if (method === 'GET' && pathname === '/api/runtime-policy') return sendJson(response, 200, { rules, budget: DEFAULT_BUDGET });
      if(method==='GET'&&pathname==='/api/engine/summary')return sendJson(response,200,await engineSummary());
      if(method==='GET'&&pathname==='/api/engine/evaluation'){
        const evaluation=await readFile(new URL('../reports/engine-evaluation-latest.json',import.meta.url),'utf8').then(JSON.parse).catch(()=>null);
        return sendJson(response,200,{evaluation});
      }
      const engineReview=pathname.match(/^\/api\/engine\/knowledge\/([a-f0-9]{64})\/review$/);
      if(method==='POST'&&engineReview)return sendJson(response,200,await reviewEngineKnowledge(engineReview[1],(await readJson(request)).accepted));
      if (method === 'GET' && pathname === '/api/skills') return sendJson(response, 200, { skills: await listSkills() });
      if (method === 'GET' && pathname === '/api/skills/catalog') return sendJson(response,200,await searchSkillCatalog({query:url.searchParams.get('q')||'',source:url.searchParams.get('source')||'',page:Number(url.searchParams.get('page')||0),includeAll:url.searchParams.get('all')==='1'}));
      if (method === 'POST' && pathname === '/api/skills/catalog/sync') return sendJson(response,200,await syncSkillCatalog());
      const catalogImport=pathname.match(/^\/api\/skills\/catalog\/([a-f0-9]{64})\/import$/);
      if (method === 'POST' && catalogImport) return sendJson(response,201,await importCatalogSkill(catalogImport[1]));
      if (method === 'GET' && pathname === '/api/skills/hermes') return sendJson(response, 200, await hermesCatalogue());
      if (method === 'POST' && pathname === '/api/skills/import') {
        const body = await readJson(request);
        const skill = body.hermesPath ? await importHermesSkill(body.hermesPath) : body.skillId ? await importSkill((await readSkill(body.skillId)).text, 'Cópia local') : await importSkill(body.content);
        return sendJson(response, 201, skill);
      }
      const skillMatch = pathname.match(/^\/api\/skills\/([^/]+)$/);
      if (skillMatch && method === 'GET') return sendJson(response, 200, await readSkill(decodeURIComponent(skillMatch[1]), url.searchParams.get('resource')));
      if (skillMatch && method === 'PATCH') { const body = await readJson(request); return sendJson(response, 200, await enableSkill(decodeURIComponent(skillMatch[1]), body.enabled)); }
      const workflowsMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/workflows$/);
      if (workflowsMatch && method === 'GET') return sendJson(response, 200, { workflows: await listWorkflows(workflowsMatch[1]) });
      if (workflowsMatch && method === 'POST') {
        const body = await readJson(request);
        return sendJson(response, 201, await createWorkflow({ conversationId:workflowsMatch[1], goal:body.goal, budget:body.budget, baseWorkflowId:body.baseWorkflowId, functionalContracts:body.functionalContracts,knowledgeMode:body.knowledgeMode }));
      }
      const workflowMatch = pathname.match(/^\/api\/workflows\/([^/]+)(?:\/(run|review|cancel|teach|recheck))?$/);
      if (workflowMatch) {
        const [, id, action] = workflowMatch;
        const job = await getWorkflow(id);
        if (!action && method === 'GET') return sendJson(response, 200, { ...job, acceptanceHash:acceptanceHash(job) });
        if (action === 'recheck' && method === 'POST') return sendJson(response,200,await recheckWorkflow(id,(await readJson(request)).stepId));
        if (action === 'teach' && method === 'POST') return sendJson(response, 200, await teachWorkflow(id));
        if (action === 'cancel' && method === 'POST') return sendJson(response, 200, cancelWorkflow(id));
        if (action === 'review' && method === 'POST') return sendJson(response, 200, await reviewWorkflow(id, await readJson(request)));
        if (action === 'run' && method === 'POST') {
          if (isWorkflowActive(id)) throw httpError(409, 'Execução já está em andamento.');
          void runWorkflow(id).catch(error => console.warn('Execução interrompida:', error.message));
          return sendJson(response, 202, { id, started:true });
        }
      }

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
        const [defaultProvider, defaultTeacher, communityManifestUrl, sandboxDir, localMaxFixAttempts, localContextTokens] = await Promise.all([
          getSetting("default_provider", "codex"),
          getSetting("default_teacher", "codex"),
          getSetting("community_manifest_url"),
          getSetting("sandbox_dir"),
          getSetting("local_max_fix_attempts"),
          getSetting("local_context_tokens"),
        ]);
        return sendJson(response, 200, {
          defaultProvider,
          defaultTeacher,
          communityManifestUrl: await resolveCommunityManifestUrl(process.env),
          communityManifestUrlIsDefault: !communityManifestUrl && !process.env.COMMUNITY_MANIFEST_URL,
          sandboxDir: sandboxDir || "",
          onboardingCompleted: (await getSetting("onboarding_completed")) === "true",
          // Both fall back to the same defaults/clamps runLocal()/refineLocalAnswer()
          // already apply when nothing is configured — see LOCAL_SETTINGS_DEFAULTS.
          localMaxFixAttempts: localMaxFixAttempts !== null ? Number(localMaxFixAttempts) : LOCAL_SETTINGS_DEFAULTS.maxFixAttempts,
          localContextTokens: localContextTokens !== null ? Number(localContextTokens) : LOCAL_SETTINGS_DEFAULTS.contextTokens,
          ...(await agentSettingsPayload()),
        });
      }
      if (method === "PUT" && pathname === "/api/settings") {
        const body = await readJson(request);
        const values = {};
        if (body.onboardingCompleted !== undefined) {
          if (typeof body.onboardingCompleted !== "boolean") throw httpError(400, "Estado do guia inválido.");
          values.onboarding_completed = String(body.onboardingCompleted);
        }
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
        if (body.localMaxFixAttempts !== undefined) {
          const value = Number(body.localMaxFixAttempts);
          if (!Number.isInteger(value) || value < LOCAL_MAX_FIX_ATTEMPTS_RANGE.min || value > LOCAL_MAX_FIX_ATTEMPTS_RANGE.max) {
            throw httpError(400, `Tentativas de correção devem ser um número inteiro entre ${LOCAL_MAX_FIX_ATTEMPTS_RANGE.min} e ${LOCAL_MAX_FIX_ATTEMPTS_RANGE.max}.`);
          }
          values.local_max_fix_attempts = value;
        }
        if (body.localContextTokens !== undefined) {
          const value = Number(body.localContextTokens);
          if (!Number.isInteger(value) || value < LOCAL_CONTEXT_TOKENS_RANGE.min || value > LOCAL_CONTEXT_TOKENS_RANGE.max) {
            throw httpError(400, `Contexto local deve ser um número inteiro entre ${LOCAL_CONTEXT_TOKENS_RANGE.min} e ${LOCAL_CONTEXT_TOKENS_RANGE.max}.`);
          }
          values.local_context_tokens = value;
        }
        if (body.agentToolsEnabled !== undefined) {
          if (typeof body.agentToolsEnabled !== "boolean") throw httpError(400, "Valor inválido para as ações do agente.");
          values.agent_tools_enabled = String(body.agentToolsEnabled);
        }
        if (body.browserBackend !== undefined) {
          if (!BROWSER_BACKENDS.includes(body.browserBackend)) throw httpError(400, "Navegador inválido.");
          values.browser_backend = body.browserBackend;
        }
        if (body.teacherMode !== undefined) {
          if (!TEACHER_MODES.includes(body.teacherMode)) throw httpError(400, "Modo do professor inválido.");
          values.teacher_mode = body.teacherMode;
        }
        if (body.teacherDailyLimit !== undefined) {
          if (!Number.isInteger(body.teacherDailyLimit) || body.teacherDailyLimit < 0 || body.teacherDailyLimit > 1000) throw httpError(400, "Limite diário do professor deve ser de 0 a 1000.");
          values.teacher_daily_limit = String(body.teacherDailyLimit);
        }
        if (body.agentMode !== undefined) {
          if (!AGENT_MODES.includes(body.agentMode)) throw httpError(400, "Modo do agente inválido.");
          values.agent_mode = body.agentMode;
        }
        if (body.agentAlwaysAllow !== undefined) {
          if (!Array.isArray(body.agentAlwaysAllow) || body.agentAlwaysAllow.length > 50 || body.agentAlwaysAllow.some((r) => !r || r.tool !== "run_command" || typeof r.prefix !== "string" || !r.prefix.trim() || r.prefix.length > 120)) throw httpError(400, "Regras de permissão inválidas.");
          values.agent_always_allow = JSON.stringify(body.agentAlwaysAllow.map((r) => ({ tool: r.tool, prefix: r.prefix.trim().toLowerCase() })));
        }
        if (body.fullComputerAccess !== undefined) {
          if (typeof body.fullComputerAccess !== "boolean") throw httpError(400, "Opção de acesso inválida.");
          values.full_computer_access = String(body.fullComputerAccess);
        }
        if (body.usageProfile !== undefined) {
          if (!["pessoal", "empresa", "ambos"].includes(body.usageProfile)) throw httpError(400, "Perfil de uso inválido.");
          values.usage_profile = body.usageProfile;
        }
        if (body.agentAllowedRoots !== undefined) {
          if (!Array.isArray(body.agentAllowedRoots) || body.agentAllowedRoots.length > 20 || body.agentAllowedRoots.some((p) => typeof p !== "string" || !/^(\/|[a-zA-Z]:[\\/])/.test(p.trim()))) throw httpError(400, "Informe pastas absolutas.");
          values.agent_allowed_roots = JSON.stringify(body.agentAllowedRoots.map((p) => p.trim()));
        }
        const db = await getDb();
        db.exec("BEGIN IMMEDIATE");
        try {
          const save = db.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at");
          for (const [key, value] of Object.entries(values)) save.run(key, value, new Date().toISOString());
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        const [defaultProvider, defaultTeacher, communityManifestUrl, sandboxDir, localMaxFixAttempts, localContextTokens] = await Promise.all([
          getSetting("default_provider", "codex"),
          getSetting("default_teacher", "codex"),
          resolveCommunityManifestUrl(process.env),
          getSetting("sandbox_dir"),
          getSetting("local_max_fix_attempts"),
          getSetting("local_context_tokens"),
        ]);
        return sendJson(response, 200, {
          defaultProvider, defaultTeacher, communityManifestUrl, sandboxDir: sandboxDir || "",
          onboardingCompleted: (await getSetting("onboarding_completed")) === "true",
          localMaxFixAttempts: localMaxFixAttempts !== null ? Number(localMaxFixAttempts) : LOCAL_SETTINGS_DEFAULTS.maxFixAttempts,
          localContextTokens: localContextTokens !== null ? Number(localContextTokens) : LOCAL_SETTINGS_DEFAULTS.contextTokens,
          ...(await agentSettingsPayload()),
        });
      }

      // ---------- Local (Ollama) setup: makes the local model "just work" ----------
      if (method === "GET" && pathname === "/api/local/status") {
        return sendJson(response, 200, await getLocalStatus());
      }
      // Where the local model runs: the video card and its memory, or the processor.
      if (method === "GET" && pathname === "/api/local/hardware") return sendJson(response, 200, { gpu: await detectGpu() });
      if (method === "GET" && pathname === "/api/local/models") {
        return sendJson(response, 200, { models: CURATED_MODELS });
      }
      if (method === "GET" && pathname === "/api/local/training") {
        return sendJson(response, 200, {experiment:await localExperiment()});
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

      // ---------- Conhecimento da empresa (pastas da rede / SharePoint) ----------
      // Task agents (agents.js): list, create, change, remove, run, history.
      if (method === "GET" && pathname === "/api/agents") return sendJson(response, 200, { agents: await taskAgents.listAgents(), runs: await taskAgents.listRuns({ limit: 20 }) });
      if (method === "POST" && pathname === "/api/agents") return sendJson(response, 201, { agent: await taskAgents.createAgent(await readJson(request)) });
      if (method === "POST" && pathname === "/api/agents/sector") {
        const body = await readJson(request);
        const departments = [...new Set((await listSources()).map((s) => s.department).filter(Boolean))];
        return sendJson(response, 201, { agents: await taskAgents.createSectorAgents({ baseDir: body.baseDir, departments: body.departments || departments }) });
      }
      // Orchestrator (orchestrator.js): plan a big request among the agents, the person checks
      // the plan, then it runs and leaves a summary document.
      if (method === "POST" && pathname === "/api/agents/plan") {
        const body = await readJson(request);
        if (!String(body.request || "").trim()) throw httpError(400, "Diga o que a equipe deve fazer.");
        return sendJson(response, 200, await planRequest({ request: String(body.request).slice(0, 4000), agents: await taskAgents.listAgents() }));
      }
      if (method === "POST" && pathname === "/api/agents/orchestrate") {
        const body = await readJson(request);
        const known = new Map((await taskAgents.listAgents()).map((a) => [a.id, a]));
        const tasks = (Array.isArray(body.tasks) ? body.tasks : []).filter((t) => known.has(t?.agentId) && String(t.request || "").trim())
          .slice(0, 12).map((t) => ({ agentId: t.agentId, agentName: known.get(t.agentId).name, request: String(t.request).slice(0, 2000), dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter((id) => known.has(id)) : [] }))
          // A task waits only for tasks listed before it (as the plan was made): no cycles.
          .map((t, i, all) => ({ ...t, dependsOn: t.dependsOn.filter((id) => all.slice(0, i).some((p) => p.agentId === id)) }));
        const dir = typeof body.dir === "string" && body.dir.trim() ? body.dir.trim() : join((await knownFolders()).documents, "Aurora", "Equipe");
        const { id } = await startOrchestration({ request: String(body.request || ""), tasks, dir, runAgent: taskAgents.runAgent, handleChatTurn });
        return sendJson(response, 202, { id });
      }
      if (method === "GET" && pathname === "/api/agents/orchestrations") return sendJson(response, 200, { orchestrations: await listOrchestrations() });
      // Audit trail for company use: every agent run as a spreadsheet (Excel opens the CSV).
      // The person started typing in a local conversation: the model loads while they write
      // instead of after they send. Desktop app only (tests and the browser build never spawn it).
      if (method === "POST" && pathname === "/api/local/warm") {
        if (warmLocal) void warmLocalChat().catch(() => {});
        return sendJson(response, 202, { warming: warmLocal });
      }
      // Celular (Telegram): the person's own bot, linked to one chat. The token never comes back out.
      if (pathname === "/api/telegram" && method === "GET") return sendJson(response, 200, await telegramStatus());
      if (pathname === "/api/telegram" && method === "PUT") return sendJson(response, 200, await connectTelegram((await readJson(request)).token, { handleChatTurn }));
      if (pathname === "/api/telegram" && method === "DELETE") return sendJson(response, 200, await disconnectTelegram());
      if (pathname === "/api/telegram/test" && method === "POST") return sendJson(response, 200, { sent: await sendToPhone("Teste da Aurora: este chat está ligado ao seu computador.") });
      // "Sobre você": the person's profile, in every conversation.
      if (pathname === "/api/profile" && method === "GET") return sendJson(response, 200, await getProfile());
      if (pathname === "/api/profile" && method === "PUT") return sendJson(response, 200, await saveProfile(await readJson(request)));
      // The computer map: on/off, progress, the tree and the name search.
      if (pathname === "/api/map" && method === "GET") return sendJson(response, 200, { enabled: await mapEnabled(), status: mapStatus(), roots: await mapChildren(null) });
      if (pathname === "/api/map" && method === "PUT") {
        const { enabled } = await readJson(request);
        await setSetting("computer_map", enabled ? "true" : "false");
        if (enabled) void scanComputer({ shouldPause: () => activeTurns().count > 0 });
        else await clearComputerMap(); // off means forgotten, not just paused
        return sendJson(response, 200, { enabled: Boolean(enabled), status: mapStatus(), roots: await mapChildren(null) });
      }
      if (pathname === "/api/map/children" && method === "GET") return sendJson(response, 200, { children: await mapChildren(url.searchParams.get("path") || null) });
      if (pathname === "/api/map/search" && method === "GET") return sendJson(response, 200, await mapSearch(url.searchParams.get("q") || "", { limit: 30 }));
      // MCP extensions: the servers the person plugged in, with each one's tools or error.
      if (pathname === "/api/mcp" && method === "GET") return sendJson(response, 200, { servers: await listMcpServers(), status: await mcpStatus() });
      if (pathname === "/api/mcp" && method === "PUT") {
        const body = await readJson(request);
        await saveMcpServers(body.servers);
        return sendJson(response, 200, { servers: await listMcpServers(), status: await mcpStatus() });
      }
      // A chat turn that moved files ("organize meus Downloads") can be undone too.
      const messageUndo = pathname.match(/^\/api\/messages\/([0-9a-f-]{36})\/undo-moves$/);
      if (method === "POST" && messageUndo) {
        const message = await getMessage(messageUndo[1]);
        const moves = message?.execution?.moves || [], edits = message?.execution?.edits || [];
        if (!message) throw httpError(404, "Mensagem não encontrada.");
        if (message.execution?.movesUndoneAt) throw httpError(409, "Estas mudanças já foram desfeitas.");
        if (!moves.length && !edits.length) throw httpError(400, "Esta resposta não moveu nem editou arquivos.");
        const result = await undoChanges({ moves, edits });
        (await getDb()).prepare("UPDATE messages SET execution = ? WHERE id = ?").run(JSON.stringify({ ...message.execution, movesUndoneAt: new Date().toISOString() }), message.id);
        return sendJson(response, 200, result);
      }
      const undoMatch = pathname.match(/^\/api\/agents\/runs\/([0-9a-f-]{36})\/undo$/);
      if (method === "POST" && undoMatch) return sendJson(response, 200, await taskAgents.undoRunMoves(undoMatch[1]));
      if (method === "GET" && pathname === "/api/agents/runs.csv") {
        const names = new Map((await taskAgents.listAgents()).map((a) => [a.id, a.name]));
        const rows = (await taskAgents.listRuns({ limit: 5000 })).map((r) => [r.startedAt, r.finishedAt || "", names.get(r.agentId) || r.agentId, r.trigger, r.status, r.request, r.files.join(" | "), r.steps ?? "", r.error || ""]);
        return sendCsv(response, "aurora-agentes", ["Início", "Fim", "Agente", "Gatilho", "Situação", "Pedido", "Arquivos entregues", "Passos", "Erro"], rows);
      }
      // Audit trail of everything the agent DID (wrote, moved, ran, sent), in any conversation.
      if (method === "GET" && pathname === "/api/audit.csv") {
        const db = await getDb();
        const rows = [];
        for (const m of db.prepare("SELECT m.created_at, m.execution, c.title FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.role = 'assistant' AND m.execution LIKE '%toolSteps%' ORDER BY m.created_at").all()) {
          let steps = [];
          try { steps = JSON.parse(m.execution).toolSteps || []; } catch { /* unreadable: skipped */ }
          for (const s of steps.filter((s) => ACTION_TOOLS.has(s.tool))) rows.push([m.created_at, m.title, s.tool, s.summary || JSON.stringify(s.args || {}).slice(0, 300), s.denied ? "negado" : s.ok ? "feito" : "falhou"]);
        }
        return sendCsv(response, "aurora-acoes", ["Quando", "Conversa", "Ferramenta", "O que fez", "Resultado"], rows);
      }
      const taskAgentMatch = pathname.match(/^\/api\/agents\/([^/]+)(\/run|\/runs)?$/);
      if (taskAgentMatch) {
        const [, id, sub] = taskAgentMatch;
        if (!sub && method === "PATCH") return sendJson(response, 200, { agent: await taskAgents.updateAgent(id, await readJson(request)) });
        if (!sub && method === "DELETE") { await taskAgents.deleteAgent(id); return sendJson(response, 200, { deleted: true }); }
        if (sub === "/runs" && method === "GET") return sendJson(response, 200, { runs: await taskAgents.listRuns({ agentId: id }) });
        if (sub === "/run" && method === "POST") {
          const body = await readJson(request);
          if (!(await taskAgents.getAgent(id))) throw httpError(404, "Agente não encontrado.");
          if (taskAgents.isAgentRunning(id)) throw httpError(409, "O agente já está trabalhando.");
          // Runs in the background; the history (GET /runs) shows it running and then its delivery.
          void taskAgents.runAgent(id, { request: body.request, trigger: "manual", handleChatTurn }).catch(() => {});
          return sendJson(response, 202, { started: true });
        }
      }
      if (method === "GET" && pathname === "/api/knowledge/sources") return sendJson(response, 200, { sources: await listSources() });
      if (method === "POST" && pathname === "/api/knowledge/sources") {
        const body = await readJson(request);
        if (body.paidAllowed !== undefined && typeof body.paidAllowed !== "boolean") throw httpError(400, "Opção paidAllowed inválida.");
        const source = await createSource({ name: body.name, path: body.path, department: body.department, paidAllowed: body.paidAllowed === true });
        void startIndexing(source.id).catch(() => {});
        return sendJson(response, 201, source);
      }
      // Folder setup (fileAccess.js): company sector folders found automatically, confirmed in
      // bulk; personal folders indexed by meaning.
      if (method === "POST" && pathname === "/api/knowledge/discover") {
        const body = await readJson(request);
        const roots = Array.isArray(body.roots) ? body.roots.filter((r) => typeof r === "string" && r.trim()).slice(0, 10) : [];
        const existing = new Set((await listSources()).map((s) => s.path.toLowerCase()));
        return sendJson(response, 200, { folders: (await discoverCompanyFolders({ roots })).map((f) => ({ ...f, registered: existing.has(f.path.toLowerCase()) })) });
      }
      if (method === "POST" && pathname === "/api/knowledge/sources/bulk") {
        const body = await readJson(request);
        if (!Array.isArray(body.folders) || !body.folders.length || body.folders.length > 40) throw httpError(400, "Envie de 1 a 40 pastas.");
        const existing = new Set((await listSources()).map((s) => s.path.toLowerCase()));
        const created = [];
        for (const f of body.folders) {
          if (!f || existing.has(String(f.path).toLowerCase())) continue;
          const source = await createSource({ name: f.name || `${f.department} (${String(f.path).split(/[\\/]/).filter(Boolean).pop()})`, path: f.path, department: f.department, paidAllowed: f.paidAllowed === true });
          void startIndexing(source.id).catch(() => {});
          created.push(source);
        }
        return sendJson(response, 201, { sources: created });
      }
      if (method === "GET" && pathname === "/api/setup/personal-folders") return sendJson(response, 200, { folders: personalFolders(), drives: computerRoots() });
      if (method === "GET" && pathname === "/api/knowledge/map") return sendJson(response, 200, { map: await knowledgeMap({ department: url.searchParams.get("department") || undefined }) });
      // The paid teacher reviews the cards the local model wrote; the person decides.
      const reviewMatch = pathname.match(/^\/api\/knowledge\/sources\/([^/]+)\/review$/);
      if (reviewMatch && method === "POST") {
        const body = await readJson(request);
        if (body.authorized !== undefined && typeof body.authorized !== "boolean") throw httpError(400, "Opção authorized inválida.");
        return sendJson(response, 200, await reviewSourceCards(reviewMatch[1], { authorized: body.authorized === true, provider: body.provider === "claude" ? "claude" : body.provider === "codex" ? "codex" : undefined }));
      }
      if (method === "GET" && pathname === "/api/knowledge/suggestions") return sendJson(response, 200, { suggestions: await listSuggestions({ sourceId: url.searchParams.get("sourceId") || undefined }) });
      const suggestionMatch = pathname.match(/^\/api\/knowledge\/suggestions\/([^/]+)$/);
      if (suggestionMatch && method === "POST") return sendJson(response, 200, await decideSuggestion(suggestionMatch[1], (await readJson(request)).action));
      const knowledgeMatch = pathname.match(/^\/api\/knowledge\/sources\/([^/]+)(\/reindex)?$/);
      if (knowledgeMatch) {
        const [, id, reindex] = knowledgeMatch;
        if (reindex && method === "POST") { void startIndexing(id).catch(() => {}); return sendJson(response, 202, { started: true }); }
        if (!reindex && method === "PATCH") {
          const body = await readJson(request);
          if (body.paidAllowed !== undefined && typeof body.paidAllowed !== "boolean") throw httpError(400, "Opção paidAllowed inválida.");
          return sendJson(response, 200, await updateSource(id, body));
        }
        if (!reindex && method === "DELETE") return sendJson(response, (await deleteSource(id)) ? 200 : 404, { ok: true });
      }

      // ---------- Avaliação contínua do agente local (Fase 3) ----------
      if (method === "GET" && pathname === "/api/agent-eval") return sendJson(response, 200, { status: evalStatus(), runs: await listEvalRuns() });
      if (method === "POST" && pathname === "/api/agent-eval/run") {
        const body = await readJson(request);
        if (body.withMemories !== undefined && typeof body.withMemories !== "boolean") throw httpError(400, "Opção withMemories inválida.");
        return sendJson(response, 202, await startEvalRun({ withMemories: body.withMemories !== false }));
      }
      if (method === "POST" && pathname === "/api/agent-eval/cancel") return sendJson(response, 200, { cancelled: cancelEvalRun() });

      // ---------- Projects ----------
      if (method === "GET" && pathname === "/api/projects") {
        // A task agent's project (agents.js) is marked: the sidebar leaves it to the Agents page.
        const owners = new Map((await taskAgents.listAgents()).filter((a) => a.projectId).map((a) => [a.projectId, a.id]));
        return sendJson(response, 200, { projects: (await listProjects()).map((p) => (owners.has(p.id) ? { ...p, agentId: owners.get(p.id) } : p)) });
      }
      if (method === "POST" && pathname === "/api/projects") {
        const body = await readJson(request);
        if (!String(body.name || "").trim()) return sendJson(response, 400, { error: "O nome do projeto é obrigatório." });
        await validateWorkspaceDir(body.workspaceDir);
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
          await validateWorkspaceDir(body.workspaceDir);
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
        const archived = url.searchParams.get("archived") === "1";
        return sendJson(response, 200, { conversations: await listConversations({ projectId, archived }) });
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
      if (method === "GET" && pathname === "/api/conversations/search") {
        const q = (url.searchParams.get("q") || "").trim();
        return sendJson(response, 200, { conversations: q ? await searchConversations(q) : [] });
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
        return sendJson(response, 200, { stage: getStage(id), partial: getPartial(id), steps: getTurnSteps(id), approval: getApproval(id), plan: getTurnPlan(id) });
      }
      match = pathname.match(/^\/api\/conversations\/([^/]+)\/approval$/);
      if (match && method === "POST") {
        const [, id] = match;
        const body = await readJson(request);
        if (typeof body.id !== "string" || typeof body.approved !== "boolean" || (body.always !== undefined && typeof body.always !== "boolean")) throw httpError(400, "Resposta de autorização inválida.");
        return sendJson(response, 200, { resolved: resolveApproval(id, body.id, body.approved, body.always === true) });
      }
      match = pathname.match(/^\/api\/conversations\/([^/]+)\/cancel$/);
      if (match && method === "POST") {
        const [, id] = match;
        return sendJson(response, 200, { cancelled: cancelTurn(id) });
      }
      match = pathname.match(/^\/api\/conversations\/([^/]+)\/duplicate$/);
      if (match && method === "POST") {
        const [, id] = match;
        const duplicated = await duplicateConversation(id);
        return duplicated ? sendJson(response, 201, duplicated) : sendJson(response, 404, { error: "Conversa não encontrada." });
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
          const teacherProvider = (conversation.teacherProvider || await getSetting("default_teacher", "codex")) === "claude" ? "claude" : "codex";
          const correction = await correctLocalAnswer({
            question: question.content,
            context: await correctionContext(conversation, messages.slice(0, flaggedIndex), question.content),
            // An agent answer is only half the story: the teacher needs what it did.
            wrongAnswer: flagged.execution?.toolSteps?.length ? `${flagged.content}\n\nAções que o modelo executou:\n${flagged.execution.toolSteps.map((s, i) => `${i + 1}. ${s.tool} ${JSON.stringify(s.args).slice(0, 300)} → ${s.ok ? "ok" : "falhou"}: ${String(s.result ?? s.summary).slice(0, 400)}`).join("\n")}` : flagged.content,
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
      if (method === "GET" && pathname === "/api/memories/atlas") return sendJson(response, 200, await memoryAtlas());
      if (method === "GET" && pathname === "/api/system/vitals") return sendJson(response, 200, systemVitals());
      if (method === "POST" && pathname === "/api/memories/recall") {
        const body = await readJson(request);
        return sendJson(response, 200, await recallProbe(body.query, { projectId: body.projectId || undefined, conversationId: body.conversationId || undefined }));
      }
      if (method === "GET" && pathname === "/api/memories/recent-recalls") return sendJson(response, 200, { recalls: await recentRecalls(Number(url.searchParams.get("limit")) || 12) });
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
          if (body.status !== undefined) {
            const archived = await setMemoryStatus(id, body.status);
            return archived ? sendJson(response, 200, archived) : sendJson(response, 404, { error: "Memória não encontrada." });
          }
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
  // Electron may pick a free port other than 8787: keep the agent off it too.
  server.on("listening", () => protectPort(server.address()?.port));
  // Scheduled and folder-triggered agents (docs/AGENTES_ROTEIRO.md, phase D): the desktop app only.
  if (agentScheduler) {
    server.on("listening", async () => {
      const stats = await runStats();
      startAgentScheduler({ listAgents: taskAgents.listAgents, runAgent: taskAgents.runAgent, isAgentRunning: taskAgents.isAgentRunning, markQuiet: taskAgents.markRunQuiet, ...stats, handleChatTurn });
    });
    server.on("close", () => stopAgentScheduler());
    // The computer map (Configurações → Pastas): kept current in the background, desktop only.
    let stopMap = null;
    server.on("listening", () => { stopMap = startMapSchedule({ enabled: mapEnabled, busy: () => activeTurns().count > 0 }); });
    server.on("close", () => stopMap?.());
    // Celular (Telegram), when the person linked a bot: messages in, answers and agent results out.
    server.on("listening", () => { void startTelegram({ handleChatTurn }).catch(() => {}); });
    const offPhone = onAutomaticRun((agent, run) => { void notifyRunOnPhone(agent, run).catch(() => {}); });
    server.on("close", () => { stopTelegram(); offPhone(); });
  }
  if (centralSync) {
    let stop;
    server.on('listening', () => { stop = startCentralScheduler(); });
    server.on('close', () => stop?.());
  }
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(port, host, () => {
    console.log(`AI Harness disponível em http://${host}:${port}`);
  });
}

export { parseCodexOutput, buildProviderConfig };

