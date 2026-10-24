import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { browserTools } from "./browser.js";
import { fileTools } from "./files.js";
import { billTools } from "./bills.js";
import { calcTools } from "./calc.js";
import { systemTools } from "./system.js";
import { webTools } from "./web.js";
import { learnTools } from "./learn.js";
import { siteTools } from "./site.js";
import { codeTools } from "./code.js";
import { knowledgeTools } from "./knowledge.js";
import { computerTools } from "./computer.js";
import { delegateTools } from "./delegate.js";
import { subagentTools } from "./subagents.js";
import { desktopTools, excelTools, pptTools, wordTools } from "./desktop.js";
import { powerBiTools } from "./powerbi.js";
import { decide } from "../agentPolicy.js";

// Browser and web tools only look, except the ones that act on a page.
const INTERACT = new Set(["browser_click", "browser_type", "browser_key"]);
for (const tool of [...browserTools, ...webTools]) tool.describe ||= () => ({ kind: INTERACT.has(tool.name) ? "interact" : "browse" });

export const AGENT_TOOLS = [...browserTools, ...webTools, ...learnTools, ...systemTools, ...fileTools, ...billTools, ...calcTools, ...knowledgeTools, ...computerTools, ...delegateTools, ...subagentTools, ...desktopTools, ...excelTools, ...wordTools, ...pptTools, ...powerBiTools, ...siteTools, ...codeTools];
/** The tools only a code request gets (they are last, so the others' prompt prefix stays the same). */
export const CODE_TOOL_NAMES = new Set([...siteTools, ...codeTools].map((t) => t.name));
const fold = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const CODE_WORDS = /\b(site|website|pagina web|landing page|portal|api|backend|crud|codigo|programa|programe|script|python|node(\.js)?|javascript|typescript|react|vue|angular|three\.?js|java|html|css|funcao|classe|bug|compil|testes? unitarios?|node:test|endpoint|rota|servidor|frontend|app|aplicativo|repositorio|git)\b|\.(py|js|jsx|ts|tsx|java|cpp|html|css)\b|c\+\+/;
/** A request (or conversation) about code: from the words, or a conversation started in VS Code. */
export function isCodeRequest(text, { title = "" } = {}) {
  return /^vs code\b/i.test(String(title)) || CODE_WORDS.test(fold(text));
}
/** The tools of a turn: the code ones only for a code request. */
export function toolsFor(tools, code) {
  return code ? tools : tools.filter((t) => !CODE_TOOL_NAMES.has(t.name));
}
const byName = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]));
export const MAX_TOOL_RESULT = 4500;

/**
 * A long result cut at the end of a line, saying what was shown whole and what is left. "… (cortado)"
 * in the middle of a row made a small model answer "a leitura está limitada, não consegui extrair" with
 * the whole table it needed on screen (the budget sheet of the Controladoria, 13/10).
 */
