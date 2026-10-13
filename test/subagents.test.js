import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-subagents-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.EMBEDDINGS_ENABLED = "false";

const { subagentTools, subagentPrompt, deliveryOf } = await import("../app/agentTools/subagents.js");
const { runChatAgent } = await import("../app/chatAgent.js");
const { startTurn, endTurn, turnSnapshots } = await import("../app/pendingTurns.js");
const { buildOffice } = await import("../app/office.js");
const tool = subagentTools[0];

// A subagent turn as runChatAgent returns it: the file it wrote, its words.
const fakeTurn = (file, ok = true) => ({ ok, text: ok ? `Entreguei ${file}.` : "Não consegui.", steps: ok ? [{ tool: "write_document", ok: true, summary: `Criei ${file} (XLSX, 3000 bytes).` }] : [{ tool: "read_file", ok: false, summary: "ERRO: não achei" }] });

test("subagents: each part to a named subagent (two at a time), what each delivered comes back, the parts' files count as the turn's", async () => {
  const conversationId = "sub-1"; const controller = startTurn(conversationId);
  let running = 0, most = 0; const prompts = [];
  const ctx = {
    conversationId, request: "crie dados de uma empresa e planilhas de departamentos, funcionários e frota", env: {},
    runSubagent: async (prompt, hooks) => {
      prompts.push(prompt); running += 1; most = Math.max(most, running);
      hooks.onStage("Pensando…"); hooks.onStep({ tool: "write_document", status: "running", summary: "" });
      // While they work, the office shows them beside their Aurora.
      const snap = turnSnapshots().active.find((t) => t.conversationId === conversationId);
      assert.ok(snap.subagents.some((s) => s.name === hooks.name && !s.done));
      await new Promise((r) => setTimeout(r, 20)); running -= 1;
      const part = /Sua parte: (.*)/.exec(prompt)[1];
      const file = /^planilha da frota/.test(part) ? "C:\\Docs\\Frota.xlsx" : /^planilha de funcion/.test(part) ? "C:\\Docs\\Funcionarios.xlsx" : null;
      return file ? fakeTurn(file) : fakeTurn("", false);
    },
  };
  const result = await tool.run({ tasks: [
    { name: "Departamentos", task: "planilha de departamentos, todos acima de 300 funcionários", deliver: "C:\\Docs\\Departamentos.xlsx" },
    { name: "Funcionários", task: "planilha de funcionários (amostra)", deliver: "C:\\Docs\\Funcionarios.xlsx" },
    { name: "Frota", task: "planilha da frota de carros", deliver: "C:\\Docs\\Frota.xlsx" },
  ] }, ctx);
  assert.equal(most, 2);
  // Names of people, one each, never "Aurora"; each prompt knows its part and the others'.
  const names = ctx.subagentRuns.map((r) => r.name);
  assert.equal(new Set(names).size, 3); assert.ok(!names.includes("Aurora"));
  assert.match(prompts[0], /esta é a SUA parte/); assert.match(prompts[0], /Outros subagentes fazem/); assert.match(prompts[0], /crie dados de uma empresa/);
  assert.match(result, /Frota\.xlsx/); assert.match(result, /NÃO terminou/); assert.match(result, /Refaça você mesmo o que não ficou pronto/);
  assert.equal(ctx.subagentSteps.length, 2);
  const office = buildOffice({ turns: turnSnapshots(), conversations: new Map([[conversationId, { id: conversationId, title: "Empresa", projectId: null }]]) });
  const subs = office.rooms.flatMap((r) => r.actors).filter((a) => a.kind === "subagente");
  assert.equal(subs.length, 3); assert.equal(subs.filter((s) => s.state === "cafe").length, 2); assert.equal(subs.filter((s) => s.state === "cobrado").length, 1);
  endTurn(conversationId, controller);
});

