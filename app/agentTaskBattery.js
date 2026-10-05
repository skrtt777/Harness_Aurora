import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { extractText } from "./docText.js";

/**
 * Agent tasks with a checkable delivery (docs/AGENTES_ROTEIRO.md, phase B), on the fictitious
 * company in F:\EmpresaIA. The expected answer is computed from the company's own sheets, so a
 * regenerated sample stays consistent. A run passes only on the FILE it delivers, not on what it says.
 */

export const COMPANY_ROOT = "F:/EmpresaIA";

/** Rows of a sheet as docText writes it ("a | b | c" under a header line). */
export function sheetRows(text) {
  // First sheet only: the receivables file also has a per-client summary sheet with other columns.
  const [, first = String(text)] = String(text).split(/^## .*$/m);
  const lines = first.split(/\r?\n/).filter((l) => l.includes(" | "));
  const header = lines.shift()?.split(" | ").map((s) => s.trim()) || [];
  return lines.map((l) => Object.fromEntries(l.split(" | ").map((v, i) => [header[i] || `c${i}`, v.trim()])));
}

const fold = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// Whole words only: "TI" must not match inside "estimativa".
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text, item) => new RegExp(`(^|[^a-z0-9])${escape(fold(item))}($|[^a-z0-9])`).test(fold(text));

export const AGENT_TASKS = [
  {
    id: "rh-ferias-outubro",
    department: "RH",
    request: "Gere uma planilha com os funcionários que começam as férias em outubro de 2026, com matrícula, nome, setor, início e fim.",
    format: [".xlsx", ".csv"],
    async truth(root) {
      const rows = sheetRows(await extractText(join(root, "RH/Férias/Controle de Férias 2026.xlsx")));
      const inOctober = (r) => /\/10\/2026$/.test(r["Início das férias"] || "");
      return { expected: rows.filter(inOctober).map((r) => r["Funcionário"]), excluded: rows.filter((r) => !inOctober(r)).map((r) => r["Funcionário"]) };
    },
  },
  {
    id: "fin-inadimplentes-30",
    department: "Financeiro",
    request: "Gere uma planilha com os títulos em atraso há mais de 30 dias (cliente, título, vencimento, valor e dias em atraso), para a cobrança.",
    format: [".xlsx", ".csv"],
    async truth(root) {
      const rows = sheetRows(await extractText(join(root, "Financeiro/Contas a Receber e Inadimplência - Set 2026.xlsx")));
      const late = (r) => Number(r["Dias em atraso (em 04/10/2026)"]) > 30;
      return { expected: rows.filter(late).map((r) => r["Título"]), excluded: rows.filter((r) => r["Título"] && !late(r)).map((r) => r["Título"]) };
    },
  },
  {
    id: "ctrl-desvios-5",
    department: "Controladoria",
    request: "Faça um relatório em Word com as áreas que gastaram mais de 5% acima do orçado até setembro de 2026, com o orçado, o realizado e o desvio em R$ e em %.",
    format: [".docx"],
    async truth(root) {
      const rows = sheetRows(await extractText(join(root, "Controladoria/Orçamento 2026 - Orçado x Realizado.xlsx"))).filter((r) => r["Área"] && r["Área"] !== "TOTAL" && /%$/.test(r["Desvio (%)"] || ""));
      const over = (r) => parseFloat(r["Desvio (%)"]) > 5;
      return { expected: rows.filter(over).map((r) => r["Área"]), excluded: rows.filter((r) => !over(r)).map((r) => r["Área"]) };
    },
  },
];

/** Scores one run: the delivered file must exist, have every expected item and none of the excluded. */
export async function scoreAgentTask(task, run, truth) {
  const files = (run.files || []).filter((f) => existsSync(f));
  const fits = (f) => task.format.some((ext) => f.toLowerCase().endsWith(ext));
  const delivered = files.find(fits) || files[0];
  const text = delivered ? await extractText(delivered).catch(() => "") : "";
  const missing = truth.expected.filter((item) => !mentions(text, item));
  // Someone with vacations in October and in another month is only expected.
  const extra = truth.excluded.filter((item) => !truth.expected.includes(item) && mentions(text, item));
  const checks = [
    { name: `entrega um arquivo ${task.format.join(" ou ")}`, ok: Boolean(delivered && fits(delivered)) },
    { name: `tem todos os ${truth.expected.length} itens certos`, ok: Boolean(delivered) && missing.length === 0 },
    { name: "não inclui itens que não se encaixam", ok: Boolean(delivered) && extra.length === 0 },
    { name: "a resposta diz onde está o arquivo", ok: Boolean(delivered) && mentions(run.answer, basename(delivered).replace(/\.[^.]+$/, "")) },
  ];
  return { checks, delivered: delivered || null, missing, extra };
}
