// O modelo local usando as ferramentas de programas, a partir de um pedido em português comum, numa
// janela de teste própria (nunca nos programas da pessoa). node scripts/desktop-lab/model.mjs [--runs 3]
import "../evalSandbox.mjs";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 3;
process.env.AURORA_DESKTOP_LAB = "1";
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-desktop-")), "harness.db");
const store = await import("../../app/store.js");
const { handleChatTurn } = await import("../../app/server.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");
await store.setSetting("teacher_mode", "off");
// The test window is a PowerShell form: authorized for good, like a person who clicked "Sempre permitir".
await store.setSetting("agent_always_allow", JSON.stringify(["desktop_click", "desktop_type", "desktop_key"].map((tool) => ({ tool, prefix: "powershell" }))));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const tasks = [
  { message: (t) => `na janela "${t}", cadastra a cliente Padaria Pão Dourado, de Salvador, como cliente VIP e salva`, expect: /Salvo: Padaria P[ãa]o Dourado \| Salvador \| VIP=True/i },
  { message: (t) => `abre a janela ${t} e cadastra o cliente Mercadinho São Jorge de Recife, não é VIP. depois salva`, expect: /Salvo: Mercadinho S[ãa]o Jorge( de Recife)? \| Recife \| VIP=False/i },
];

let ok = 0, total = 0;
for (let run = 1; run <= runs; run += 1) {
  for (const task of tasks) {
    const title = `Aurora Teste ${Math.random().toString(36).slice(2, 8)}`;
    const form = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("./test-window.ps1", import.meta.url)), "-Title", title], { stdio: "ignore" });
    try {
      await wait(2500);
      const conversation = await store.createConversation({ provider: "local", title: "programa" });
      const started = Date.now();
      const reply = await handleChatTurn({ conversationId: conversation.id, message: task.message(title) });
      const steps = (reply.message?.execution?.toolSteps || []).map((s) => `${s.tool}${s.ok ? "" : "✗"}`);
      const screen = (await desktopRequest("snapshot", { window: title, max: 40 })).text || "";
      const passed = task.expect.test(screen);
      total += 1; if (passed) ok += 1;
      console.log(`${passed ? "✓" : "✗"} (${((Date.now() - started) / 1000).toFixed(0)} s) "${task.message(title)}"\n   passos: ${steps.join(", ")}\n   tela: ${(/Salvo:[^"\n]*|Nada salvo/.exec(screen) || ["?"])[0]}\n   resposta: ${String(reply.message?.content || reply.error).slice(0, 160).replace(/\n/g, " ")}`);
    } finally { form.kill(); }
  }
}
stopDesktop();
console.log(`\nNota: ${ok}/${total}`);
process.exit(0);
