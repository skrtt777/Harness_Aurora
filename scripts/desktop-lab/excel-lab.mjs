// A ferramenta excel num Excel que a própria Aurora abre (pasta nova), nunca nas planilhas da pessoa.
// node scripts/desktop-lab/excel-lab.mjs
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { executeTool } = await import("../../app/agentTools/index.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");
const { excelRows } = await import("../../app/agentTools/desktop.js");
const dir = mkdtempSync(join(tmpdir(), "aurora-excel-"));
const ctx = { mode: "auto", request: "abre o excel", conversationId: "lab", workspace: dir, workspaceRoots: [dir], knownFolders: { documents: dir }, approve: async () => true, alwaysAllow: [] };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const rows = excelRows("| Produto | Quantidade | Preço | Total | Validade |\n|---|---|---|---|---|\n| Pão francês | 120 | R$ 0,75 | =B2*C2 | 12/10/2026 |\n| Bolo de cenoura | 8 | 32,50 | =B3*C3 | 15/10/2026 |\n| Total | | | =SOMA(D2:D3) | |");
check("lê a tabela em markdown com tipos", rows.length === 4 && rows[1][2] === 0.75 && rows[2][2] === 32.5 && rows[1][3].formula === "=B2*C2" && rows[1][4].date === "2026-10-12" && rows[3][3].local === true, JSON.stringify(rows[1]));
try {
  const opened = await executeTool("excel", { action: "open" }, ctx);
  check("abre o Excel com pasta nova e pede o próximo passo", opened.ok && /Abri o Excel/.test(opened.result) && /pergunte à pessoa/.test(opened.result), opened.result.split("\n")[0]);
  const wrote = await executeTool("excel", { action: "write", data: "| Produto | Quantidade | Preço | Total | Validade |\n|---|---|---|---|---|\n| Pão francês | 120 | R$ 0,75 | =B2*C2 | 12/10/2026 |\n| Bolo de cenoura | 8 | 32,50 | =B3*C3 | 15/10/2026 |\n| Total | | | =SOMA(D2:D3) | |" }, ctx);
  check("escreve e devolve a planilha", wrote.ok && /Escrevi 4 linha\(s\) em A1:E4/.test(wrote.result), wrote.result.split("\n")[0]);
  check("fórmulas calculadas (90 + 260 = 350)", /Pão francês \| 120 \| 0.75 \| 90/.test(wrote.result) && /Total \|  \|  \| 350/.test(wrote.result), (wrote.result.match(/Total \|[^\n]*/) || ["?"])[0]);
  check("pede confirmação à pessoa", /Quer ajustar\?/.test(wrote.result));
  const formatted = await executeTool("excel", { action: "format", formats: { C: "moeda", D: "moeda", E: "data" } }, ctx);
  check("formata como tabela com moeda e data", formatted.ok && /tabela/.test(formatted.result) && /coluna C como moeda/.test(formatted.result), formatted.result.split("\n")[0]);
  const saved = await executeTool("excel", { action: "save", path: "Documentos/estoque_teste.xlsx" }, ctx);
  check("salva o arquivo", saved.ok && existsSync(join(dir, "estoque_teste.xlsx")), saved.result);
  const plan = await executeTool("excel", { action: "save", path: "Documentos/x.xlsx" }, { ...ctx, mode: "plan" });
  check("modo Plano não salva", plan.denied === true);
} finally {
  console.log("fechamento:", JSON.stringify(await desktopRequest("excel_close")));
  stopDesktop();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
