import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-mirror-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";

const { buildMirror, cellShape, fakeTable, leaks, pseudonymize, restoreScript, MIRROR_MANIFEST, MIRROR_SCRIPT } = await import("../app/mirror.js");
const { escalate, engineNote } = await import("../app/engine.js");
const { makeXlsx } = await import("../app/sampleDocs.js");
const { xlsxSheets } = await import("../app/docText.js");

const REAL = "cliente;cpf;email;regiao;mes;data;vendas;valor\nMaria Souza;123.456.789-09;maria@acme.com.br;Sul;Janeiro;05/01/2026;120;R$ 1.250,50\nJoão Lima;987.654.321-00;joao@acme.com.br;Norte;Fevereiro;12/02/2026;95;R$ 980,00\nAna Prado;111.222.333-44;ana@acme.com.br;Sul;Março;20/03/2026;143;R$ 2.100,10\n";
const SECRETS = ["Maria", "João", "Ana Prado", "Souza", "123.456.789-09", "maria@acme", "acme.com.br", "1.250,50", "2.100,10"];
const hasPython = (() => { for (const py of ["python", "py"]) { try { execFileSync(py, ["--version"], { stdio: "ignore" }); return true; } catch { /* next */ } } return false; })();

test("each cell keeps its shape: CPF, e-mail, date, money, month and category", () => {
  assert.equal(cellShape("123.456.789-09"), "cpf");
  assert.equal(cellShape("a@b.com"), "email");
  assert.equal(cellShape("05/01/2026"), "date-br");
  assert.equal(cellShape("R$ 1.250,50"), "money");
  assert.equal(cellShape("1.250,50"), "number-br");
  assert.equal(cellShape("Janeiro"), "common");
  assert.equal(cellShape("Sul"), "category");
});

