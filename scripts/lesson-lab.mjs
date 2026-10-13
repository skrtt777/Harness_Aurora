// Does the Conferência's lesson help the next request? Two legal opinions in a row on one test Harness
// (temporary database, local model, teacher off), each in its own conversation: the citations of each
// Word file, whether they were read in an official page, and the lessons saved in between.
// node scripts/lesson-lab.mjs <pasta> [rodadas]
import "./evalSandbox.mjs";
import { mkdtempSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const base = process.argv[2]; const rounds = Number(process.argv[3]) || 2;
if (!base) { console.log("Use: node scripts/lesson-lab.mjs <pasta> [rodadas]"); process.exit(2); }
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-lesson-lab-")), "harness.db");
process.env.LLAMA_SERVER_PORT ||= "18191";
const store = await import("../app/store.js");
const { createServer } = await import("../app/server.js");
const { stopLlamaServer } = await import("../app/llamaServer.js");
const { extractText } = await import("../app/docText.js");
await store.setSetting("teacher_mode", "off");
await store.setSetting("onboarding_completed", "true");
await store.setSetting("agent_mode", "auto");
const server = createServer({ allowDev: false }); await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { createClient } = createRequire(import.meta.url)("../vscode/aurora/lib/client.js");
const client = createClient({ base: `http://127.0.0.1:${server.address().port}`, pollMs: 1000 });
const ask = "Faça um parecer curto em Word sobre multa por rescisão antecipada de contrato de locação residencial.";
const docx = (dir) => { const out = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.docx$/i.test(f)) out.push(p); } }; if (existsSync(dir)) walk(dir); return out; };

for (let i = 1; i <= rounds; i++) {
  const folder = join(base, `r${i}`); mkdirSync(folder, { recursive: true });
  const project = await client.projectFor(folder, `Lição ${i}`);
  const conversation = await client.newConversation({ projectId: project.id, title: `Parecer ${i}` });
  const started = Date.now();
  const r = await client.send(conversation.id, ask, { onProgress: async (p) => { if (p.approval) await client.approve(conversation.id, p.approval.id, true); } });
  const file = docx(folder)[0];
  const text = file ? String(await extractText(file)) : "";
  const arts = [...new Set((text.match(/art(?:igo)?\.?\s*\d+[ºo°]?/gi) || []).map((a) => a.replace(/\s+/g, " ")))];
  const lessons = (await store.listMemories({ scope: "global" })).filter((m) => m.source === "Lição da Conferência (Sede)").map((m) => m.title);
  console.log(`## parecer ${i} (${Math.round((Date.now() - started) / 1000)} s) passos: ${r.steps.map((s) => `${s.tool}${s.ok ? "" : "✗"}`).join(", ")}`);
  console.log(`   artigos no Word: ${arts.join(", ") || "nenhum"} | planalto: ${/planalto/i.test(text)} | aviso na resposta: ${/não foram confirmadas/.test(r.content)}`);
  console.log(`   lições na memória: ${lessons.join(" | ") || "nenhuma"}`);
}
server.close(); stopLlamaServer();
process.exit(0);
