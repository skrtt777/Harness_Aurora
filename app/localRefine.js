import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLocal } from "./local.js";
import { runCodeInSandbox } from "./jsSandbox.js";

const execFileAsync = promisify(execFile);

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
  const matches = [...String(html || "").matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
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

  const dir = await mkdtemp(join(tmpdir(), "harness-syntax-"));
  const file = join(dir, "check.mjs");
  try {
    await writeFile(file, js, "utf8");
    await execFileAsync(process.execPath, ["--check", file]);
    return { checked: true, valid: true, error: null };
  } catch (error) {
    const detail = (error.stderr || error.message || "").toString().trim().slice(0, 500);
    return { checked: true, valid: false, error: detail || "Erro de sintaxe desconhecido." };
  } finally {
    await unlink(file).catch(() => {});
    await rmdir(dir).catch(() => {});
  }
}

/**
 * A heuristic (not a real parser) that catches a pattern this specific class
 * of small model produces constantly: declaring a variable with `const` and
 * reassigning it later (`const score = 0; ...; score++`), which is valid
 * syntax — `node --check` never sees it — but throws
 * "Assignment to constant variable" the moment the code actually runs.
 * False positives are possible (this is line-based, not AST-based); that's
 * an acceptable cost for a free, best-effort safety net.
 */
export function findConstReassignments(js) {
  if (!js) return [];
  const lines = js.split(/\r?\n/);
  const constNames = new Set();
  for (const line of lines) {
    const m = line.match(/\bconst\s+([a-zA-Z_$][\w$]*)\s*=/);
    if (m) constNames.add(m[1]);
  }
  const offenders = [];
  for (const name of constNames) {
    const declRe = new RegExp(`\\bconst\\s+${name}\\b`);
    const reassignRe = new RegExp(`\\b${name}\\b\\s*(=(?!=)|\\+\\+|--|\\+=|-=|\\*=|/=)`);
    const reassigned = lines.some((line) => !declRe.test(line) && reassignRe.test(line));
    if (reassigned) offenders.push(name);
  }
  return offenders;
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

  // Neither check above is a real parser, so as a last line of defense
  // actually run the code (against a permissive fake THREE/DOM — see
  // jsSandbox.js) to catch anything else that's syntactically fine but
  // throws the moment it executes (e.g. a variable used without ever being
  // declared, like `cube` in a game that only declared `cubes`, or an addon
  // class like OrbitControls referenced without its own import/script).
  // The full `text` (not just the extracted script) is passed through so
  // the sandbox can see any <script src="..."> tags outside the inline
  // script when deciding which addons are actually available.
  const sandbox = runCodeInSandbox(js, text);
  if (sandbox.checked && sandbox.crashed) {
    return `O código quebra assim que roda (testado de verdade num sandbox): ${sandbox.error}`;
  }

  return null;
}

// Extra local-only retries beyond the first answer, always free (Ollama),
// bounded because the same weak model that made a mistake sometimes makes
// the same class of mistake again on the very next attempt.
const MAX_FIX_ATTEMPTS = 2;

export async function refineLocalAnswer({ task, result, memories = [], env = process.env }) {
  if (!result.ok || !looksLikeCode(result.text)) return result;

  let current = result;

  for (let attempt = 0; attempt < MAX_FIX_ATTEMPTS; attempt++) {
    const problem = await describeCodeProblems(current.text);
    if (!problem) break;
    const retryPrompt = `${task}\n\nSua resposta anterior tinha um problema:\n${problem}\n\nGere a resposta completa novamente (o HTML completo, em um unico bloco de codigo), corrigindo esse problema.`;
    const retried = await runLocal(retryPrompt, env);
    if (!retried.ok || !retried.text.trim()) break;
    current = retried;
  }

  // The loop above never re-checks the very last retry it produced (it just
  // ran out of budget after setting `current`) — check once more, for free,
  // so a lingering problem is at least handed to the self-review pass below
  // instead of shipping an unverified answer silently.
  const remainingProblem = await describeCodeProblems(current.text);

  if (memories.length > 0 || remainingProblem) {
    const reviewPrompt = buildSelfReviewPrompt(task, current.text, memories, remainingProblem);
    const reviewed = await runLocal(reviewPrompt, env);
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

  return current;
}
