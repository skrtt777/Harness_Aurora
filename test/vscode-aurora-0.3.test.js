// The VS Code extension 0.3 (vscode/aurora): the pieces that run without VS Code — the line diff of
// the review in the editor, the panel's safe markdown with the comprovante's marks, the slash commands,
// the terminal in the message, the reuse of a gray suggestion — and the Harness side (app/codeAssist.js).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cleanCompletion, completeCode, editCode, codeOf } from "../app/codeAssist.js";

const require = createRequire(import.meta.url);
const { diffLines, applyHunks, countText } = require("../vscode/aurora/lib/diff.js");
const { render, renderAnswer } = require("../vscode/aurora/media/markdown.js");
const { composeMessage } = require("../vscode/aurora/lib/client.js");

test("review diff: hunks of removed and added lines, and accepting some of them", () => {
  const a = ["function soma(lista) {", "  return lista.reduce((a, b) => a + b);", "}", "", "module.exports = { soma };"];
  const b = ["function soma(lista) {", "  if (!lista.length) return 0;", "  return lista.reduce((a, b) => a + b, 0);", "}", "", "module.exports = { soma, media };"];
  const hunks = diffLines(a, b);
  assert.equal(hunks.length, 2);
  assert.deepEqual(hunks[0], { at: 1, removed: ["  return lista.reduce((a, b) => a + b);"], added: ["  if (!lista.length) return 0;", "  return lista.reduce((a, b) => a + b, 0);"] });
  assert.equal(hunks[1].at, 4);
  assert.deepEqual(applyHunks(a, hunks), b);
  assert.deepEqual(applyHunks(a, hunks, () => false), a);
  // Only the first one accepted: the export line stays as it was.
  assert.deepEqual(applyHunks(a, hunks, (_, k) => k === 0).at(-1), "module.exports = { soma };");
  assert.equal(countText(hunks), "+3 −2");
  assert.deepEqual(diffLines(a, a), []);
  // Only lines added (writing at the cursor) or only removed.
  assert.deepEqual(diffLines([], ["x", "y"]), [{ at: 0, removed: [], added: ["x", "y"] }]);
  assert.deepEqual(diffLines(["x", "y", "z"], ["x", "z"]), [{ at: 1, removed: ["y"], added: [] }]);
  // Two hunks with only a blank line between them become one decision.
  const joined = diffLines(["a", "", "b"], ["A", "", "B"]);
  assert.equal(joined.length, 1);
  assert.deepEqual(applyHunks(["a", "", "b"], joined), ["A", "", "B"]);
});

test("panel markdown: escaped, with code blocks, tables, lists and clickable paths", () => {
  const html = render("# Título\n\nTexto com **negrito**, `código` e <script>alert(1)</script>.\n\n- um\n- dois\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1 < 2;\n```\n\nVeja C:\\proj\\src\\app.js e [site](javascript:alert(1)).");
  assert.ok(!html.includes("<script>"), "HTML of the answer is escaped");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("<strong>negrito</strong>") && html.includes("<code>código</code>"));
  assert.ok(html.includes("<ul><li>um</li><li>dois</li></ul>"));
  assert.ok(html.includes("<th>A</th>") && html.includes("<td>2</td>"));
  assert.ok(html.includes("const x = 1 &lt; 2;") && html.includes("data-insert"));
  assert.ok(html.includes('data-open="C:\\proj\\src\\app.js"'));
  assert.ok(!/data-href="javascript/i.test(html), "a javascript: link is not kept");
});

test("panel markdown: the comprovante's numbers marked where they are, not the ones the person gave", () => {
  const content = "O Bruno vendeu **R$ 101.250,00**, acima da meta de R$ 90.000,00 que você citou.";
  const at = (s) => content.indexOf(s);
  const proof = { claims: [
    { raw: "R$ 101.250,00", start: at("R$ 101.250,00"), end: at("R$ 101.250,00") + 13, status: "fonte" },
    { raw: "R$ 90.000,00", start: at("R$ 90.000,00"), end: at("R$ 90.000,00") + 12, status: "pedido" },
  ] };
  const html = renderAnswer(content, proof);
  assert.ok(html.includes('<strong><mark class="proof" data-proof="0">R$ 101.250,00</mark></strong>'), html);
  assert.ok(!html.includes('data-proof="1"'));
  // Offsets that no longer match the text: nothing marked, nothing broken.
  assert.ok(!renderAnswer("outro texto", proof).includes("<mark"));
});

