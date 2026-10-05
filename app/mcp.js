// MCP (Model Context Protocol) client: the person plugs in ready-made servers (e-mail, calendar,
// Notion, databases…) and the agent gets their tools. stdio transport: one JSON-RPC message per
// line. No SDK dependency; only what the agent needs: initialize, tools/list, tools/call.
import { spawn } from "node:child_process";
import { getSetting, setSetting } from "./store.js";

const PROTOCOL = "2025-06-18";
const CALL_TIMEOUT_MS = 60_000;
const clients = new Map(); // server name → client

/** "Google Agenda" + "list_events" → "mcp_google_agenda_list_events" (what tool names allow). */
export const mcpToolName = (server, tool) => `mcp_${slug(server)}_${slug(tool)}`.slice(0, 64);
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** The servers the person configured: [{ name, command, args, env, enabled }]. */
export async function listMcpServers() {
  try {
    const list = JSON.parse((await getSetting("mcp_servers")) || "[]");
    return Array.isArray(list) ? list.filter((s) => s && s.name && s.command) : [];
  } catch { return []; }
}

export async function saveMcpServers(list) {
  const clean = (Array.isArray(list) ? list : []).map((s) => ({
    name: String(s.name || "").trim().slice(0, 40),
    command: String(s.command || "").trim(),
    args: Array.isArray(s.args) ? s.args.map(String) : String(s.args || "").split(/\s+/).filter(Boolean),
    env: s.env && typeof s.env === "object" ? Object.fromEntries(Object.entries(s.env).map(([k, v]) => [String(k), String(v)])) : {},
    enabled: s.enabled !== false,
  })).filter((s) => s.name && s.command);
  if (new Set(clean.map((s) => slug(s.name))).size !== clean.length) throw Object.assign(new Error("Dois servidores com o mesmo nome."), { status: 400 });
  await setSetting("mcp_servers", JSON.stringify(clean));
  stopMcpServers();
  return clean;
}

class McpClient {
  constructor(config) {
    this.config = config;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = "";
    this.stderr = "";
    this.tools = [];
    this.error = null;
  }

  async start() {
    const { command, args = [], env = {} } = this.config;
    // npx/uvx are .cmd files on Windows: a bare command name goes through the shell (hidden, no
    // console window), quoted; a full path ("C:\Program Files\…\node.exe") is run directly.
    const shell = process.platform === "win32" && !/[\\/]/.test(command) && !/\.exe$/i.test(command);
    const quote = (s) => (/[\s"&|<>^()]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s);
    this.child = spawn(shell ? quote(command) : command, shell ? args.map(quote) : args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.receive(chunk));
    this.child.stderr.on("data", (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-2000); });
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) => this.fail(new Error(`O servidor encerrou (código ${code}). ${this.stderr.trim().split("\n").pop() || ""}`.trim())));
    await this.request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "Aurora", version: "1" } });
    this.notify("notifications/initialized");
    this.tools = (await this.request("tools/list", {})).tools || [];
    return this;
  }

  receive(chunk) {
    this.buffer += chunk;
    let at;
    while ((at = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; } // a server's log line on stdout
      const waiting = message.id !== undefined && this.pending.get(message.id);
      if (!waiting) continue;
      this.pending.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.error) waiting.reject(new Error(message.error.message || "Erro do servidor MCP."));
      else waiting.resolve(message.result || {});
    }
  }

  request(method, params, timeoutMs = CALL_TIMEOUT_MS) {
    if (this.error) return Promise.reject(this.error);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`O servidor MCP "${this.config.name}" não respondeu em ${Math.round(timeoutMs / 1000)} s.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) })}\n`);
  }

  fail(error) {
    this.error ||= error;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
    // Only its own entry: a stopped client's late "exit" removed the new client of the same name,
    // which then outlived every stop (seen in the tests, 05/10/2026).
    if (clients.get(this.config.name)?.client === this) clients.delete(this.config.name);
  }

  stop() {
    this.fail(new Error("Servidor MCP parado."));
    try { this.child?.kill(); } catch { /* already gone */ }
  }
}

async function clientFor(config) {
  let entry = clients.get(config.name);
  if (!entry) {
    const client = new McpClient(config);
    entry = { client, ready: client.start() };
    clients.set(config.name, entry);
    entry.ready.catch((error) => { client.error ||= error; try { client.child?.kill(); } catch { /* gone */ } if (clients.get(config.name) === entry) clients.delete(config.name); });
  }
  return entry.ready;
}

/** Each configured server, started if needed, with its tools or why it failed (Settings shows this). */
export async function mcpStatus() {
  return Promise.all((await listMcpServers()).map(async (s) => {
    if (!s.enabled) return { name: s.name, status: "desligado", tools: [] };
    try { const c = await clientFor(s); return { name: s.name, status: "ativo", tools: c.tools.map((t) => t.name) }; }
    catch (error) { return { name: s.name, status: "erro", tools: [], error: String(error.message).slice(0, 300) }; }
  }));
}

/** The agent tools of every working server. A server that fails is left out, never the turn. */
export async function mcpAgentTools() {
  const out = [];
  for (const server of (await listMcpServers()).filter((s) => s.enabled)) {
    let client;
    try { client = await clientFor(server); } catch { continue; }
    for (const tool of client.tools) {
      const name = mcpToolName(server.name, tool.name);
      const readOnly = tool.annotations?.readOnlyHint === true;
      out.push({
        name,
        mcp: { server: server.name, tool: tool.name },
        description: `[${server.name}] ${String(tool.description || tool.name).slice(0, 400)}`,
        parameters: tool.inputSchema?.type === "object" ? tool.inputSchema : { type: "object", properties: {} },
        stage: () => `${server.name}: ${tool.title || tool.name}…`,
        describe: (args) => ({ kind: "external", readOnly, tool: name, summary: `${server.name} → ${tool.title || tool.name} ${JSON.stringify(args || {}).slice(0, 200)}` }),
        async run(args) {
          const c = await clientFor(server);
          const result = await c.request("tools/call", { name: tool.name, arguments: args || {} });
          const text = (result.content || []).map((part) => (part.type === "text" ? part.text : part.type === "resource" ? part.resource?.text || "" : `[${part.type}]`)).join("\n").trim()
            || (result.structuredContent ? JSON.stringify(result.structuredContent) : "(sem conteúdo)");
          if (result.isError) throw new Error(text.slice(0, 600));
          return text;
        },
      });
    }
  }
  return out;
}

export function stopMcpServers() {
  for (const { client } of clients.values()) client.stop();
  clients.clear();
}

// Child processes outlive their parent on Windows: the servers stop with the app.
process.once("exit", stopMcpServers);
