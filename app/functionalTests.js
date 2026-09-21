import { createHash } from 'node:crypto';

export const FUNCTIONAL_TEST_VERSION = 'browser-contract-v1';
const operations = {
  click: [], fill: ['value'], select: ['value'], check: ['value'], press: ['value'], reload: [],
  assertText: ['expected'], assertValue: ['expected'], assertCount: ['expected'],
  assertNumber: ['expected'], assertChecked: ['expected'], assertVisible: ['expected'],
};
const assertion = op => typeof op === 'string' && op.startsWith('assert');
const boundedString = (s, max) => typeof s === 'string' && s.length <= max;
const invalid = detail => { throw new Error(`Contrato de testes inválido: ${detail}`); };

// Data only: no JavaScript, URLs, filesystem paths or executable expressions.
export function normalizeTestContract(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.cases) || !input.cases.length || input.cases.length > 8) invalid('use version:1 e 1 a 8 casos.');
  if (JSON.stringify(input).length > 14000) invalid('máximo de 14000 caracteres.');
  const ids = new Set(); let total = 0;
  const cases = input.cases.map(c => {
    if (!c || !boundedString(c.id, 60) || !/^[a-zA-Z0-9_-]+$/.test(c.id) || ids.has(c.id)) invalid('id ausente, repetido ou inválido.');
    ids.add(c.id);
    if (!boundedString(c.name, 160) || !c.name.trim() || !Array.isArray(c.actions) || !c.actions.length || c.actions.length > 20) invalid('cada caso precisa de nome e 1 a 20 ações.');
    if (!c.actions.some(a => a && assertion(a.op || '')) || !assertion(c.actions.at(-1)?.op || '')) invalid('cada caso deve terminar com uma asserção.');
    total += c.actions.length;
    const actions = c.actions.map(a => {
      if (!a || !Object.hasOwn(operations, a.op)) invalid('operação desconhecida.');
      const allowed = ['op', ...(a.op === 'reload' ? [] : ['selector']), ...operations[a.op], ...(a.op === 'assertNumber' ? ['tolerance', 'locale'] : [])];
      if (Object.keys(a).some(k => !allowed.includes(k))) invalid('campo não permitido na ação.');
      if (a.op !== 'reload' && (!boundedString(a.selector, 240) || !a.selector.trim())) invalid('seletor CSS obrigatório.');
      const key = operations[a.op][0];
      if (key) {
        const v = a[key];
        if (['check','assertChecked','assertVisible'].includes(a.op)) { if (typeof v !== 'boolean') invalid('valor booleano obrigatório.'); }
        else if (['assertCount','assertNumber'].includes(a.op)) {
          if (!Number.isFinite(v) || (a.op === 'assertCount' && (!Number.isInteger(v) || v < 0 || v > 10000))) invalid('valor numérico inválido.');
        } else if (!boundedString(v, 500)) invalid('texto obrigatório de até 500 caracteres.');
      }
      if (a.op === 'press' && !['Enter','Escape','Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(a.value)) invalid('tecla não permitida.');
      if (a.op === 'assertNumber' && ((a.locale !== undefined && !['pt-BR','en-US'].includes(a.locale)) || (a.tolerance !== undefined && (!Number.isFinite(a.tolerance) || a.tolerance < 0 || a.tolerance > 1)))) invalid('locale ou tolerância inválidos.');
      return Object.fromEntries(allowed.filter(k => a[k] !== undefined).map(k => [k, a[k]]));
    });
    return { id:c.id, name:c.name.trim(), actions };
  });
  if (total > 80) invalid('máximo de 80 ações por contrato.');
  return { version:1, cases };
}

export const testContractHash = contract => createHash('sha256').update(JSON.stringify(normalizeTestContract(contract))).digest('hex');

export function normalizeFunctionalContracts(input = []) {
  if (!Array.isArray(input) || input.length > 8) invalid('a lista de contratos deve ter até 8 etapas.');
  const steps = new Set();
  return input.map(entry => {
    if (!entry || !Number.isInteger(entry.step) || entry.step < 0 || entry.step > 7 || steps.has(entry.step)) invalid('índice de etapa inválido ou repetido.');
    steps.add(entry.step);
    return { step:entry.step, contract:normalizeTestContract(entry.contract) };
  }).sort((a,b) => a.step-b.step);
}

// Require one complete number. Never turn "receita 100 custo 70" into 10070.
export function parseDisplayedNumber(value, locale = 'pt-BR') {
  const text = String(value).trim().replace(/^(?:R\$|US\$|\$|€)\s*/, '').replace(/\s*%$/, '').trim();
  const pattern = locale === 'pt-BR' ? /^[-+]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/ : /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
  if (!pattern.test(text)) return null;
  const number = Number(locale === 'pt-BR' ? text.replaceAll('.', '').replace(',', '.') : text.replaceAll(',', ''));
  return Number.isFinite(number) ? number : null;
}

const clip = value => typeof value === 'string' ? value.slice(0, 600) : value;
const textValue = s => s.replace(/\s+/g, ' ').trim();
export function functionalEvidence(results) {
  return results.filter(r => r.status !== 'passed').map(r => `${r.name}, ação ${r.action + 1} (${r.op}${r.selector ? ' '+r.selector : ''}): esperado ${JSON.stringify(r.expected)}; observado ${JSON.stringify(r.observed)}.`);
}

// Each case has fresh storage; actions within a case share storage across reloads.
export async function runFunctionalCases(browser, html, contract, { signal, timeoutMs = 15000 } = {}) {
  const normalized = normalizeTestContract(contract), started = Date.now(), results = [];
  const origin = 'https://aurora-test.invalid/artifact';
  const guard = () => { if (signal?.aborted) throw signal.reason || new Error('Cancelado.'); if (Date.now()-started >= timeoutMs) throw new Error('Tempo dos testes esgotado.'); };
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";
  for (const c of normalized.cases) {
    guard();
    const context = await browser.newContext({ serviceWorkers:'block', acceptDownloads:false });
    try {
      const page = await context.newPage(), errors = [];
      const close = () => { void context.close().catch(() => {}); };
      signal?.addEventListener('abort', close, { once:true });
      try {
        context.on('page', p => { if (p !== page) void p.close().catch(() => {}); });
        page.on('dialog', d => { void d.dismiss().catch(() => {}); });
        page.on('pageerror', e => errors.push(e.message));
        await context.route('**/*', route => route.request().isNavigationRequest() && route.request().frame() === page.mainFrame() && route.request().url() === origin
          ? route.fulfill({ status:200, contentType:'text/html', headers:{'Content-Security-Policy':csp}, body:html }) : route.abort());
        await context.routeWebSocket('**/*', ws => ws.close());
        await page.goto(origin, { waitUntil:'domcontentloaded', timeout:3000 });
        for (const [index, a] of c.actions.entries()) {
          guard();
          const result = { caseId:c.id, name:c.name, action:index, op:a.op, selector:a.selector, expected:a.expected ?? a.value ?? 'ação executada', status:'passed', observed:null };
          try {
            const locator = a.selector ? page.locator('css='+a.selector) : null;
            const timeout = Math.min(1200, Math.max(1, timeoutMs-(Date.now()-started)));
            if (a.op === 'reload') await page.reload({ waitUntil:'domcontentloaded', timeout });
            else if (a.op === 'click') await locator.click({ timeout });
            else if (a.op === 'fill') await locator.fill(a.value, { timeout });
            else if (a.op === 'select') await locator.selectOption(a.value, { timeout });
            else if (a.op === 'check') await locator.setChecked(a.value, { timeout });
            else if (a.op === 'press') await locator.press(a.value, { timeout });
            else {
              const deadline = Date.now()+timeout;
              do {
                guard();
                const count = await locator.count();
                if (a.op === 'assertCount') result.observed = count;
                else if (a.op === 'assertVisible' && count === 0) result.observed = false;
                else if (count !== 1) throw new Error(`Esperado um elemento; encontrados ${count}.`);
                else if (a.op === 'assertVisible') result.observed = await locator.isVisible();
                else if (a.op === 'assertChecked') result.observed = await locator.isChecked({ timeout });
                else if (a.op === 'assertValue') result.observed = await locator.inputValue({ timeout });
                else {
                  const text = textValue(await locator.innerText({ timeout }));
                  result.observed = a.op === 'assertNumber' ? parseDisplayedNumber(text, a.locale) : text;
                  if (a.op === 'assertNumber') result.displayed = clip(text);
                }
                const matches = a.op === 'assertNumber' ? result.observed !== null && Math.abs(result.observed-a.expected) <= (a.tolerance ?? 0.001) : result.observed === a.expected;
                if (matches) break;
                result.status = 'failed';
                if (Date.now() >= deadline) break;
                await new Promise(r => setTimeout(r, 40)); result.status = 'passed';
              } while (true);
            }
            if (!assertion(a.op)) result.observed = 'ação executada';
            if (errors.length) { result.status = 'failed'; result.observed = 'Erro JavaScript: '+errors.slice(0,3).join('; '); }
          } catch (error) { guard(); result.status = 'failed'; result.observed = error.message; }
          result.observed = clip(result.observed); results.push(result);
          if (result.status === 'failed') break; // The remaining actions depend on this state.
        }
      } finally { signal?.removeEventListener('abort', close); }
    } finally { await context.close().catch(() => {}); }
  }
  const passedCases = normalized.cases.filter(c => {
    const records = results.filter(r => r.caseId === c.id);
    return records.length === c.actions.length && records.every(r => r.status === 'passed');
  }).map(c => c.id);
  return { version:FUNCTIONAL_TEST_VERSION, contractHash:testContractHash(normalized), results, passedCases, totalCases:normalized.cases.length, elapsedMs:Date.now()-started };
}
