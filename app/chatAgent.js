import { runClaude } from "./claude.js";
import { runCodex } from "./codex.js";
import { runLocalChat } from "./local.js";
import { localCallRecord, summarizeLocalCalls } from "./localTelemetry.js";
import { AGENT_TOOLS, executeTool, stageFor, toolCatalogue, toolSchemas } from "./agentTools/index.js";

export const DEFAULT_MAX_STEPS = 15;
const REPEAT_LIMIT = 3;

const stripThinking = (text) => String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

/**
 * Finds a tool call a model wrote as text instead of emitting it natively:
 * {"tool":"x","args":{}}, {"name":"x","arguments":{}} or Qwen's
 * <tool_call>{…}</tool_call>. Small local models slip into this often, and
 * the Claude/Codex CLIs only have text. Returns null for ordinary prose, so
 * an answer that merely *contains* braces isn't mistaken for an action.
 */
export function parseTextToolCall(rawText, known = AGENT_TOOLS.map((t) => t.name)) {
  if (!rawText) return null;
  let text = String(rawText).trim();
  const tagged = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (tagged) text = tagged[1].trim();
  else if (fence) text = fence[1].trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  const name = parsed?.tool || parsed?.name || parsed?.function?.name;
  let args = parsed?.args ?? parsed?.arguments ?? parsed?.parameters ?? parsed?.function?.arguments ?? {};
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
  if (typeof name !== "string" || !known.includes(name)) return null;
  return { name, arguments: args && typeof args === "object" ? args : {} };
}

const ACTION_VERBS = "rolar|tentar|clicar|abrir|pesquisar|verificar|procurar|digitar|acessar|navegar|buscar|carregar|conferir|checar|olhar|ler|recarregar|voltar|selecionar|executar|rodar";

/** "Vou rolar a página e verificar…" — a promise of an action, not an answer. */
export function announcesAction(text) {
  const tail = String(text || "").slice(-400);
  return new RegExp(`\\b(vou|irei|vamos|deixa eu|deixe-me|agora vou)\\s+(\\w+\\s+)?(${ACTION_VERBS})`, "i").test(tail)
    && !/\?\s*$/.test(tail.trim());
}

/** Transcript as a single prompt, for the CLI providers (no native tools). */
export function renderTextPrompt(messages, tools) {
  const lines = [];
  for (const m of messages) {
    if (m.role === "system") lines.push(m.content);
    else if (m.role === "user") lines.push(`Usuário: ${m.content}`);
    else if (m.role === "assistant" && m.tool_calls?.length) lines.push(...m.tool_calls.map((c) => `Você chamou: ${JSON.stringify({ tool: c.function.name, args: c.function.arguments })}`));
    else if (m.role === "assistant") lines.push(`Aurora: ${m.content}`);
    else if (m.role === "tool") lines.push(`Resultado de ${m.tool_name}:\n${m.content}`);
  }
  if (tools.length) lines.splice(1, 0, `Ferramentas disponíveis:\n${toolCatalogue(tools)}\n\nPara usar uma ferramenta, responda SOMENTE com um JSON numa única linha: {"tool":"nome","args":{...}} — uma ferramenta por resposta; você verá o resultado e poderá continuar. Quando terminar, responda ao usuário normalmente, sem JSON.`);
  else lines.push("Agora responda ao usuário em texto, sem chamar ferramentas.");
  return lines.join("\n\n");
}

const KEEP_FULL_TOOL_RESULTS = 2;
const OLD_RESULT_CHARS = 400;

/**
 * Page snapshots are large; a long browsing session would overflow a local
 * model's context and Ollama would silently drop the *start* of it — the
 * system prompt. Only the latest results matter for the next step, so older
 * ones shrink to their first lines ("Cliquei em e12." + URL).
 */
export function compactOldToolResults(messages) {
  const toolIndexes = messages.flatMap((m, i) => (m.role === "tool" ? [i] : []));
  for (const i of toolIndexes.slice(0, -KEEP_FULL_TOOL_RESULTS)) {
    const content = messages[i].content;
    if (content.length > OLD_RESULT_CHARS && !content.endsWith("(resultado antigo resumido)")) messages[i].content = `${content.slice(0, OLD_RESULT_CHARS)}\n… (resultado antigo resumido)`;
  }
}

function defaultCallModel(provider) {
  if (provider === "local") return (messages, tools, env, signal) => runLocalChat(messages, toolSchemas(tools), env, signal);
  const run = provider === "claude" ? runClaude : runCodex;
  return async (messages, tools, env, signal) => {
    const result = await run(renderTextPrompt(messages, tools), env, signal);
    return result.ok ? { ...result, toolCalls: [] } : result;
  };
}

