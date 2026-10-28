// The VS Code extension 0.3 end to end, in a VS Code of its own (temporary profile, extensions and
// folder; never the person's VS Code settings or projects) talking to a test Harness (temporary
// database, the local model, the teacher off). vscode/aurora/test/e2e.js does the checks inside.
//   node scripts/vscode-ext-e2e.mjs [--code "C:\...\Code.exe"]
import "./evalSandbox.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const root = mkdtempSync(join(tmpdir(), "aurora-vscode-ext-"));
process.env.HARNESS_DB_FILE = join(root, "harness.db");
process.env.LLAMA_SERVER_PORT ||= "18191";
const store = await import("../app/store.js");
const { createServer } = await import("../app/server.js");
const { stopLlamaServer } = await import("../app/llamaServer.js");
await store.setSetting("teacher_mode", "off");
await store.setSetting("onboarding_completed", "true");
const server = createServer({ allowDev: false, centralSync: false, agentScheduler: false });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const harnessUrl = `http://127.0.0.1:${server.address().port}`;

// The folder VS Code opens, and its profile.
const folder = join(root, "projeto");
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, "util.js"), "// util\nfunction soma(lista) {\n  return lista.reduce((a, b) => a + b);\n}\n\nmodule.exports = { soma };\n");
const userDir = join(root, "user"), extDir = join(root, "extensions");
mkdirSync(join(userDir, "User"), { recursive: true });
writeFileSync(join(userDir, "User", "settings.json"), JSON.stringify({
  "aurora.harnessUrl": harnessUrl, "aurora.autoStartHarness": false, "aurora.openChangedFiles": false, "aurora.autocompleteDelayMs": 100,
  "security.workspace.trust.enabled": false, "telemetry.telemetryLevel": "off", "update.mode": "none", "workbench.startupEditor": "none",
  "terminal.integrated.shellIntegration.enabled": true, "terminal.integrated.defaultProfile.windows": "PowerShell",
}, null, 1));
const code = arg("code", [join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"), "C:\\Program Files\\Microsoft VS Code\\Code.exe"].find(existsSync));
if (!code) { console.log("VS Code não encontrado (use --code)."); process.exit(2); }
const outFile = join(root, "result.json");
const ext = resolve("vscode/aurora");
const started = Date.now();
const env = { ...process.env, AURORA_SMOKE_OUT: outFile };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(code, [folder, `--extensionDevelopmentPath=${ext}`, `--extensionTestsPath=${join(ext, "test", "e2e.js")}`, `--user-data-dir=${userDir}`, `--extensions-dir=${extDir}`, "--disable-extensions", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", "--new-window"], { env, stdio: "ignore" });
const exit = await new Promise((r) => { child.on("exit", r); setTimeout(() => { child.kill(); r("timeout"); }, 15 * 60 * 1000); });
server.close(); stopLlamaServer();
if (!existsSync(outFile)) { console.log(`O VS Code de teste fechou sem resultado (${exit}).`); process.exit(1); }
const result = JSON.parse(readFileSync(outFile, "utf8"));
for (const c of result.checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail.replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
console.log(`\n${result.checks.filter((c) => c.ok).length}/${result.checks.length} em ${Math.round((Date.now() - started) / 1000)} s`);
if (result.inlineEdit) console.log(`\nCtrl+I deixou:\n${result.inlineEdit}`);
process.exit(result.ok ? 0 : 1);
