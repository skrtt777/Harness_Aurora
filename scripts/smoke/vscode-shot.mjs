// The VS Code extension as the person sees it, in a VS Code of its own (temporary profile, extensions
// and folder) driven by Playwright, against a test Harness (temporary database, the local model):
// the Aurora panel with a proven answer whose sheet changed afterwards (the resposta viva), the proof
// card, Ctrl+I reviewed in the file, the gray suggestion. Screenshots in --out. Never the person's
// VS Code, settings, projects or Harness.
//   node scripts/smoke/vscode-shot.mjs [--out pasta]
import "../evalSandbox.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const root = mkdtempSync(join(tmpdir(), "aurora-vscode-shot-"));
const out = arg("out", join(root, "shots"));
mkdirSync(out, { recursive: true });
process.env.HARNESS_DB_FILE = join(root, "harness.db");
process.env.EMBEDDINGS_ENABLED = "false";
process.env.LLAMA_SERVER_PORT ||= "18191";
const store = await import("../../app/store.js");
const { createServer } = await import("../../app/server.js");
const { stopLlamaServer } = await import("../../app/llamaServer.js");
const { proveAnswer } = await import("../../app/proof.js");
const { liveIo } = await import("../../app/proofLive.js");
const { renderDocument } = await import("../../app/documentWriter.js");
await store.setSetting("teacher_mode", "off");
await store.setSetting("onboarding_completed", "true");

// The folder: a sheet with a proven answer about it, then edited (Bruno's sale corrected), and code.
const folder = join(root, "loja");
mkdirSync(folder, { recursive: true });
const xlsx = join(folder, "Vendas Outubro.xlsx");
const sheet = (rows) => `## Outubro\n\n| Vendedor | Região | Meta | Vendido |\n|---|---|---|---|\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`;
writeFileSync(xlsx, await renderDocument("xlsx", sheet([["Ana Souza", "Sul", 120000, 98400], ["Bruno Lima", "Norte", 90000, 101250], ["Carla Dias", "Sudeste", 150000, 87000]])));
writeFileSync(join(folder, "util.js"), "// Funções de vendas\nfunction totalVendido(vendas) {\n  return vendas.reduce((soma, v) => soma + v.vendido);\n}\n\nfunction media(numeros) {\n  if (!numeros.length) return 0;\n  const total = \n  return total / numeros.length;\n}\n\nmodule.exports = { totalVendido, media };\n");
const project = await store.createProject({ name: "VS Code: loja", workspaceDir: folder });
const io = await liveIo({ request: "quem bateu a meta de vendas em outubro?", workspace: folder });
const step = { tool: "read_file", ok: true, args: { path: xlsx }, summary: "Leu Vendas Outubro.xlsx" };
const read = await io.replay(step, xlsx);
const answer = "Só o **Bruno Lima** bateu a meta em outubro: vendeu **R$ 101.250,00**, acima da meta de R$ 90.000,00.\n\n- A equipe vendeu **R$ 286.650,00** no total, **R$ 73.350,00** abaixo da meta somada de R$ 360.000,00.\n- A Ana ficou em R$ 98.400,00 e a Carla em R$ 87.000,00.";
const proof = proveAnswer(answer, { sources: [{ tool: "read_file", args: { path: xlsx }, result: read }], asked: ["quem bateu a meta de vendas em outubro?"] });
const conv = await store.createConversation({ provider: "local", title: "Metas de outubro", projectId: project.id });
await store.addMessage({ conversationId: conv.id, role: "user", content: "quem bateu a meta de vendas em outubro?", provider: "local" });
await store.addMessage({ conversationId: conv.id, role: "assistant", content: answer, provider: "local", execution: { toolSteps: [step], proof } });
writeFileSync(xlsx, await renderDocument("xlsx", sheet([["Ana Souza", "Sul", 120000, 98400], ["Bruno Lima", "Norte", 90000, 104800], ["Carla Dias", "Sudeste", 150000, 87000]])));
const later = new Date(Date.now() + 2 * 86_400_000);
utimesSync(xlsx, later, later);

