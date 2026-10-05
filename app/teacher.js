import { runClaude } from "./claude.js";
import { runCodex } from "./codex.js";

/**
 * Automatic teaching (docs/REVISAO_2026-09-27.md, Fase 2). The local agent
 * delivers; a paid teacher (Codex/Claude CLI) reviews the whole trajectory
 * when there is a reason to — an error signal or a delivery that changed
 * something — and, if it finds problems, hands back general lessons (saved
 * as memories) and concrete guidance. The LOCAL model then redoes the work
 * with those lessons, which is what makes the lesson prove its value.
 */

// Tools whose success changes the world; a delivery using them gets reviewed.
export const ACTION_TOOLS = new Set(["write_file", "edit_file", "write_document", "move_file", "organize_folder", "run_command", "browser_click", "browser_type", "browser_key", "open", "skill_create"]);
export const TEACHER_MODES = ["actions", "errors", "off"];
export const DEFAULT_TEACHER_MODE = "actions";
export const DEFAULT_DAILY_LIMIT = 30;

const COMPLAINT = /\b(n[ãa]o (funcionou|funciona|deu certo|abriu|fez|era isso|rodou|salvou|mudou|achei|encontrei|criou|gerou)|(t[áa]|est[áa]|ficou|continua) (errado|com erro|quebrado)|deu erro|errou|de novo|tente (de )?novo|refa[çz]a|corrija)\b/i;
// "Onde está?" is a complaint only when the previous answer wrote nothing it could point to.
export const WHERE_IS = /\bcad[êe]\b|^\s*(e\s+)?onde\s+(est[áa]|ficou|foi parar|salvou)(?![a-zà-ú])\s*(ele|ela|o arquivo|o documento|a planilha)?\?*\s*$/i;
const GAVE_UP = /\b(n[ãa]o consegui|n[ãa]o foi poss[íi]vel|infelizmente|n[ãa]o tenho como|n[ãa]o posso)\b/i;

// Tools that leave a file behind; a claim of a created file needs one of them.
export const WRITE_TOOLS = new Set(["write_file", "edit_file", "write_document", "run_command"]);
const DELIVERABLE = "(?:documento|arquivo|planilha|relat[óo]rio|pdf|docx|xlsx|csv|tabela|apresenta[çc][ãa]o|vers[ãa]o atualizada)";
const CLAIM = new RegExp([
  `\\b(?:criei|salvei|gerei|escrevi|elaborei|montei|produzi|atualizei)\\b[^.\\n]{0,60}\\b${DELIVERABLE}`,
  `\\bconsegui (?:criar|gerar|salvar|montar|elaborar)\\b`,
  `\\b${DELIVERABLE}\\b[^.\\n]{0,40}\\b(?:criad[oa]|salv[oa]|gerad[oa]|pront[oa] para|atualizad[oa] com sucesso)\\b`,
  `\\bfoi salv[oa] (?:em|na pasta)\\b`,
].join("|"), "i");

/** "Crie um novo documento…", "gere uma planilha…": the person asked for a file. */
export function requestsFile(text) {
  return new RegExp(`\\b(?:crie|cria|criar|gere|gera|gerar|fa[çz]a|monte|elabore|escreva|salve|produza|prepare)\\b[^.?!\\n]{0,40}\\b${DELIVERABLE}`, "i").test(String(text || ""));
}

/**
 * "Criei o documento", "Documento criado com sucesso" with no tool that wrote
 * a file: a delivery the person will look for and not find. Negations
 * ("não criei") and offers ("posso criar") don't count.
 */
export function claimsDelivery(text, steps = []) {
  if (steps.some((s) => s.ok && WRITE_TOOLS.has(s.tool))) return false;
  return String(text || "").split(/(?<=[.!?\n])\s+/).some((sentence) => CLAIM.test(sentence) && !/\bn[ãa]o\s+(\w+\s+)?(criei|salvei|gerei|consegui|foi)\b/i.test(sentence));
}