test("subagents: refused for one part, inside a subagent, or without the runner", async () => {
  const two = { tasks: [{ task: "a" }, { task: "b" }] };
  await assert.rejects(tool.run({ tasks: [{ task: "só uma" }] }, { runSubagent: async () => ({}) }), /2 ou mais partes/);
  await assert.rejects(tool.run(two, { subagent: "Bia", runSubagent: async () => ({}) }), /não cria outros/);
  await assert.rejects(tool.run(two, {}), /não estão disponíveis/);
  assert.deepEqual(deliveryOf({ ok: true, steps: [{ tool: "write_file", ok: true, summary: "Salvei C:\\x\\a.md." }] }).files, ["C:\\x\\a.md"]);
  assert.match(subagentPrompt({ name: "Bia", task: "t", deliver: "d", request: "r", others: [] }), /Você é Bia, um subagente da Aurora/);
});

test("subagents: the Aurora's turn that divided the work may say it created the files (the parts wrote them)", async () => {
  const subagents = { ...tool, run: async (args, ctx) => { ctx.subagentSteps = [{ tool: "write_document", ok: true, summary: "Criei C:\\Docs\\Frota.xlsx (XLSX).", by: "Fábio" }]; return "## Fábio — Frota: entregou\nArquivos: C:\\Docs\\Frota.xlsx"; } };
  const replies = [
    { ok: true, text: "", toolCalls: [{ name: "subagents", arguments: { tasks: [{ task: "frota" }, { task: "deptos" }] } }] },
    { ok: true, text: "Criei a planilha da frota em C:\\Docs\\Frota.xlsx (feita pelo subagente Fábio)." },
  ];
  const result = await runChatAgent({ system: "s", input: "crie as planilhas da empresa", tools: [subagents], callModel: async () => replies.shift() });
  assert.equal(result.ok, true); assert.match(result.text, /Frota\.xlsx/);
  assert.ok(result.steps.some((s) => s.by === "Fábio" && s.tool === "write_document"));
  assert.ok(!(result.checks || []).some((c) => /claimed_delivery/.test(c.check)));
});

test("subagents: a request with several deliveries is planned in parts (held to a schema); one delivery is not divided", async () => {
  const { multiPart, planParts, PARTS_SCHEMA } = await import("../app/agentTools/subagents.js");
  assert.deepEqual(multiPart("certo faça planilhas em execel e use os dados para montar um POWERBI interativo com modelos 3D"), ["planilhas", "Power BI"]);
  assert.equal(multiPart("monte o power bi com a planilha vendas.xlsx"), null);
  assert.equal(multiPart("faça uma planilha de vendas"), null);
  let seen = null;
  const plan = await planParts({ request: "faça planilhas e monte um power bi", history: [{ role: "user", content: "crie dados de uma empresa com mais de 300 funcionários por departamento" }], folder: "C:\Docs",
    ask: async (messages, schema) => { seen = { messages, schema }; return { ok: true, text: JSON.stringify({ partes: [{ nome: "Departamentos", tarefa: "planilha de departamentos, todos acima de 300", entrega: "C:\Docs\Departamentos.xlsx" }, { nome: "Frota", tarefa: "planilha da frota", entrega: "C:\Docs\Frota.xlsx" }], final: "montar o Power BI com as duas" }) }; } });
  assert.equal(plan.tasks.length, 2); assert.equal(plan.final, "montar o Power BI com as duas");
  assert.deepEqual(JSON.parse(seen.schema), PARTS_SCHEMA); assert.match(seen.messages[1].content, /mais de 300 funcionários/); assert.match(seen.messages[0].content, /NÃO é uma parte/);
  assert.equal(await planParts({ request: "x", ask: async () => ({ ok: true, text: "{\"partes\":[],\"final\":\"\"}" }) }), null);
});