test("a fake table: same header, rows and distinct values, no real value, months kept", () => {
  const ctx = { map: new Map(), counters: new Map() };
  const rows = REAL.trim().split("\n").map((l) => l.split(";"));
  const fake = fakeTable(rows, ctx);
  assert.deepEqual(fake.rows[0], rows[0]);
  assert.equal(fake.rows.length, rows.length);
  const flat = fake.rows.slice(1).flat().join("|");
  for (const s of SECRETS) assert.ok(!flat.includes(s), `${s} leaked into the mirror`);
  assert.deepEqual(fake.rows.slice(1).map((r) => r[4]), ["Janeiro", "Fevereiro", "Março"], "months say nothing about the company");
  assert.deepEqual(fake.rows.slice(1).map((r) => r[3]), ["Sul", "Norte", "Sul"], "a region is the business's vocabulary: kept");
  assert.ok(ctx.kept.has("regiao"));
  const clients = fake.rows.slice(1).map((r) => r[0]);
  assert.equal(new Set(clients).size, 3);
  assert.match(fake.rows[1][1], /^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
  assert.match(fake.rows[1][7], /^R\$ [\d.]+,\d{2}$/);
  assert.match(fake.rows[1][5], /^\d{2}\/\d{2}\/2020$/);
  assert.equal(ctx.map.get("Maria Souza"), clients[0]);
  assert.ok(!ctx.map.has("Sul"));
  assert.ok(!ctx.map.has("120"), "numbers are parameters, not names: not in the map");
});

test("the request and the error text lose names, CPF, e-mail and R$; the script gets the real values back", () => {
  const map = new Map([["Sul", "regiao 1"], ["Maria Souza", "cliente 1"]]);
  const { text } = pseudonymize("Quanto a Maria Souza vendeu no Sul acima de 100? CPF 123.456.789-09, maria@acme.com.br, R$ 1.250,50", map);
  assert.equal(text, "Quanto a cliente 1 vendeu no regiao 1 acima de 100? CPF [CPF 1], [E-MAIL 1], [VALOR 1]");
  assert.equal(map.get("123.456.789-09"), "[CPF 1]", "the marks are reversible: they go into the map");
  assert.deepEqual(leaks(text, map), []);
  assert.deepEqual(leaks("e a Maria Souza?", map), ["Maria Souza"]);
  const { code, restored } = restoreScript(`df[df.regiao == "regiao 1"]\nx = 'cliente 1'\ny = "regiao 10"`, new Map([...map, ["O'Neil", "regiao 10"]]));
  assert.equal(code, `df[df.regiao == "Sul"]\nx = 'Maria Souza'\ny = "O\\'Neil"`);
  assert.equal(restored, 3);
});

test("names are marked too, consistently, and products and months are not names", () => {
  const map = new Map();
  const { text } = pseudonymize("Carta para Maria da Silva e Acme Indústria Ltda; no Power BI, em Janeiro, a Maria da Silva aprovou.", map, { names: true });
  assert.equal(text, "Carta para [NOME 1] e [NOME 2]; no Power BI, em Janeiro, a [NOME 1] aprovou.");
  const { code } = restoreScript('doc.add_paragraph("Prezada [NOME 1],")', map);
  assert.equal(code, 'doc.add_paragraph("Prezada Maria da Silva,")');
});

test("code is copied with the marks; keys and names out, the code itself intact", () => {
  const ws = mkdtempSync(join(tmpdir(), "mirror-code-"));
  writeFileSync(join(ws, "clientes.csv"), "nome,cidade\nMaria Souza,Curitiba\n", "utf8");
  writeFileSync(join(ws, "app.py"), '# Autor: Bruno Gomes Souza\nKEY = "sk-abcdefghijklmnopqrstuvwx"\nVIP = "Maria Souza"\ndef total(xs):\n    return sum(xs)\n', "utf8");
  const mirror = buildMirror(ws);
  const code = readFileSync(join(mirror.dir, "app.py"), "utf8");
  for (const s of ["Bruno", "sk-abc", "Maria"]) assert.ok(!code.includes(s), `${s} in the code copy`);
  assert.match(code, /def total\(xs\):\n    return sum\(xs\)/);
  assert.match(code, /VIP = "nome 1"/, "a value of the sheets has the same fake in the code");
  assert.equal(restoreScript(code, mirror.map).code, readFileSync(join(ws, "app.py"), "utf8"), "and everything comes back here");
  assert.match(readFileSync(join(mirror.dir, MIRROR_MANIFEST), "utf8"), /Código e configuração[\s\S]*app\.py/);
});

test("the mirror folder: fake copies of csv and xlsx, other files only listed", () => {
  const ws = mkdtempSync(join(tmpdir(), "mirror-ws-"));
  writeFileSync(join(ws, "vendas.csv"), REAL, "utf8");
  writeFileSync(join(ws, "clientes.xlsx"), makeXlsx({ Clientes: [["Nome", "Cidade", "Limite"], ["Maria Souza", "Curitiba", 5000], ["João Lima", "Belém", 3000]] }));
  writeFileSync(join(ws, "contrato.docx"), "segredo");
  const mirror = buildMirror(ws);
  assert.deepEqual(readdirSync(mirror.dir).sort(), [MIRROR_MANIFEST, "clientes.xlsx", "vendas.csv"].sort());
  const csv = readFileSync(join(mirror.dir, "vendas.csv"), "utf8");
  const sheet = JSON.stringify(xlsxSheets(readFileSync(join(mirror.dir, "clientes.xlsx"))));
  for (const s of [...SECRETS, "Curitiba", "Belém"]) { assert.ok(!csv.includes(s), `${s} in csv`); assert.ok(!sheet.includes(s), `${s} in xlsx`); }
  const maria = mirror.map.get("Maria Souza");
  assert.ok(maria && csv.includes(maria) && sheet.includes(maria), "the same person has the same fake in every file");
  const manifest = readFileSync(join(mirror.dir, MIRROR_MANIFEST), "utf8");
  assert.match(manifest, /vendas\.csv: 3 linhas de dados/);
  assert.match(manifest, /contrato\.docx \(1 KB\)/);
  assert.ok(!manifest.includes("segredo"));
});

test("espelho: the engine sees only fakes, its script runs here on the real data and filters by the real name", { skip: !hasPython && "sem Python" }, async () => {
  const ws = mkdtempSync(join(tmpdir(), "mirror-run-"));
  writeFileSync(join(ws, "vendas.csv"), REAL, "utf8");
  const prompts = [];
  const run = async (id, prompt, { cwd, mirror }) => {
    prompts.push(prompt);
    // The engine writes the script with the fake client name it read in the request.
    const client = prompt.match(/Quanto a (\S+ \d+) vendeu/)[1];
    writeFileSync(join(cwd, MIRROR_SCRIPT), [
      "import csv",
      "rows = list(csv.DictReader(open('vendas.csv', encoding='utf-8'), delimiter=';'))",
      `total = sum(int(r['vendas']) for r in rows if r['cliente'] == "${client}" and r['regiao'] == "Sul")`,
      "open('total.txt', 'w', encoding='utf-8').write(str(total))",
      `print(f"Vendas de ${client} no Sul: {total}")`,
    ].join("\n"));
    assert.ok(existsSync(join(cwd, "vendas.csv")) && cwd !== ws, "it works on the mirror, not the real folder");
    return { ok: true, text: `O script soma as vendas de ${client} e grava total.txt.` };
  };
  const out = await escalate({ task: "Quanto a Maria Souza vendeu no Sul? Ela pediu por maria@acme.com.br.", workspace: ws, run, order: ["claude"], privacy: "espelho" });
  assert.equal(out.ok, true, JSON.stringify(out));
  for (const s of SECRETS) assert.ok(!prompts[0].includes(s), `${s} reached the paid engine`);
  assert.match(prompts[0], /no Sul\?/, "a region is vocabulary: it goes as it is");
  assert.equal(readFileSync(join(ws, "total.txt"), "utf8"), "120", "Maria Souza's real row");
  assert.match(out.text, /Vendas de Maria Souza no Sul: 120/, "what the script printed is shown with the real name");
  assert.match(out.text, /soma as vendas de Maria Souza/, "the engine's own words get the real names back, here only");
  assert.deepEqual(out.files.map((f) => f.split(/[\\/]/).pop()), ["total.txt"]);
  assert.match(engineNote(out), /sem enviar seus dados/);
});

test("espelho: a script that fails on the real data gets one repair round with the error pseudonymized", { skip: !hasPython && "sem Python" }, async () => {
  const ws = mkdtempSync(join(tmpdir(), "mirror-fix-"));
  writeFileSync(join(ws, "vendas.csv"), REAL, "utf8");
  const prompts = [];
  const run = async (id, prompt, { cwd }) => {
    prompts.push(prompt);
    writeFileSync(join(cwd, MIRROR_SCRIPT), prompts.length === 1
      ? "import csv\nrows = list(csv.DictReader(open('vendas.csv', encoding='utf-8'), delimiter=';'))\nraise ValueError('linha ruim: ' + rows[0]['cliente'] + ' ' + rows[0]['cpf'])"
      : "print('ok')");
    return { ok: true, text: "Pronto." };
  };
  const out = await escalate({ task: "conte as linhas", workspace: ws, run, order: ["claude"], privacy: "espelho" });
  assert.equal(out.ok, true);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /falhou com este erro/);
  assert.ok(!prompts[1].includes("Maria") && !prompts[1].includes("123.456.789-09"), "the real error is pseudonymized before it goes back");
});

