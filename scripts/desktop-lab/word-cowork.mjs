// Trabalho em conjunto no Word, com o modelo local, numa conversa só: a pessoa só fala, a Aurora escreve.
// Num Word que a própria Aurora abre (documento novo); nada dos documentos da pessoa. --runs 2
import "../evalSandbox.mjs";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 2;
if (/WINWORD/i.test(execSync("tasklist", { encoding: "utf8" }))) { console.log("O Word já está aberto: feche-o antes do teste."); process.exit(1); }
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-wcowork-")), "harness.db");
const store = await import("../../app/store.js");
const { handleChatTurn } = await import("../../app/server.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");
await store.setSetting("teacher_mode", "off");
const documents = JSON.parse(process.env.HARNESS_KNOWN_FOLDERS).documents;
const look = async () => (await desktopRequest("word_look", { max: 4000 })).text || "";
const asksBack = (t) => /\?/.test(t) || /Quer ajustar/i.test(t);

const steps = [
  { message: "abre o word pra mim", checks: [
    { name: "abriu o Word", ok: async (t) => t.steps.some((s) => (s.tool === "word" || s.tool === "open") && s.ok) && /aberto pela Aurora/.test(await look()) },
    { name: "pergunta o que escrever", ok: (t) => asksBack(t.text) },
  ] },
  { message: "escreve um orçamento de pintura de apartamento para o cliente Marcos: título, um parágrafo de apresentação e uma tabela com sala R$ 1.200, quartos R$ 1.800 e cozinha R$ 900", checks: [
    { name: "título no documento", ok: async () => /^# /m.test(await look()) },
    { name: "cita o Marcos", ok: async () => /Marcos/.test(await look()) },
    { name: "tabela com os 3 valores", ok: async () => { const s = await look(); return /1 tabela/.test(s) && /1\.200/.test(s) && /1\.800/.test(s) && /900/.test(s); } },
    { name: "pergunta se está certo", ok: (t) => asksBack(t.text) },
  ] },
  { message: "ta certo. acrescenta no final o prazo de 10 dias e a forma de pagamento: metade no início e metade na entrega", checks: [
    { name: "acrescentou prazo e pagamento", ok: async () => { const s = await look(); return /10 dias/.test(s) && /metade/i.test(s); } },
    { name: "não apagou o começo", ok: async () => /Marcos/.test(await look()) },
  ] },
  { message: "salva como orcamento_marcos em pdf na pasta documentos", checks: [
    { name: "salvou o PDF", ok: () => existsSync(join(documents, "orcamento_marcos.pdf")) },
  ] },
];

let ok = 0, total = 0;
for (let run = 1; run <= runs; run += 1) {
  const conversation = await store.createConversation({ provider: "local", title: "word junto" });
  console.log(`\n## rodada ${run}`);
  try {
    for (const step of steps) {
      const started = Date.now();
      const reply = await handleChatTurn({ conversationId: conversation.id, message: step.message });
      const turn = { text: reply.message?.content || reply.error || "", steps: reply.message?.execution?.toolSteps || [] };
      const results = [];
      for (const check of step.checks) { let passed = false; try { passed = Boolean(await check.ok(turn)); } catch { passed = false; } results.push([check.name, passed]); total += 1; if (passed) ok += 1; }
      console.log(`- "${step.message.slice(0, 70)}" (${((Date.now() - started) / 1000).toFixed(0)} s) ${results.map(([n, p]) => `${p ? "✓" : "✗"} ${n}`).join(" | ")}\n   passos: ${turn.steps.map((s) => `${s.tool}${s.args?.action ? `:${s.args.action}` : ""}${s.ok ? "" : "✗"}`).join(", ")}\n   resposta: ${turn.text.slice(0, 160).replace(/\n/g, " ")}`);
    }
  } finally { await desktopRequest("word_close"); }
}
stopDesktop();
console.log(`\nNota: ${ok}/${total}`);
process.exit(0);
