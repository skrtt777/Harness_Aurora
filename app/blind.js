// What goes to a paid AI when the person's data must stay on the computer (paid_privacy "espelho", the
// default): the teacher, the planner and the engine see the project only through the synthetic mirror, every
// text with names, identifiers and spreadsheet values swapped for reversible marks, and the tools' results as
// their shape (how long, how many lines), never their content. What comes back gets the real values here.
import { rmSync } from "node:fs";
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
export function blindSession(workspace) {
  let mirror = null;
  try { mirror = workspace ? buildMirror(workspace) : null; } catch { mirror = null; }
  const map = mirror ? mirror.map : new Map();
  return {
    dir: mirror?.dir || null,
    map,
    files: mirror?.files || [],
    text: (t) => maskSensitive(pseudonymize(t, map, { names: true }).text),
    back: (t) => unfake(t, map),
    check: (t) => leaks(t, map),
    close: () => { if (mirror) try { rmSync(mirror.dir, { recursive: true, force: true }); } catch { /* temp */ } },
  };
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
