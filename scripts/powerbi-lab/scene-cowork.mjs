// O BI com cena numa conversa com o modelo local: pedir o painel da operação do CD, perguntar pelo pátio e
// pelos atrasos. Com os dados de teste (make-logistica.mjs) nos Documentos de mentira; fecha só o Power BI
// que abriu. node scripts/powerbi-lab/scene-cowork.mjs <pasta dos dados> [--runs 1]
import "../evalSandbox.mjs";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const data = process.argv[2];
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 1;
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-cenacowork-")), "harness.db");
const store = await import("../../app/store.js");
const { handleChatTurn } = await import("../../app/server.js");
const { openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");
const { stopDesktop } = await import("../../app/desktop.js");
await store.setSetting("teacher_mode", "off");
const documents = JSON.parse(process.env.HARNESS_KNOWN_FOLDERS).documents;
copyFileSync(join(data, "operacao_cd.xlsx"), join(documents, "operacao_cd.xlsx"));
const expected = JSON.parse(readFileSync(join(data, "esperado-logistica.json"), "utf8"));
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes."); process.exit(1); }
const dax = async (q) => (await pbiRequest("query", { dax: q, max: 5 })).text || "";
let worst = "";

const steps = [
  { message: "monta um power bi da operação do nosso CD com a planilha operacao_cd.xlsx dos documentos, quero ver os caminhões nas docas, o rastreamento das entregas e os atrasos", checks: [
    { name: "criou e abriu o painel", ok: async (t) => t.steps.some((s) => s.tool === "powerbi" && s.args?.action === "build" && s.ok) && (await openReports()).length === 1 },
    { name: "primeira página é a operação com a cena", ok: (t) => t.steps.some((s) => s.tool === "powerbi" && /Páginas: Operação/.test(String(s.result || "")) && /cena com as docas/.test(String(s.result || ""))) },
    { name: "fala da operação com números certos", ok: (t) => new RegExp(`\\b(${expected.active}|${expected.atDocks + expected.waiting})\\b`).test(t.text) || /86[,.]2/.test(t.text) },
    { name: "pergunta se está certo", ok: (t) => /\?|Quer ajustar/i.test(t.text) },
  ] },
  { message: "quantos caminhões estão no pátio agora?", checks: [
    { name: "consultou o modelo", ok: (t) => t.steps.some((s) => s.tool === "powerbi" && s.args?.action === "query" && s.ok) },
    { name: "acertou o número", ok: (t) => new RegExp(`\\b${expected.atDocks + expected.waiting}\\b`).test(t.text) },
  ] },
  { message: "qual transportadora tem mais entregas atrasadas?", checks: [
    { name: "consultou o modelo", ok: (t) => t.steps.some((s) => s.tool === "powerbi" && s.args?.action === "query" && s.ok) },
    { name: "acertou a transportadora", ok: async (t) => {
      worst ||= (await dax("EVALUATE TOPN(1, SUMMARIZECOLUMNS('Embarques'[Transportadora], \"v\", [Entregas atrasadas]), [v], DESC)")).split("\n")[2]?.split(" | ")[0] || "?";
      return t.text.includes(worst);
    } },
  ] },
];

let ok = 0, total = 0;
for (let run = 1; run <= runs; run += 1) {
  const conversation = await store.createConversation({ provider: "local", title: "bi da operação" });
  console.log(`\n## rodada ${run}`);
  try {
    for (const step of steps) {
      const started = Date.now();
      const reply = await handleChatTurn({ conversationId: conversation.id, message: step.message });
      const turn = { text: reply.message?.content || reply.error || "", steps: reply.message?.execution?.toolSteps || [] };
      const results = [];
      for (const check of step.checks) { let passed = false; try { passed = Boolean(await check.ok(turn)); } catch { passed = false; } results.push([check.name, passed]); total += 1; if (passed) ok += 1; }
      console.log(`- "${step.message}" (${((Date.now() - started) / 1000).toFixed(0)} s) ${results.map(([n, p]) => `${p ? "✓" : "✗"} ${n}`).join(" | ")}\n   passos: ${turn.steps.map((s) => `${s.tool}${s.args?.action ? `:${s.args.action}` : ""}${s.args?.action === "query" ? JSON.stringify({ m: s.args.measure, by: s.args.by, top: s.args.top, f: s.args.filter, dax: s.args.dax }) + " => " + String(s.result || "").split("\n").slice(0, 4).join(" / ") : ""}${s.ok ? "" : `✗(${String(s.result || "").slice(0, 160)})`}`).join(", ")}\n   resposta: ${turn.text.slice(0, 260).replace(/\n/g, " ")}`);
    }
  } finally {
    // Every Power BI open now was opened by this test (none was open before it started).
    for (const r of await openReports().catch(() => [])) { try { process.kill(r.pid); } catch { /* closed */ } }
    stopPowerBi();
    await new Promise((r) => setTimeout(r, 4000));
  }
}
stopDesktop();
console.log(`\nNota: ${ok}/${total}`);
process.exit(0);