const server = createServer({ allowDev: false, centralSync: false, agentScheduler: false });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const userDir = join(root, "user"), extDir = join(root, "extensions");
mkdirSync(join(userDir, "User"), { recursive: true });
writeFileSync(join(userDir, "User", "settings.json"), JSON.stringify({
  "aurora.harnessUrl": `http://127.0.0.1:${server.address().port}`, "aurora.autoStartHarness": false, "aurora.openChangedFiles": false, "aurora.autocompleteDelayMs": 150,
  "security.workspace.trust.enabled": false, "telemetry.telemetryLevel": "off", "update.mode": "none", "workbench.startupEditor": "none", "workbench.tips.enabled": false,
  "editor.minimap.enabled": false, "window.commandCenter": false, "chat.commandCenter.enabled": false, "workbench.colorTheme": arg("theme", "Default Dark Modern"),
}, null, 1));
const code = [join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"), "C:\\Program Files\\Microsoft VS Code\\Code.exe"].find(existsSync);
const { _electron } = await import("playwright");
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: code, env, args: [folder, `--extensionDevelopmentPath=${resolve("vscode/aurora")}`, `--user-data-dir=${userDir}`, `--extensions-dir=${extDir}`, "--disable-extensions", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", "--new-window"] });
const problems = [];
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1500, 940); w.center(); });
await page.waitForSelector(".monaco-workbench", { timeout: 60000 });
await page.waitForTimeout(2500);
const palette = async (text) => { await page.keyboard.press("Control+Shift+P"); await page.waitForTimeout(400); await page.keyboard.type(text); await page.waitForTimeout(500); await page.keyboard.press("Enter"); await page.waitForTimeout(800); };
const panelFrame = async () => {
  for (let i = 0; i < 60; i += 1) {
    for (const f of page.frames()) { if (await f.$("#app .composer").catch(() => null)) return f; }
    await page.waitForTimeout(500);
  }
  return null;
};

// 1. The panel, the conversation picked from the history: the proven answer, its sheet changed.
await palette(">Aurora: Conversar");
const frame = await panelFrame();
if (!frame) problems.push("o painel da Aurora não abriu");
else {
  await frame.click("#title");
  await frame.waitForSelector("[data-pick]", { timeout: 15000 }).catch(() => problems.push("o histórico não apareceu"));
  await page.screenshot({ path: join(out, "0_historico.png") });
  await frame.click("text=Metas de outubro").catch(() => problems.push("a conversa semeada não está no histórico"));
  await frame.waitForSelector("mark.proof", { timeout: 20000 }).catch(() => problems.push("as marcas do comprovante não apareceram"));
  await frame.waitForSelector(".live.mudou", { timeout: 30000 }).catch(() => problems.push("o aviso da resposta viva não apareceu"));
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, "1_painel_resposta_viva.png") });
  const changed = await frame.$("mark.proof.mudou");
  if (changed) { await changed.hover(); await page.waitForTimeout(500); await page.screenshot({ path: join(out, "2_cartao_do_numero.png") }); }
  else problems.push("nenhum número riscado");
}

// 2. Ctrl+I on util.js: the reduce without its start value, fixed and reviewed in the file.
await page.keyboard.press("Control+P"); await page.waitForTimeout(400); await page.keyboard.type("util.js"); await page.waitForTimeout(600); await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
await page.keyboard.press("Control+G"); await page.keyboard.type("2"); await page.keyboard.press("Enter");
await page.keyboard.press("Home");
for (let i = 0; i < 3; i += 1) await page.keyboard.press("Shift+ArrowDown");
await page.keyboard.press("Shift+End");
await page.keyboard.press("Control+I");
await page.waitForTimeout(700);
await page.keyboard.type("comece a soma em 0 e ignore vendas sem valor");
await page.keyboard.press("Enter");
await page.waitForSelector("text=Aceitar", { timeout: 120000 }).catch(() => problems.push("a revisão do Ctrl+I não apareceu"));
await page.waitForTimeout(800);
await page.screenshot({ path: join(out, "3_ctrl_i_revisao.png") });
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(800);

// 3. The gray suggestion after "const total = ".
// The line found by its text (Ctrl+I may have added lines above it).
await page.mouse.move(800, 600);
await page.locator(".monaco-editor .view-line", { hasText: "const total =" }).first().click();
await page.keyboard.press("End"); await page.waitForTimeout(200);
await page.waitForTimeout(300);
await page.keyboard.type(" ");
await page.keyboard.press("Backspace");
await page.waitForSelector(".ghost-text-decoration, .ghost-text", { timeout: 30000 }).catch(() => problems.push("a sugestão em cinza não apareceu"));
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "4_autocompletar.png") });

await app.close().catch(() => {});
server.close(); stopLlamaServer();
console.log(JSON.stringify({ out, problems }, null, 1));
process.exit(problems.length ? 1 : 0);
