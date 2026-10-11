// A ferramenta powerpoint numa apresentação que a própria Aurora abre, nunca nas da pessoa.
// node scripts/desktop-lab/ppt-lab.mjs
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { executeTool } = await import("../../app/agentTools/index.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");
const { pptSlides } = await import("../../app/agentTools/desktop.js");
const running = () => (execSync("tasklist", { encoding: "utf8" }).match(/POWERPNT/gi) || []).length;
if (running()) { console.log("O PowerPoint já está aberto: feche-o antes do teste."); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), "aurora-ppt-"));
const ctx = { mode: "auto", request: "abre o powerpoint", conversationId: "lab", workspace: dir, workspaceRoots: [dir], knownFolders: { documents: dir }, approve: async () => true, alwaysAllow: [] };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const text = "# Resultados do 3º trimestre\nPadaria Pão Dourado\n\n# Destaques\n- Vendas cresceram 18%\n- Novo produto: pão de fermentação natural\n- Nota fiscal eletrônica em todas as lojas\nNotas: começar pelos números\n\n# Vendas por mês\n[gráfico de colunas]\n| Mês | Vendas |\n|---|---|\n| Julho | 42.000 |\n| Agosto | 45.500 |\n| Setembro | 49.800 |\n\n# Metas\n| Meta | Prazo |\n|---|---|\n| Abrir loja 3 | Março |\n| Delivery próprio | Maio |";
const slides = pptSlides(text);
check("lê os slides em markdown", slides.map((s) => s.kind).join(",") === "title,bullets,chart,table" && slides[1].notes === "começar pelos números" && slides[1].bullets.length === 3 && slides[2].chart === "coluna", JSON.stringify(slides.map((s) => s.kind)));
try {
  const refused = await executeTool("powerpoint", { action: "open" }, { ...ctx, request: "crie uma apresentação sobre vendas" });
  check("sem pedir o PowerPoint, aponta write_document", !refused.ok && /write_document/.test(refused.result || refused.error || ""));
  const opened = await executeTool("powerpoint", { action: "open" }, ctx);
  check("abre o PowerPoint e pergunta o tema", opened.ok && /Abri o PowerPoint/.test(opened.result) && /pergunte à pessoa/.test(opened.result), String(opened.result || opened.error).split("\n")[0]);
  const wrote = await executeTool("powerpoint", { action: "write", text }, ctx);
  check("monta 4 slides e pede confirmação", wrote.ok && /Criei 4 slide/.test(wrote.result) && /Quer ajustar\?/.test(wrote.result), String(wrote.result || wrote.error).split("\n")[0]);
  const look = String(wrote.result || "");
  check("capa, tópicos, gráfico e tabela", /1\. Resultados do 3º trimestre \| Padaria Pão Dourado/.test(look) && /Vendas cresceram 18%/.test(look) && /\[gráfico\]/.test(look) && /\[tabela 3x2\]/.test(look), look.split("\n").slice(2, 7).join(" ⏎ "));
  const saved = await executeTool("powerpoint", { action: "save", path: "Documentos/resultados_teste.pptx" }, ctx);
  check("salva o .pptx", saved.ok && existsSync(join(dir, "resultados_teste.pptx")), saved.result || saved.error);
  const pdf = await executeTool("powerpoint", { action: "save", path: "Documentos/resultados_teste.pdf" }, ctx);
  console.log("pdf:", join(dir, "resultados_teste.pdf"));
  check("salva em PDF", pdf.ok && existsSync(join(dir, "resultados_teste.pdf")) && statSync(join(dir, "resultados_teste.pdf")).size > 10000, pdf.result || pdf.error);
  const plan = await executeTool("powerpoint", { action: "save", path: "Documentos/x.pptx" }, { ...ctx, mode: "plan" });
  check("modo Plano não salva", plan.denied === true);
} finally {
  console.log("fechamento:", JSON.stringify(await desktopRequest("ppt_close")));
  stopDesktop();
}
await new Promise((r) => setTimeout(r, 2500));
check("o PowerPoint da Aurora fechou", running() === 0);
check("nenhum Excel sobrou do gráfico", !/EXCEL/i.test(execSync("tasklist", { encoding: "utf8" })));
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