/** Error signals found without any paid call. */
export function detectSignals({ userMessage = "", result, history = [] }) {
  const signals = [];
  const steps = result?.steps || [];
  const failed = steps.filter((s) => !s.ok && !s.denied);
  const unrecovered = failed.filter((f) => !steps.slice(steps.indexOf(f) + 1).some((s) => s.tool === f.tool && s.ok));
  if (unrecovered.length) signals.push({ code: "failed_actions", detail: unrecovered.map((s) => `${s.tool}: ${s.summary}`).join(" | ").slice(0, 600) });
  if (result?.forced === "limit") signals.push({ code: "step_limit", detail: "Atingiu o limite de ações sem concluir." });
  if (result?.forced === "repeat") signals.push({ code: "repetition", detail: "Repetiu a mesma ação sem progresso." });
  if (claimsDelivery(result?.text, steps)) signals.push({ code: "claimed_delivery", detail: "A resposta diz que criou ou salvou um arquivo, mas nenhuma ação escreveu arquivo." });
  if (GAVE_UP.test(String(result?.text || "").slice(-600))) signals.push({ code: "gave_up", detail: "A resposta admite que não conseguiu." });
  // Several copies answered differently (copies.js): the local model is unsure here.
  if (result?.copies?.disagree) signals.push({ code: "copies_disagree", detail: `${result.copies.used} cópias do modelo local deram respostas diferentes (concordância ${Math.round(result.copies.support * 100)}%).` });
  const previous = history.filter((m) => m.role === "assistant").at(-1);
  const delivered = (previous?.execution?.toolSteps || []).some((s) => s.ok && WRITE_TOOLS.has(s.tool));
  if (COMPLAINT.test(userMessage) || (WHERE_IS.test(userMessage) && !delivered)) signals.push({ code: "user_complaint", detail: `O usuário reclamou do resultado anterior: "${userMessage.slice(0, 200)}"` });
  return signals;
}

export function shouldReview({ mode = DEFAULT_TEACHER_MODE, signals, steps = [] }) {
  if (mode === "off") return null;
  if (signals.length) return "errors";
  if (mode === "actions" && steps.some((s) => s.ok && ACTION_TOOLS.has(s.tool))) return "actions";
  return null;
}

const clip = (text, max) => { const value = String(text ?? ""); return value.length > max ? `${value.slice(0, max)}…` : value; };

export function buildReviewPrompt({ userMessage, history = [], steps = [], answer, signals = [], workspace, memories = [] }) {
  const recent = history.filter((m) => ["user", "assistant"].includes(m.role) && m.provider !== "Sistema").slice(-4)
    .map((m) => `${m.role === "user" ? "Usuário" : "Aurora"}: ${clip(m.content, 500)}`).join("\n");
  const actions = steps.map((s, i) => `${i + 1}. ${s.tool} ${clip(JSON.stringify(s.args), 700)}\n   → ${s.ok ? "ok" : "FALHOU"}: ${clip(s.result ?? s.summary, 700)}`).join("\n") || "(nenhuma ação)";
  return [
    "Você é o professor de um assistente local pequeno (a Aurora) que executa tarefas no computador do usuário usando ferramentas.",
    "Revise a entrega abaixo com rigor: a tarefa foi cumprida de verdade? Algo que funcionava foi quebrado? A resposta final afirma algo que as ações não comprovam?",
    "Seja exigente como um usuário experiente: uma entrega superficial conta como problema (ex.: um teste que não exercita o código do projeto, um arquivo criado mas nunca executado quando o pedido era fazê-lo funcionar, um resultado inventado).",
    workspace ? `A pasta do projeto é o diretório atual (${workspace}). Você PODE ler os arquivos dela para conferir o resultado. NÃO altere nada.` : "Não altere nada no computador.",
    "",
    "Responda SOMENTE com um objeto JSON válido, sem markdown:",
    '{"verdict":"ok" ou "fix","problems":["problema concreto"],"guidance":"instruções objetivas para a Aurora corrigir AGORA (o que fazer, em que arquivo, qual comando conferir)","lessons":[{"title":"curto","content":"regra geral e reutilizável, uma frase, útil para tarefas PARECIDAS no futuro — não um resumo desta tarefa","tags":["1 a 3 palavras"]}],"skill":null}',
    'Use "fix" só se houver problema real e corrigível. Com "ok", deixe problems e lessons vazios. No máximo 3 lessons. "skill" opcional: {"name":"minusculas-com-hifen","description":"quando usar","body":"procedimento em markdown"} só para um procedimento longo e reutilizável.',
    "",
    signals.length ? `Sinais de erro detectados automaticamente:\n${signals.map((s) => `- ${s.code}: ${s.detail}`).join("\n")}` : "Nenhum sinal automático de erro; revisão de rotina de uma entrega que alterou algo.",
    memories.length ? `Lições que a Aurora já tinha (não repita):\n${memories.map((m) => `- ${clip(m.content, 200)}`).join("\n")}` : "",
    recent ? `Conversa recente:\n${recent}` : "",
    `Pedido atual do usuário: ${clip(userMessage, 2000)}`,
    `Ações da Aurora:\n${actions}`,
    `Resposta final da Aurora: ${clip(answer, 2000)}`,
  ].filter(Boolean).join("\n");
}