test("code projects: a website with several technologies is divided by area; code lands in the project folder, clean", async () => {
  const { multiPart } = await import("../app/agentTools/subagents.js");
  const { cleanCode, CODE_FILE } = await import("../app/agentTools/files.js");
  // The VS Code test of 13/10.
  // A website goes to create_site in one action (13/10); a system with several technologies is divided.
  assert.equal(multiPart("crie um website usando three.js, c++,html, java e react, o site deve ser sobre video games, dete ter um menu interarivo, dinamico e responsivo"), null);
  assert.deepEqual(multiPart("crie um sistema com react, java e python"), ["código react", "código java", "código python"]);
  assert.equal(multiPart("crie um site em html"), null);
  assert.equal(multiPart("o que é react, java e c++?"), null);
  assert.equal(cleanCode("C:\p\index.html", "<html><body>oi</body></html>\n```\n{\"name\":\"write_file\",\"arguments\""), "<html><body>oi</body></html>\n");
  assert.equal(cleanCode("C:\p\a.js", "```js\nconst a = 1;\n```"), "const a = 1;\n");
  assert.equal(cleanCode("C:\p\notas.txt", "```\nx\n```"), "```\nx\n```");
  assert.ok(CODE_FILE.test("src/App.jsx") && CODE_FILE.test("server/Main.java") && CODE_FILE.test("engine.cpp") && !CODE_FILE.test("relatorio.docx"));
});

test("code projects: write_file puts a project's code in the project folder (not a Documentos folder inside it)", async () => {
  const { fileTools } = await import("../app/agentTools/files.js");
  const { mkdtempSync, existsSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path"); const { tmpdir } = await import("node:os");
  const project = mkdtempSync(join(tmpdir(), "aurora-code-"));
  const write = fileTools.find((t) => t.name === "write_file");
  const said = await write.run({ path: "Documentos/game_website.html", content: "<html><body>jogos</body></html>\n```" }, { workspace: project, request: "crie um site de video games", env: {} });
  assert.match(said, /game_website\.html/);
  assert.ok(existsSync(join(project, "game_website.html")) && !existsSync(join(project, "Documentos")));
  assert.equal(readFileSync(join(project, "game_website.html"), "utf8"), "<html><body>jogos</body></html>\n");
});

test("code projects: the folder the request names, a plain CSV for scripts, no report brief, project pages open as files", async () => {
  const { askedFolder, CODE_REQUEST } = await import("../app/agentTools/files.js");
  const { pickBrief } = await import("../app/briefs.js");
  const { renderDocument } = await import("../app/documentWriter.js");
  const { projectPage } = await import("../app/agentTools/browser.js");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join, sep } = await import("node:path"); const { tmpdir } = await import("node:os");
  assert.equal(askedFolder("na pasta api, crie uma API REST em Node.js"), "api");
  assert.equal(askedFolder("crie um website … Crie tudo dentro da pasta site."), "site");
  assert.equal(askedFolder("salve na pasta do projeto"), null);
  assert.ok(CODE_REQUEST.test("crie um arquivo jogos.csv e um script relatorio.py que le o csv"));
  assert.equal(pickBrief("na pasta python, crie um arquivo jogos.csv com 15 jogos e um script relatorio.py que lê o CSV e mostra a média"), null);
  assert.equal(pickBrief("faça um relatório de vendas do mês")?.name, "relatorio");
  assert.equal(String(await renderDocument("csv", "| nome | gênero |\n|---|---|\n| Elden Ring | Ação, RPG |\n| Hades | Roguelike |\n| Celeste | Plataforma |", { plainCsv: true })), 'nome,gênero\nElden Ring,"Ação, RPG"\nHades,Roguelike\nCeleste,Plataforma\n');
  const project = mkdtempSync(join(tmpdir(), "aurora-page-")); writeFileSync(join(project, "index.html"), "<html></html>");
  assert.match(String(projectPage("index.html", project)), /^file:\/\/\/.*index\.html$/);
  assert.match(String(projectPage(`https://${project[0].toLowerCase()}/${project.slice(3).split(sep).join("/")}/index.html`, project)), /^file:/);
  assert.equal(projectPage("C:/Windows/win.html", project), null);
  assert.equal(projectPage("youtube.com", project), null);
});

