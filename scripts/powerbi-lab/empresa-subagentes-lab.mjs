// The conversation of 12/10 again, word for word, with the local model as in the app: "crie dados de uma
// empresa… mais de 300 funcionários por departamento, carros" then "faça planilhas em excel e monte um
// POWERBI". Checks: the work was divided among subagents, each spreadsheet is a real table, every
// department above 300, the Power BI built with every data table loaded, the answer says where. Fake
// personal folders (evalSandbox), a temporary database, the teacher off, its own model server port.
// Closes only the Power BI it opened.
// node scripts/powerbi-lab/empresa-subagentes-lab.mjs [--runs 1]
import "../evalSandbox.mjs";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 1;
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-empresa-sub-")), "harness.db");
process.env.LLAMA_SERVER_PORT ||= "18191";          // never the desktop's own server
const store = await import("../../app/store.js");
const { handleChatTurn } = await import("../../app/server.js");
const { openReports, stopPowerBi } = await import("../../app/powerbi.js");
const { readSources } = await import("../../app/powerbiDesign.js");
const { stopLlamaServer } = await import("../../app/llamaServer.js");
await store.setSetting("teacher_mode", "off");
await (await import("../../app/guides.js")).seedGuides();
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes."); process.exit(1); }
const documents = JSON.parse(process.env.HARNESS_KNOWN_FOLDERS).documents;
const desktop = JSON.parse(process.env.HARNESS_KNOWN_FOLDERS).desktop;

const sheetsNow = () => [documents, desktop].flatMap((d) => (existsSync(d) ? readdirSync(d).filter((f) => /\.(xlsx|csv)$/i.test(f)).map((f) => join(d, f)) : []));
const steps = [
  { message: "quero que você crie dados sobre uma empresa aleatora, quero que tenha informações de todos os departamentos com mais de 300 funcionarios,  carros e etc..", checks: [] },
  { message: "certo faça planilhas em execel e use os dados para montar um POWERBI interativo com modelos 3D", checks: [
    { name: "dividiu entre subagentes", ok: (t) => t.steps.some((s) => s.tool === "subagents" && s.ok) },
    { name: "planilhas que são tabelas", ok: () => { const files = sheetsNow(); return files.length >= 2 && files.every((f) => { try { return readSources(f).length > 0; } catch { return false; } }); } },
    { name: "todos os departamentos acima de 300", ok: () => {
      for (const f of sheetsNow()) { let tables; try { tables = readSources(f); } catch { continue; }
        for (const t of tables) { const c = t.header.findIndex((h) => /funcion|colaborador|quadro/i.test(h)); const d = t.header.findIndex((h) => /departamento|setor|área/i.test(h));
          if (c >= 0 && d >= 0 && t.rows.length <= 20) return t.rows.every((r) => Number(String(r[c]).replace(/\D/g, "")) > 300); } }
      return false; } },
    { name: "Power BI montado com as tabelas carregadas", ok: (t) => t.steps.some((s) => s.tool === "powerbi" && s.args?.action === "build" && s.ok) },
    { name: "a resposta diz onde estão", ok: (t) => /[A-Z]:\\[^\n]*\.(xlsx|csv)/i.test(t.text) },
  ] },
];

let ok = 0, total = 0;
for (let run = 1; run <= runs; run += 1) {
  const conversation = await store.createConversation({ provider: "local", title: "empresa subagentes" });
  console.log(`\n## rodada ${run}`);
  try {
    for (const step of steps) {
      const started = Date.now();
      const reply = await handleChatTurn({ conversationId: conversation.id, message: step.message });
      const turn = { text: reply.message?.content || reply.error || "", steps: reply.message?.execution?.toolSteps || [] };
      const results = [];
      for (const check of step.checks) { let passed = false; try { passed = Boolean(await check.ok(turn)); } catch { passed = false; } results.push([check.name, passed]); total += 1; if (passed) ok += 1; }
      console.log(`- "${step.message.slice(0, 70)}" (${((Date.now() - started) / 1000).toFixed(0)} s) ${results.map(([n, p]) => `${p ? "✓" : "✗"} ${n}`).join(" | ")}`);
      console.log(`  passos: ${turn.steps.map((s) => `${s.by ? `[${s.by}] ` : ""}${s.tool}${s.args?.action ? `:${s.args.action}` : ""}${s.ok ? "" : "✗"}`).join(", ")}`);
      for (const s of turn.steps.filter((x) => !x.ok)) console.log(`  falhou ${s.tool}: ${String(s.summary || "").slice(0, 300)} | args: ${JSON.stringify(s.args || {}).slice(0, 300)}`);
      const sub = turn.steps.find((s) => s.tool === "subagents");
      if (sub) console.log(`  subagentes: ${String(sub.result || sub.summary).split("\n").filter((l) => l.startsWith("## ") || l.startsWith("Arquivos")).join(" / ").slice(0, 600)}`);
      const pbi = turn.steps.filter((s) => s.tool === "powerbi" && s.args?.action === "build").map((s) => String(s.result || s.summary).split("\n").find((l) => /Linhas por tabela|sem nenhuma linha|Pronto/.test(l))).filter(Boolean);
      if (pbi.length) console.log(`  power bi: ${pbi.join(" / ").slice(0, 400)}`);
      console.log(`  resposta: ${turn.text.replace(/\n+/g, " ").slice(0, 500)}`);
    }
    console.log(`  planilhas: ${sheetsNow().map((f) => f.split(/[\\/]/).pop()).join(", ")}`);
  } finally {
    for (const r of await openReports().catch(() => [])) { try { process.kill(r.pid); } catch { /* closed */ } }
    stopPowerBi();
  }
}
stopLlamaServer();
console.log(`\nNota: ${ok}/${total} (${total ? ((ok / total) * 100).toFixed(1) : 0}%)`);
process.exit(0);
