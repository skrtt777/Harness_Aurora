import { test } from "node:test";
import assert from "node:assert/strict";
import { proveAnswer } from "../app/proof.js";
import { evaluateFormula, locateCell, recheckAnswer, recheckSummary } from "../app/proofLive.js";
import { factsOf } from "../app/proof.js";

const PATH = "C:\\Users\\x\\Documents\\Vendas.xlsx";
const sheet = (rows) => ["## Outubro", "Vendedor | Região | Meta | Vendido | % da meta", ...rows].map((l, i) => `${String(i + 1).padStart(5)}  ${l}`).join("\n");
const BEFORE = sheet([
  "Ana Souza | Sul | R$ 120.000,00 | R$ 98.400,00 | 82%",
  "Bruno Lima | Norte | R$ 90.000,00 | R$ 101.250,00 | 112,5%",
  "Carla Dias | Sudeste | R$ 150.000,00 | R$ 87.000,00 | 58%",
]);
// Two days later: a new seller above Bruno (his row moved down) and his sale corrected.
const AFTER = sheet([
  "Ana Souza | Sul | R$ 120.000,00 | R$ 98.400,00 | 82%",
  "Aline Rocha | Centro | R$ 60.000,00 | R$ 50.000,00 | 83%",
  "Bruno Lima | Norte | R$ 90.000,00 | R$ 104.800,00 | 112,5%",
  "Carla Dias | Sudeste | R$ 150.000,00 | R$ 87.000,00 | 58%",
]);
const ANSWER = "Só o Bruno Lima bateu a meta: vendeu R$ 101.250,00, ou 112,5% da meta de R$ 90.000,00. A equipe vendeu R$ 286.650,00, R$ 73.350,00 abaixo da meta somada de R$ 360.000,00. A Carla ficou com 58%.";
const T0 = Date.parse("2026-10-25T10:00:00Z");

function message() {
  const proof = proveAnswer(ANSWER, { sources: [{ tool: "read_file", args: { path: PATH }, result: BEFORE }], asked: ["quem bateu a meta?"] });
  return { content: ANSWER, createdAt: new Date(T0).toISOString(), execution: { proof, toolSteps: [{ tool: "read_file", ok: true, args: { path: PATH } }] } };
}
const io = (text, mtimeMs) => ({
  stat: async (p) => (text === null ? null : { path: p, mtimeMs }),
  readWhole: async () => text,
  replay: async () => text,
});

test("the file did not change after the answer: everything still holds, nothing is read", async () => {
  let reads = 0;
  const live = await recheckAnswer(message(), { ...io(BEFORE, T0 - 60_000), readWhole: async () => { reads += 1; return BEFORE; } });
  assert.equal(live.verdict, "vale");
  assert.equal(reads, 0);
  assert.ok(live.claims.every((c) => c.status === "confere"));
});

test("the sheet changed: the moved row is found by its name, the new value, the sums and what depends on them", async () => {
  const live = await recheckAnswer(message(), io(AFTER, T0 + 2 * 86_400_000));
  const by = Object.fromEntries(live.claims.map((c) => [c.raw, c]));
  assert.equal(by["R$ 101.250,00"].status, "mudou");
  assert.equal(by["R$ 101.250,00"].now, "R$ 104.800,00");
  assert.equal(by["R$ 101.250,00"].where, "Outubro › D4");
  assert.equal(by["112,5%"].status, "confere");
  assert.equal(by["58%"].status, "confere");
  assert.equal(by["R$ 90.000,00"].status, "confere");
  // Sums of the column with the new row; the difference recomputed from them.
  assert.equal(by["R$ 286.650,00"].now, "R$ 340.200,00");
  assert.equal(by["R$ 360.000,00"].now, "R$ 420.000,00");
  assert.equal(by["R$ 73.350,00"].now, "R$ 79.800,00");
  assert.equal(live.verdict, "mudou");
  assert.match(recheckSummary(live), /^⚠ 4 números mudaram desde a resposta: R\$ 101\.250,00 → R\$ 104\.800,00/);
});

test("a removed row or file is said plainly; a web or memory source is not rechecked", async () => {
  const gone = await recheckAnswer(message(), io(null, 0));
  assert.ok(gone.claims.filter((c) => c.status !== "mantido").every((c) => c.status === "sumiu"));
  assert.match(gone.claims[0].why, /não está mais em C:/);
  const noBruno = sheet(["Ana Souza | Sul | R$ 120.000,00 | R$ 98.400,00 | 82%", "Carla Dias | Sudeste | R$ 150.000,00 | R$ 87.000,00 | 58%"]);
  const cell = locateCell(factsOf({ tool: "read_file", args: { path: PATH }, result: BEFORE }).find((f) => f.value === 101250), factsOf({ tool: "read_file", args: { path: PATH }, result: noBruno }));
  assert.match(cell.why, /a linha de Bruno Lima não está mais na aba Outubro/);
  const web = { content: "O dólar fechou em R$ 5,41.", createdAt: new Date(T0).toISOString(), execution: { proof: proveAnswer("O dólar fechou em R$ 5,41.", { sources: [{ tool: "web_fetch", args: { url: "https://www.bcb.gov.br/cotacoes" }, result: "Dólar: R$ 5,41" }] }) } };
  const live = await recheckAnswer(web, io(null, 0));
  assert.equal(live.claims[0].status, "mantido");
  assert.equal(live.verdict, "vale");
});

test("the calculations the comprovante writes are evaluated again", () => {
  const v = (t) => ({ "R$ 993,00": 993, "3%": 3, "R$ 500": 500, "10%": 10, "a": 200, "b": 150 })[t];
  assert.equal(evaluateFormula("R$ 993,00 − 3% = 963,21", v).toFixed(2), "963.21");
  assert.equal(evaluateFormula("10% de R$ 500 = 50", v), 50);
  assert.equal(evaluateFormula("(a − b) ÷ b × 100 = 33,33", (t) => (t === "100" ? 100 : v(t))).toFixed(2), "33.33");
});
