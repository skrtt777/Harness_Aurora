// What goes to a paid AI when the person's data must stay on the computer (paid_privacy "espelho", the
// default): the teacher, the planner and the engine see the project only through the synthetic mirror, every
// text with names, identifiers and spreadsheet values swapped for reversible marks, and the tools' results as
// their shape (how long, how many lines), never their content. What comes back gets the real values here.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getSetting } from "./store.js";
import { buildMirror, leaks, pseudonymize, unfake } from "./mirror.js";
import { maskSensitive } from "./sensitive.js";

const LONG_ARG = 160;
const shape = (value) => {
  const s = String(value ?? "");
  const lines = s.split(/\r?\n/).length;
  return `(${s.length} caracteres${lines > 1 ? `, ${lines} linhas` : ""})`;
};

/**
 * The steps as the paid AI may see them: tool, short arguments (paths, filters, commands), ok or failed, the
 * tool's own one-line summary; long arguments (a document's text) and successful results only as their shape.
 * A failed step keeps its error: the error is what the teacher must read.
 */
export function blindSteps(steps = []) {
  return steps.map((s) => ({
    ...s,
    args: Object.fromEntries(Object.entries(s.args || {}).map(([k, v]) => [k, typeof v === "string" && v.length > LONG_ARG ? shape(v) : v])),
    summary: s.summary ? String(s.summary).split(/\r?\n/)[0].slice(0, 240) : s.summary,
    result: s.ok ? (s.result == null ? s.result : shape(s.result)) : String(s.result ?? s.summary ?? "").slice(0, 1200),
  }));
}

/**
 * A blind session for one call: the mirror of `workspace` (when there is one) and its map. `text(t)` blinds a
 * text, `back(t)` restores one, `check(t)` lists real values still in it, `close()` removes the mirror.
 */
export function blindSession(workspace, { terms = [] } = {}) {
  let mirror = null;
  try { mirror = workspace ? buildMirror(workspace, { terms }) : null; } catch { mirror = null; }
  const map = mirror ? mirror.map : new Map();
  return {
    dir: mirror?.dir || null,
    map,
    files: mirror?.files || [],
    text: (t) => maskSensitive(pseudonymize(t, map, { names: true, terms }).text),
    back: (t) => unfake(t, map),
    check: (t) => leaks(t, map),
    close: () => { if (mirror) try { rmSync(mirror.dir, { recursive: true, force: true }); } catch { /* temp */ } },
  };
}

/** The person's secret terms (Configurações → Privacidade): always "[SIGILO n]" on the way out. */
export async function secretTerms() {
  try { const list = JSON.parse((await getSetting("secret_terms")) || "[]"); return Array.isArray(list) ? list.map(String).filter((t) => t.trim()) : []; } catch { return []; }
}

/**
 * The local model as a second censor (top secret): the proper names in a text the rules may miss ("Rogério
 * assinou"), found on this computer. Null when no local model answers; the rules alone then.
 */
export async function localNameFinder(env = process.env) {
  const { localPlanAsk } = await import("./powerbiPlanner.js");
  const ask = await localPlanAsk(env).catch(() => null);
  if (!ask) return null;
  const schema = JSON.stringify({ type: "object", properties: { nomes: { type: "array", items: { type: "string" } } }, required: ["nomes"] });
  return async (text) => {
    const found = new Set();
    for (let i = 0; i < Math.min(text.length, 24_000); i += 6000) {
      const chunk = text.slice(i, i + 6000);
      const out = await ask(`Liste os nomes próprios que aparecem neste texto: pessoas, empresas, marcas, produtos, lugares específicos e códigos internos. Só os que estão escritos no texto, exatamente como aparecem. Responda em JSON {"nomes": [...]}.\n\nTexto:\n${chunk}`, { ...env, LOCAL_OUTPUT_SCHEMA: schema, LOCAL_MAX_OUTPUT_TOKENS: "600" }).catch(() => null);
      try { for (const n of JSON.parse(out?.text || "{}").nomes || []) if (typeof n === "string" && n.trim().length >= 3 && chunk.includes(n.trim())) found.add(n.trim()); } catch { /* not JSON */ }
    }
    return [...found];
  };
}

// ---------------- What went out (Configurações → Privacidade) ----------------
// Every text sent to a paid AI, as it was sent (already censored), with the files the engine could read:
// a local record to audit. Never real values — only what left.
const egressFile = (env = process.env) => join(env.HARNESS_DB_FILE ? dirname(env.HARNESS_DB_FILE) : join(env.APPDATA || homedir(), "Harness Aurora"), "saidas-ia-paga.jsonl");
export function logEgress({ engine, kind, privacy, text, files = [] }, env = process.env) {
  try {
    const file = egressFile(env);
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) renameSync(file, `${file}.1`);
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), engine, kind, privacy, chars: String(text || "").length, text: String(text || "").slice(0, 20_000), files: files.slice(0, 200) }) + "\n");
  } catch { /* the record never blocks the work */ }
}
export function listEgress({ limit = 50 } = {}, env = process.env) {
  try { return readFileSync(egressFile(env), "utf8").trim().split("\n").filter(Boolean).slice(-limit).reverse().map((l) => JSON.parse(l)); } catch { return []; }
}

/** The teacher's verdict with the real values back (problems, guidance, lessons, skill), used only here. */
export function unblindReview(verdict, back) {
  if (!verdict) return verdict;
  return {
    ...verdict,
    problems: verdict.problems.map(back),
    guidance: back(verdict.guidance),
    lessons: verdict.lessons.map((l) => ({ ...l, title: back(l.title), content: back(l.content) })),
    skill: verdict.skill ? { ...verdict.skill, description: back(verdict.skill.description), body: back(verdict.skill.body) } : null,
  };
}
