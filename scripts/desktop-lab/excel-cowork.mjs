// Trabalho em conjunto no Excel, com o modelo local, numa conversa só: a pessoa só fala, a Aurora faz.
// Num Excel que a própria Aurora abre (pasta nova); nada das planilhas da pessoa. --runs 2
import "../evalSandbox.mjs";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 2;
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-cowork-")), "harness.db");
const store = await import("../../app/store.js");
const { handleChatTurn } = await import("../../app/server.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");
await store.setSetting("teacher_mode", "off");
const documents = JSON.parse(process.env.HARNESS_KNOWN_FOLDERS).documents;
const look = async () => (await desktopRequest("excel_look", { max: 20 })).text || "";
const asksBack = (t) => /\?/.test(t) || /Quer ajustar/i.test(t);

const steps = [
  { message: "abre o excel pra mim", checks: [
    { name: "abriu o Excel", ok: async (t) => t.steps.some((s) => (s.tool === "excel" || s.tool === "open") && s.ok) && /aba atual/.test(await look()) },
    { name: "pergunta o que fazer", ok: (t) => asksBack(t.text) },
  ] },
  { message: "cria uma planilha de estoque da padaria com as colunas Produto, Quantidade, Preço unitário e Total, com 5 produtos de exemplo. o total é a quantidade vezes o preço", checks: [
    { name: "as 4 colunas na planilha", ok: async () => { const s = await look(); return /Produto[^|]*| Quantidade[^|]*| Pre[çc]o unit[áa]rio[^|]*| Total/i.test(s);\| Quantidade \| Pre[çc]o unit[áa]rio \| Total/i.test(s); } },
    { name: "5 produtos", ok: async () => /\(6 linha\(s\)/.test(await look()) },
    { name: "total = quantidade x preço", ok: async () => {
      const rows = (await look()).split("\n").filter((l) => /^[^|]+\| \d/.test(l)).map((l) => l.split(" | "));
      return rows.length >= 5 && rows.every((r) => Math.abs(Number(r[1]) * Number(r[2]) - Number(r[3])) < 0.01);
    } },
    { name: "pergunta se está certo", ok: (t) => asksBack(t.text) },
  ] },
  { message: "ta certo. deixa o preço e o total em reais", checks: [
    { name: "formatou", ok: (t) => t.steps.some((s) => s.tool === "excel" && s.ok && /format/.test(JSON.stringify(s.args || {}))) },
  ] },
  { message: "salva como estoque_padaria na pasta documentos", checks: [
    { name: "salvou o arquivo", ok: () => existsSync(join(documents, "estoque_padaria.xlsx")) },
  ] },
];

let ok = 0, total = 0;
for (let run = 1; run <= runs; run += 1) {
  const conversation = await store.createConversation({ provider: "local", title: "excel junto" });
  console.log(`\n## rodada ${run}`);
  try {
    for (const step of steps) {
      const started = Date.now();
      const reply = await handleChatTurn({ conversationId: conversation.id, message: step.message });
      const turn = { text: reply.message?.content || reply.error || "", steps: reply.message?.execution?.toolSteps || [] };
      const results = [];
      for (const check of step.checks) { let passed = false; try { passed = Boolean(await check.ok(turn)); } catch { passed = false; } results.push([check.name, passed]); total += 1; if (passed) ok += 1; }
      console.log(`- "${step.message}" (${((Date.now() - started) / 1000).toFixed(0)} s) ${results.map(([n, p]) => `${p ? "✓" : "✗"} ${n}`).join(" | ")}\n   passos: ${turn.steps.map((s) => `${s.tool}${s.args?.action ? `:${s.args.action}` : ""}${s.ok ? "" : "✗"}`).join(", ")}\n   resposta: ${turn.text.slice(0, 170).replace(/\n/g, " ")}`);
    }
  } finally { await desktopRequest("excel_close"); }
}
stopDesktop();
console.log(`\nNota: ${ok}/${total}`);
process.exit(0);
