// BIs de assuntos diferentes numa conversa com o modelo local, como no app: o pedido em português, a IA
// local planeja o painel, o Power BI de teste abre, e perguntas sobre os números. Dados de teste
// (make-financas.mjs, make-logistica.mjs) nos Documentos de mentira; fecha só o Power BI que abriu.
// node scripts/powerbi-lab/bi-conversas.mjs <pasta dos dados> [--so financas|logistica] [--runs 1]
import "../evalSandbox.mjs";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const data = process.argv[2];
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 1;
const only = process.argv.includes("--so") ? process.argv[process.argv.indexOf("--so") + 1] : null;
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-biconversa-")), "harness.db");
const store = await import("../../app/store.js");
const { handleChatTurn } = await import("../../app/server.js");
const { openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");
const { stopDesktop } = await import("../../app/desktop.js");
await store.setSetting("teacher_mode", "off");
const documents = JSON.parse(process.env.HARNESS_KNOWN_FOLDERS).documents;
for (const f of ["financeiro_empresa.xlsx", "operacao_cd.xlsx"]) copyFileSync(join(data, f), join(documents, f));
const logistics = JSON.parse(readFileSync(join(data, "esperado-logistica.json"), "utf8"));
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes."); process.exit(1); }
const dax = async (q) => (await pbiRequest("query", { dax: q, max: 5 })).text || "";
const built = (t) => t.steps.find((s) => s.tool === "powerbi" && s.args?.action === "build" && s.ok);
const planOf = (t) => /Plano \(([^)]+)\): ([^\n]*)/.exec(String(built(t)?.result || "")) || [];
// The guides the app writes on start (app/guides.js), as in the app.
await (await import("../../app/guides.js")).seedGuides();

const conversations = {
  financas: [
    { message: "monta um BI das finanças da empresa com a planilha financeiro_empresa.xlsx dos documentos, é para a reunião de diretoria: quero ver se estamos gastando mais do que o orçado e onde", checks: [
      { name: "criou e abriu o painel", ok: async (t) => Boolean(built(t)) && (await openReports()).length === 1 },
      { name: "a IA local planejou", ok: (t) => planOf(t)[1] === "modelo" },
      { name: "o plano fala do orçamento ou do dinheiro", ok: (t) => /cena dinheiro|or[çc]a|gast|dinheiro|despesa/i.test(planOf(t)[2] || "") },
      { name: "fala das páginas", ok: (t) => [...(planOf(t)[2] || "").matchAll(/"([^"]+)"/g)].some((x) => t.text.includes(x[1])) },
    ] },
    { message: "quanto gastamos com marketing no total?", checks: [
      { name: "consultou o modelo", ok: (t) => t.steps.some((s) => s.tool === "powerbi" && s.args?.action === "query" && s.ok) },
      { name: "valor certo", ok: async (t) => { const v = (await dax("EVALUATE ROW(\"v\", FORMAT(CALCULATE([Saídas no período], 'Categorias'[Categoria] = \"Marketing\"), \"#,0\"))")).split("\n")[2]?.trim(); return Boolean(v) && t.text.replace(/\s/g, "").includes(v.replace(/\s/g, "")); } },
    ] },
    { message: "qual categoria mais estourou o orçamento?", checks: [
      { name: "consultou o modelo", ok: (t) => t.steps.some((s) => s.tool === "powerbi" && s.args?.action === "query" && s.ok) },
      { name: "Marketing", ok: (t) => /marketing/i.test(t.text) },
    ] },
  ],
  logistica: [
    { message: "power bi da operação do CD com a planilha operacao_cd.xlsx dos documentos, para o supervisor acompanhar o pátio e os atrasos", checks: [
      { name: "criou e abriu o painel", ok: async (t) => Boolean(built(t)) && (await openReports()).length === 1 },
      { name: "a IA local planejou", ok: (t) => planOf(t)[1] === "modelo" },
      { name: "o plano tem o pátio", ok: (t) => /cena patio/.test(planOf(t)[2] || "") },
    ] },
    { message: "quantos caminhões estão no pátio agora?", checks: [
      { name: "acertou o número", ok: (t) => new RegExp(`\\b${logistics.atDocks + logistics.waiting}\\b`).test(t.text) },
    ] },
  ],
};

let ok = 0, total = 0;
for (const [name, steps] of Object.entries(conversations)) {
  if (only && only !== name) continue;
  for (let run = 1; run <= runs; run += 1) {
    const conversation = await store.createConversation({ provider: "local", title: `bi ${name}` });
    console.log(`\n## ${name}, rodada ${run}`);
    try {
      for (const step of steps) {
        const started = Date.now();
        const reply = await handleChatTurn({ conversationId: conversation.id, message: step.message });
        const turn = { text: reply.message?.content || reply.error || "", steps: reply.message?.execution?.toolSteps || [] };
        const results = [];
        for (const check of step.checks) { let passed = false; try { passed = Boolean(await check.ok(turn)); } catch { passed = false; } results.push([check.name, passed]); total += 1; if (passed) ok += 1; }
        const plan = planOf(turn);
        console.log(`- "${step.message.slice(0, 90)}" (${((Date.now() - started) / 1000).toFixed(0)} s) ${results.map(([n, p]) => `${p ? "✓" : "✗"} ${n}`).join(" | ")}${plan[2] ? `\n   plano (${plan[1]}): ${plan[2]}` : ""}\n   passos: ${turn.steps.map((s) => `${s.tool}${s.args?.action ? `:${s.args.action}` : ""}${s.args?.action === "query" ? JSON.stringify({ m: s.args.measure, by: s.args.by, top: s.args.top, f: s.args.filter }) : ""}${s.ok ? "" : `✗(${String(s.result || "").slice(0, 140)})`}`).join(", ")}\n   resposta: ${turn.text.slice(0, 300).replace(/\n/g, " ")}`);
      }
    } finally {
      // Every Power BI open now was opened by this test (none was open before it started).
      for (const r of await openReports().catch(() => [])) { try { process.kill(r.pid); } catch { /* closed */ } }
      stopPowerBi();
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}
stopDesktop();
console.log(`\nNota: ${ok}/${total}`);
process.exit(0);
