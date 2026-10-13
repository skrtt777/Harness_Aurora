// The Harness Aurora that runs on this PC, as seen from VS Code: its local API (http://127.0.0.1:8787,
// the same one the desktop window uses), a session token from /api/session, the project of the open
// folder, one conversation per folder, a message sent while its progress is polled (stage, steps, the
// permission it asks for). Plain Node (the extension host): no dependencies, testable without VS Code.
"use strict";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

class HarnessError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

/** The client of the Harness API; base must be a loopback http address (nothing leaves the PC). */
function createClient({ base = "http://127.0.0.1:8787", fetchImpl = globalThis.fetch, pollMs = 700 } = {}) {
  const url = new URL(base);
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) throw new HarnessError("A Aurora só conversa com o Harness deste computador (http://127.0.0.1).");
  const root = `${url.protocol}//${url.host}`;
  let token = null;

  async function raw(path, { method = "GET", body, signal, timeoutMs = 15000 } = {}) {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${root}/api${path}`, {
        method, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { "x-harness-token": token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (signal?.aborted) throw new HarnessError("Cancelado.", 499);
      throw new HarnessError("Não encontrei o Harness Aurora neste computador. Abra o Harness e tente de novo.", 503);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new HarnessError(data.error || `O Harness respondeu ${response.status}.`, response.status);
    return data;
  }
  async function session() { token = (await raw("/session")).token; return token; }
  /** A call with the session; a desktop restarted meanwhile issues a new token: once more with it. */
  async function call(path, options = {}) {
    if (!token) await session();
    try { return await raw(path, options); }
    catch (error) { if (error.status !== 401) throw error; await session(); return raw(path, options); }
  }

  return {
    health: () => raw("/health", { timeoutMs: 3000 }),
    /** The Harness project whose folder is this one (made when there is none, named after it). */
    async projectFor(folder, name) {
      const same = (a, b) => String(a || "").replace(/[\\/]+$/, "").toLowerCase() === String(b || "").replace(/[\\/]+$/, "").toLowerCase();
      const { projects = [] } = await call("/projects");
      const found = projects.find((p) => !p.agentId && same(p.workspaceDir, folder));
      if (found) return found;
      return call("/projects", { method: "POST", body: { name: String(name || "VS Code").slice(0, 80), workspaceDir: folder } });
    },
    newConversation: ({ projectId = null, title = "VS Code", provider = "local" } = {}) => call("/conversations", { method: "POST", body: { ...(projectId ? { projectId } : {}), title: String(title).slice(0, 80), provider } }),
    conversation: (id) => call(`/conversations/${encodeURIComponent(id)}`),
    approve: (id, approvalId, approved) => call(`/conversations/${encodeURIComponent(id)}/approval`, { method: "POST", body: { id: approvalId, approved } }),
    cancel: (id) => call(`/conversations/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} }).catch(() => null),
    /** Takes back what one answer changed: edited files restored, created files removed. */
    undo: (messageId) => call(`/messages/${encodeURIComponent(messageId)}/undo-moves`, { method: "POST", body: {} }),
    /**
     * Sends a message and, while the Aurora works, reports each new stage, step and permission request
     * (onProgress({ stage, steps, approval, plan, partial })). Resolves with { content, steps, files,
     * messageId, changes: [{ file, created, backup }] }.
     */
    async send(id, message, { onProgress = () => {}, signal } = {}) {
      if (!token) await session();
      const turn = call(`/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", body: { message }, signal, timeoutMs: 30 * 60 * 1000 });
      let done = false;
      turn.finally(() => { done = true; }).catch(() => {});
      const poll = (async () => {
        let last = "";
        while (!done && !signal?.aborted) {
          await new Promise((r) => setTimeout(r, pollMs));
          if (done) break;
          const p = await call(`/conversations/${encodeURIComponent(id)}/pending`, { timeoutMs: 5000 }).catch(() => null);
          if (!p) continue;
          const key = JSON.stringify([p.stage, p.steps?.length, p.steps?.at?.(-1)?.status, p.approval?.id, String(p.partial || "").length, Boolean(p.order)]);
          if (key !== last) { last = key; onProgress(p); }
        }
      })();
      const result = await turn;
      await poll;
      const message_ = result.message || {};
      const steps = message_.execution?.toolSteps || [];
      const changes = changesOf(message_.execution);
      return { content: String(message_.content || result.error || ""), steps, files: [...new Set([...changes.map((c) => c.file), ...filesIn(message_.content, steps)])], messageId: message_.id || null, changes };
    },
  };
}

/** The files a reply speaks of (written by a tool, or a Windows/Unix path in the text). */
function filesIn(text, steps = []) {
  const written = steps.filter((s) => s.ok && /^(write_file|edit_file|write_document)$/.test(s.tool)).map((s) => /^(?:Criei|Salvei|Editei) (.+?)(?: \(|\.$|$)/.exec(String(s.summary || ""))?.[1]).filter(Boolean);
  const said = [...String(text || "").matchAll(/(?:[A-Za-z]:\\|\/)(?:[^\s`'"<>|*?\n]+[\\/])*[^\s`'"<>|*?\n]+\.[A-Za-z0-9]{1,6}/g)].map((m) => m[0].replace(/[.,;:)]+$/, ""));
  return [...new Set([...written, ...said])];
}

/** The files one answer changed, as the Harness recorded them (one entry per file, the first copy). */
function changesOf(execution) {
  const seen = new Map();
  for (const e of execution?.edits || []) {
    if (!e?.file) continue;
    if (!seen.has(e.file)) seen.set(e.file, { file: e.file, created: Boolean(e.created), backup: e.backup || null });
  }
  return [...seen.values()];
}

/**
 * The context of the Problems panel: [{ file, line, severity, message, source }] -> text lines,
 * the most serious first, at most `max`.
 */
function problemsText(problems = [], max = 40) {
  const order = { erro: 0, aviso: 1 };
  return problems.slice().sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2)).slice(0, max)
    .map((p) => `${p.file}:${p.line} ${p.severity}: ${String(p.message).replace(/\s+/g, " ").slice(0, 200)}${p.source ? ` (${p.source})` : ""}`).join("\n");
}

