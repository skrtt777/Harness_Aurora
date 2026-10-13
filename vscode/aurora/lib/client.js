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
    /**
     * Sends a message and, while the Aurora works, reports each new stage, step and permission request
     * (onProgress({ stage, steps, approval, plan })). Resolves with { content, steps, files }.
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
          const key = JSON.stringify([p.stage, p.steps?.length, p.steps?.at?.(-1)?.status, p.approval?.id]);
          if (key !== last) { last = key; onProgress(p); }
        }
      })();
      const result = await turn;
      await poll;
      const message_ = result.message || {};
      const steps = message_.execution?.toolSteps || [];
      return { content: String(message_.content || result.error || ""), steps, files: filesIn(message_.content, steps) };
    },
  };
}

/** The files a reply speaks of (written by a tool, or a Windows/Unix path in the text). */
function filesIn(text, steps = []) {
  const written = steps.filter((s) => s.ok && /^(write_file|edit_file|write_document)$/.test(s.tool)).map((s) => /^(?:Criei|Salvei|Editei) (.+?)(?: \(|\.$|$)/.exec(String(s.summary || ""))?.[1]).filter(Boolean);
  const said = [...String(text || "").matchAll(/(?:[A-Za-z]:\\|\/)(?:[^\s`'"<>|*?\n]+[\\/])*[^\s`'"<>|*?\n]+\.[A-Za-z0-9]{1,6}/g)].map((m) => m[0].replace(/[.,;:)]+$/, ""));
  return [...new Set([...written, ...said])];
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
function composeMessage(prompt, { file = null, selection = "", language = "", references = [] } = {}) {
  const parts = [String(prompt || "").trim()];
  const context = [];
  if (file) context.push(`Arquivo aberto no VS Code: ${file}`);
  if (selection.trim()) context.push(`Trecho selecionado${language ? ` (${language})` : ""}:\n\`\`\`${language}\n${selection.slice(0, 8000)}\n\`\`\``);
  for (const r of references.slice(0, 8)) {
    if (r.path && r.text != null) context.push(`Arquivo anexado ${r.path}:\n\`\`\`\n${String(r.text).slice(0, 8000)}\n\`\`\``);
    else if (r.path) context.push(`Arquivo citado: ${r.path}`);
  }
  if (context.length) parts.push(`\n\n[Contexto do VS Code]\n${context.join("\n\n")}`);
  return parts.join("");
}

module.exports = { createClient, HarnessError, filesIn, stepLine, composeMessage };
