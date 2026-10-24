// Hermes Agent and OpenClaw as strong engines, beside Claude Code and Codex (app/engine.js). Like them, they
// only ever see what the Aurora hands over — the mirror with fake values ("espelho") or the documents with the
// sensitive parts as marks ("censura") — and work in that folder; the Aurora runs the result on the real data
// and puts the real values back. Nothing of theirs that reaches the outside is used: no messaging channels
// (OpenClaw's reply is never delivered), no memory or computer use (Hermes runs with files and code only).
import { randomUUID } from "node:crypto";
import { executeCli, resolveCli } from "./cliRuntime.js";

const clean = (s) => String(s || "").replace(/\u001b\[[0-9;]*m/g, "").trim();

/** An agent CLI's short answer that is really its model provider failing: { status, reason } or null. */
export function providerFailure(text) {
  const t = String(text || "");
  if (t.length > 600) return null;
  if (/billing|credits?|entitlement|quota|rate.?limit|too many requests|\b429\b/i.test(t)) return { status: 429, reason: "o provedor do modelo está sem créditos ou no limite de uso." };
  if (/api key not valid|invalid api key|unauthori[sz]ed|\b401\b|authentication/i.test(t)) return { status: 401, reason: "a chave do provedor do modelo foi recusada." };
  if (/connection error|api call failed|ECONNREFUSED|could not connect|unknown provider/i.test(t)) return { status: 503, reason: "não conseguiu falar com o provedor do modelo (confira o modelo configurado nele)." };
  return null;
}

/** Hermes, one shot in the folder: files, code and terminal only, without its rules and memory. */
export const HERMES_TOOLSETS = "file,code_execution,terminal,todo";
export async function runHermesAgent(prompt, { cwd, env = process.env, signal, timeoutMs } = {}) {
  try {
    const cli = resolveCli("hermes", env);
    // HERMES_PROVIDER / HERMES_MODEL override its configured model for these tasks.
    const args = ["-z", prompt, "--in", cwd, "-t", HERMES_TOOLSETS, "--ignore-rules", ...(env.HERMES_PROVIDER ? ["--provider", env.HERMES_PROVIDER] : []), ...(env.HERMES_MODEL ? ["-m", env.HERMES_MODEL] : [])];
    const result = await executeCli(cli.command, [...cli.prefix, ...args], {
      cwd, windowsHide: true, signal, env: { ...process.env, ...env, ...(cli.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
      maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs || Number(env.HERMES_AGENT_TIMEOUT_MS || 600_000),
    });
    const text = clean(result.stdout);
    if (!text) return { ok: false, status: 502, error: "O Hermes retornou uma resposta vazia." };
    // Its provider failing comes back as the answer ("API call failed after 3 retries: Connection error.",
    // "billing, credits … exhausted"): a failure, said as such (a 429 marks the engine out of its limit).
    const failed = providerFailure(text);
    if (failed) return { ok: false, status: failed.status, error: `Hermes: ${failed.reason}` };
    return { ok: true, status: 200, text };
  } catch (error) {
    const detail = error.code === "ENOENT" ? "Hermes não encontrado." : error.killed ? "O Hermes demorou demais e foi interrompido." : clean(error.stderr) || error.message || "Falha ao executar o Hermes.";
    return { ok: false, status: error.code === "ENOENT" ? 503 : 502, error: detail.slice(0, 600) };
  }
}

/** The reply text inside OpenClaw's JSON (its shape varies by version): the longest text field found. */
export function openClawText(stdout) {
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { return clean(stdout); }
  const texts = [];
  const walk = (v, key = "") => {
    if (typeof v === "string") { if (/^(text|reply|content|message|output|result|response)$/i.test(key) && v.trim()) texts.push(v); return; }
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(parsed);
  return clean(texts.sort((a, b) => b.length - a.length)[0] || "");
}

/**
 * OpenClaw, one agent turn in a session of its own (never the person's main one) and never delivered to a
 * channel. Its tools work in its own workspace, so the folder goes in the message as an absolute path. Through
 * the Gateway when it is running; otherwise embedded (--local, with the provider keys of the environment).
 */
export async function runOpenClawAgent(prompt, { cwd, env = process.env, signal, timeoutMs } = {}) {
  const cli = resolveCli("openclaw", env);
  const message = `Trabalhe somente na pasta ${cwd} (use caminhos completos dentro dela; não use mensagens, canais nem a internet).\n\n${prompt}`;
  const timeout = timeoutMs || Number(env.OPENCLAW_AGENT_TIMEOUT_MS || 600_000);
  const once = async (local) => {
    const args = ["agent", "--message", message, "--json", "--session-id", `aurora-${randomUUID()}`, "--thinking", "medium", "--timeout", String(Math.round(timeout / 1000)), ...(local ? ["--local"] : [])];
    const result = await executeCli(cli.command, [...cli.prefix, ...args], {
      cwd, windowsHide: true, signal, env: { ...process.env, ...env, ...(cli.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
      maxBuffer: 16 * 1024 * 1024, timeout: timeout + 30_000,
    });
    return openClawText(result.stdout);
  };
  try {
    let text = "";
    try { text = await once(false); } catch (error) {
      // No Gateway running: the embedded agent.
      if (!/gateway|ECONNREFUSED|connect/i.test(`${error.stderr || ""}${error.message || ""}`)) throw error;
      text = await once(true);
    }
    if (!text) return { ok: false, status: 502, error: "O OpenClaw retornou uma resposta vazia." };
    const failed = providerFailure(text);
    if (failed) return { ok: false, status: failed.status, error: `OpenClaw: ${failed.reason}` };
    return { ok: true, status: 200, text };
  } catch (error) {
    const detail = error.code === "ENOENT" ? "OpenClaw não encontrado." : error.killed ? "O OpenClaw demorou demais e foi interrompido." : clean(error.stderr) || error.message || "Falha ao executar o OpenClaw.";
    return { ok: false, status: error.code === "ENOENT" ? 503 : 502, error: detail.slice(0, 600) };
  }
}