/** The Recepção's order as one line for the chat ("Entregar: …; Regras: …"), or "". */
function orderLine(order) {
  if (!order) return "";
  const parts = [
    ...(order.deliver?.length ? [`Entregar: ${order.deliver.join("; ")}`] : []),
    ...(order.rules?.length ? [`Regras: ${order.rules.join("; ")}`] : []),
    ...(order.run ? ["rodar e mostrar a saída"] : []),
  ];
  return parts.length ? `**Ordem de serviço:** ${parts.join(" · ")}` : "";
}

/** What a step looks like in the chat while it runs ("Lendo src/app.js"). */
function stepLine(step) {
  const s = String(step?.summary || step?.stage || step?.tool || "").replace(/^ERRO:\s*/, "");
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
}

/**
 * The message the Aurora gets: the person's words, then what VS Code shows them (the open file, the
 * selected code, the files they attached), so "explica isso" or "corrige essa função" have a subject.
 */
function composeMessage(prompt, { file = null, selection = "", language = "", references = [], problems = [], diff = "", selectionRange = null } = {}) {
  const parts = [String(prompt || "").trim()];
  const context = [];
  if (file) context.push(`Arquivo aberto no VS Code: ${file}${selectionRange ? ` (seleção nas linhas ${selectionRange})` : ""}`);
  if (selection.trim()) context.push(`Trecho selecionado${language ? ` (${language})` : ""}:\n\`\`\`${language}\n${selection.slice(0, 8000)}\n\`\`\``);
  for (const r of references.slice(0, 8)) {
    if (r.path && r.text != null) context.push(`Arquivo anexado ${r.path}:\n\`\`\`\n${String(r.text).slice(0, 8000)}\n\`\`\``);
    else if (r.path) context.push(`Arquivo citado: ${r.path}`);
  }
  if (problems.length) context.push(`Problemas do VS Code (painel Problemas):\n${problemsText(problems)}`);
  if (diff) context.push(`Mudanças ainda não commitadas (git diff):\n\`\`\`diff\n${String(diff).slice(0, 12000)}\n\`\`\``);
  if (context.length) parts.push(`\n\n[Contexto do VS Code]\n${context.join("\n\n")}`);
  return parts.join("");
}

/**
 * The request of a slash command, in the Aurora's words: what to do with the context VS Code sends.
 * /explicar, /corrigir, /testes, /revisar; anything else is the person's own prompt.
 */
const COMMANDS = {
  explicar: (p) => `Explique ${p || "o trecho selecionado (ou o arquivo aberto)"}: o que faz, como funciona por partes e o que pode dar errado. Não mude nenhum arquivo.`,
  corrigir: (p) => `Corrija ${p || "os problemas abaixo"} no código: leia só os arquivos e linhas apontados, mude com edit_file só o trecho necessário, rode ou teste se der, e diga o que mudou em cada arquivo.`,
  testes: (p) => `Escreva testes para ${p || "o arquivo aberto (ou o trecho selecionado)"} no estilo do projeto (node:test em Node, pytest/unittest em Python, o que já houver), grave ao lado do código, rode os testes e mostre o resultado real.`,
  revisar: (p) => `Revise as mudanças abaixo (git diff)${p ? ` com foco em: ${p}` : ""}: aponte bugs, riscos e o que falta (testes, casos de erro), do mais grave ao menos, com arquivo e linha. Não mude arquivos.`,
};
function commandPrompt(command, prompt) {
  const make = COMMANDS[command];
  return make ? make(String(prompt || "").trim()) : String(prompt || "");
}

module.exports = { createClient, HarnessError, filesIn, stepLine, composeMessage, changesOf, problemsText, commandPrompt, COMMANDS, orderLine };
