import http from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const execFileAsync = promisify(execFile);
const memoryFile = join(root, "data", "memory.json");

async function loadMemory() {
  try { return JSON.parse(await readFile(memoryFile, "utf8")); }
  catch { return { nodes: [], edges: [] }; }
}

async function saveMemory(memory) {
  await mkdir(dirname(memoryFile), { recursive: true });
  await writeFile(memoryFile, JSON.stringify(memory, null, 2), "utf8");
  return memory;
}

export function limitContext(input, memories = [], limit = 12000) {
  const max = Math.max(1000, Number(limit) || 12000);
  const memoryText = selectMemories(input, memories).map((node) => `- ${node.label}: ${node.content}`).join("\n");
  const prefix = memoryText ? `Memórias relevantes do usuário:\n${memoryText}\n\nTarefa atual:\n` : "Tarefa atual:\n";
  const available = Math.max(0, max - prefix.length);
  return prefix + String(input).slice(-available);
}

export function selectMemories(input, memories = {}, limit = 12) {
  const query = new Set(String(input).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  return (memories.nodes || []).map((node, index) => {
    const words = String(`${node.label} ${node.content}`).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const overlap = words.reduce((score, word) => score + (query.has(word) ? 1 : 0), 0);
    return { node, score: overlap, index };
  }).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, limit).map(({ node }) => node);
}

export function buildProviderConfig(env = process.env) {
  return {
    id: "codex",
    name: "Codex",
    mode: "cli",
    command: env.CODEX_BIN || "codex",
    model: env.CODEX_MODEL || "configured in Codex CLI",
    configured: true
  };
}

export function parseCodexOutput(stdout) {
  const messages = [];
  let threadId = null;
  let usage = null;

  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "thread.started") threadId = event.thread_id || null;
      if (event.type === "turn.completed") usage = event.usage || null;
      if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
        messages.push(event.item.text);
      }
    } catch {
      // Ignore non-JSON diagnostic lines; --json should keep the final output machine-readable.
    }
  }

  return { text: messages.at(-1) || "", threadId, usage };
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  if (body.length > 1_000_000) throw new Error("Payload muito grande");
  return JSON.parse(body || "{}");
}

export async function createResponse(input, env = process.env) {
  try {
    const memories = await loadMemory();
    const accessedMemories = selectMemories(input, memories);
    const prompt = limitContext(input, memories, env.CONTEXT_LIMIT_CHARS);
    const args = ["exec", "--ephemeral", "--json", "--skip-git-repo-check", prompt];
    const result = await execFileAsync(env.CODEX_BIN || "codex", args, {
      cwd: env.CODEX_CWD || process.cwd(),
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      timeout: Number(env.CODEX_TIMEOUT_MS || 120_000)
    });
    const parsed = parseCodexOutput(result.stdout);
    return { ok: true, status: 200, provider: "codex", mode: "cli", memoryAccess: accessedMemories.map((node) => node.id), ...parsed };
  } catch (error) {
    const detail = error.code === "ENOENT"
      ? "Codex CLI não encontrado. Instale o Codex e confirme que o comando codex está no PATH."
      : error.stderr?.trim() || error.message || "Falha ao executar o Codex CLI.";
    return { ok: false, status: error.code === "ENOENT" ? 503 : 502, error: detail };
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = join(publicDir, requested.replace(/^\/+/, ""));
  if (!safePath.startsWith(publicDir)) return false;

  try {
    const content = await readFile(safePath);
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
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

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return sendJson(response, 200, { ok: true, provider: buildProviderConfig() });
      }

      if (request.method === "GET" && url.pathname === "/api/memories") {
        return sendJson(response, 200, await loadMemory());
      }

      if (request.method === "POST" && url.pathname === "/api/memories") {
        const body = await readJson(request);
        const label = String(body.label || "Memória").trim();
        const content = String(body.content || "").trim();
        if (!content) return sendJson(response, 400, { error: "O conteúdo da memória é obrigatório." });
        const memory = await loadMemory();
        const id = `memory-${Date.now()}`;
        memory.nodes.push({ id, label, content, type: body.type || "fact", createdAt: new Date().toISOString() });
        if (body.connectTo) memory.edges.push({ source: body.connectTo, target: id, relation: body.relation || "related" });
        return sendJson(response, 201, await saveMemory(memory));
      }

      if (request.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson(request);
        const message = String(body.message || "").trim();
        if (!message) return sendJson(response, 400, { error: "A mensagem é obrigatória." });
        const result = await createResponse(message, { ...process.env, CONTEXT_LIMIT_CHARS: body.contextLimit });
        return sendJson(response, result.status, result);
      }

      if (request.method === "GET" && await serveStatic(response, url.pathname)) return;
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
