import { parseJavaScript } from './jsSandbox.js';
import { extractRunnableHtml } from './sandboxCode.js';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { diagnoseLocalArtifact, diagnosticText } from './localDiagnostics.js';
import { normalizeTestContract, runFunctionalCases, functionalEvidence } from './functionalTests.js';

export const VALIDATOR_VERSION = 'artifact-checks-v3';
export function unwrap(text, format) {
  const fenced = String(text).match(/^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/);
  if (format === 'html') return extractRunnableHtml(text)?.html || text;
  return fenced ? fenced[1] : text;
}

export async function validateArtifact(content, format, { signal, contract, contractSource = 'request' } = {}) {
  const evidence = []; const fail = detail => ({ status: 'failed', evidence: [...evidence, detail], validator: VALIDATOR_VERSION });
  if (contract) {
    try { contract = normalizeTestContract(contract); } catch (error) { return fail(error.message); }
    if (format !== 'html') return fail('O contrato de navegador exige uma etapa HTML.');
  }
  if (!content?.trim()) return fail('Artefato vazio.');
  if (signal?.aborted) throw signal.reason || new Error('Cancelado.');
  if (format === 'json') {
    try { JSON.parse(unwrap(content, format)); evidence.push('JSON analisado com sucesso.'); }
    catch (error) { return fail(`JSON inválido: ${error.message}`); }
    return { status: 'needs_review', evidence, validator: VALIDATOR_VERSION, limitation: 'A estrutura é válida; o significado e os valores precisam de revisão.' };
  }
  if (format === 'javascript') {
    try { parseJavaScript(unwrap(content, format)); evidence.push('Sintaxe JavaScript válida; código não executado no sistema.'); }
    catch (error) { return fail(error.message); }
    return { status: 'needs_review', evidence, validator: VALIDATOR_VERSION, limitation: 'Execução e comportamento precisam de um teste apropriado.' };
  }
  if (format !== 'html') return { status: 'needs_review', evidence: ['Artefato não vazio.'], validator: VALIDATOR_VERSION, limitation: 'Conteúdo exige revisão humana; não há validador funcional configurado.' };
  const html = unwrap(content, 'html');
  if (!/<html[\s>]/i.test(html) || !/<\/html\s*>/i.test(html)) return fail('Entregue um documento HTML completo.');
  const diagnostics=diagnoseLocalArtifact(html);
  if(diagnostics.issues.length)return {...fail(diagnosticText(diagnostics)),diagnostics};
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|\btype\s*=\s*["'](?:importmap|application\/json)/i.test(m[1])) continue;
    try { parseJavaScript(m[2]); } catch (error) { return fail(`Sintaxe: ${error.message}`); }
  }
  evidence.push('Documento HTML e sintaxe dos scripts inline verificados.');
  if (/<script[^>]+src\s*=|\bimport\s*(?:\(|[^;]*from\s*)["']https?:/i.test(html)) return { status: 'needs_review', evidence, validator: VALIDATOR_VERSION, limitation: 'Dependências externas não são acessadas pelo teste isolado. Execute e confira no preview.' };
  let browser; let timer;
  const abort = () => { void browser?.close().catch(() => {}); };
  try {
    const fallbacks=process.platform==='win32'?[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean).flatMap(base=>[join(base,'Microsoft','Edge','Application','msedge.exe'),join(base,'BraveSoftware','Brave-Browser','Application','brave.exe')]):[];
    const executablePath=existsSync(chromium.executablePath())?undefined:fallbacks.find(path=>existsSync(path));
    browser = await chromium.launch({ headless: true, timeout: 10000, ...(executablePath?{executablePath}:{} ) });
    if (signal?.aborted) throw signal.reason || new Error('Cancelado.');
    signal?.addEventListener('abort', abort, { once:true });
    timer = setTimeout(abort, 25000);
    if (contract) {
      const functional = await runFunctionalCases(browser, html, contract, { signal });
      const failures = functionalEvidence(functional.results);
      evidence.push(`${functional.passedCases.length}/${functional.totalCases} cenários funcionais passaram.`, ...failures);
      const passed = functional.passedCases.length === functional.totalCases;
      return { status:!passed ? 'failed' : contractSource === 'request' ? 'passed' : 'needs_review', level:'functional', evidence, functional, validator:VALIDATOR_VERSION,
        limitation:passed ? contractSource === 'request' ? 'Aprovado nos cenários fornecidos; o aceite final da entrega continua necessário.' : 'Os testes propostos pela IA passaram, mas sua cobertura dos requisitos precisa de revisão.' : 'Os comportamentos reprovados precisam ser corrigidos antes de avançar.' };
    }
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { void d.dismiss(); });
    context.on('page', p => { if (p !== page) void p.close(); });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 5000 });
    await page.waitForTimeout(400);
    if (errors.length) return fail(`Erro no navegador isolado: ${errors.slice(0,3).join('; ')}`);
    evidence.push('Inicialização em Chromium isolado, sem rede e sem erro JavaScript observado.');
    return { status: 'needs_review', level:'initialization', evidence, validator: VALIDATOR_VERSION, limitation: 'Inicialização verificada; controles, números e requisitos funcionais ainda não foram testados.' };
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    return { status: 'needs_review', evidence, validator: VALIDATOR_VERSION, limitation: `Teste de navegador indisponível ou inconclusivo: ${error.message.slice(0,240)}` };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (browser) await browser.close().catch(() => {}); }
}
