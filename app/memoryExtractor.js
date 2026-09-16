import { runCodex } from "./codex.js";
import { createMemory } from "./store.js";

const DEFAULT_EXTRACTION_TIMEOUT_MS = 45_000;

export function buildExtractionPrompt(userMessage, assistantMessage) {
  return [
    "Você é um extrator de memória de longo prazo para um assistente de IA.",
    "Leia a troca abaixo entre um usuário e um assistente e decida o que vale a pena lembrar em conversas futuras:",
    "fatos estáveis, preferências, decisões, nomes, restrições e combinados.",
    "",
    "Responda SOMENTE com um array JSON válido, sem markdown e sem texto fora do array.",
    'Cada item: {"title": string curto, "content": string objetiva (uma frase), "tags": lista de 1 a 3 palavras-chave em minúsculas}.',
    "Se não houver nada relevante para lembrar, responda exatamente: []",
    "Não invente informação que não esteja no texto. Não repita a conversa inteira; extraia só o que é reutilizável depois.",
    "No máximo 4 itens.",
    "",
    `Usuário: ${userMessage}`,
    `Assistente: ${assistantMessage}`,
  ].join("\n");
}

export function parseMemoryCandidates(text) {
  if (!text) return [];
  const match = String(text).match(/\[[\s\S]*\]/);
  const jsonText = match ? match[0] : text;
  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object" && String(item.content || "").trim())
      .slice(0, 4)
      .map((item) => ({
        title: String(item.title || "Memória").trim().slice(0, 120) || "Memória",
        content: String(item.content).trim().slice(0, 600),
        tags: Array.isArray(item.tags) ? item.tags.map((t) => String(t).toLowerCase()).slice(0, 5) : [],
      }));
  } catch {
    return [];
  }
}

/**
 * Runs after every assistant turn. This is what makes memory "real" instead
 * of decorative: the same model that answered the user is asked, in a second
 * ephemeral call, what from that exchange deserves to be remembered. The
 * result is stored scoped to the conversation it came from, so every chat
 * created in the harness builds its own memory automatically.
 */
export async function extractAndStoreMemories({ conversationId, userMessage, assistantMessage, env = process.env }) {
  if (!conversationId || !userMessage?.trim() || !assistantMessage?.trim()) return [];

  const prompt = buildExtractionPrompt(userMessage, assistantMessage);
  const result = await runCodex(prompt, {
    ...env,
    CODEX_TIMEOUT_MS: env.MEMORY_EXTRACTION_TIMEOUT_MS || DEFAULT_EXTRACTION_TIMEOUT_MS,
  });
  if (!result.ok) return [];

  const candidates = parseMemoryCandidates(result.text);
  const saved = [];
  for (const candidate of candidates) {
    try {
      const memory = await createMemory({
        scope: "conversation",
        conversationId,
        title: candidate.title,
        content: candidate.content,
        tags: candidate.tags,
        kind: "extracted",
        source: "Extraído automaticamente pela IA após a resposta",
      });
      saved.push(memory);
    } catch {
      // A malformed candidate is skipped instead of failing the whole turn.
    }
  }
  return saved;
}
