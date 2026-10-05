import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { filterRows, cellValue } = await import("../app/agentTools/files.js");
const { AGENT_TASKS, scoreAgentTask, sheetRows } = await import("../app/agentTaskBattery.js");
const { renderDocument } = await import("../app/documentWriter.js");

const sheet = [
  "## Contas a receber",
  "Cliente | Título | Vencimento | Valor | Dias em atraso (em 04/10/2026) | Situação",
  "Rede Mais | Duplicata 2132 | 15/07/2026 | 79799.24 | 81 | Em atraso",
  "Atacadão | Duplicata 2066 | 24/09/2026 | 1.355,27 | 10 | Em atraso",
  "Padaria | Duplicata 7049 | 05/10/2026 | 33633.29 | 0 | A vencer",
  "Hotel | Duplicata 5390 | 18/09/2026 | 87470.7 | 31 | Em atraso",
];

test("cell values: Brazilian and plain numbers, percentages and dates", () => {
  assert.equal(cellValue("1.355,27"), 1355.27);
  assert.equal(cellValue("69062.05"), 69062.05);
  assert.equal(cellValue("-3,12%"), -3.12);
  assert.equal(cellValue("R$ 400"), 400);
  assert.ok(cellValue("05/10/2026") > cellValue("24/09/2026"));
  assert.equal(cellValue("Em atraso"), null);
});

test("filters compare numbers and dates, combine conditions and forgive the model's spelling", () => {
  const titles = (result) => result.split("\n").filter((l) => l.includes("Duplicata")).map((l) => l.match(/Duplicata \d+/)[0]);
  assert.deepEqual(titles(filterRows(sheet, "Dias em atraso>30")), ["Duplicata 2132", "Duplicata 5390"]);
  assert.deepEqual(titles(filterRows(sheet, "Vencimento>=01/09/2026; Vencimento<=30/09/2026")), ["Duplicata 2066", "Duplicata 5390"]);
  assert.deepEqual(titles(filterRows(sheet, "Valor<2000")), ["Duplicata 2066"]);
  assert.deepEqual(titles(filterRows(sheet, "Situação=Em atraso; Dias em atraso<=30")), ["Duplicata 2066"]);
  // What qwen3.5:4b actually wrote, copying the "Coluna=texto" example.
  for (const spelling of ["Coluna=Dias em atraso>30", "Coluna>Dias em atraso (em 04/10/2026)>30", "\"Dias em atraso (em 04/10/2026)\">30"]) {
    assert.deepEqual(titles(filterRows(sheet, spelling)), ["Duplicata 2132", "Duplicata 5390"], spelling);
  }
  assert.match(filterRows(sheet, "Dias em atraso>muito"), /Condição inválida/);
  assert.match(filterRows(sheet, "Desconto>3"), /Nenhuma planilha tem as colunas/);
  assert.match(filterRows(sheet, "Situação=A vencer"), /1 linha/, "the old text filter is unchanged");
});

test("agent tasks are scored on the file they deliver", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-agent-task-"));
  const task = AGENT_TASKS.find((t) => t.id === "ctrl-desvios-5");
  const truth = { expected: ["Produção", "Logística", "TI"], excluded: ["Marketing", "Comercial"] };
  const good = join(dir, "desvios.docx");
  writeFileSync(good, await renderDocument("docx", "# Desvios\n| Área | Desvio (%) |\n|---|---|\n| Produção | 8,07% |\n| Logística | 8,84% |\n| TI | 14,35% |\nEstimativa revisada."));
  const passed = await scoreAgentTask(task, { files: [good], answer: "Salvei em desvios.docx" }, truth);
  assert.ok(passed.checks.every((c) => c.ok), JSON.stringify(passed));
  // "TI" inside "Estimativa" does not count; a claim with no file fails everything.
  const noTi = join(dir, "sem-ti.docx");
  writeFileSync(noTi, await renderDocument("docx", "Produção e Logística. Estimativa."));
  assert.deepEqual((await scoreAgentTask(task, { files: [noTi], answer: "" }, truth)).missing, ["TI"]);
  const claimed = await scoreAgentTask(task, { files: [], answer: "Criei o relatório." }, truth);
  assert.ok(claimed.checks.every((c) => !c.ok));
  assert.equal(sheetRows(sheet.join("\n"))[0]["Título"], "Duplicata 2132");
});
