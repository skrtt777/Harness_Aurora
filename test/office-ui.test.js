import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const temp = mkdtempSync(join(tmpdir(), "harness-office-ui-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.CODEX_BIN = join(temp, "missing-codex.exe");
process.env.CLAUDE_BIN = join(temp, "missing-claude.exe");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
const { createServer } = await import("../app/server.js");
const { createConversation, createProject, setSetting } = await import("../app/store.js");
const turns = await import("../app/pendingTurns.js");
await setSetting("onboarding_completed", "true");
const executable = process.env.CHROMIUM_EXECUTABLE_PATH || (process.platform === "win32" && existsSync("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe") ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : chromium.executablePath());
const skip = !existsSync(executable) || !existsSync(new URL("../frontend/dist/index.html", import.meta.url)) ? "Build do frontend e Chromium necessários para teste de UI." : false;

test("office: each project's room shows its real sessions, and a click opens the conversation", { skip, timeout: 40000 }, async () => {
  const project = await createProject({ name: "Sala de Vendas" });
  const c = await createConversation({ title: "Metas do mês", provider: "local", projectId: project.id });
  const controller = turns.startTurn(c.id); turns.pushTurnStep(c.id, { tool: "web_search", status: "running", summary: "Pesquisando a concorrência" });
  const server = createServer({ allowDev: false }); await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Escritório" }).click();
    await page.locator(".office-room-tab", { hasText: "Sala de Vendas" }).click();
    const person = page.locator(".office-people button", { hasText: "Metas do mês" });
    await person.waitFor();
    assert.match(await person.textContent(), /Trabalhando/);
    await person.click();
    await page.getByText("Pesquisando a concorrência").waitFor();
    // The room is drawn (the canvas has pixels) and the session leads to its conversation.
    assert.ok(await page.locator("canvas.office-canvas").evaluate((c) => c.width > 0 && c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data[3] > 0));
    await page.getByRole("button", { name: "Abrir conversa" }).click();
    await page.getByRole("textbox", { name: "Mensagem para Aurora" }).waitFor();
    assert.deepEqual(errors, []);
  } finally { turns.endTurn(c.id, controller); await browser.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); }
});
