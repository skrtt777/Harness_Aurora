import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { browserTools } from "./browser.js";
import { fileTools } from "./files.js";
import { systemTools } from "./system.js";
import { webTools } from "./web.js";

export const AGENT_TOOLS = [...browserTools, ...webTools, ...systemTools, ...fileTools];
const byName = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]));
export const MAX_TOOL_RESULT = 4500;

export function getTool(name, tools) {
  return tools ? tools.find((tool) => tool.name === name) || null : byName.get(name) || null;
}

/** Ollama/OpenAI function-calling shape. */
export function toolSchemas(tools = AGENT_TOOLS) {
  return tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

/** Plain-text catalogue for providers without native tool calling (Claude/Codex CLI). */
export function toolCatalogue(tools = AGENT_TOOLS) {
  return tools.map((t) => {
    const props = Object.entries(t.parameters.properties || {}).map(([k, v]) => `${k}${(t.parameters.required || []).includes(k) ? "" : "?"}: ${v.enum ? v.enum.join("|") : v.type}`).join(", ");
    return `- ${t.name}(${props}): ${t.description}`;
  }).join("\n");
}

export function stageFor(name, args, tools) {
  const tool = getTool(name, tools);
  try { return tool?.stage ? tool.stage(args || {}) : `Usando ${name}…`; } catch { return `Usando ${name}…`; }
}

/**
 * Runs one tool call. Never throws: a failure becomes an "ERRO: …" result
 * the model reads on its next step and can recover from, the same contract
 * executeAction() in browserAgent.js has.
 */
export async function executeTool(name, args, ctx, tools = AGENT_TOOLS) {
  const tool = getTool(name, tools);
  const started = Date.now();
  if (!tool) return { ok: false, result: `ERRO: a ferramenta "${name}" não existe. Ferramentas disponíveis: ${tools.map((t) => t.name).join(", ")}.`, ms: 0 };
  try {
    const output = String(await tool.run(args && typeof args === "object" ? args : {}, ctx));
    return { ok: true, result: output.length > MAX_TOOL_RESULT ? `${output.slice(0, MAX_TOOL_RESULT)}\n… (cortado)` : output, ms: Date.now() - started };
  } catch (error) {
    if (ctx.signal?.aborted) throw Object.assign(new Error("Cancelado pelo usuário."), { name: "AbortError" });
    return { ok: false, result: `ERRO: ${String(error.message || error).split("\n")[0].slice(0, 600)}`, ms: Date.now() - started };
  }
}

let foldersPromise = null;
/** Real Desktop/Documents/Downloads (may be redirected to OneDrive). */
export function knownFolders() {
  const fallback = { desktop: join(homedir(), "Desktop"), documents: join(homedir(), "Documents"), downloads: join(homedir(), "Downloads"), home: homedir() };
  if (process.platform !== "win32") return Promise.resolve(fallback);
  foldersPromise ||= new Promise((resolve) => {
    const script = "[Environment]::GetFolderPath('Desktop');[Environment]::GetFolderPath('MyDocuments');(New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path";
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15000 }, (error, stdout) => {
      const [desktop, documents, downloads] = String(stdout || "").split(/\r?\n/).map((s) => s.trim());
      resolve(error ? fallback : { desktop: desktop || fallback.desktop, documents: documents || fallback.documents, downloads: downloads || fallback.downloads, home: homedir() });
    });
  });
  return foldersPromise;
}
