import { runLocal } from "./local.js";
import { diagnoseLocalArtifact, diagnosticText, artifactFingerprint, applyLocalEdits, repairContext } from "./localDiagnostics.js";
import { localCallRecord, summarizeLocalCalls } from "./localTelemetry.js";
import { parseJavaScript, constReassignments } from "./jsSandbox.js";

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

// Each retry has a distinct strategy. Never silently replace a better artifact.
export async function refineLocalAnswer({ task, result, memories = [], env = process.env, signal, onStage, selfReview = false, call = runLocal, maxAttempts = 2 }) {
  const calls=[localCallRecord(result)],events=[];
  let current=result;
  const finish=(value=current)=>{
    const telemetry={...summarizeLocalCalls(calls),events};
    return {...value,usage:telemetry.completeUsage?telemetry.knownUsage:null,telemetry,diagnostics:diagnoseLocalArtifact(value.text)};
  };
  const cancelled=()=>finish({ok:false,status:499,cancelled:true,error:'Mensagem cancelada.'});
  if(signal?.aborted)return cancelled();
  if(!result.ok || !looksLikeCode(result.text))return result;
  let diagnostics=diagnoseLocalArtifact(current.text);
  let lastFailure='';
  if(!diagnostics.issues.length&&!selfReview)return result;
  const seen=new Set([artifactFingerprint(current.text)]);
  for(let attempt=0;attempt<maxAttempts && diagnostics.issues.length;attempt++){
    if(signal?.aborted)return cancelled();
    // Complete HTML uses exact, guarded edits. Legacy script-only answers keep
    // the full-answer protocol, with a more specific second repair request.
    const edits=/<html[\s>]/i.test(current.text);
    const protocol=edits
      ? 'Retorne SOMENTE JSON {"edits":[{"before":"trecho literal único do HTML","after":"trecho corrigido"}]}. No máximo 3 edições. Preserve tudo fora dos trechos. Não repita o HTML inteiro.'
      : 'Gere a resposta completa novamente em um único bloco HTML, corrigindo o problema.';
    const prompt=[attempt?'A tentativa anterior não resolveu a falha. Faça uma alteração verificável no alvo indicado.':'Corrija apenas as falhas verificadas a seguir.',lastFailure&&`Tentativa rejeitada: ${lastFailure}`,`Tarefa original:\n${task}`,`Diagnóstico:\n${diagnosticText(diagnostics)}`,`Artefato anterior${edits?' (somente trechos relevantes; restante preservado)':''}:\n${edits?repairContext(current.text,diagnostics):current.text}`,protocol].filter(Boolean).join('\n\n');
    if(prompt.length>24000){events.push({reason:'context_budget',attempt:attempt+1});break;}
    onStage?.('Corrigindo um erro encontrado no código…');
    const retryEnv={...env};delete retryEnv.LOCAL_OUTPUT_SCHEMA;delete retryEnv.LOCAL_OUTPUT_FORMAT;
    if(edits)retryEnv.LOCAL_OUTPUT_FORMAT='json';
    const retried=await call(prompt,retryEnv,signal);
    calls.push(localCallRecord(retried,edits?'repair_edits':'repair_full'));
    if(!retried.ok){events.push({reason:'call_failed',attempt:attempt+1});break;}
    if(retried.truncated){events.push({reason:'truncated',attempt:attempt+1});break;}
    const applied=edits?applyLocalEdits(current.text,retried.text):{ok:looksLikeCode(retried.text),text:retried.text,reason:'not_code'};
    if(!applied.ok){events.push({reason:applied.reason,attempt:attempt+1});lastFailure=applied.reason+'. Copie before literalmente de um único trecho fornecido e preserve os IDs existentes.';continue;}
    const fingerprint=artifactFingerprint(applied.text);
    if(seen.has(fingerprint)){events.push({reason:'no_change',attempt:attempt+1});lastFailure='O artefato ficou idêntico a uma versão já testada e a falha continua.';continue;}
    seen.add(fingerprint);
    const next=diagnoseLocalArtifact(applied.text);
    const originalIssues=new Set(diagnostics.issues.map(i=>i.code+':'+i.target));
    if(next.issues.some(i=>!originalIssues.has(i.code+':'+i.target))){events.push({reason:'static_regression',attempt:attempt+1});lastFailure=diagnosticText(next);continue;}
    if(next.issues.length>=diagnostics.issues.length){events.push({reason:'no_diagnostic_progress',attempt:attempt+1});lastFailure='A alteração não eliminou as falhas verificadas: '+diagnosticText(next);continue;}
    current={...retried,text:applied.text};diagnostics=next;events.push({reason:'static_progress',attempt:attempt+1});
  }
  if(signal?.aborted)return cancelled();
  if(selfReview && (memories.length||diagnostics.issues.length)){
    const prompt=buildSelfReviewPrompt(task,current.text,memories,diagnosticText(diagnostics)||null);
    if(prompt.length<=24000){
      const reviewed=await call(prompt,env,signal);calls.push(localCallRecord(reviewed,'self_review'));
      if(reviewed.ok&&!reviewed.truncated&&looksLikeCode(reviewed.text)&&!diagnoseLocalArtifact(reviewed.text).issues.length)current=reviewed;
      else events.push({reason:'review_rejected'});
    }
  }
  return signal?.aborted?cancelled():finish();
}
