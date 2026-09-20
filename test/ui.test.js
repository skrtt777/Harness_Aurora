import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import http from "node:http";

const temp = mkdtempSync(join(tmpdir(), "harness-ui-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.CODEX_BIN = join(temp, "missing-codex.exe");
process.env.CLAUDE_BIN = join(temp, "missing-claude.exe");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
const { createServer } = await import("../app/server.js");
const { createConversation, addMessage, setSetting } = await import("../app/store.js");
const executable = process.env.CHROMIUM_EXECUTABLE_PATH || (process.platform === "win32" && existsSync("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe") ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : chromium.executablePath());
const skip = !existsSync(executable) || !existsSync(new URL("../frontend/dist/index.html", import.meta.url)) ? "Build do frontend e Chromium necessários para teste de UI." : false;

test("real UI: navigation races, drafts, errors, settings and opaque executable previews", { skip, timeout: 30000 }, async () => {
  const server = createServer({ allowDev: false });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const a = await createConversation({ title: "Audit A", provider: "codex" });
  const b = await createConversation({ title: "Audit B", provider: "codex" });
  await setSetting("sandbox_dir", join(temp, "sandbox"));
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(base);
    await page.locator(".conv-title", { hasText: "Audit B" }).click();
    await page.waitForFunction(() => document.querySelector(".chat-page-head h1")?.textContent === "Audit B");
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route(`**/api/conversations/${a.id}`, async route => { await held; await route.continue(); });
    const requestA = page.waitForRequest(r => r.url().endsWith(`/api/conversations/${a.id}`));
    await page.locator(".conv-title", { hasText: "Audit A" }).click(); await requestA;
    await page.locator(".conv-title", { hasText: "Audit B" }).click();
    await page.waitForFunction(() => document.querySelector(".chat-page-head h1")?.textContent === "Audit B");
    const responseA = page.waitForResponse(r => r.url().endsWith(`/api/conversations/${a.id}`)); release(); await responseA;
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".chat-page-head h1").textContent(), "Audit B");
    await page.unroute(`**/api/conversations/${a.id}`);

    const composer = page.locator(".chat-composer textarea");
    await page.locator(".conv-title", { hasText: "Audit A" }).click(); await composer.fill("Rascunho A");
    await page.locator(".conv-title", { hasText: "Audit B" }).click(); await composer.fill("Rascunho B");
    await page.locator(".conv-title", { hasText: "Audit A" }).click();
    await page.waitForFunction(() => document.querySelector(".chat-composer textarea")?.value === "Rascunho A");
    await page.getByRole("button", { name: "Enviar ↗" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await composer.inputValue(), "Rascunho A");

    await page.getByRole("button", { name: /Configurações/ }).click();
    const custom = page.getByPlaceholder("ou nome de outro modelo do Ollama…");
    await custom.fill("qwen:custom-test"); assert.equal(await custom.inputValue(), "qwen:custom-test");

    const html = `<html><body><script>(async()=>{let parentReadable=false,apiReadable=false,bridge=false;try{parentReadable=Boolean(parent.document.body)}catch{}try{bridge=Boolean(parent.harness)}catch{}try{const r=await fetch('/api/projects');apiReadable=r.ok}catch{}document.body.textContent=JSON.stringify({parentReadable,apiReadable,bridge});})();</script></body></html>`;
    await addMessage({ conversationId: b.id, role: "assistant", content: `\`\`\`html\n${html}\n\`\`\``, provider: "Codex" });
    await page.locator(".conv-title", { hasText: "Audit B" }).click();
    await page.getByRole("button", { name: "▶ Executar", exact: true }).click();
    const frame = page.frameLocator(".sandbox-preview");
    await frame.locator("body").filter({ hasText: "parentReadable" }).waitFor();
    const result = JSON.parse(await frame.locator("body").textContent());
    assert.deepEqual(result, { parentReadable: false, apiReadable: false, bridge: false });
    assert.equal(await page.locator(".sandbox-preview").getAttribute("sandbox"), "allow-scripts allow-pointer-lock");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("local setup finishes once without reconnecting or restarting downloads", { skip, timeout: 15000 }, async () => {
  let pulled = false, downloads = 0, setups = 0;
  const ollama = http.createServer(async (req, res) => {
    if (req.url === "/api/version") return res.end('{"version":"test"}');
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: pulled ? [{ name: "ui-test:latest" }] : [] }));
    if (req.url === "/api/pull") {
      for await (const _ of req) { /* drain */ }
      downloads++; pulled = true;
      return res.end('{"status":"success"}');
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => ollama.listen(0, "127.0.0.1", resolve));
  const previous = process.env.LOCAL_BASE_URL;
  process.env.LOCAL_BASE_URL = `http://127.0.0.1:${ollama.address().port}`;
  await setSetting("local_model", "ui-test:latest");
  await createConversation({ title: "Setup UI", provider: "local" });
  const server = createServer({ allowDev: false });
  server.on("request", req => { if (req.url === "/api/local/setup") setups++; });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator(".local-setup-panel.ready").waitFor();
    await page.waitForTimeout(3500); // EventSource's old default retry would already have fired.
    assert.equal(setups, 1); assert.equal(downloads, 1);
  } finally {
    process.env.LOCAL_BASE_URL = previous;
    await browser.close();
    server.closeAllConnections(); ollama.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => ollama.close(resolve))]);
  }
});