test("VS Code message: the terminal's failed command and its output go with it", () => {
  const msg = composeMessage("Corrija o erro", { terminal: { command: "npm test", exitCode: 1, cwd: "C:\\proj", output: "x".repeat(5000) + "\nAssertionError: 2 !== 3" } });
  assert.match(msg, /Último comando no terminal do VS Code \(falhou, código 1, em C:\\proj\): `npm test`/);
  assert.ok(msg.includes("AssertionError: 2 !== 3"));
  assert.ok(msg.length < 4600, "only the end of a long output");
});

test("VS Code: panel slash commands and the reuse of a gray suggestion", () => {
  // lib/panel.js and lib/completion.js need VS Code; their pure parts are checked through a stub.
  const Module = require("node:module");
  const original = Module._load;
  Module._load = function (request, ...rest) { return request === "vscode" ? { EventEmitter: class { fire() {} get event() { return () => {}; } dispose() {} }, DiagnosticSeverity: {}, workspace: {}, window: {}, languages: {} } : original.call(this, request, ...rest); };
  try {
    const { parseCommand } = require("../vscode/aurora/lib/panel.js");
    assert.deepEqual(parseCommand("/corrigir o botão não salva"), { command: "corrigir", prompt: "o botão não salva" });
    assert.deepEqual(parseCommand("/nova"), { command: "nova", prompt: "" });
    assert.deepEqual(parseCommand("/inexistente x"), { command: "", prompt: "/inexistente x" });
    assert.deepEqual(parseCommand("explique isto"), { command: "", prompt: "explique isto" });
    const { reuse, SECRET } = require("../vscode/aurora/lib/completion.js");
    const last = { prefix: "const total = ", text: "numeros.reduce((a, b) => a + b, 0);" };
    assert.equal(reuse(last, "const total = num"), "eros.reduce((a, b) => a + b, 0);");
    assert.equal(reuse(last, "const total = x"), null);
    assert.equal(reuse(last, "const total = numeros.reduce((a, b) => a + b, 0);"), null);
    assert.ok(SECRET.test("C:\\proj\\.env") && SECRET.test("/home/a/.env.local") && SECRET.test("chave.pem"));
    assert.ok(!SECRET.test("C:\\proj\\src\\env.js"));
    const { clean } = require("../vscode/aurora/lib/terminal.js");
    assert.equal(clean("\x1b[31mErro\x1b[0m\x1b]633;D;1\x07 fim"), "Erro fim");
  } finally { Module._load = original; }
});