test("code projects: && in Windows PowerShell, a full context that looks empty, earlier messages shortened", async () => {
  const { psChain } = await import("../app/agentTools/system.js");
  const { contextFull, shortenHistory } = await import("../app/chatAgent.js");
  assert.equal(psChain("cd api && node --test"), "cd api; if ($?) { node --test }");
  assert.equal(psChain("npm ci || echo falhou"), "npm ci; if (-not $?) { echo falhou }");
  assert.equal(psChain('echo "a && b"'), 'echo "a && b"');
  const empty = "O modelo local retornou uma resposta vazia ou inválida.";
  assert.equal(contextFull({ ok: false, error: empty, usage: { input_tokens: 16351 } }, {}), true);
  assert.equal(contextFull({ ok: false, error: empty, usage: { input_tokens: 3000 } }, {}), false);
  assert.equal(contextFull({ ok: false, error: "request (16458 tokens) exceeds the available context size (16384 tokens)" }, {}), true);
  const m = [{ role: "system", content: "s".repeat(2000) }, { role: "user", content: "u".repeat(2000) }, { role: "user", content: "agora" }];
  shortenHistory(m, { keep: 1 });
  assert.deepEqual(m.map((x) => x.content.length < 800), [false, true, true]);
});

test("learning: learn picks documentation pages and the relevant part; code guides are seeded", async () => {
  const { pickPages, relevantText } = await import("../app/agentTools/learn.js");
  const { GUIDES } = await import("../app/guides.js");
  const { AGENT_TOOLS } = await import("../app/agentTools/index.js");
  const results = "1. Vídeo\n   https://www.youtube.com/watch?v=1\n   x\n2. Blog\n   https://blog.exemplo.com/three\n   y\n3. Docs\n   https://threejs.org/docs/#manual/en/introduction/Installation\n   z";
  assert.deepEqual(pickPages(results), ["https://threejs.org/docs/#manual/en/introduction/Installation", "https://blog.exemplo.com/three"]);
  const page = "Menu do site e rodapé com links.\n\nInstalação com importmap: use <script type=\"importmap\"> com three e three/addons/ para OrbitControls.\n\nOutro assunto sem relação nenhuma aqui.";
  assert.match(relevantText(page, "three.js importmap OrbitControls"), /importmap/);
  assert.ok(AGENT_TOOLS.some((t) => t.name === "learn"));
  assert.deepEqual(["codigo-projeto", "codigo-testar", "aprender-sozinha"].filter((id) => GUIDES.some((g) => g.id === id)).length, 3);
});

test("search: Bing results when DuckDuckGo blocks (its links decoded); learn ranks pages by the topic", async () => {
  const { parseBing } = await import("../app/agentTools/web.js");
  const { pickPages } = await import("../app/agentTools/learn.js");
  const real = Buffer.from("https://nodejs.org/api/test.html").toString("base64").replace(/=+$/, "");
  const html = `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;p=x&amp;u=a1${real}&amp;ntb=1">Test runner | Node.js</a></h2><p>The node:test module</p></li><li class="b_algo"><h2><a href="https://example.com/x">Outro</a></h2></li>`;
  assert.deepEqual(parseBing(html).map((r) => r.url), ["https://nodejs.org/api/test.html", "https://example.com/x"]);
  const results = "1. Node.js — Run JavaScript Everywhere\n   https://nodejs.org/\n   runtime\n2. Test runner | Node.js v24 Documentation\n   https://nodejs.org/api/test.html\n   The node:test module facilitates the creation of tests, http server";
  assert.deepEqual(pickPages(results, 2, "node:test http server"), ["https://nodejs.org/api/test.html"]);
});

