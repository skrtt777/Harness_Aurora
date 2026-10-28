// The extension as a person uses it in a day (vscode/aurora/test/scenarios.js), run from the .vsix as it
// was packed (or the source folder), in a VS Code of its own (temporary profile, extensions and folder)
// against a test Harness (temporary database, the real local model, the teacher off). The folder is a
// small git project with a broken file, a failing script and code to edit.
//   node scripts/vscode-scenarios.mjs [--vsix vscode/dist/aurora-harness.vsix] [--code Code.exe]
import "./evalSandbox.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const root = mkdtempSync(join(tmpdir(), "aurora-vscode-cenarios-"));
process.env.HARNESS_DB_FILE = join(root, "harness.db");
process.env.LLAMA_SERVER_PORT ||= "18191";
const store = await import("../app/store.js");
const { createServer } = await import("../app/server.js");
const { stopLlamaServer } = await import("../app/llamaServer.js");
await store.setSetting("teacher_mode", "off");
await store.setSetting("onboarding_completed", "true");
await store.setSetting("agent_mode", "auto");
const server = createServer({ allowDev: false, centralSync: false, agentScheduler: false });
await new Promise((r) => server.listen(0, "127.0.0.1", r));

// The extension: unpacked from the .vsix (what people install), or the source folder.
const vsix = resolve(arg("vsix", "vscode/dist/aurora-harness.vsix"));
let ext = resolve("vscode/aurora");
if (existsSync(vsix)) {
  const dir = join(root, "vsix");
  mkdirSync(dir, { recursive: true });
  // Windows' own tar reads zips (Git's GNU tar on PATH does not).
  const tar = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "unzip";
  execFileSync(tar, process.platform === "win32" ? ["-xf", vsix, "-C", dir] : ["-q", vsix, "-d", dir]);
  ext = join(dir, "extension");
  console.log(`extensão do .vsix: ${JSON.parse(readFileSync(join(ext, "package.json"), "utf8")).version}`);
}

// The project.
const folder = join(root, "loja");
mkdirSync(folder, { recursive: true });
const files = {
  "vendas.js": "// Total vendido por vendedor\nfunction totalPorVendedor(vendas) {\n  const total = {};\n  for (const v of vendas) {\n    total[v.vendedor] = (total[v.vendedor] || 0) + v.valor;\n  }\n  return total;\n}\n\nmodule.exports = { totalPorVendedor };\n",
  "calc.js": "function soma(a, b) {\n  return a + b\n}\n\nconsole.log(soma(2, 4);\n",
  "texto.js": "function iniciais(nome) {\n  return nome.split(' ').filter(Boolean).map((p) => p[0].toUpperCase()).join('');\n}\n\nmodule.exports = { iniciais };\n",
  "relatorio.js": "const vendas = [{ vendedor: 'Ana', valor: 100 }, { vendedor: 'Bruno', valor: 250 }];\nconst total = vendas.reduce((s, v) => s + v.valr, 0);\nif (Number.isNaN(total)) throw new Error('total inválido: ' + total);\nconsole.log('Total:', total);\n",
  "paginas.js": "function pagina(itens, tamanho) {\n  const out = [];\n  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));\n  return out;\n}\n\nfunction ultimo(itens) {\n  for (let i = 0; i < itens.length; i++) if (i === itens.length - 1) return itens[i];\n}\n\nmodule.exports = { pagina, ultimo };\n",
  "dados.py": "def media_por_grupo(linhas):\n    grupos = {}\n    for grupo, valor in linhas:\n        grupos.setdefault(grupo, []).append(valor)\n    return {g: sum(v) / len(v) for g, v in grupos.items()}\n",
  "busca.js": "function buscarUsuario(id) {\n  return fetch('https://api.exemplo.com/usuarios/' + id)\n    .then((r) => r.json())\n    .then((u) => u.nome)\n    .catch((e) => {\n      console.error(e);\n    });\n}\n\nmodule.exports = { buscarUsuario };\n",
  "config.js": "module.exports = {\n  porta: 3000,\n  host: 'localhost',\n};\n",
  "package.json": JSON.stringify({ name: "loja", version: "1.0.0", private: true, scripts: { test: "node --test" } }, null, 2) + "\n",
};
for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
const git = (...a) => execFileSync("git", a, { cwd: folder, stdio: "ignore" });
git("init", "-q"); git("add", "."); git("-c", "user.name=Teste", "-c", "user.email=teste@exemplo.com", "commit", "-q", "-m", "inicio");

const userDir = join(root, "user"), extDir = join(root, "extensions");
mkdirSync(join(userDir, "User"), { recursive: true });
writeFileSync(join(userDir, "User", "settings.json"), JSON.stringify({
  "aurora.harnessUrl": `http://127.0.0.1:${server.address().port}`, "aurora.autoStartHarness": false, "aurora.openChangedFiles": false, "aurora.autocompleteDelayMs": 100,
  "security.workspace.trust.enabled": false, "telemetry.telemetryLevel": "off", "update.mode": "none", "workbench.startupEditor": "none",
  "terminal.integrated.shellIntegration.enabled": true, "terminal.integrated.defaultProfile.windows": "PowerShell", "git.enabled": true,
}, null, 1));
const code = arg("code", [join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"), "C:\\Program Files\\Microsoft VS Code\\Code.exe"].find(existsSync));
const outFile = join(root, "result.json");
const started = Date.now();
const env = { ...process.env, AURORA_SMOKE_OUT: outFile };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(code, [folder, `--extensionDevelopmentPath=${ext}`, `--extensionTestsPath=${resolve("vscode/aurora/test/scenarios.js")}`, `--user-data-dir=${userDir}`, `--extensions-dir=${extDir}`, "--disable-extensions", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", "--new-window"], { env, stdio: "ignore" });
const exit = await new Promise((r) => { child.on("exit", r); setTimeout(() => { child.kill(); r("timeout"); }, 40 * 60 * 1000); });
server.close(); stopLlamaServer();
if (!existsSync(outFile)) { console.log(`O VS Code de teste fechou sem resultado (${exit}).`); process.exit(1); }
const result = JSON.parse(readFileSync(outFile, "utf8"));
for (const s of result.scenarios) console.log(`\n${s.ok ? "✓" : "✗"} ${s.name} (${Math.round(s.ms / 1000)} s)\n  ${String(s.detail).replace(/\n/g, "\n  ")}`);
if (result.approvals?.length) console.log(`\nAutorizações: ${result.approvals.join(" | ")}`);
console.log(`\n${result.scenarios.filter((s) => s.ok).length}/${result.scenarios.length} cenários em ${Math.round((Date.now() - started) / 1000)} s · pasta ${folder}`);
process.exit(result.ok ? 0 : 1);