test("autocompletar: what the model wrote, as the editor inserts it", () => {
  // After code on the line: no leading line break.
  assert.equal(cleanCompletion("\n    numeros.reduce((a, b) => a + b, 0);\n", { prefix: "  const total = ", suffix: "\n  return total;\n}" }), "numeros.reduce((a, b) => a + b, 0);");
  // On an indented empty line: the model's own break and indent go.
  assert.equal(cleanCompletion("\n    return 1", { prefix: "def f(n):\n    ", suffix: "\n" }), "return 1");
  // Text after the cursor: one line, without repeating it.
  assert.equal(cleanCompletion(" usuario => usuario.nome);\nconsole.log(nomes);", { prefix: "const nomes = usuarios.map(", suffix: ");\n" }), " usuario => usuario.nome");
  // The lines that already follow the cursor are not written again; a blank line ends it.
  assert.equal(cleanCompletion("if (!x) return 0;\n  return total / n;\n}", { prefix: "function m(x) {\n  ", suffix: "\n  return total / n;\n}" }), "if (!x) return 0;");
  assert.equal(cleanCompletion("a();\nb();\n\nc();", { prefix: "x\n", suffix: "" }), "a();\nb();");
  assert.equal(cleanCompletion("<|endoftext|>", { prefix: "x = ", suffix: "" }), "");
  assert.equal(cleanCompletion("1\n2\n3\n4", { prefix: "x\n", suffix: "", maxLines: 2 }), "1\n2");
  // Seen in VS Code: "const total = " + a whole statement + the "}" that already exists below.
  assert.equal(cleanCompletion("numeros.reduce((s, n) => s + n, 0);\n}", { prefix: "  const total = ", suffix: "\n  return total / numeros.length;\n}\n" }), "numeros.reduce((s, n) => s + n, 0);");
  // Seen in VS Code: the cursor after "return 0;": the suggestion goes on the next line, not glued.
  assert.equal(cleanCompletion("\n  const total = numeros.reduce((t, n) => t + n, 0);", { prefix: "  if (!numeros.length) return 0;", suffix: "\n  const total = \n" }), "\n  const total = numeros.reduce((t, n) => t + n, 0);");
  assert.equal(cleanCompletion(" // fim", { prefix: "  return 0;", suffix: "\n}" }), "");
  // Seen in the usage scenarios: the suggestion ran past the function ("def main():") and closed the caller's block.
  assert.equal(cleanCompletion("return n * fatorial(n - 1)\ndef main():\n    print(fatorial(5))", { prefix: "def fatorial(n):\n    if n <= 1:\n        return 1\n    ", suffix: "\n" }), "return n * fatorial(n - 1)");
  assert.equal(cleanCompletion("res.end('ok');\n});\nconsole.log('rodando');", { prefix: "http.createServer((req, res) => {\n  res.writeHead(200);\n  ", suffix: "\n}).listen(3000);\n" }), "res.end('ok');");
  // A first line that opens a block goes on; the closing line that already follows does not repeat.
  assert.equal(cleanCompletion("() => {\n  res.json({ ok: true });\n});", { prefix: "app.get('/saude', ", suffix: "\n\napp.listen(3000);\n", target: -1 }), "() => {\n  res.json({ ok: true });\n});");
  assert.equal(cleanCompletion("for (const n of lista) {\n    total += n;\n  }", { prefix: "  ", suffix: "\n  }\n  return total;\n}" }), "for (const n of lista) {\n    total += n;\n  }");
  // Its own block closed, the extra "}" that the code below already has is not.
  assert.equal(cleanCompletion("if (x > m) {\n      m = x;\n    }\n  }\n}\n", { prefix: "function maior(v) {\n  let m = v[0];\n  for (const x of v) {\n    ", suffix: "\n  }\n  return m;\n}\n", language: "javascript" }), "if (x > m) {\n      m = x;\n    }");
  // Text after the cursor: ")" of the model's own call kept, the ");" already there not repeated.
  assert.equal(cleanCompletion(" setTimeout(resolve, ms));", { prefix: "const esperar = (ms) => new Promise((resolve) =>", suffix: ");\n" }), " setTimeout(resolve, ms)");
  assert.equal(cleanCompletion(" nome, email\n", { prefix: "  return { ", suffix: " };\n}\n" }), " nome, email");
  // Cut by the token limit: only the half line goes.
  assert.equal(cleanCompletion("x for x in xs if x % 2 == 0]\n    # return [x for", { prefix: "def pares(xs):\n    return [", suffix: "]\n", truncated: true, language: "python" }), "x for x in xs if x % 2 == 0");
});

test("autocompletar: the fill-in-the-middle prompt and the line limits", async () => {
  const seen = [];
  const generate = async (prompt, opts) => { seen.push({ prompt, opts }); return { text: "a + b;", ms: 5, engine: "fake" }; };
  const r = await completeCode({ prefix: "function s(a, b) {\n  return ", suffix: "\n}\n", file: "C:\\proj\\src\\s.js" }, { generate });
  assert.equal(r.text, "a + b;");
  assert.ok(seen[0].prompt.startsWith("<|fim_prefix|><|file_sep|>src/s.js\nfunction s(a, b) {"));
  assert.ok(seen[0].prompt.endsWith("<|fim_suffix|>\n}\n<|fim_middle|>"));
  assert.equal(seen[0].opts.maxTokens, 128, "nothing after the cursor on the line: several lines");
  await completeCode({ prefix: "foo(", suffix: ")\n", file: "" }, { generate });
  assert.equal(seen[1].opts.maxTokens, 48, "text after the cursor: one line");
  assert.deepEqual(await completeCode({ prefix: "   ", suffix: "" }, { generate }), { text: "", ms: 0 });
  assert.equal(seen.length, 2, "an empty file is not sent");
});

