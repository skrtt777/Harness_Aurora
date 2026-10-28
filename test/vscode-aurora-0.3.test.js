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
  // A first line that opens a block goes on; the closing line that already follows does not repeat.
  assert.equal(cleanCompletion("() => {\n  res.json({ ok: true });\n});", { prefix: "app.get('/saude', ", suffix: "\n\napp.listen(3000);\n" }), "() => {\n  res.json({ ok: true });\n});");
  assert.equal(cleanCompletion("for (const n of lista) {\n    total += n;\n  }", { prefix: "  ", suffix: "\n  }\n  return total;\n}" }), "for (const n of lista) {\n    total += n;");
});

test("autocompletar: the fill-in-the-middle prompt and the line limits", async () => {
  const seen = [];
  const generate = async (prompt, opts) => { seen.push({ prompt, opts }); return { text: "a + b;", ms: 5, engine: "fake" }; };
  const r = await completeCode({ prefix: "function s(a, b) {\n  return ", suffix: "\n}\n", file: "C:\\proj\\src\\s.js" }, { generate });
  assert.equal(r.text, "a + b;");
  assert.ok(seen[0].prompt.startsWith("<|fim_prefix|><|file_sep|>src/s.js\nfunction s(a, b) {"));
  assert.ok(seen[0].prompt.endsWith("<|fim_suffix|>\n}\n<|fim_middle|>"));
  assert.equal(seen[0].opts.maxTokens, 96, "nothing after the cursor on the line: several lines");
  await completeCode({ prefix: "foo(", suffix: ")\n", file: "" }, { generate });
  assert.equal(seen[1].opts.maxTokens, 40, "text after the cursor: one line");
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
  assert.equal(answers[0].env.LOCAL_TEMPERATURE, "0.2");
  // Indentation of the selection kept when the model lost it.
  answers.reply = "```\nreturn x * 2;\n```";
  assert.equal((await editCode({ instruction: "dobre", selection: "    return x;", before: "", after: "" }, { run })).code, "    return x * 2;");
  // Nothing selected: the code for the cursor (the prompt says so).
  answers.reply = "const ok = true;";
  assert.equal((await editCode({ instruction: "uma constante", before: "a\n", after: "b\n" }, { run })).code, "const ok = true;");
  assert.match(answers.at(-1).prompt, /<CURSOR>/);
  await assert.rejects(editCode({ instruction: "  " }, { run }), /Diga o que mudar/);
  await assert.rejects(editCode({ instruction: "x" }, { run: async () => ({ ok: false, error: "sem modelo" }) }), /sem modelo/);
  assert.equal(codeOf("<think>hm</think>```py\nprint(1)\n```"), "print(1)");
});
