import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NOT_FOUND } from "./grounding.js";

/**
 * Company benchmark (docs/CONHECIMENTO_EMPRESA.md): every sector folder of a
 * company share (F:\EmpresaIA, made by scripts/gerar_empresa_ia.py) becomes a
 * knowledge source of its own department, and each question is asked in a new
 * chat without saying where the answer is. A question passes when the answer
 * has every expected fact; it is "in the right sector" when the documents the
 * turn used come from the sector the question belongs to.
 * Runs against a COPY of the user's database (HARNESS_DB_FILE), like agentEval.
 */

const sectorOf = (path, root) => String(path).replace(/\//g, "\\").toLowerCase().split(root.replace(/\//g, "\\").toLowerCase().replace(/\\$/, "") + "\\")[1]?.split("\\")[0] || null;
const fold = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** One source per sector folder; indexing is incremental, so a second run only checks dates. */
export async function prepareCompanySources(root, { env = process.env, onProgress = () => {} } = {}) {
  const knowledge = await import("./knowledge.js");
  const sectors = readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
  const wanted = new Set(sectors.map((s) => fold(join(root, s))));
  // The user's own sources stay out, so the score depends only on the sample company.
  for (const source of await knowledge.listSources()) if (!wanted.has(fold(source.path))) await knowledge.deleteSource(source.id);
  const existing = await knowledge.listSources();
  const timings = {};
  for (const sector of sectors) {
    const path = join(root, sector);
    const source = existing.find((s) => fold(s.path) === fold(path)) || await knowledge.createSource({ name: `${sector} (EmpresaIA)`, path, department: sector });
    const started = Date.now();
    await knowledge.indexSource(source.id, { env });
    timings[sector] = Date.now() - started;
    onProgress({ indexed: sector, ms: timings[sector] });
  }
  return { sectors, timings };
}

export function checkAnswer(question, answer) {
  const text = String(answer || "");
  if (question.notFound) return NOT_FOUND.test(text) && !(question.avoid || []).some((r) => new RegExp(r, "iu").test(text));
  return question.expect.every((r) => new RegExp(r, "iu").test(text)) && !(question.avoid || []).some((r) => new RegExp(r, "iu").test(text));
}

export async function runCompanyEval({ questions, root, workDir, samples = 1, env = process.env, onProgress = () => {} }) {
  const store = await import("./store.js");
  const { handleChatTurn } = await import("./server.js");
  const { escalate, pickConsensus } = await import("./consensus.js");
  await store.setSetting("teacher_mode", "off");
  await store.setSetting("agent_mode", "auto");
  const askOnce = async (question, n) => {
    const dir = join(workDir, `${question.id}-${n}`);
    mkdirSync(dir, { recursive: true });
    const project = await store.createProject({ name: `Empresa ${question.id} #${n}`, workspaceDir: dir });
    const conversation = await store.createConversation({ provider: "local", projectId: project.id });
    const started = Date.now();
    let turn;
    try { turn = await handleChatTurn({ conversationId: conversation.id, message: question.prompt, env }); }
    catch (error) { turn = { ok: false, error: error.message }; }
    const answer = turn.message?.content || "";
    const docs = turn.message?.execution?.knowledgeDocs || [];
    const docSectors = [...new Set(docs.map((d) => sectorOf(d, root)).filter(Boolean))];
    return {
      passed: Boolean(turn.ok) && checkAnswer(question, answer),
      // Not-found questions have no sector to find; everything else should read its own sector.
      rightSector: question.notFound ? null : docSectors.some((s) => fold(s) === fold(question.setor)),
      docSectors, docs: docs.map((d) => String(d).split(/[\\/]/).pop()), tools: (turn.message?.execution?.toolSteps || []).map((s) => s.tool),
      ms: Date.now() - started, error: turn.ok ? null : turn.error, answer: answer.slice(0, 600),
    };
  };
  const results = [];
  for (const [index, question] of questions.entries()) {
    onProgress({ index, total: questions.length, id: question.id });
    const started = Date.now();
    // The copies run at the same time, as the app would (Ollama's parallel slots).
    const runs = await Promise.all(Array.from({ length: samples }, (_, n) => askOnce(question, n + 1)));
    const result = { id: question.id, setor: question.setor, prompt: question.prompt, notFound: Boolean(question.notFound), ...runs[0] };
    if (samples > 1) {
      const answers = runs.map((r) => r.answer);
      const at = (k) => runs[pickConsensus(answers.slice(0, k)).index].passed;
      const esc = escalate(answers);
      Object.assign(result, {
        wallMs: Date.now() - started,
        samples: runs.map((r) => ({ passed: r.passed, ms: r.ms, answer: r.answer.slice(0, 300) })),
        consensus3: samples >= 3 ? at(3) : null, consensusN: at(samples),
        escalated: { passed: runs[esc.index].passed, used: esc.used, support: Math.round(esc.support * 100) / 100 },
        anyPassed: runs.some((r) => r.passed),
      });
    }
    results.push(result);
    onProgress({ index, total: questions.length, id: question.id, passed: result.passed, ms: result.wallMs || result.ms, extra: samples > 1 ? `consenso ${result.consensusN ? "ok" : "ERRO"} escalada ${result.escalated.passed ? "ok" : "ERRO"} (${result.escalated.used}x)` : "" });
  }
  return results;
}

export function summarizeCompanyEval(results) {
  const bySector = {};
  for (const r of results) {
    const s = bySector[r.setor] ||= { passed: 0, total: 0, rightSector: 0, located: 0, ms: 0 };
    s.total += 1;
    s.passed += r.passed ? 1 : 0;
    s.ms += r.ms;
    if (r.rightSector !== null) { s.located += 1; s.rightSector += r.rightSector ? 1 : 0; }
  }
  const located = results.filter((r) => r.rightSector !== null);
  const sampled = results.filter((r) => r.samples);
  const count = (f) => sampled.filter(f).length;
  return {
    ...(sampled.length ? { samples: sampled[0].samples.length, single: count((r) => r.passed), consensus3: count((r) => r.consensus3), consensusN: count((r) => r.consensusN),
      escalated: count((r) => r.escalated.passed), escalatedCost: Math.round((sampled.reduce((n, r) => n + r.escalated.used, 0) / sampled.length) * 100) / 100,
      anyPassed: count((r) => r.anyPassed) } : {}),
    passed: results.filter((r) => r.passed).length, total: results.length,
    rightSector: located.filter((r) => r.rightSector).length, located: located.length,
    ms: results.reduce((n, r) => n + r.ms, 0), bySector,
  };
}
