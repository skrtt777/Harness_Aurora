// Power BI numa conversa com o modelo local: criar o painel, perguntar sobre os números, criar uma medida.
// Com os dados de teste (make-data.mjs) copiados para os Documentos de mentira; fecha só o Power BI que abriu.
// node scripts/powerbi-lab/pbi-cowork.mjs <pasta dos dados> [--runs 1]
import "../evalSandbox.mjs";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const data = process.argv[2];
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 1;
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-pbicowork-")), "harness.db");
const store = await import("../../app/store.js");
const { handleChatTurn } = await import("../../app/server.js");
const { openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");
const { stopDesktop } = await import("../../app/desktop.js");
await store.setSetting("teacher_mode", "off");
// Like a person who clicked "Sempre permitir" for the Power BI.
await store.setSetting("agent_always_allow", JSON.stringify(["desktop_click", "desktop_type", "desktop_key"].map((tool) => ({ tool, prefix: "pbidesktop" }))));
const documents = JSON.parse(process.env.HARNESS_KNOWN_FOLDERS).documents;
copyFileSync(join(data, "vendas_padarias.xlsx"), join(documents, "vendas_padarias.xlsx"));
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes."); process.exit(1); }
const dax = async (q) => (await pbiRequest("query", { dax: q, max: 5 })).text || "";
const nums = (s) => String(s).replace(/R\$\s*/g, "");

let best2026 = "";
const steps = [
  { message: "faz um power bi com a planilha vendas_padarias.xlsx que está nos documentos", checks: [
    { name: "criou e abriu o painel", ok: async (t) => t.steps.some((s) => s.tool === "powerbi" && s.ok) && (await openReports()).length === 1 },
    { name: "diz o faturamento certo", ok: (t) => /94[.,]?419|94[.,]4 mil/i.test(nums(t.text)) },
    { name: "pergunta se está certo", ok: (t) => /\?|Quer ajustar/i.test(t.text) },
  ] },
  { message: "qual produto vendeu mais em 2026?", checks: [
    { name: "consultou o modelo", ok: (t) => t.steps.some((s) => s.tool === "powerbi" && s.args?.action === "query" && s.ok) },
    { name: "acertou o produto", ok: async (t) => {
      best2026 ||= (await dax("EVALUATE TOPN(1, SUMMARIZECOLUMNS('Vendas'[Produto], KEEPFILTERS(TREATAS({2026}, 'Calendário'[Ano])), \"v\", [Faturamento]), [v], DESC)")).split("\n")[2]?.split(" | ")[0] || "?";
      // The right one, and not a list of all of them ("todos venderam o mesmo…").
      const others = ["Pão francês", "Pão de queijo", "Croissant", "Bolo de cenoura", "Bolo de chocolate", "Coxinha", "Café expresso", "Suco natural", "Sonho", "Torta de limão"].filter((p) => p !== best2026 && t.text.includes(p));
      return t.text.includes(best2026) && others.length <= 2;
    } },
  ] },
  { message: "cria uma medida de lucro por pedido", checks: [
    { name: "alterou o modelo", ok: (t) => t.steps.some((s) => s.tool === "powerbi" && s.args?.action === "change" && s.ok) },
    { name: "a medida existe e calcula", ok: async () => {
      const model = (await pbiRequest("model", {})).text || "";
      const m = /medida \[([^\]]*lucro[^\]]*pedido[^\]]*)\]/i.exec(model)?.[1];
      if (!m) return false;
      const v = Number((await dax(`EVALUATE ROW("v", [${m}])`)).split("\n")[2]?.replace(/\./g, "").replace(",", "."));
      return Math.abs(v - 61875.05 / 1480) < 0.05;
    } },
  ] },
];

let ok = 0, total = 0;
for (let run = 1; run <= runs; run += 1) {
  const conversation = await store.createConversation({ provider: "local", title: "power bi junto" });
  console.log(`\n## rodada ${run}`);
  best2026 = "";
  try {
    for (const step of steps) {
      const started = Date.now();
      const reply = await handleChatTurn({ conversationId: conversation.id, message: step.message });
      const turn = { text: reply.message?.content || reply.error || "", steps: reply.message?.execution?.toolSteps || [] };
      const results = [];
      for (const check of step.checks) { let passed = false; try { passed = Boolean(await check.ok(turn)); } catch { passed = false; } results.push([check.name, passed]); total += 1; if (passed) ok += 1; }
      console.log(`- "${step.message}" (${((Date.now() - started) / 1000).toFixed(0)} s) ${results.map(([n, p]) => `${p ? "✓" : "✗"} ${n}`).join(" | ")}\n   passos: ${turn.steps.map((s) => `${s.tool}${s.args?.action ? `:${s.args.action}` : ""}${s.ok ? "" : `✗(${String(s.result || "").slice(0, 120)})`}`).join(", ")}\n   resposta: ${turn.text.slice(0, 220).replace(/\n/g, " ")}`);
    }
  } finally {
    for (const r of await openReports().catch(() => [])) { try { process.kill(r.pid); } catch { /* closed */ } }
    stopPowerBi();
    await new Promise((r) => setTimeout(r, 4000));
  }
}
stopDesktop();
console.log(`\nNota: ${ok}/${total}`);
process.exit(0);