test("espelho: code fixed blind — the engine edits the marked copy, the real file gets the change and keeps its secrets", async () => {
  const ws = mkdtempSync(join(tmpdir(), "mirror-codefix-"));
  const original = 'API_KEY = "sk-abcdefghijklmnopqrstuvwx"\n# Responsável: Bruno Gomes Souza\ndef media(xs):\n    return sum(xs) / len(xs) + 1\n';
  writeFileSync(join(ws, "calc.py"), original, "utf8");
  writeFileSync(join(ws, "notas.docx"), "x");
  const seen = [];
  const run = async (id, prompt, { cwd }) => {
    const copy = readFileSync(join(cwd, "calc.py"), "utf8");
    seen.push(prompt + copy);
    // The engine fixes the bug in the copy it sees, marks and all, and adds a test file.
    writeFileSync(join(cwd, "calc.py"), copy.replace(" + 1\n", "\n"));
    writeFileSync(join(cwd, "test_calc.py"), "from calc import media\nassert media([2, 4]) == 3\n");
    return { ok: true, text: "Corrigi a média em calc.py e criei test_calc.py." };
  };
  const out = await escalate({ task: "corrija o bug da média em calc.py", workspace: ws, run, order: ["claude"], privacy: "espelho" });
  assert.equal(out.ok, true, JSON.stringify(out));
  for (const s of ["sk-abc", "Bruno"]) assert.ok(!seen.join("").includes(s), `${s} reached the engine`);
  assert.equal(readFileSync(join(ws, "calc.py"), "utf8"), original.replace(" + 1\n", "\n"), "the fix, with the real key and name");
  assert.ok(existsSync(join(ws, "test_calc.py")), "the new test file came too");
  assert.deepEqual(out.files.map((f) => f.split(/[\\/]/).pop()).sort(), ["calc.py", "test_calc.py"]);
  assert.equal(readFileSync(join(ws, "notas.docx"), "utf8"), "x", "a listed document is never touched");
});

test("espelho: a task that needs a document's content stops and says so, without trying the next engine", async () => {
  const ws = mkdtempSync(join(tmpdir(), "mirror-doc-"));
  writeFileSync(join(ws, "contrato.docx"), "x");
  const calls = [];
  const out = await escalate({ task: "resuma o contrato", workspace: ws, order: ["claude", "codex"], privacy: "espelho", run: async (id) => { calls.push(id); return { ok: true, text: "PRECISA_DO_CONTEUDO: o contrato só está listado." }; } });
  assert.equal(out.ok, false);
  assert.equal(out.needsContent, true);
  assert.deepEqual(calls, ["claude"]);
  assert.match(engineNote(out), /precisa que um modelo forte leia o conteúdo real/);
});