test("Ctrl+I: the snippet back as code only, without the lines around it", async () => {
  const answers = [];
  const run = async (prompt, env) => { answers.push({ prompt, env }); return { ok: true, text: answers.reply, metrics: { wallMs: 10, model: "fake" } }; };
  answers.reply = "```javascript\n// util\n\nfunction soma(lista) {\n  if (!lista.length) return 0;\n  return lista.reduce((a, b) => a + b, 0);\n}\n\nmodule.exports = { soma };\n```";
  const r = await editCode({ instruction: "trate lista vazia", selection: "function soma(lista) {\n  return lista.reduce((a, b) => a + b);\n}", before: "// util\n", after: "\nmodule.exports = { soma };\n", language: "javascript", file: "util.js" }, { run });
  assert.equal(r.code, "function soma(lista) {\n  if (!lista.length) return 0;\n  return lista.reduce((a, b) => a + b, 0);\n}");
  assert.match(answers[0].prompt, /Pedido: trate lista vazia/);
  assert.equal(answers[0].env.LOCAL_TEMPERATURE, "0");
  // Indentation of the selection kept when the model lost it.
  answers.reply = "```\nreturn x * 2;\n```";
  assert.equal((await editCode({ instruction: "dobre", selection: "    return x;", before: "", after: "" }, { run })).code, "    return x * 2;");
  // Nothing selected: the code for the cursor (the prompt says so).
  answers.reply = "const ok = true;";
  assert.equal((await editCode({ instruction: "uma constante", before: "a\n", after: "b\n" }, { run })).code, "const ok = true;");
  assert.match(answers.find((a) => a.prompt.includes("Pedido: uma constante")).prompt, /<CURSOR>/);
  await assert.rejects(editCode({ instruction: "  " }, { run }), /Diga o que mudar/);
  await assert.rejects(editCode({ instruction: "x" }, { run: async () => ({ ok: false, error: "sem modelo" }) }), /sem modelo/);
  assert.equal(codeOf("<think>hm</think>```py\nprint(1)\n```"), "print(1)");
});

test("Editor de código: the bundled .vsix, the version an editor has, and when it is old", async () => {
  const { bundledVsix, installedVersion, older, vscodeStatus } = await import("../app/vscodeExtension.js");
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const out = join(mkdtempSync(join(tmpdir(), "aurora-vsix-")), "a.vsix");
  execFileSync(process.execPath, ["scripts/pack-vscode.mjs", "--out", out]);
  const pkg = JSON.parse((await import("node:fs")).readFileSync("vscode/aurora/package.json", "utf8"));
  assert.deepEqual(bundledVsix({ AURORA_VSIX: out }), { path: out, version: pkg.version });
  assert.equal(installedVersion("ms-python.python@2026.1.0\nharness-aurora.aurora-harness@0.2.1\n"), "0.2.1");
  assert.equal(installedVersion("ms-python.python@2026.1.0\n"), null);
  assert.ok(older("0.2.1", "0.3.0") && older("0.3.0", "0.10.0") && !older("0.3.0", "0.3.0") && !older("1.0.0", "0.9.9"));
  // No editor CLI on this fake PC: nothing listed, nothing run.
  const ran = [];
  const s = await vscodeStatus({ env: { AURORA_VSIX: out, LOCALAPPDATA: join(tmpdir(), "nada"), ProgramFiles: join(tmpdir(), "nada") }, run: async (...a) => { ran.push(a); return { ok: true, stdout: "" }; } });
  assert.deepEqual(s.editors, []);
  assert.equal(ran.length, 0);
});

test("Ctrl+I: the selection widened to whole blocks before it goes to the model", () => {
  const { widenToBlock, balanceOf } = require("../vscode/aurora/lib/blocks.js");
  const js = ["// total", "function total(vendas) {", "  const t = {};", "  for (const v of vendas) {", "    t[v.n] = (t[v.n] || 0) + v.valor;", "  }", "  return t;", "}", "", "module.exports = { total };"];
  // Lines 1-6 (without the function's "}"): the closing line comes too.
  assert.deepEqual(widenToBlock(js, 1, 7), [1, 8]);
  // A balanced selection stays as it is.
  assert.deepEqual(widenToBlock(js, 3, 6), [3, 6]);
  // Only the inside of the loop and its "}": the "for" line above comes too.
  assert.deepEqual(widenToBlock(js, 4, 6), [3, 6]);
  // Brackets inside strings and comments do not count.
  assert.equal(balanceOf("const s = '{'; // }"), 0);
  assert.equal(balanceOf("if (x) {"), 1);
  const py = ["def media(xs):", "    if not xs:", "        return 0", "    return sum(xs) / len(xs)", "", "", "def outra():", "    pass"];
  assert.deepEqual(widenToBlock(py, 0, 2, { language: "python" }), [0, 4]);
  assert.deepEqual(widenToBlock(py, 3, 4, { language: "python" }), [3, 4]);
});

