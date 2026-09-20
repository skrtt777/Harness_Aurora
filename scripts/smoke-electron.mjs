import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "harness-electron-smoke-"));
const cache = join(temp, "ocr-cache"); await mkdir(cache);
const sourceCache = process.env.OCR_TEST_CACHE || root;
if (existsSync(join(sourceCache, "eng.traineddata"))) await copyFile(join(sourceCache, "eng.traineddata"), join(cache, "eng.traineddata"));
const env = { ...process.env, HARNESS_TEST_MODE: "1", HARNESS_PORT: "0", HARNESS_USER_DATA_DIR: temp,
  HARNESS_DB_FILE: join(temp, "harness.db"), CODEX_BIN: join(temp, "missing-codex.exe"),
  CLAUDE_BIN: join(temp, "missing-claude.exe"), LOCAL_BASE_URL: "http://127.0.0.1:1", OCR_LANG: "eng", OCR_CACHE_PATH: cache };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_START_URL;
const executablePath = process.argv[2];
const desktop = await electron.launch({ executablePath, args: executablePath ? [] : [root], cwd: root, env, timeout: 30000 });
try {
  const page = await desktop.firstWindow();
  await page.locator(".app-shell").waitFor();
  assert.equal(await page.evaluate(() => typeof window.harness?.openExternal), "function");
  await desktop.evaluate(({ shell, dialog }, folder) => {
    shell.openExternal = async url => { globalThis.__smokeOpenedUrl = url; };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, temp);
  assert.equal(await page.evaluate(() => window.harness.openExternal("https://example.test/")), true);
  assert.equal(await desktop.evaluate(() => globalThis.__smokeOpenedUrl), "https://example.test/");
  assert.equal(await page.evaluate(() => window.harness.pickFolder()), temp);
  const blocked = await page.evaluate(async () => { try { await window.harness.openExternal("file:///C:/Windows/System32/calc.exe"); return false; } catch { return true; } });
  assert.equal(blocked, true);
  const results = await desktop.evaluate(async ({ app }, args) => {
    const require = process.getBuiltinModule("node:module").createRequire(app.getAppPath() + "/package.json");
    const path = require("node:path");
    const { execFile } = require("node:child_process");
    const appRoot = app.getAppPath();
    const ocr = require(path.join(appRoot, "app", "ocr.js"));
    const refine = require(path.join(appRoot, "app", "localRefine.js"));
    const codex = require(path.join(appRoot, "app", "codex.js"));
    const store = require(path.join(appRoot, "app", "store.js"));
    await store.createProject({ name: "Persisted smoke project" });
    const fakeProvider = await codex.runCodex("synthetic smoke prompt", { ...process.env, CODEX_BIN: args.fakeCli, CODEX_MODEL: "smoke-model" });
    if (!fakeProvider.ok) throw new Error(fakeProvider.error);
    const syntax = await refine.checkJsModuleSyntax('<script type="module">const x = 1;</script>');
    const words = await ocr.recognizeImage(args.fixture);
    await ocr.terminateOcr();
    const cli = path.join(appRoot, "node_modules", "playwright", "cli.js").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
    const cliVersion = await new Promise((resolve, reject) => execFile(process.execPath, [cli, "--version"], { windowsHide: true, timeout: 10000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
    return { packaged: app.isPackaged, userData: app.getPath("userData"), db: process.env.HARNESS_DB_FILE,
      browserProfile: process.env.BROWSER_AGENT_PROFILE_DIR, syntax, words: words.words, cliVersion, fakeProviderOk: fakeProvider.ok };
  }, { fixture: join(root, "test", "fixtures", "ocr-sample.png"), fakeCli: join(root, "test", "fixtures", "fake-cli.mjs") });
  assert.equal(results.userData, temp);
  assert.equal(results.db, join(temp, "harness.db"));
  assert.equal(results.browserProfile, join(temp, "browser-profile"));
  assert.equal(results.syntax.valid, true);
  assert.ok(results.words.some(word => word.text === "Salvar"));
  assert.match(results.cliVersion, /^Version /);
  // X still hides to the tray instead of shutting down; app.quit below ends it.
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  console.log(JSON.stringify({ ok: true, ...results }, null, 2));
} finally { await desktop.close(); }

const restarted = await electron.launch({ executablePath, args: executablePath ? [] : [root], cwd: root, env, timeout: 30000 });
try {
  await (await restarted.firstWindow()).locator(".app-shell").waitFor();
  const persisted = await restarted.evaluate(async ({ app }) => {
    const require = process.getBuiltinModule("node:module").createRequire(app.getAppPath() + "/package.json");
    const store = require(app.getAppPath() + "/app/store.js");
    return (await store.listProjects()).some(p => p.name === "Persisted smoke project");
  });
  assert.equal(persisted, true);
  console.log("Restart persistence: OK");
} finally { await restarted.close(); }
