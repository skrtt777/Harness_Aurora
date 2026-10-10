// desktop_copy on the Access datasheet of the lab's own database (never the person's files).
import { spawn } from "node:child_process";
const { executeTool } = await import("../../app/agentTools/index.js");
const { stopDesktop } = await import("../../app/desktop.js");
const access = spawn("C:\\Program Files\\Microsoft Office\\root\\Office16\\MSACCESS.EXE", [process.argv[2]], { stdio: "ignore" });
const ctx = { mode: "auto", approve: async () => true, alwaysAllow: [] };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await wait(8000);
  const snap = await executeTool("desktop_snapshot", { window: "AuroraTeste" }, ctx);
  const table = /\[(d\d+)\] Button "Clientes"/.exec(snap.result)?.[1];
  await executeTool("desktop_click", { ref: table }, ctx);
  await executeTool("desktop_key", { keys: "{ENTER}", window: "AuroraTeste" }, ctx);
  await wait(1500);
  const after = await executeTool("desktop_snapshot", { window: "AuroraTeste" }, ctx);
  console.log(after.result.split("\n").filter((l) => /Mensagem de Status|Registro Atual|Guia 'Clientes'/.test(l)).join("\n"));
  const tab = /\[(d\d+)\] Button "Guia 'Clientes'"/.exec(after.result)?.[1];
  if (process.argv.includes("--tab") && tab) await executeTool("desktop_click", { ref: tab }, ctx);
  // Into the datasheet itself, as a person would click on the table.
  const sheet = /\[(d\d+)\] Pane "Clientes"/.exec(after.result)?.[1];
  const clicked = await executeTool("desktop_click", { ref: sheet }, ctx);
  console.log("clique na tabela:", clicked.result.split("\n")[0]);
  const copied = await executeTool("desktop_copy", { window: "AuroraTeste" }, ctx);
  console.log(copied.result);
  console.log(/Hotel Litoral Norte/.test(copied.result) ? "✓ leu a folha de dados" : "✗ não leu");
} finally { access.kill(); stopDesktop(); }
process.exit(0);
