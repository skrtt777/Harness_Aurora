import { runCodex } from "./codex.js";
import { runClaude } from "./claude.js";

const DEFAULT_CORRECTION_TIMEOUT_MS = 60_000;

export function buildCorrectionPrompt(question, wrongAnswer, note) {
  return [
    "Um modelo de IA local e pequeno respondeu errado ou incompleto a uma pergunta.",
    "Você é o professor: corrija a resposta para o usuário e, principalmente, ensine o modelo pequeno a acertar perguntas parecidas no futuro.",
    "",
    "Responda SOMENTE com um objeto JSON válido, sem markdown e sem texto fora do objeto, no formato:",
    '{"answer": "resposta corrigida e completa para o usuário", "memories": [{"title": "título curto", "content": "regra ou fato objetivo (uma frase) que ajudaria um modelo pequeno a acertar perguntas parecidas", "tags": ["1 a 3 palavras-chave em minúsculas"]}], "template": {"title": "título curto", "content": "esqueleto de código reutilizável", "tags": ["1 a 3 palavras-chave"]} ou null}',
    'No máximo 3 itens em "memories". Cada memória deve ser uma regra ou fato reutilizável — não um resumo desta troca.',
    '"template" é OPCIONAL: inclua só quando a tarefa envolve gerar um artefato de código estruturado (ex: um jogo, uma página) e vale a pena guardar um ESQUELETO/BOILERPLATE correto e reutilizável (setup de cena/câmera/loop de animação, sem a mecânica específica deste pedido) para o modelo pequeno adaptar da próxima vez em vez de reescrever tudo do zero. Se não fizer sentido, responda "template": null.',
    "",
    `Pergunta original do usuário: ${question}`,
    `Resposta errada do modelo local: ${wrongAnswer}`,
    note ? `O que estava errado, segundo o usuário: ${note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseCorrectionResponse(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(match ? match[0] : text);
    const answer = String(parsed.answer || "").trim();
    const memories = Array.isArray(parsed.memories)
      ? parsed.memories
          .filter((m) => m && String(m.content || "").trim())
          .slice(0, 3)
          .map((m) => ({
            title: String(m.title || "Correção").trim().slice(0, 120) || "Correção",
            content: String(m.content).trim().slice(0, 600),
            tags: Array.isArray(m.tags) ? m.tags.map((t) => String(t).toLowerCase()).slice(0, 5) : [],
          }))
      : [];
    const template =
      parsed.template && String(parsed.template.content || "").trim()
        ? {
            title: String(parsed.template.title || "Template").trim().slice(0, 120) || "Template",
            content: String(parsed.template.content).trim().slice(0, 4000),
            tags: Array.isArray(parsed.template.tags) ? parsed.template.tags.map((t) => String(t).toLowerCase()).slice(0, 5) : [],
          }
        : null;
    return { answer, memories, template };
  } catch {
    return { answer: "", memories: [], template: null };
  }
}

/**
 * The teacher (Codex or Claude) both corrects the local model's answer and
 * distills the lesson into memory candidates, in a single call — this is
 * what lets the local model "learn" via memory instead of fine-tuning.
 */
export async function correctLocalAnswer({ question, wrongAnswer, note, teacherProvider = "codex", env = process.env }) {
  const runProvider = teacherProvider === "claude" ? runClaude : runCodex;
  const timeoutKey = teacherProvider === "claude" ? "CLAUDE_TIMEOUT_MS" : "CODEX_TIMEOUT_MS";
  const prompt = buildCorrectionPrompt(question, wrongAnswer, note);
  const result = await runProvider(prompt, {
    ...env,
    [timeoutKey]: env.CORRECTION_TIMEOUT_MS || DEFAULT_CORRECTION_TIMEOUT_MS,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, ...parseCorrectionResponse(result.text) };
}
