import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
const temp = mkdtempSync(join(tmpdir(), 'aurora-welcome-'));
process.env.HARNESS_DB_FILE = join(temp, 'test.db');
process.env.CODEX_BIN = join(temp, 'missing-codex.exe');
process.env.CLAUDE_BIN = join(temp, 'missing-claude.exe');
process.env.LOCAL_BASE_URL = 'http://127.0.0.1:1';
const { createServer } = await import('../app/server.js');
const { getSetting } = await import('../app/store.js');
const executable = process.env.CHROMIUM_EXECUTABLE_PATH || (process.platform === 'win32' && existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : chromium.executablePath());
const skip = !existsSync(executable) || !existsSync(new URL('../frontend/dist/index.html', import.meta.url));

test('first-run guide persists across restart, reopens, handles failures and explains connections without inference', { skip, timeout: 40000 }, async () => {
  let server;
  async function start() { server = createServer({ allowDev: false, centralSync: false }); await new Promise(r => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${server.address().port}`; }
  async function stop() { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let inference = 0;
    page.on('request', req => { if (/\/messages$|\/correct$/.test(new URL(req.url()).pathname) && req.method() === 'POST') inference++; });
    await page.goto(await start());
    const guide = page.getByRole('dialog'); await guide.waitFor();
    assert.equal(await guide.getAttribute('aria-labelledby'), 'guide-title');
    await page.getByRole('button', { name: '3 Conectar uma IA', exact: true }).click();
    await page.getByRole('button', { name: 'Codex', exact: true }).click();
    assert.equal(await guide.locator('code').first().innerText(), 'codex login');
    assert.match(await guide.getByRole('link').getAttribute('href'), /^https:\/\/developers.openai.com\//);
    await page.getByRole('button', { name: 'Verificar detecção', exact: true }).click();
    await guide.getByRole('status').filter({ hasText: 'Programa não encontrado' }).waitFor();
    await page.route('**/api/providers', route => route.fulfill({ json: { providers: [{ id: 'codex', configured: true }] } }));
    await page.getByRole('button', { name: 'Verificar detecção', exact: true }).click();
    await guide.getByRole('status').filter({ hasText: 'O login será confirmado' }).waitFor();
    await page.unroute('**/api/providers');
    await page.getByRole('button', { name: 'Claude', exact: true }).click();
    assert.match(await guide.innerText(), /winget install Anthropic.ClaudeCode/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await guide.evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.route('**/api/settings', route => route.request().method() === 'PUT' ? route.fulfill({ status: 500, json: { error: 'Synthetic persistence failure' } }) : route.continue());
    await page.getByRole('button', { name: 'Ver depois', exact: true }).click();
    await guide.getByRole('alert').waitFor(); assert.equal(await guide.isVisible(), true);
    assert.notEqual(await getSetting('onboarding_completed'), 'true');
    await page.unroute('**/api/settings');
    await page.getByRole('button', { name: 'Ver depois', exact: true }).click(); await guide.waitFor({ state: 'hidden' });
    assert.equal(await getSetting('onboarding_completed'), 'true');
    await stop(); await page.goto(await start());
    await page.locator('.conversation-workspace').waitFor(); assert.equal(await guide.count(), 0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: /Configurações/ }).click();
    await page.getByRole('button', { name: 'Abrir guia de boas-vindas', exact: true }).click(); await guide.waitFor();
    await page.keyboard.press('Escape'); await guide.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Abrir guia de boas-vindas', exact: true }).click();
    await page.getByRole('button', { name: '4 Memórias', exact: true }).click();
    await page.getByRole('button', { name: 'Começar a usar', exact: true }).click(); await guide.waitFor({ state: 'hidden' });
    assert.equal(inference, 0);
    const invalid = await page.evaluate(async () => { const { token } = await fetch('/api/session').then(r => r.json()); return (await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-harness-token': token }, body: JSON.stringify({ onboardingCompleted: 'true', defaultProvider: 'claude' }) })).status; });
    assert.equal(invalid, 400); assert.notEqual(await getSetting('default_provider'), 'claude');
  } finally { await browser.close(); if (server?.listening) await stop(); }
});
