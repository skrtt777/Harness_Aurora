import { runCodex } from "./codex.js";
import { runClaude } from "./claude.js";
import { createMemory, createRelation, listNearbyMemories } from "./store.js";

const DEFAULT_EXTRACTION_TIMEOUT_MS = 45_000;
const RELATION_TYPES = ["belonging", "thematic", "derivation", "correction"];
const RELATION_GUIDE = [
  "belonging = faz parte de um tema/projeto já registrado numa das memórias existentes",
  "thematic = fala do mesmo assunto que uma memória existente, sem depender dela",
  "derivation = decorre de ou depende diretamente de uma memória existente",
  "correction = corrige ou atualiza o que uma memória existente dizia",
].join("; ");

export function buildExtractionPrompt(userMessage, assistantMessage, existingMemories = []) {
  const candidateList = existingMemories.length
    ? existingMemories.map((m) => `- ${m.id}: ${m.title}`).join("\n")
    : "(nenhuma memória existente ainda)";

  return [
    "Você é um extrator de memória de longo prazo para um assistente de IA.",
    "Leia a troca abaixo entre um usuário e um assistente e decida o que vale a pena lembrar em conversas futuras:",
    "fatos estáveis, preferências, decisões, nomes, restrições e combinados.",
    "",
    "Responda SOMENTE com um array JSON válido, sem markdown e sem texto fora do array.",
    'Cada item: {"title": string curto, "content": string objetiva (uma frase), "tags": lista de 1 a 3 palavras-chave em minúsculas, "relatesTo": lista opcional de relações com memórias já existentes}.',
    'Cada item de "relatesTo": {"id": id exato de uma memória da lista abaixo, "type": um dos tipos a seguir}.',
    `Tipos de relação: ${RELATION_GUIDE}.`,
    "Só use \"relatesTo\" quando a relação for clara; nunca invente um id fora da lista. Se não houver relação, omita o campo ou deixe [].",
    "Se não houver nada relevante para lembrar, responda exatamente: []",
    "Não invente informação que não esteja no texto. Não repita a conversa inteira; extraia só o que é reutilizável depois.",
    "No máximo 4 itens.",
    "",
    "Memórias existentes que podem ser referenciadas em \"relatesTo\":",
    candidateList,
    "",
    `Usuário: ${userMessage}`,
    `Assistente: ${assistantMessage}`,
  ].join("\n");
}

export function parseMemoryCandidates(text, validIds = []) {
  if (!text) return [];
  const match = String(text).match(/\[[\s\S]*\]/);
  const jsonText = match ? match[0] : text;
  const validIdSet = new Set(validIds);
  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object" && typeof item.content === "string" && item.content.trim())
      .slice(0, 4)
      .map((item) => ({
        title: String(item.title || "Memória").trim().slice(0, 120) || "Memória",
        content: String(item.content).trim().slice(0, 600),
        tags: Array.isArray(item.tags) ? item.tags.filter(t => typeof t === "string").map(t => t.toLowerCase()).slice(0, 5) : [],
        relatesTo: Array.isArray(item.relatesTo)
          ? item.relatesTo
              .filter((r) => r && validIdSet.has(r.id) && RELATION_TYPES.includes(r.type))
              .map((r) => ({ id: r.id, type: r.type }))
              .slice(0, 5)
          : [],
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
export async function extractAndStoreMemories({ conversationId, projectId, provider = "codex", userMessage, assistantMessage, env = process.env }) {
  if (!conversationId || !userMessage?.trim() || !assistantMessage?.trim()) return [];

  const nearby = await listNearbyMemories({ conversationId, projectId });
  const prompt = buildExtractionPrompt(userMessage, assistantMessage, nearby);
  const runProvider = provider === "claude" ? runClaude : runCodex;
  const timeoutKey = provider === "claude" ? "CLAUDE_TIMEOUT_MS" : "CODEX_TIMEOUT_MS";
  const result = await runProvider(prompt, {
    ...env,
    [timeoutKey]: env.MEMORY_EXTRACTION_TIMEOUT_MS || DEFAULT_EXTRACTION_TIMEOUT_MS,
  });
  if (!result.ok) throw new Error(result.error || "Extração indisponível.");

  const candidates = parseMemoryCandidates(result.text, nearby.map((m) => m.id));
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
      for (const relation of candidate.relatesTo) {
        try {
          await createRelation({ fromId: memory.id, toId: relation.id, type: relation.type });
        } catch {
          // A relation that fails validation is skipped; the memory itself is still saved.
        }
      }
      saved.push(memory);
    } catch {
      // A malformed candidate is skipped instead of failing the whole turn.
    }
  }
  return saved;
}