export function clipResult(output, max = MAX_TOOL_RESULT) {
  const text = String(output);
  if (text.length <= max) return text;
  // The tool's own notes at the end ("(Quadro ativo: 113 linha(s) de dados…)", "… (cortado; continue com
  // offset=46…)") are kept: cut away, a sheet of 113 people was answered "80 funcionários" (regression 24/10).
  const lines = text.split("\n");
  let tailStart = lines.length;
  while (tailStart > 0 && (/^\s*[(…]/.test(lines[tailStart - 1]) || !lines[tailStart - 1].trim())) tailStart -= 1;
  const tail = lines.slice(tailStart).join("\n").trim();
  const keepTail = tail && tail.length < max * 0.3;
  // Room for the rows: what is left after the tail and the note about the cut (~220 characters).
  const room = (keepTail ? max - tail.length - 2 : max) - 220;
  const body = keepTail ? lines.slice(0, tailStart).join("\n") : text;
  const cut = body.lastIndexOf("\n", room);
  const shown = body.slice(0, cut > room * 0.6 ? cut : room);
  const rest = body.slice(shown.length).split("\n").filter((l) => l.trim());
  // Numbered lines (read_file): where the next part starts and how many rows are left; "## Seção" lines: what the rest holds.
  const lastNumber = [...shown.matchAll(/^\s*(\d+)\s{2}/gm)].at(-1)?.[1];
  const restRows = rest.filter((l) => /^\s*\d+\s{2}/.test(l)).length;
  const sections = rest.map((l) => l.match(/^\s*\d*\s*##\s+(.+)$/)?.[1]).filter(Boolean).slice(0, 6);
  const note = `(As linhas acima estão completas. Faltam ${restRows || rest.length} linha(s) deste trecho${sections.length ? `, das partes: ${sections.join(", ")}` : ""}. Só se precisar delas, leia de novo com offset=${lastNumber ? Number(lastNumber) + 1 : "a próxima linha"}.)`;
  return `${shown}\n${note}${keepTail ? `\n${tail}` : ""}`;
}

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
 * executeAction() in browserAgent.js has. Before running, the tool describes
 * what it will touch and the permission mode decides: run, ask or refuse.
 */
export async function executeTool(name, args, ctx, tools = AGENT_TOOLS) {
  const tool = getTool(name, tools);
  const started = Date.now();
  if (!tool) return { ok: false, result: `ERRO: a ferramenta "${name}" não existe. Ferramentas disponíveis: ${tools.map((t) => t.name).join(", ")}.`, ms: 0 };
  const input = args && typeof args === "object" ? args : {};
  // A write outside the project that nobody approved: say where it can go without asking
  // (the model kept retrying "Documentos" and ended with nothing saved).
  let access = null;
  const whereFree = () => (access?.kind === "write" && ctx.workspace ? ` Na pasta do projeto (${ctx.workspace}) você pode salvar sem pedir autorização.` : "");
  try {
    access = tool.describe ? await tool.describe(input, ctx) : { kind: "meta" };
    const decision = await decide(access, ctx);
    if (decision.action === "deny") return { ok: false, denied: true, result: `ERRO: ${decision.reason}`, ms: Date.now() - started };
    if (decision.action === "ask") {
      const answer = await ctx.approve({ tool: name, summary: access.summary || `${name} ${JSON.stringify(input).slice(0, 200)}`, detail: decision.reason, rule: decision.rule });
      if (!answer) return { ok: false, denied: true, result: `ERRO: o usuário não autorizou (${decision.reason}). Não tente contornar; pergunte o que ele prefere.${whereFree()}`, ms: Date.now() - started };
      if (answer === "always" && decision.rule) await ctx.onAlwaysAllow?.({ tool: name, prefix: decision.rule });
      // A program authorized once is driven for the rest of the turn without asking at every click.
      if (access.kind === "desktop" && access.program) (ctx.desktopApproved ||= new Set()).add(String(access.program).toLowerCase());
    }
    const output = String(await tool.run(input, ctx));
    return { ok: true, result: clipResult(output), ms: Date.now() - started };
  } catch (error) {
    if (ctx.signal?.aborted) throw Object.assign(new Error("Cancelado pelo usuário."), { name: "AbortError" });
    return { ok: false, result: `ERRO: ${String(error.message || error).split("\n")[0].slice(0, 600)}${/autoriza/i.test(String(error.message)) ? whereFree() : ""}`, ms: Date.now() - started };
  }
}

let foldersPromise = null;
/** Real Desktop/Documents/Downloads (may be redirected to OneDrive). */
export function knownFolders() {
  // Evaluations point these at fake folders (a phone eval wrote into the real Downloads, 06/10).
  try { const fixed = JSON.parse(process.env.HARNESS_KNOWN_FOLDERS || "null"); if (fixed?.downloads) return Promise.resolve(fixed); } catch { /* the real ones */ }
  const fallback = { desktop: join(homedir(), "Desktop"), documents: join(homedir(), "Documents"), downloads: join(homedir(), "Downloads"), home: homedir() };
  if (process.platform !== "win32") return Promise.resolve(fallback);
  foldersPromise ||= new Promise((resolve) => {
    // UTF-8 out: in the console's OEM code page "Área de Trabalho" arrives as "�rea".
    const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;[Environment]::GetFolderPath('Desktop');[Environment]::GetFolderPath('MyDocuments');(New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path";
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15000 }, (error, stdout) => {
      const [desktop, documents, downloads] = String(stdout || "").split(/\r?\n/).map((s) => s.trim());
      resolve(error ? fallback : { desktop: desktop || fallback.desktop, documents: documents || fallback.documents, downloads: downloads || fallback.downloads, home: homedir() });
    });
  });
  return foldersPromise;
}
