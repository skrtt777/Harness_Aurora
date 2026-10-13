// Aurora as the VS Code extension uses her, with the code of this repository: a test Harness (temporary
// database, the teacher off, its own model server port) and the extension's own client
// (vscode/aurora/lib/client.js), asking for real coding work in a folder made for it. Commands she asks
// to run are allowed only when they are the usual ones inside that folder (node, npm, npx, python, java,
// javac, g++); anything else is denied. Prints what she did, the files, and checks them.
// node scripts/vscode-lab.mjs <pasta de teste> [--so 1,3]
import "./evalSandbox.mjs";
import { mkdtempSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createRequire } from "node:module";

const folder = process.argv[2];
if (!folder || !existsSync(folder)) { console.log("Use: node scripts/vscode-lab.mjs <pasta de teste>"); process.exit(2); }
const only = process.argv.includes("--so") ? process.argv[process.argv.indexOf("--so") + 1].split(",").map(Number) : null;
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-vscode-lab-")), "harness.db");
process.env.LLAMA_SERVER_PORT ||= "18191";
const store = await import("../app/store.js");
const { createServer } = await import("../app/server.js");
const { stopLlamaServer } = await import("../app/llamaServer.js");
await store.setSetting("teacher_mode", "off");
await store.setSetting("onboarding_completed", "true");
await store.setSetting("agent_mode", "auto");
const server = createServer({ allowDev: false }); await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { createClient } = createRequire(import.meta.url)("../vscode/aurora/lib/client.js");
const client = createClient({ base: `http://127.0.0.1:${server.address().port}`, pollMs: 1000 });

const SAFE = /^\s*(cd\s+[^&|;]+&&\s*)?(node|npm|npx|python|py|pip|java|javac|g\+\+|gcc|cmake|mvn|gradle)\b/i;
const asked = process.argv.includes("--ask") ? process.argv[process.argv.indexOf("--ask") + 1] : null;
const tasks = asked ? [{ n: 1, ask: asked }] : [
  { n: 1, ask: "crie um website usando three.js, c++,html, java e react, o site deve ser sobre video games, dete ter um menu interarivo, dinamico e responsivo. Crie tudo dentro da pasta site." },
  { n: 2, ask: "na pasta api, crie uma API REST em Node.js (sem dependências externas, só o módulo http) com cadastro de jogos: listar, criar, editar e apagar, guardando num arquivo JSON. Escreva testes com node:test e rode os testes." },
  { n: 3, ask: "na pasta python, crie um arquivo jogos.csv com 15 jogos (nome, gênero, ano, nota) e um script relatorio.py que lê o CSV e mostra a média de nota por gênero e o jogo mais bem avaliado. Rode o script e me mostre o resultado." },
  { n: 4, ask: "abra o que você fez na pasta site, confira se o index.html carrega sem erro (os scripts, o Three.js, o menu) e corrija o que estiver errado." },
];
const project = await client.projectFor(folder, "VS Code: teste");
const conversation = await client.newConversation({ projectId: project.id, title: "VS Code: teste" });
const files = () => { const out = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (f === "node_modules" || f.startsWith(".")) continue; if (statSync(p).isDirectory()) walk(p); else out.push(relative(folder, p)); } }; walk(folder); return out; };

for (const t of tasks) {
  if (only && !only.includes(t.n)) continue;
  const before = new Set(files()); const started = Date.now(); const answered = new Set();
  console.log(`\n## ${t.n}. ${t.ask.slice(0, 110)}`);
  let r;
  try {
    r = await client.send(conversation.id, t.ask, { onProgress: async (p) => {
      if (p.approval && !answered.has(p.approval.id)) {
        answered.add(p.approval.id);
        const detail = `${p.approval.summary} ${p.approval.detail || ""}`;
        const yes = p.approval.tool === "run_command" ? SAFE.test(String(p.approval.detail || p.approval.summary).replace(/^.*?:\s*/, "")) || SAFE.test(detail) : /\bsite_aurora_teste\b/i.test(detail);
        console.log(`  autorização ${yes ? "PERMITIDA" : "NEGADA"}: ${p.approval.tool} ${detail.slice(0, 160)}`);
        await client.approve(conversation.id, p.approval.id, yes).catch(() => {});
      }
    } });
  } catch (error) { console.log(`  ERRO: ${error.message}`); continue; }
  const made = files().filter((f) => !before.has(f));
  console.log(`  ${Math.round((Date.now() - started) / 1000)} s | passos: ${r.steps.map((s) => `${s.tool}${s.ok ? "" : "✗"}`).join(", ")}`);
  for (const s of r.steps.filter((x) => !x.ok)) console.log(`  falhou ${s.tool}: ${String(s.summary || "").slice(0, 200)}`);
  console.log(`  arquivos novos: ${made.join(", ") || "nenhum"}`);
  console.log(`  resposta: ${r.content.replace(/\s+/g, " ").slice(0, 700)}`);
}
server.close(); stopLlamaServer();
process.exit(0);
