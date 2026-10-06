import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const temp = mkdtempSync(join(tmpdir(), "harness-drop-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
const { createServer } = await import("../app/server.js");
const { createConversation, setSetting } = await import("../app/store.js");
await setSetting("onboarding_completed", "true");
const executable = process.env.CHROMIUM_EXECUTABLE_PATH || (process.platform === "win32" && existsSync("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe") ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : chromium.executablePath());
const skip = !existsSync(executable) || !existsSync(new URL("../frontend/dist/index.html", import.meta.url)) ? "Build do frontend e Chromium necessários para teste de UI." : false;

test("a file dropped on the message box goes in as its full path; in a plain browser it says why not", { skip, timeout: 30000 }, async () => {
  await createConversation({ title: "Arrastar", provider: "local" });
  const server = createServer({ allowDev: false });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const drop = async (page) => {
      const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(["x"], "boleto luz.pdf", { type: "application/pdf" })); return d; });
      await page.dispatchEvent("form.chat-composer", "dragover", { dataTransfer: dt });
      await page.dispatchEvent("form.chat-composer", "drop", { dataTransfer: dt });
    };
    // The desktop app: the bridge gives the real path.
    const page = await browser.newPage();
    await page.addInitScript(() => { window.harness = { pathForFile: (f) => `C:\\Users\\voce\\Downloads\\${f.name}` }; });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator("form.chat-composer").waitFor();
    await page.getByLabel("Mensagem para Aurora").fill("resuma");
    await drop(page);
    assert.equal(await page.getByLabel("Mensagem para Aurora").inputValue(), 'resuma "C:\\Users\\voce\\Downloads\\boleto luz.pdf" ');
    // A plain browser has no paths: the hint says where it works.
    const plain = await browser.newPage();
    await plain.goto(`http://127.0.0.1:${server.address().port}/`);
    await plain.locator("form.chat-composer").waitFor();
    await drop(plain);
    await plain.getByText("Arrastar arquivos funciona no aplicativo da Aurora.").waitFor();
  } finally { await browser.close(); server.close(); }
});
