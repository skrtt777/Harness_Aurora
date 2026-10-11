// Trabalho em conjunto no PowerPoint, com o modelo local, numa conversa só: a pessoa só fala, a Aurora escreve.
// Num Word que a própria Aurora abre (documento novo); nada dos documentos da pessoa. --runs 2
import "../evalSandbox.mjs";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 2;
if (/POWERPNT/i.test(execSync("tasklist", { encoding: "utf8" }))) { console.log("O PowerPoint já está aberto: feche-o antes do teste."); process.exit(1); }
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-pcowork-")), "harness.db");
const store = await import("../../app/store.js");
const { handleChatTurn } = await import("../../app/server.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");
await store.setSetting("teacher_mode", "off");
const documents = JSON.parse(process.env.HARNESS_KNOWN_FOLDERS).documents;
const look = async () => (await desktopRequest("ppt_look", {})).text || "";
const asksBack = (t) => /\?/.test(t) || /Quer ajustar/i.test(t);

const steps = [
  { message: "abre o powerpoint pra mim", checks: [
    { name: "abriu o PowerPoint", ok: async (t) => t.steps.some((s) => (s.tool === "powerpoint" || s.tool === "open") && s.ok) && /aberta pela Aurora/.test(await look()) },
    { name: "pergunta sobre o que é", ok: (t) => asksBack(t.text) },
  ] },
  { message: "monta uma apresentação de resultados da padaria: capa, um slide com 3 destaques do trimestre e um gráfico de vendas de julho 42 mil, agosto 45,5 mil e setembro 49,8 mil", checks: [
    { name: "3 slides ou mais", ok: async () => /(\d+) slide\(s\)/.exec(await look())?.[1] >= 3 },
    { name: "tem um gráfico", ok: async () => /\[gráfico\]/.test(await look()) },
    { name: "tem destaques", ok: async () => /•/.test(await look()) },
    { name: "pergunta se está certo", ok: (t) => asksBack(t.text) },
  ] },
  { message: "ta certo. acrescenta um slide final de próximos passos: abrir a loja 3 e lançar o delivery", checks: [
    { name: "acrescentou o slide", ok: async () => /loja 3/i.test(await look()) && /delivery/i.test(await look()) },
  ] },
  { message: "salva como resultados_padaria em pdf na pasta documentos", checks: [
    { name: "salvou o PDF", ok: () => existsSync(join(documents, "resultados_padaria.pdf")) },
  ] },
];

let ok = 0, total = 0;
for (let run = 1; run <= runs; run += 1) {
  const conversation = await store.createConversation({ provider: "local", title: "powerpoint junto" });
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
  } finally { await desktopRequest("ppt_close"); }
}
stopDesktop();
console.log(`\nNota: ${ok}/${total}`);
process.exit(0);
