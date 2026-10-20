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
  const regions = fake.rows.slice(1).map((r) => r[3]);
  assert.equal(regions[0], regions[2], "the two Sul rows share one fake");
  assert.notEqual(regions[0], regions[1]);
  assert.match(fake.rows[1][1], /^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
  assert.match(fake.rows[1][7], /^R\$ [\d.]+,\d{2}$/);
  assert.match(fake.rows[1][5], /^\d{2}\/\d{2}\/2020$/);
  assert.equal(ctx.map.get("Sul"), regions[0]);
  assert.ok(!ctx.map.has("120"), "numbers are parameters, not names: not in the map");
});

test("the request and the error text lose names, CPF, e-mail and R$; the script gets the real values back", () => {
  const map = new Map([["Sul", "regiao 1"], ["Maria Souza", "cliente 1"]]);
  const { text } = pseudonymize("Quanto a Maria Souza vendeu no Sul acima de 100? CPF 123.456.789-09, maria@acme.com.br, R$ 1.250,50", map);
  assert.equal(text, "Quanto a cliente 1 vendeu no regiao 1 acima de 100? CPF [CPF], [E-MAIL], [VALOR]");
  assert.deepEqual(leaks(text, map), []);
  assert.deepEqual(leaks("e a Maria Souza?", map), ["Maria Souza"]);
  const { code, restored } = restoreScript(`df[df.regiao == "regiao 1"]\nx = 'cliente 1'\ny = "regiao 10"`, new Map([...map, ["O'Neil", "regiao 10"]]));
  assert.equal(code, `df[df.regiao == "Sul"]\nx = 'Maria Souza'\ny = "O\\'Neil"`);
  assert.equal(restored, 3);
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
    // The engine writes the script with the fake region name it read in the request.
    const region = prompt.match(/no (\S+ \d+)\?/)[1];
    writeFileSync(join(cwd, MIRROR_SCRIPT), [
      "import csv",
      "rows = list(csv.DictReader(open('vendas.csv', encoding='utf-8'), delimiter=';'))",
      `total = sum(int(r['vendas']) for r in rows if r['regiao'] == "${region}")`,
      "open('total.txt', 'w', encoding='utf-8').write(str(total))",
      `print(f"Vendas no ${region}: {total}")`,
    ].join("\n"));
    assert.ok(existsSync(join(cwd, "vendas.csv")) && cwd !== ws, "it works on the mirror, not the real folder");
    return { ok: true, text: `O script soma as vendas da ${region} e grava total.txt.` };
  };
  const out = await escalate({ task: "Quanto vendemos no Sul? A Maria Souza (maria@acme.com.br) pediu.", workspace: ws, run, order: ["claude"], privacy: "espelho" });
  assert.equal(out.ok, true, JSON.stringify(out));
  for (const s of [...SECRETS, "Sul"]) assert.ok(!prompts[0].includes(s), `${s} reached the paid engine`);
  assert.equal(readFileSync(join(ws, "total.txt"), "utf8"), "263", "120 + 143, the real Sul rows");
  assert.match(out.text, /Vendas no Sul: 263/, "what the script printed is shown with the real name");
  assert.match(out.text, /soma as vendas da Sul/, "the engine's own words get the real names back, here only");
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
