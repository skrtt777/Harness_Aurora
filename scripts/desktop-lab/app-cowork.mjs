// Trabalho em conjunto num programa qualquer do Windows (a Calculadora: sem dados da pessoa), com o
// modelo local e pedidos em português comum. node scripts/desktop-lab/app-cowork.mjs [--runs 2]
import "../evalSandbox.mjs";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 2;
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-app-")), "harness.db");
const store = await import("../../app/store.js");
const { handleChatTurn } = await import("../../app/server.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");
await store.setSetting("teacher_mode", "off");
// The calculator authorized for good, like a person who clicked "Sempre permitir" for it.
await store.setSetting("agent_always_allow", JSON.stringify(["desktop_click", "desktop_type", "desktop_key"].map((tool) => ({ tool, prefix: "calculadora" }))));
const running = () => { try { return /CalculatorApp/i.test(execSync("tasklist", { encoding: "utf8" })); } catch { return false; } };
if (running()) { console.log("A Calculadora já está aberta: feche-a antes do teste (o teste não mexe numa janela que já era da pessoa)."); process.exit(1); }
const display = async () => ((await desktopRequest("snapshot", { window: "Calculadora", max: 80 })).text || "").match(/A exibição é ([^"\n]+)/)?.[1] || "?";

const steps = [
  { message: "abre a calculadora pra mim", checks: [
    { name: "abriu e viu a janela", ok: (t) => t.steps.some((s) => s.tool === "open" && s.ok && /Calculadora/.test(s.result || s.summary || "")) },
    { name: "pergunta o que fazer", ok: (t) => /\?|Quer ajustar/i.test(t.text) },
  ] },
  { message: "faz 1234 vezes 56", checks: [
    { name: "usou a calculadora", ok: (t) => t.steps.some((s) => /^desktop_(click|type|key)$/.test(s.tool) && s.ok) },
    { name: "a tela mostra 69.104", ok: async () => /69[.,]?104/.test(await display()) },
    { name: "a resposta diz 69.104", ok: (t) => /69[.,]?104/.test(t.text) },
  ] },
  { message: "agora divide isso por 8", checks: [
    { name: "a tela mostra 8.638", ok: async () => /8[.,]?638\b/.test(await display()) },
  ] },
];

let ok = 0, total = 0;
for (let run = 1; run <= runs; run += 1) {
  const conversation = await store.createConversation({ provider: "local", title: "calculadora junto" });
  console.log(`\n## rodada ${run}`);
  try {
    for (const step of steps) {
      const started = Date.now();
      const reply = await handleChatTurn({ conversationId: conversation.id, message: step.message });
      const turn = { text: reply.message?.content || reply.error || "", steps: reply.message?.execution?.toolSteps || [] };
      const results = [];
      for (const check of step.checks) { let passed = false; try { passed = Boolean(await check.ok(turn)); } catch { passed = false; } results.push([check.name, passed]); total += 1; if (passed) ok += 1; }
      console.log(`- "${step.message}" (${((Date.now() - started) / 1000).toFixed(0)} s) ${results.map(([n, p]) => `${p ? "✓" : "✗"} ${n}`).join(" | ")}\n   passos: ${turn.steps.map((s) => `${s.tool}${s.ok ? "" : "✗"}`).join(", ")}\n   tela: ${await display()}\n   resposta: ${turn.text.slice(0, 150).replace(/\n/g, " ")}`);
    }
  } finally {
    // Only the calculator this test opened (none was open before).
    try { execSync("taskkill /IM CalculatorApp.exe /F", { stdio: "ignore" }); } catch { /* already closed */ }
  }
}
stopDesktop();
console.log(`\nNota: ${ok}/${total}`);
process.exit(0);
