import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-policy-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.EMBEDDINGS_ENABLED = "false";

const { decide, dangerousReason, commandRule, matchesAlwaysAllow, commandPaths } = await import("../app/agentPolicy.js");
const { executeTool } = await import("../app/agentTools/index.js");
const { globToRegExp } = await import("../app/agentTools/files.js");

const workspace = join(temp, "projeto");
const outside = join(temp, "fora");
mkdirSync(join(workspace, "src", "lib"), { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(join(workspace, "src", "app.js"), "const total = soma(1, 2);\nfunction soma(a, b) { return a + b; }\n");
writeFileSync(join(workspace, "src", "lib", "util.ts"), "export const ola = 'mundo';\n");
writeFileSync(join(workspace, "LEIAME.md"), Array.from({ length: 50 }, (_, i) => `linha ${i + 1}`).join("\n"));
writeFileSync(join(outside, "segredo.txt"), "fora");

const ctx = (mode, approve = async () => false, extra = {}) => ({ mode, workspace, workspaceRoots: [workspace], knownFolders: { desktop: outside }, env: process.env, approve, ...extra });
const askLog = () => { const asked = []; return { asked, approve: async (request) => { asked.push(request); return false; } }; };

test("dangerous commands are recognized; ordinary development commands are not", () => {
  for (const command of ["Remove-Item -Recurse build", "rm -rf node_modules", "del *.log", "winget install git", "pip install requests", "npm i -g typescript", "curl https://x.com", "git push origin main", "Invoke-WebRequest x", "shutdown /s", "reg add HKCU\\x", "Set-ExecutionPolicy Bypass", "Start-Process pwsh -Verb RunAs", "iex (gc x)", "git reset --hard", "format d:", "taskkill /IM node.exe"]) {
    assert.ok(dangerousReason(command), command);
  }
  for (const command of ["npm test", "npm run format", "node app.js", "git status", "git diff", "grep -ri ola .", "python main.py", "dir", "Get-ChildItem", "npm install", "dotnet build", "Select-String -Pattern x *.js"]) {
    assert.equal(dangerousReason(command), null, command);
  }
  assert.equal(commandRule("npm test -- --watch"), "npm test");
  assert.equal(commandRule("git status"), "git status");
  assert.equal(commandRule("node C:\\x\\app.js"), "node");
  assert.equal(matchesAlwaysAllow([{ tool: "run_command", prefix: "npm test" }], "run_command", "npm test -- -u"), true);
  assert.equal(matchesAlwaysAllow([{ tool: "run_command", prefix: "npm test" }], "run_command", "npm testify"), false);
  assert.deepEqual(commandPaths('type "C:\\Users\\x\\a.txt" && dir D:\\dados'), ["C:\\Users\\x\\a.txt", "D:\\dados"]);
});

test("the three modes decide reads, writes, commands and launches as documented", async () => {
  const d = (access, mode, extra) => decide(access, ctx(mode, undefined, extra)).then((r) => r.action);
  const inFile = [join(workspace, "novo.txt")];
  const outFile = [join(outside, "x.txt")];
  assert.equal(await d({ kind: "read", paths: inFile }, "plan"), "allow");
  assert.equal(await d({ kind: "read", paths: outFile }, "auto"), "ask");
  assert.equal(await d({ kind: "write", paths: inFile }, "auto"), "allow");
  assert.equal(await d({ kind: "write", paths: outFile }, "auto"), "ask");
  assert.equal(await d({ kind: "write", paths: inFile }, "manual"), "ask");
  assert.equal(await d({ kind: "write", paths: inFile }, "plan"), "deny");
  assert.equal(await d({ kind: "exec", command: "npm test", cwd: workspace }, "auto"), "allow");
  assert.equal(await d({ kind: "exec", command: "npm test", cwd: outside }, "auto"), "ask");
  assert.equal(await d({ kind: "exec", command: `type ${join(outside, "segredo.txt")}`, cwd: workspace }, "auto"), "ask");
  assert.equal(await d({ kind: "exec", command: "Remove-Item x", cwd: workspace }, "auto"), "ask");
  assert.equal(await d({ kind: "exec", command: "npm test", cwd: workspace }, "manual"), "ask");
  assert.equal(await d({ kind: "exec", command: "npm test", cwd: workspace }, "manual", { alwaysAllow: [{ tool: "run_command", prefix: "npm test" }] }), "allow");
  assert.equal(await d({ kind: "exec", command: "rm -rf x", cwd: workspace }, "auto", { alwaysAllow: [{ tool: "run_command", prefix: "rm -rf" }] }), "ask", "always-allow never covers dangerous commands");
  assert.equal(await d({ kind: "exec", command: "dir", cwd: workspace }, "plan"), "deny");
  assert.equal(await d({ kind: "interact" }, "plan"), "deny");
  assert.equal(await d({ kind: "browse" }, "plan"), "allow");
  assert.equal(await d({ kind: "open", launch: "document" }, "manual"), "allow");
  assert.equal(await d({ kind: "open", launch: "app" }, "auto"), "allow");
  assert.equal(await d({ kind: "open", launch: "app" }, "manual"), "ask");
  assert.equal(await d({ kind: "open", launch: "executable" }, "auto"), "ask");
  assert.equal(await d({ kind: "import" }, "auto"), "ask");
});

test("executeTool enforces the mode: plan refuses writes, manual asks, always-allow is offered and saved", async () => {
  const planned = await executeTool("write_file", { path: "plano.txt", content: "x" }, ctx("plan"));
  assert.equal(planned.ok, false);
  assert.match(planned.result, /modo Plano/i);
  assert.equal(existsSync(join(workspace, "plano.txt")), false);

  const { asked, approve } = askLog();
  const manual = await executeTool("write_file", { path: "manual.txt", content: "x" }, ctx("manual", approve));
  assert.equal(manual.ok, false);
  assert.equal(asked.length, 1);
  assert.match(asked[0].summary, /manual\.txt/);

  const auto = await executeTool("write_file", { path: "src/novo.txt", content: "oi" }, ctx("auto"));
  assert.equal(auto.ok, true, auto.result);
  assert.equal(readFileSync(join(workspace, "src", "novo.txt"), "utf8"), "oi");

  const saved = [];
  const always = await executeTool("run_command", { command: "echo aurora" }, ctx("manual", async (request) => { assert.equal(request.rule, "echo aurora"); return "always"; }, { onAlwaysAllow: async (rule) => saved.push(rule) }));
  assert.equal(always.ok, true, always.result);
  assert.match(always.result, /aurora/);
  assert.deepEqual(saved, [{ tool: "run_command", prefix: "echo aurora" }]);
});

test("file search finds names by glob and text by grep, and reads line ranges", async () => {
  assert.ok(globToRegExp("**/*.js").test("src/app.js"));
  assert.ok(globToRegExp("*.ts").test("src/lib/util.ts"));
  assert.ok(globToRegExp("src/**/*.{js,ts}").test("src/lib/util.ts"));
  assert.equal(globToRegExp("src/*.ts").test("src/lib/util.ts"), false);
  const c = ctx("auto");
  const names = await executeTool("search_files", { pattern: "**/*.{js,ts}" }, c);
  assert.match(names.result, /src\/app\.js/);
  assert.match(names.result, /src\/lib\/util\.ts/);
  const grep = await executeTool("grep", { pattern: "function soma", glob: "**/*.js" }, c);
  assert.match(grep.result, /^src\/app\.js:2: function soma/m);
  assert.match((await executeTool("grep", { pattern: "(" }, c)).result, /src\/app\.js:1/, "an invalid regex falls back to plain text");
  const range = await executeTool("read_file", { path: "LEIAME.md", offset: 10, limit: 3 }, c);
  assert.match(range.result, /10  linha 10\n +11  linha 11\n +12  linha 12\n/);
  assert.match(range.result, /linhas 10–12 de 50/);
  const outsideRead = await executeTool("read_file", { path: join(outside, "segredo.txt") }, c);
  assert.equal(outsideRead.ok, false, "reading outside the project asks and is denied here");
});

test("commands run in the project folder, stream output and can live in the background", async () => {
  const stages = [];
  const c = ctx("auto", async () => false, { onStage: (s) => stages.push(s) });
  const where = await executeTool("run_command", { command: process.platform === "win32" ? "(Get-Location).Path" : "pwd" }, c);
  assert.match(where.result, /projeto/);
  assert.ok(stages.some((s) => s.includes("projeto")), "last output line is shown as the live stage");
  const reader = join(workspace, "le-entrada.js");
  writeFileSync(reader, "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('fim:'+s.length));");
  const startedAt = Date.now();
  const eof = await executeTool("run_command", { command: "node le-entrada.js" }, c);
  assert.match(eof.result, /fim:0/);
  assert.ok(Date.now() - startedAt < 10000, "a command that reads stdin gets EOF instead of hanging");
  const script = join(workspace, "tick.js");
  writeFileSync(script, "let n=0;const t=setInterval(()=>{console.log('tick '+(++n));if(n===50)clearInterval(t)},100);");
  const started = await executeTool("run_command", { command: `node tick.js`, background: true }, c);
  assert.match(started.result, /Processo (p\d+) iniciado/);
  const id = started.result.match(/Processo (p\d+)/)[1];
  assert.match(started.result, /tick 1/);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const more = await executeTool("command_output", { id }, c);
  assert.match(more.result, /rodando/);
  assert.doesNotMatch(more.result, /tick 1\n/, "only new output is returned");
  assert.match((await executeTool("command_stop", { id }, c)).result, /Encerrei/);
  assert.equal((await executeTool("command_output", { id }, c)).ok, false);
});

test("memory and skill tools let the agent remember, look up and propose procedures", async () => {
  const c = ctx("auto", async () => false, { conversationId: null, projectId: null });
  assert.match((await executeTool("memory_save", { title: "Café", content: "O usuário prefere café sem açúcar pela manhã." }, c)).result, /Guardei/);
  assert.match((await executeTool("memory_save", { content: "O usuário prefere café sem açúcar pela manhã" }, c)).result, /Já existia/);
  assert.match((await executeTool("memory_search", { query: "café açúcar" }, c)).result, /sem açúcar/);
  const created = await executeTool("skill_create", { name: "Exportar Planilha PDF", description: "Quando exportar planilhas para PDF", body: "# Passos\n1. Abra\n2. Exporte" }, c);
  assert.match(created.result, /exportar-planilha-pdf/);
  assert.match(created.result, /inativa/);
  const found = await executeTool("skill_search", { query: "exportar planilhas" }, c);
  assert.match(found.result, /exportar-planilha-pdf \(inativa\)/);
  const id = found.result.match(/- (\S+) — exportar-planilha-pdf/)[1];
  const used = await executeTool("skill_use", { id }, c);
  assert.equal(used.ok, true, used.result);
  assert.match(used.result, /1\. Abra/);
  const unknown = await executeTool("skill_use", { id: "f".repeat(64) }, ctx("auto", async () => false));
  assert.equal(unknown.ok, false, "an unknown id is treated as a catalog import and needs approval");
  const plans = [];
  const plan = await executeTool("update_plan", { items: [{ text: "Ler", status: "done" }, { text: "Editar", status: "in_progress" }, { text: "Testar" }] }, { ...c, onPlan: (p) => plans.push(p) });
  assert.match(plan.result, /\[x\] Ler\n\[~\] Editar\n\[ \] Testar/);
  assert.equal(plans[0].length, 3);
});

test("commands use Windows' own tools first and print UTF-8", { skip: process.platform !== "win32" }, async () => {
  const { commandEnv } = await import("../app/agentTools/system.js");
  const env = commandEnv({ SystemRoot: "C:\\Windows", Path: "C:\\Program Files\\Git\\usr\\bin;C:\\Windows\\System32;C:\\tools" });
  assert.deepEqual(env.Path.split(";").slice(0, 2), ["C:\\Windows\\System32", "C:\\Windows"]);
  assert.ok(env.Path.indexOf("Git\\usr\\bin") > env.Path.indexOf("System32"), "GNU find no longer shadows find.exe");
  assert.equal(env.Path.split(";").filter((p) => p.toLowerCase() === "c:\\windows\\system32").length, 1);
  const c = ctx("auto");
  const out = await executeTool("run_command", { command: "Write-Output 'ação não é exceção'" }, c);
  assert.match(out.result, /ação não é exceção/);
});