export function parseReview(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try { parsed = JSON.parse(match[0]); } catch { return null; }
  if (!["ok", "fix"].includes(parsed?.verdict)) return null;
  const strings = (list, n, max) => (Array.isArray(list) ? list : []).filter((s) => typeof s === "string" && s.trim()).slice(0, n).map((s) => clip(s.trim(), max));
  const lessons = (Array.isArray(parsed.lessons) ? parsed.lessons : []).filter((l) => l && typeof l.content === "string" && l.content.trim()).slice(0, 3).map((l) => ({
    title: clip(String(l.title || "Lição").trim() || "Lição", 100),
    content: clip(l.content.trim(), 600),
    tags: (Array.isArray(l.tags) ? l.tags : []).filter((t) => typeof t === "string").map((t) => t.toLowerCase().slice(0, 40)).slice(0, 3),
  }));
  const skill = parsed.skill && typeof parsed.skill.body === "string" && parsed.skill.body.trim() && typeof parsed.skill.name === "string"
    ? { name: clip(parsed.skill.name, 64), description: clip(String(parsed.skill.description || parsed.skill.name), 1000), body: clip(parsed.skill.body, 8000) } : null;
  const verdict = parsed.verdict === "fix" && (strings(parsed.problems, 6, 400).length || lessons.length) ? "fix" : "ok";
  return { verdict, problems: strings(parsed.problems, 6, 400), guidance: clip(String(parsed.guidance || ""), 3000), lessons: verdict === "fix" ? lessons : [], skill };
}

export async function callTeacher({ provider, prompt, workspace, env = process.env, signal }) {
  const run = provider === "claude" ? runClaude : runCodex;
  const cwdKey = provider === "claude" ? "CLAUDE_CWD" : "CODEX_CWD";
  const timeoutKey = provider === "claude" ? "CLAUDE_TIMEOUT_MS" : "CODEX_TIMEOUT_MS";
  return run(prompt, { ...env, ...(workspace ? { [cwdKey]: workspace } : {}), [timeoutKey]: env.TEACHER_TIMEOUT_MS || "180000" }, signal);
}

/** The message the local model gets for its second attempt. */
export function redoMessage(review, userMessage = "") {
  return [
    "Um revisor conferiu sua entrega e encontrou problemas. Corrija agora usando as ferramentas e confira o resultado antes de responder.",
    review.problems.length ? `Problemas:\n${review.problems.map((p) => `- ${p}`).join("\n")}` : "",
    review.guidance ? `Orientação:\n${review.guidance}` : "",
    review.lessons.length ? `Lições para guardar:\n${review.lessons.map((l) => `- ${l.content}`).join("\n")}` : "",
    userMessage ? `Pedido do usuário: ${clip(userMessage, 1000)}` : "",
    // The app already shows that the answer was revised; narrating it ("Corrigi a
    // situação: agora, após a leitura…") replaced the summary the person asked for.
    "A resposta final é a entrega pedida pelo usuário, completa, como se fosse a primeira: não fale do revisor, da correção nem das tentativas anteriores.",
  ].filter(Boolean).join("\n\n");
}

/** A redo that talks about itself instead of delivering. */
export function narratesCorrection(text) {
  return /^\s*(\*\*)?\s*(corrigi|corrigido|corrigindo|corre[çc][ãa]o|agora,? ap[óo]s|ap[óo]s (a |o )?(revis|corre|leitura)|refiz|revisei)/i.test(String(text || ""));
}
