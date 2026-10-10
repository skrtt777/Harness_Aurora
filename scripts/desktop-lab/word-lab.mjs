// A ferramenta word num Word que a própria Aurora abre (documento novo), nunca nos documentos da pessoa.
// node scripts/desktop-lab/word-lab.mjs
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { executeTool } = await import("../../app/agentTools/index.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");
const { wordBlocks } = await import("../../app/agentTools/desktop.js");
const words = () => (execSync("tasklist", { encoding: "utf8" }).match(/WINWORD/gi) || []).length;
if (words()) { console.log("O Word já está aberto: feche-o antes do teste (o teste não mexe num documento da pessoa)."); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), "aurora-word-"));
const ctx = { mode: "auto", request: "abre o word", conversationId: "lab", workspace: dir, workspaceRoots: [dir], knownFolders: { documents: dir }, approve: async () => true, alwaysAllow: [] };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const text = "# Proposta comercial\n\nPrezado cliente, segue a proposta para **reforma da cozinha**.\n\n## Itens\n\n- Bancada de granito\n- Armários planejados\n\n| Item | Valor |\n|---|---|\n| Bancada | R$ 2.400,00 |\n| Armários | R$ 6.800,00 |\n\n1. Prazo: 30 dias\n2. Validade: 15 dias";
const blocks = wordBlocks(text);
check("lê o markdown em blocos", blocks.map((b) => b.t).join(",") === "h1,p,h2,li,li,table,ol,ol" && blocks[5].rows.length === 3, blocks.map((b) => b.t).join(","));
try {
  const refused = await executeTool("word", { action: "open" }, { ...ctx, request: "crie um documento com a proposta" });
  check("sem pedir o Word, aponta write_document", !refused.ok && /write_document/.test(refused.result || refused.error || ""));
  const opened = await executeTool("word", { action: "open" }, ctx);
  check("abre o Word com documento novo e pede o próximo passo", opened.ok && /Abri o Word/.test(opened.result) && /pergunte à pessoa/.test(opened.result), String(opened.result || opened.error).split("\n")[0]);
  const wrote = await executeTool("word", { action: "write", text }, ctx);
  check("escreve e pede confirmação", wrote.ok && /Escrevi 7 parágrafo\(s\) e 1 tabela/.test(wrote.result) && /Quer ajustar\?/.test(wrote.result), String(wrote.result || wrote.error).split("\n")[0]);
  const look = await executeTool("word", { action: "look" }, { ...ctx, request: "como ficou?" });
  check("o documento tem título, lista e tabela", look.ok && /^# Proposta comercial$/m.test(look.result) && /## Itens/.test(look.result) && /Bancada de granito/.test(look.result) && look.result.includes("| Armários | R$ 6.800,00 |") && look.result.includes("1 tabela"), String(look.result || look.error).slice(0, 300).replace(/\n/g, " ⏎ "));
  const saved = await executeTool("word", { action: "save", path: "Documentos/proposta_teste.docx" }, ctx);
  check("salva o .docx", saved.ok && existsSync(join(dir, "proposta_teste.docx")), saved.result || saved.error);
  const pdf = await executeTool("word", { action: "save", path: "Documentos/proposta_teste.pdf" }, ctx);
  check("salva em PDF", pdf.ok && existsSync(join(dir, "proposta_teste.pdf")), pdf.result || pdf.error);
  const plan = await executeTool("word", { action: "save", path: "Documentos/x.docx" }, { ...ctx, mode: "plan" });
  check("modo Plano não salva", plan.denied === true);
} finally {
  console.log("fechamento:", JSON.stringify(await desktopRequest("word_close")));
  stopDesktop();
}
await new Promise((r) => setTimeout(r, 2000));
check("o Word da Aurora fechou", words() === 0);
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
