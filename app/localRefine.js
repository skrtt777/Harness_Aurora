import { runLocal } from "./local.js";
import { runCodeInSandbox, parseJavaScript, constReassignments } from "./jsSandbox.js";

function looksLikeCode(text) {
  return /<script[^>]*>/i.test(text || "") || /```html/i.test(text || "");
}

/**
 * Finds the inline game-logic <script> in the answer — module-typed
 * (`<script type="module">`) or classic (a plain `<script>`, which the local
 * model sometimes produces when it loads Three.js from a UMD/global build
 * instead of an ES module CDN URL). Script tags with a `src` attribute (no
 * inline body, e.g. the Three.js CDN loader itself) are skipped; when
 * several inline scripts exist, the longest one is assumed to be the real
 * game code rather than a small inline snippet.
 */
function extractModuleScript(text) {
  const codeBlockMatch = String(text || "").match(/```html\n([\s\S]*?)\n```/);
  const html = codeBlockMatch ? codeBlockMatch[1] : text;
  const matches = [...String(html || "").matchAll(/<script(?![^>]*\bsrc\s*=)(?![^>]*\btype\s*=\s*["'](?:importmap|application\/json))[^>]*>([\s\S]*?)<\/script>/gi)];
  if (!matches.length) return null;
  return matches.map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
}

/**
 * A syntax-only check (no imports resolved, nothing executed) on the JS
 * module script embedded in a local model's HTML answer. Catches the class
 * of fatal mistakes we saw repeatedly in testing (e.g. referencing an addon
 * that was never imported produces valid-looking but broken code) before
 * the user ever sees it — for free, no teacher call involved.
 */
export async function checkJsModuleSyntax(text) {
  const js = extractModuleScript(text);
  if (!js || !js.trim()) return { checked: false, valid: true, error: null };

  try {
    parseJavaScript(js);
    return { checked: true, valid: true, error: null };
  } catch (error) {
    const detail = (error.stderr || error.message || "").toString().trim().slice(0, 500);
    return { checked: true, valid: false, error: detail || "Erro de sintaxe desconhecido." };
  }
}

/** Uses lexical bindings, not text matching, to detect reassignment. */
export function findConstReassignments(js) {
  return constReassignments(js);
}

export function buildSelfReviewPrompt(task, answer, memories, knownProblem = null) {
  const rules = memories.map((m) => `- ${m.title}: ${m.content}`).join("\n");
  return [
    "Voce gerou a resposta abaixo para a tarefa indicada. Revise sua propria resposta com cuidado, uma ultima vez, antes de entregar.",
    "",
    `Tarefa original do usuario:\n${task}`,
    "",
    `Sua resposta:\n${answer}`,
    "",
    rules ? `Regras que voce deve seguir (aprendidas antes):\n${rules}` : "",
    knownProblem ? `Problema conhecido que AINDA precisa ser corrigido nesta resposta:\n${knownProblem}` : "",
    "",
    "Se a resposta ja atende TODAS as regras acima, nao tem o problema conhecido (se houver) e cumpre o pedido original por completo, responda EXATAMENTE com a mesma resposta, sem nenhuma mudanca.",
    "Se encontrar qualquer problema (regra nao seguida, problema conhecido nao resolvido, parte do pedido faltando, erro de logica), responda com a versao corrigida e COMPLETA — nao um resumo do que mudou, a resposta inteira de novo.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Refines a local model's answer using only the local model itself (zero
 * extra Codex/Claude cost): a syntax-check-and-retry pass for generated code,
 * then a self-review pass against the same memories that were already in
 * context. Skipped entirely for plain answers that don't look like code, to
 * keep normal chat turns fast.
 */
async function describeCodeProblems(text) {
  const js = extractModuleScript(text);
  if (!js || !js.trim()) return null;

  const syntax = await checkJsModuleSyntax(text);
  if (syntax.checked && !syntax.valid) {
    return `Erro de sintaxe JavaScript: ${syntax.error}`;
  }

  const offenders = findConstReassignments(js);
  if (offenders.length > 0) {
    return `Estas variaveis foram declaradas com "const" mas reatribuidas depois, o que quebra em tempo de execucao com "Assignment to constant variable": ${offenders.join(", ")}. Troque a declaracao dessas variaveis especificas para "let".`;
  }

  // Static diagnostics only: generated code is never evaluated in Node.
  const sandbox = runCodeInSandbox(js, text);
  if (sandbox.checked && sandbox.crashed) {
    return `A análise estática encontrou um possível erro: ${sandbox.error}`;
  }

  return null;
}

// Extra local-only retries beyond the first answer, always free (Ollama),
// bounded because the same weak model that made a mistake sometimes makes
// the same class of mistake again on the very next attempt.
const MAX_FIX_ATTEMPTS = 2;

export async function refineLocalAnswer({ task, result, memories = [], env = process.env, signal, onStage }) {
  const cancelled = () => ({ ok: false, status: 499, cancelled: true, error: "Mensagem cancelada." });
  if (signal?.aborted) return cancelled();
  if (!result.ok || !looksLikeCode(result.text)) return result;

  let current = result;

  for (let attempt = 0; attempt < MAX_FIX_ATTEMPTS && !signal?.aborted; attempt++) {
    const problem = await describeCodeProblems(current.text);
    if (!problem) break;
    onStage?.(
      attempt === 0
        ? "Corrigindo um erro encontrado no código…"
        : `Corrigindo um erro encontrado no código (tentativa ${attempt + 1})…`,
    );
    const retryPrompt = `${task}\n\nSua resposta anterior tinha um problema:\n${problem}\n\nGere a resposta completa novamente (o HTML completo, em um unico bloco de codigo), corrigindo esse problema.`;
    const retried = await runLocal(retryPrompt, env, signal);
    if (!retried.ok || !retried.text.trim() || !looksLikeCode(retried.text)) break;
    current = retried;
  }

  if (signal?.aborted) return cancelled();

  // The loop above never re-checks the very last retry it produced (it just
  // ran out of budget after setting `current`) — check once more, for free,
  // so a lingering problem is at least handed to the self-review pass below
  // instead of shipping an unverified answer silently.
  const remainingProblem = await describeCodeProblems(current.text);

  if (memories.length > 0 || remainingProblem) {
    onStage?.("Revisando a resposta antes de entregar…");
    const reviewPrompt = buildSelfReviewPrompt(task, current.text, memories, remainingProblem);
    const reviewed = await runLocal(reviewPrompt, env, signal);
    // A weak local model sometimes ignores the "repeat the same answer or
    // give a corrected one" instruction and writes prose *about* the review
    // instead (e.g. "verifiquei e está tudo certo"), silently discarding the
    // actual code — or reintroduces exactly the bug the retries above just
    // fixed while rewriting. Only adopt the revision if it still looks like
    // code AND doesn't reintroduce a detectable problem; otherwise the
    // already-checked pre-review answer is safer to keep.
    if (reviewed.ok && reviewed.text.trim() && looksLikeCode(reviewed.text)) {
      const reviewedProblem = await describeCodeProblems(reviewed.text);
      if (!reviewedProblem) current = reviewed;
    }
  }

  return signal?.aborted ? cancelled() : current;
}