/**
 * The chat agent loop: ask the model → run any tool it calls → feed the
 * result back → repeat until it answers in plain text. It's what turns
 * "controle o navegador e acesse o youtube" into real actions instead of a
 * description of them. The model — not a keyword router — decides whether
 * a message needs tools at all; a plain "oi" is a single call that answers
 * directly.
 *
 * Guards: a step cap, a repeat detector (same call with the same args
 * REPEAT_LIMIT times), and both end with one last tool-less call so the
 * user always gets a summary instead of a silent stop.
 */
export async function runChatAgent({
  provider = "local", system, history = [], input, env = process.env, signal,
  onStage = () => {}, onStep = () => {}, approve = async () => false, toolContext = {},
  tools = AGENT_TOOLS, maxSteps = DEFAULT_MAX_STEPS, callModel = defaultCallModel(provider),
}) {
  const messages = [{ role: "system", content: system }, ...history, { role: "user", content: input }];
  const steps = [];
  const calls = [];
  const seen = new Map();
  const ctx = { ...toolContext, env, signal, onStage, approve };
  let offered = tools;
  let forcedNote = "";
  let forced = null;
  let nudged = false;

  for (let round = 0; round <= maxSteps; round += 1) {
    if (signal?.aborted) return { ok: false, status: 499, cancelled: true, error: "Mensagem cancelada.", steps, calls };
    if (round === maxSteps && offered.length) { offered = []; forced = "limit"; forcedNote = `Você atingiu o limite de ${maxSteps} ações nesta mensagem.`; }
    if (!offered.length && forcedNote) messages.push({ role: "user", content: `${forcedNote} Não chame mais ferramentas: diga ao usuário, em poucas frases, o que você conseguiu fazer e o que faltou.` });
    onStage(round === 0 ? "Pensando…" : steps.length ? "Decidindo o próximo passo…" : "Gerando resposta…");
    compactOldToolResults(messages);

    const result = await callModel(messages, offered, env, signal);
    calls.push(localCallRecord(result, round === 0 ? "generate" : "agent-step"));
    if (!result.ok) return { ...result, steps, calls };

    let toolCalls = offered.length ? (result.toolCalls || []) : [];
    const text = stripThinking(result.text);
    if (offered.length && !toolCalls.length) {
      const inline = parseTextToolCall(text, offered.map((t) => t.name));
      if (inline) toolCalls = [inline];
    }
    if (!toolCalls.length && offered.length && !nudged && announcesAction(text)) {
      // Small models often stop at "vou rolar a página…" instead of doing it.
      nudged = true;
      messages.push({ role: "assistant", content: text }, { role: "user", content: "Faça isso agora usando as ferramentas, em vez de só anunciar. Depois responda com o resultado." });
      continue;
    }
    if (!toolCalls.length) {
      messages.push({ role: "assistant", content: text || "Pronto." });
      return { ok: true, status: 200, text: text || "Pronto.", steps, calls, forced, messages, truncated: result.truncated, threadId: result.threadId || null };
    }

    messages.push({ role: "assistant", content: toolCalls.length && parseTextToolCall(text) ? "" : text, tool_calls: toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) });
    for (const call of toolCalls) {
      const key = `${call.name}:${JSON.stringify(call.arguments)}`;
      const count = (seen.get(key) || 0) + 1;
      seen.set(key, count);
      let outcome;
      if (count >= REPEAT_LIMIT) {
        outcome = { ok: false, result: "ERRO: você já repetiu exatamente essa ação várias vezes sem progresso.", ms: 0 };
        offered = [];
        forced = "repeat";
        forcedNote = "Você repetiu a mesma ação sem progresso.";
      } else {
        const stage = stageFor(call.name, call.arguments, tools);
        onStage(stage);
        onStep({ tool: call.name, args: call.arguments, stage, status: "running" });
        try { outcome = await executeTool(call.name, call.arguments, ctx, tools); }
        catch { return { ok: false, status: 499, cancelled: true, error: "Mensagem cancelada.", steps, calls }; }
      }
      const step = { tool: call.name, args: call.arguments, ok: outcome.ok, ...(outcome.denied ? { denied: true } : {}), summary: outcome.result.split("\n")[0].slice(0, 200), result: outcome.result.slice(0, 1200), ms: outcome.ms };
      steps.push(step);
      onStep({ ...step, stage: stageFor(call.name, call.arguments, tools), status: outcome.ok ? "done" : "failed" });
      messages.push({ role: "tool", tool_name: call.name, content: outcome.result });
    }
  }
  return { ok: false, status: 500, error: "O agente não conseguiu concluir.", steps, calls };
}

export function agentTelemetry(calls) {
  return summarizeLocalCalls(calls);
}
