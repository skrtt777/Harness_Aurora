import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-topsecret-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";
process.env.AURORA_LOCAL_CENSOR = "off";

const { buildMirror, censorDocuments, pseudonymize, unfake, MIRROR_MANIFEST } = await import("../app/mirror.js");
const { escalate, engineNote } = await import("../app/engine.js");
const { listEgress } = await import("../app/blind.js");
const store = await import("../app/store.js");

const CONTRACT = "Contrato de prestação de serviços\nContratante: Metalúrgica Andrade Ltda, CNPJ 12.345.678/0001-90, representada por Rogério Tavares.\nCláusula 7: em caso de atraso, multa de 2% ao mês sobre R$ 9.100,00.\nVigência de 12 meses a partir de 01/02/2026. Este contrato faz parte do Projeto Fênix.\nRogério assinou em São Paulo.";
const SECRETS = ["Metalúrgica Andrade", "12.345.678/0001-90", "Rogério", "Tavares", "9.100,00", "01/02/2026", "Fênix", "2%"];

test("secret terms and every number become reversible marks, never the digits inside a mark", () => {
  const map = new Map();
  const { text } = pseudonymize("O Projeto fênix vence em 15/08/2026, multa de 2% e 3 parcelas; fale com Maria Souza.", map, { names: true, terms: ["Projeto Fênix"], numbers: true });
  assert.equal(text, "O [SIGILO 1] vence em [NÚMERO 1], multa de [NÚMERO 2]% e [NÚMERO 3] parcelas; fale com [NOME 1].");
  assert.equal(unfake(text, map), "O Projeto Fênix vence em 15/08/2026, multa de 2% e 3 parcelas; fale com Maria Souza.".replace("Projeto Fênix", "Projeto Fênix"));
});

test("a document goes into the mirror as censored text; the local model's names are hidden too", async () => {
  const ws = mkdtempSync(join(tmpdir(), "ts-doc-"));
  writeFileSync(join(ws, "contrato.docx"), "binário");
  writeFileSync(join(ws, "foto.png"), "png");
  const mirror = buildMirror(ws, { terms: ["Projeto Fênix"] });
  const asked = [];
  await censorDocuments(mirror, ws, { terms: ["Projeto Fênix"], extract: async () => CONTRACT, findNames: async (text) => { asked.push(text.length); return ["Rogério"]; } });
  const censored = readFileSync(join(mirror.dir, "contrato.docx.txt"), "utf8");
  for (const s of SECRETS) assert.ok(!censored.includes(s), `${s} in the censored text`);
  assert.match(censored, /\[NOME (\d+): prenome\] assinou/, "the first name alone points to the whole name");
  const whole = /representada por \[NOME (\d+)\]/.exec(censored)[1];
  assert.equal(/\[NOME (\d+): prenome\] assinou/.exec(censored)[1], whole, "the same person, and the paid model can tell");
  assert.match(censored, /\[SIGILO 1\]/);
  assert.match(censored, /Cláusula \[NÚMERO \d+\]: em caso de atraso, multa de \[NÚMERO \d+\]% ao mês sobre \[VALOR 1\]/, "the text itself stays readable");
  assert.ok(asked.length > 0);
  const manifest = readFileSync(join(mirror.dir, MIRROR_MANIFEST), "utf8");
  assert.match(manifest, /Documentos \(texto censurado aqui[\s\S]*contrato\.docx → contrato\.docx\.txt/);
  assert.match(manifest, /foto\.png/, "an image stays only listed");
});

test("top secret: 'resuma o contrato' goes censored, the answer comes back real, and the record keeps only what left", async () => {
  const ws = mkdtempSync(join(tmpdir(), "ts-run-"));
  writeFileSync(join(ws, "contrato.txt"), CONTRACT, "utf8");
  await store.setSetting("secret_terms", JSON.stringify(["Projeto Fênix"]));
  const seen = [];
  const run = async (id, prompt, { cwd }) => {
    const doc = readFileSync(join(cwd, "contrato.txt.txt"), "utf8");
    seen.push(prompt, doc);
    const who = /representada por (\[NOME \d+\])/.exec(doc)[1];
    const fee = /multa de (\[NÚMERO \d+\])%/.exec(doc)[1];
    const value = /sobre (\[VALOR \d+\])/.exec(doc)[1];
    return { ok: true, text: `Resumo: ${who} representa a contratante; a multa por atraso é de ${fee}% ao mês sobre ${value}. Faz parte do [SIGILO 1].` };
  };
  // Without the local model (findNames null): "Rogério assinou" is still hidden, as part of "Rogério Tavares".
  const out = await escalate({ task: "Resuma o contrato e diga qual é a multa por atraso.", workspace: ws, run, order: ["claude"], privacy: "censura", findNames: null });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.text, "Resumo: Rogério Tavares representa a contratante; a multa por atraso é de 2% ao mês sobre R$ 9.100,00. Faz parte do Projeto Fênix.");
  for (const s of SECRETS) assert.ok(!seen.join("\n").includes(s), `${s} reached the paid engine`);
  assert.match(engineNote(out), /documentos censurados/);
  const record = listEgress({ limit: 5 })[0];
  assert.deepEqual([record.engine, record.kind, record.privacy], ["Claude", "tarefa", "censura"]);
  assert.ok(record.files.includes("contrato.txt.txt"));
  for (const s of SECRETS) assert.ok(!record.text.includes(s), `${s} in the local record of what left`);
});

test("plain espelho never sends a document's text: the engine can only ask for it", async () => {
  const ws = mkdtempSync(join(tmpdir(), "ts-espelho-"));
  writeFileSync(join(ws, "contrato.txt"), CONTRACT, "utf8");
  let files = [];
  const out = await escalate({ task: "resuma o contrato", workspace: ws, order: ["claude"], privacy: "espelho", run: async (id, prompt, { cwd }) => { files = (await import("node:fs")).readdirSync(cwd); return { ok: true, text: "PRECISA_DO_CONTEUDO: o contrato só está listado." }; } });
  assert.equal(out.needsContent, true);
  assert.ok(!files.some((f) => /contrato/.test(f)), "no copy of the document in the mirror");
});
