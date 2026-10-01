import { createMemory, getSetting, recordMemoryOutcome, setSetting } from "./store.js";
import { enableSkill, importSkill } from "./skills.js";
import { DEFAULT_DAILY_LIMIT, DEFAULT_TEACHER_MODE, TEACHER_MODES, buildReviewPrompt, callTeacher, detectSignals, parseReview, redoMessage, shouldReview } from "./teacher.js";

const today = () => new Date().toISOString().slice(0, 10);

export async function teacherSettings() {
  const mode = await getSetting("teacher_mode");
  const rawLimit = await getSetting("teacher_daily_limit");
  const limit = rawLimit === null || rawLimit === "" ? NaN : Number(rawLimit);
  let usage = { date: today(), count: 0 };
  try { const saved = JSON.parse(await getSetting("teacher_usage")); if (saved?.date === today()) usage = saved; } catch { /* first use */ }
  return { mode: TEACHER_MODES.includes(mode) ? mode : DEFAULT_TEACHER_MODE, dailyLimit: Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_DAILY_LIMIT, usedToday: usage.count };
}

async function spendTeacherCall() {
  const { usedToday } = await teacherSettings();
  await setSetting("teacher_usage", JSON.stringify({ date: today(), count: usedToday + 1 }));
}

/**
 * After a local agent delivery: detect error signals, ask the teacher when
 * there's a reason, save its lessons, and let the local model redo the work
 * with them. Never throws — a teacher failure keeps the original delivery.
 *
 * rerun(history, input) runs the local agent again on top of the first
 * attempt's transcript (so it sees what it did and what went wrong).
 */
export async function runTeachingLoop({ userMessage, history, first, teacherProvider, conversation, workspace, memoryIds = [], memories = [], rerun, onStage = () => {}, env = process.env, signal, call = callTeacher, needsConsent = () => false, approve = async () => false }) {
  const settings = await teacherSettings();
  const signals = detectSignals({ userMessage, result: first });
  const reason = shouldReview({ mode: settings.mode, signals, steps: first.steps });
  const review = { reason, signals: signals.map((s) => s.code), teacher: teacherProvider };
  if (!reason) {
    await recordMemoryOutcome(memoryIds, "used").catch(() => {});
    return { result: first, review: null };
  }
  if (settings.usedToday >= settings.dailyLimit) return { result: first, review: { ...review, skipped: "daily_limit" } };

  const label = teacherProvider === "claude" ? "Claude" : "Codex";
  // Internal documents not cleared for paid AI leave the machine only with consent.
  if (needsConsent() && !(await approve({ tool: "teacher", summary: `Enviar esta conversa ao ${label} para revisão`, detail: "Ela usa documentos internos que não estão liberados para IA paga." }))) {
    return { result: first, review: { ...review, skipped: "privacy" } };
  }
  onStage(`Revisando com ${label}…`);
  const started = Date.now();
  await spendTeacherCall();
  const response = await call({ provider: teacherProvider, workspace, env, signal, prompt: buildReviewPrompt({ userMessage, history, steps: first.steps, answer: first.text, signals, workspace, memories }) });
  review.ms = Date.now() - started;
  if (signal?.aborted) return { result: first, review: { ...review, error: "cancelado" } };
  const verdict = response.ok ? parseReview(response.text) : null;
  if (!verdict) return { result: first, review: { ...review, error: response.ok ? "resposta do professor inválida" : response.error } };
  Object.assign(review, { verdict: verdict.verdict, problems: verdict.problems });

  if (verdict.verdict === "ok") {
    await recordMemoryOutcome(memoryIds, "helped").catch(() => {});
    return { result: first, review };
  }

  await recordMemoryOutcome(memoryIds, "failed").catch(() => {});
  const scope = conversation.projectId ? "project" : "global";
  const lessons = [];
  for (const lesson of verdict.lessons) {
    try {
      lessons.push(await createMemory({ scope, projectId: conversation.projectId || undefined, title: lesson.title, content: lesson.content, tags: lesson.tags, kind: "extracted", source: `Lição de ${label} (revisão automática)`, env }));
    } catch { /* a malformed lesson is skipped */ }
  }
  review.lessonIds = lessons.map((m) => m.id);
  if (verdict.skill) {
    try {
      const text = `---\nname: ${JSON.stringify(verdict.skill.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "licao-professor")}\ndescription: ${JSON.stringify(verdict.skill.description)}\n---\n${verdict.skill.body}`;
      const skill = await importSkill(text, `${label}: revisão automática`);
      await enableSkill(skill.id, true);
      review.skillId = skill.id;
    } catch { /* invalid skill proposals are ignored */ }
  }

  onStage("Refazendo com as lições do professor…");
  const second = await rerun(first.messages.slice(1), redoMessage(verdict));
  if (!second.ok) return { result: first, review: { ...review, redo: "falhou", redoError: second.error } };
  const stillWrong = detectSignals({ userMessage: "", result: second });
  await recordMemoryOutcome(review.lessonIds, stillWrong.length ? "failed" : "helped").catch(() => {});
  review.redo = stillWrong.length ? "com_erros" : "ok";
  return {
    review,
    result: {
      ...second,
      steps: [...first.steps, ...second.steps.map((s) => ({ ...s, redo: true }))],
      calls: [...first.calls, ...second.calls],
      text: second.text,
    },
  };
}