test("Ctrl+I: lines copied from after the selection are cut, a new inner block is kept", async () => {
  const run = (reply) => async () => ({ ok: true, text: reply, metrics: {} });
  const sel = "function total(vendas) {\n  return vendas.reduce((s, v) => s + v.valor, 0);\n}";
  const after = "\nfunction outra() {}\n\nmodule.exports = { total };\n";
  const r = await editCode({ instruction: "ignore sem valor", selection: sel, before: "", after }, { run: run("```js\nfunction total(vendas) {\n  return vendas.filter((v) => v.valor).reduce((s, v) => s + v.valor, 0);\n}\n\nmodule.exports = { total };\n```") });
  assert.equal(r.code, "function total(vendas) {\n  return vendas.filter((v) => v.valor).reduce((s, v) => s + v.valor, 0);\n}");
  const inner = await editCode({ instruction: "só se positivo", selection: "  total += x;", before: "for (const x of xs) {\n", after: "}\n" }, { run: run("```js\n  if (x > 0) {\n    total += x;\n  }\n```") });
  assert.equal(inner.code, "  if (x > 0) {\n    total += x;\n  }");
});

test("Editor de código: a name nothing declares is caught without running the code", async () => {
  const { undefinedNames, newUndefined } = await import("../app/codeAssist.js");
  assert.deepEqual(await undefinedNames("const fs = require('fs');\nfunction a(v) { return [fs, process.env, console, v, total]; }\nmodule.exports = { a };"), ["total"]);
  assert.match(await newUndefined("javascript", "function f(v) { const t = {}; return t; }", "function f(v) { const t = {}; t[vendedor] = v.valor; return t; }"), /"vendedor"/);
  // A name already undefined before (declared in another file) is not the change's fault.
  assert.equal(await newUndefined("javascript", "function f() { return helper(); }", "function f() { return helper() + 1; }"), null);
  assert.equal(await newUndefined("go", "a", "b"), null, "languages without an analysis are not judged");
  assert.equal(await undefinedNames("function ("), null);
});

test("Editor de código: Brazilian idioms go along when the request speaks of them", async () => {
  const { hintsFor } = await import("../app/codeAssist.js").then(() => import("../app/codeHints.js"));
  assert.match(hintsFor("formate em reais", "javascript")[0], /Intl\.NumberFormat\('pt-BR'/);
  assert.match(hintsFor("remova os acentos", "python")[0], /unicodedata/);
  assert.equal(hintsFor("formate em reais", "go").length, 0, "only languages with idioms");
  assert.equal(hintsFor("some os números", "javascript").length, 0);
  assert.ok(hintsFor("valide o CPF, o CNPJ, o CEP e o telefone", "javascript").length <= 3);
  const { editPrompt } = await import("../app/codeAssist.js");
  assert.match(editPrompt({ instruction: "calcule a idade", language: "javascript", selection: "function idade() {}" }), /Dicas que funcionam aqui:\n- Idade em anos completos/);
  assert.doesNotMatch(editPrompt({ instruction: "some", language: "javascript", selection: "x" }), /Dicas/);
});

test("Editor de código: Python names used without import are caught (parsed, never run)", async () => {
  const { pythonUndefined, newUndefined, editPrompt } = await import("../app/codeAssist.js");
  const names = await pythonUndefined("def ler(c):\n    with open(c) as f:\n        return list(csv.DictReader(f))\n");
  if (names === null) return; // no Python on this machine: nothing to check
  assert.deepEqual(names, ["csv"]);
  assert.match(await newUndefined("python", "def f(c):\n    return c\n", "def f(c):\n    return datetime.date.today()\n"), /"datetime"/);
  assert.equal(await newUndefined("python", "import re\n", "import re\nx = [y for y in re.findall('a', 'b') if y]\n"), null);
  assert.equal(await newUndefined("python", "def f(:", "def f():\n    return csv\n"), null, "the code before does not parse: not judged");
  // The model may import what the new code needs (28/10: obeying "no imports", the 30B left csv undefined).
  assert.match(editPrompt({ instruction: "leia o csv", selection: "def f(): pass", language: "python" }), /importe-o dentro do trecho/);
});

test("autocompletar: a block over several lines, with text after the cursor, comes whole on one line", async () => {
  // 28/10 (second held-out set): "sem sugestão" because the block was cut after its first statement.
  assert.equal(cleanCompletion("{\n  return [...new Set(lista)];\n}", { prefix: "const unicos = (lista) => ", suffix: ";\nmodule.exports = { unicos };\n" }), "{ return [...new Set(lista)]; }");
  assert.equal(cleanCompletion("(acc, p) => {\n    return p.preco > acc.preco ? p : acc;\n  }", { prefix: "function f(ps) {\n  return ps.reduce(", suffix: ");\n}\n", target: 0 }), "(acc, p) => { return p.preco > acc.preco ? p : acc; }");
});