test("create_site: a website from the content, with the technologies the person named", async () => {
  const { siteTools } = await import("../app/agentTools/site.js");
  const { mkdtempSync, readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path"); const { tmpdir } = await import("node:os");
  const project = mkdtempSync(join(tmpdir(), "aurora-site-"));
  const items = ["Elden Ring", "Hades", "Celeste"].map((name, i) => ({ name, category: ["RPG", "Roguelike", "Plataforma"][i], detail: "2020", score: 9 + i / 10, description: "Um jogo." }));
  const said = await siteTools[0].run({ title: "GameVerse", tagline: "Os melhores jogos", items, theme: "neon" }, { workspace: project, request: "crie um website usando three.js, c++, html, java e react sobre video games", env: {} });
  assert.match(said, /Criei o site "GameVerse"/);
  for (const f of ["index.html", "css/style.css", "js/catalog.js", "js/scene.js", "js/menu.js", "server/Servidor.java", "cpp/ranking.cpp"]) assert.ok(existsSync(join(project, "site", f)), f);
  assert.match(readFileSync(join(project, "site", "index.html"), "utf8"), /react-dom[\s\S]*three\.min\.js/);
  await assert.rejects(siteTools[0].run({ title: "X", tagline: "y", items: items.slice(0, 1) }, { workspace: project, request: "crie um site", env: {} }), /pelo menos 3 itens/);
});

test("code tools: syntax check on write, the code map, create_api with tests that pass", async () => {
  const { fileTools } = await import("../app/agentTools/files.js");
  const { codeTools, codeMap, symbolsOf } = await import("../app/agentTools/code.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path"); const { tmpdir } = await import("node:os");
  const project = mkdtempSync(join(tmpdir(), "aurora-code2-"));
  const write = fileTools.find((t) => t.name === "write_file");
  const ctx = { workspace: project, request: "crie um script", env: {} };
  assert.match(await write.run({ path: "a.js", content: "const x = {;" }, ctx), /ATENÇÃO[\s\S]*linha 1/);
  assert.match(await write.run({ path: "c.json", content: '{"a":1,}' }, ctx), /ATENÇÃO/);
  assert.doesNotMatch(await write.run({ path: "ok.js", content: "const a = 1;\n" }, ctx), /ATENÇÃO/);
  assert.match(await write.run({ path: "i.html", content: '<html><script src="js/main.js"></script></html>' }, ctx), /Falta criar: js\/main\.js/);
  assert.deepEqual(symbolsOf("export async function load(a, b) {}\nclass Store {}\nconst add = (x) => x;\napp.get('/jogos', h);", ".js"), ["export function load(a, b)", "class Store", "add(x)", "GET /jogos"]);
  assert.deepEqual(symbolsOf("class Jogo:\n    def nota(self):\n        pass\ndef main():\n  for x in y: pass", ".py"), ["class Jogo", "def Jogo.nota(self)", "def main()"]);
  mkdirSync(join(project, "node_modules", "x"), { recursive: true }); writeFileSync(join(project, "node_modules", "x", "i.js"), "function hidden() {}");
  const map = codeMap(project).text;
  assert.match(map, /ok\.js \(2 linhas\)/); assert.doesNotMatch(map, /hidden/);
  const api = codeTools.find((t) => t.name === "create_api");
  const said = await api.run({ resource: "jogos", fields: [{ name: "nome" }, { name: "gênero" }, { name: "ano", type: "inteiro" }] }, { workspace: project, request: "na pasta api, crie uma API REST em Node.js com cadastro de jogos", env: process.env });
  assert.match(said, /Testes \(node --test\): 2 testes passaram, 0 falharam/);
  assert.match(said, /api[\/]?:?/);
});

test("code guards: the files a request names must exist; 'o script rodou' only when something ran", async () => {
  const { requestedFiles, missingFiles, claimsRunWithoutRunning } = await import("../app/codeGuards.js");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path"); const { tmpdir } = await import("node:os");
  const ask = "na pasta python, crie um arquivo jogos.csv com 15 jogos (nome, gênero, ano, nota) e um script relatorio.py que lê o CSV. Rode o script e me mostre o resultado.";
  assert.deepEqual(requestedFiles(ask), ["jogos.csv", "relatorio.py"]);
  assert.deepEqual(requestedFiles("leia o vendas.csv e me diga o total"), []);
  assert.deepEqual(requestedFiles("crie um website usando three.js e react"), []);
  const project = mkdtempSync(join(tmpdir(), "aurora-guard-")); mkdirSync(join(project, "python")); writeFileSync(join(project, "python", "jogos.csv"), "a,b\n");
  assert.deepEqual(missingFiles(ask, project), ["relatorio.py"]);
  writeFileSync(join(project, "python", "relatorio.py"), "print(1)\n");
  assert.deepEqual(missingFiles(ask, project), []);
  assert.equal(claimsRunWithoutRunning("O script rodou e encontrou God of War (nota 100)", [{ tool: "write_document", ok: true }], ask), true);
  assert.equal(claimsRunWithoutRunning("O script rodou: média 8,7", [{ tool: "run_command", ok: true }], ask), false);
  assert.equal(claimsRunWithoutRunning("Criei os arquivos.", [], ask), false);
});
