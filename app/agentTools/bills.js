// The person's bills, read at once: every boleto/conta/fatura in a folder → one table (conta, valor,
// vencimento), in due order, with the total and an optional due-date filter. A small model reading five
// PDFs one by one and comparing their dates in its head put the wrong ones in "as contas que vencem até
// dia 19" (ladder D06: the most common failure, 24/10); the comparison is code's job.
import { readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { extractText } from "../docText.js";
import { expandPath, namedFolder, resolveExisting } from "./files.js";
import { decodeBoleto, digitLines } from "../boletoLine.js";

const READABLE = new Set([".pdf", ".docx", ".txt", ".md", ".html", ".htm"]);
const STATEMENT = /extrato|movimenta/i;
const MAX_FILES = 80;
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const brl = (v) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad = (n) => String(n).padStart(2, "0");
const money = (s) => Number(String(s).replace(/\./g, "").replace(",", "."));

/** What a bill says: who, how much, when. Null when it is not a bill (no amount, or neither due date nor bill words). */
export function parseBill(text, file = "", now = Date.now()) {
  const t = String(text || "");
  const amount = t.match(/(?:valor(?:\s+(?:a\s+pagar|total|do\s+documento|cobrado))?|total\s+a\s+pagar|total)\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/i) || t.match(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/);
  const due = t.match(/venc\w*\s*(?:em|:)?\s*:?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i);
  // The digit line carries both, whatever the layout: what the printed text lacks comes from it.
  const line = digitLines(t).map((d) => decodeBoleto(d, now)).find(Boolean);
  if (!amount && !line?.value) return null;
  if (!due && !line?.due && !/boleto|fatura|conta de|vencimento/i.test(t + " " + file)) return null;
  const head = t.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l.length > 2) || basename(file);
  const year = due?.[3] ? (due[3].length === 2 ? 2000 + Number(due[3]) : Number(due[3])) : null;
  return { name: head.slice(0, 70), value: amount ? money(amount[1]) : line.value, due: due ? { day: Number(due[1]), month: Number(due[2]), year } : line?.due || null };
}

/** "12", "12/10", "12/10/2026", "2026-10-12" → a date (a bare day is in the bills' own month). */
export function parseDay(text, { month, year }) {
  const s = String(text || "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/(\d{1,2})(?:\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?)?/);
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
  return new Date(y, (m[2] ? Number(m[2]) : month) - 1, Number(m[1]));
}

/**
 * "Já paguei os boletos? Vê pelo extrato": each bill looked up in the statements of the folder (a line with
 * the company and a payment). The model listed the statement and never crossed it (ladder D10, 24/10).
 */
export function paidIn(bill, statements) {
  const key = fold(bill.name).split(/\s+-\s+|\s+/).filter((w) => w.length >= 3 && !/^(conta|boleto|fatura|de|da|do)$/.test(w)).slice(0, 2);
  if (!key.length) return null;
  for (const line of statements) {
    const l = fold(line);
    if (key.every((w) => l.includes(w)) && /pag|debito automatico|quitad/.test(l)) {
      const d = line.match(/(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?/);
      return d ? `${pad(Number(d[1]))}/${pad(Number(d[2]))}` : "sim";
    }
  }
  return null;
}

async function filesIn(dir, depth = 0, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (out.length >= MAX_FILES) break;
    const path = join(dir, e.name);
    if (e.isDirectory() && depth < 2 && !e.name.startsWith(".")) await filesIn(path, depth + 1, out);
    else if (e.isFile() && (READABLE.has(extname(e.name).toLowerCase()) || (STATEMENT.test(e.name) && /\.(csv|xlsx|tsv)$/i.test(e.name)))) out.push(path);
  }
  return out;
}

export const billTools = [
  {
    name: "bills_table",
    description: "Lê de uma vez TODAS as contas/boletos/faturas de uma pasta (PDF, Word, texto) e devolve uma tabela pronta: conta, valor, vencimento e arquivo, em ordem de vencimento, com o total, a que vence primeiro e a mais cara. Se houver um extrato na pasta, diz quais aparecem pagas nele e quais faltam (\"já paguei?\"). Use para \"quais contas eu tenho\", \"qual vence primeiro\", \"quanto dá tudo\", \"as contas que vencem até dia X\" — em vez de ler arquivo por arquivo e comparar datas de cabeça. Filtros opcionais: vence_ate e vence_depois (dia, dd/mm ou dd/mm/aaaa).",
    parameters: { type: "object", properties: { path: { type: "string", description: "A pasta (ex.: Downloads, Documentos/Contas)" }, vence_ate: { type: "string", description: "Só as que vencem até esta data (inclusive)" }, vence_depois: { type: "string", description: "Só as que vencem depois desta data" } }, required: ["path"] },
    stage: (a) => `Lendo as contas de ${a.path}…`,
    describe: (a, ctx) => ({ kind: "read", paths: [expandPath(a.path || ".", ctx.knownFolders, ctx.workspace)] }),
    async run({ path, vence_ate: until, vence_depois: after }, ctx) {
      const dir = await resolveExisting(namedFolder(path || ".", ctx), ctx, { directory: true });
      const bills = [], skipped = [], statements = [];
      for (const file of await filesIn(dir)) {
        const text = await extractText(file).catch(() => "");
        if (STATEMENT.test(basename(file))) { statements.push(...String(text).split(/\r?\n/)); continue; }
        const bill = parseBill(text, file, process.env.HARNESS_NOW ? new Date(process.env.HARNESS_NOW).getTime() : Date.now());
        if (bill) bills.push({ ...bill, file: relative(dir, file) || basename(file) });
        else if (/boleto|fatura|conta/i.test(basename(file))) skipped.push(basename(file));
      }
      if (!bills.length) return `Não achei contas (com valor) em ${dir}.${skipped.length ? ` Arquivos com nome de conta mas sem valor legível: ${skipped.join(", ")}.` : ""} Para outras pastas, chame de novo com o path delas.`;
      const now = new Date(process.env.HARNESS_NOW || Date.now());
      // A due date without a year is this year; a bare filter day is in the month most bills fall due.
      const months = bills.filter((b) => b.due).map((b) => b.due.month);
      const usual = months.sort((a, b) => months.filter((x) => x === b).length - months.filter((x) => x === a).length)[0] || now.getMonth() + 1;
      const when = (b) => (b.due ? new Date(b.due.year || now.getFullYear(), b.due.month - 1, b.due.day) : null);
      bills.sort((a, b) => (when(a)?.getTime() ?? Infinity) - (when(b)?.getTime() ?? Infinity));
      const base = { month: usual, year: now.getFullYear() };
      const untilDate = until ? parseDay(until, base) : null, afterDate = after ? parseDay(after, base) : null;
      const keep = (b) => { const d = when(b); if (!d) return !untilDate && !afterDate; return (!untilDate || d <= untilDate) && (!afterDate || d > afterDate); };
      const chosen = bills.filter(keep), left = bills.filter((b) => !keep(b));
      const date = (b) => (b.due ? `${pad(b.due.day)}/${pad(b.due.month)}${b.due.year ? `/${b.due.year}` : ""}` : "sem vencimento");
      const total = Math.round(chosen.reduce((a, b) => a + b.value, 0) * 100) / 100;
      const filterText = [untilDate && `até ${pad(untilDate.getDate())}/${pad(untilDate.getMonth() + 1)}`, afterDate && `depois de ${pad(afterDate.getDate())}/${pad(afterDate.getMonth() + 1)}`].filter(Boolean).join(" e ");
      const top = [...chosen].sort((a, b) => b.value - a.value)[0];
      // With a statement in the folder, whether each one shows up paid in it.
      const crossed = statements.length > 0;
      const paid = (b) => paidIn(b, statements);
      const open = chosen.filter((b) => !paid(b));
      return [
        `Contas em ${dir}${filterText ? ` que vencem ${filterText}` : ""}: ${chosen.length}${filterText ? ` de ${bills.length}` : ""}.`,
        "",
        crossed ? "| Conta | Valor | Vencimento | Situação no extrato | Arquivo |" : "| Conta | Valor | Vencimento | Arquivo |", crossed ? "|---|---|---|---|---|" : "|---|---|---|---|",
        ...chosen.map((b) => (crossed ? `| ${b.name} | ${brl(b.value)} | ${date(b)} | ${paid(b) ? `paga (${paid(b)})` : "NÃO aparece paga"} | ${b.file} |` : `| ${b.name} | ${brl(b.value)} | ${date(b)} | ${b.file} |`)),
        crossed ? `\nPelo extrato: ${open.length ? `faltam pagar ${open.length} — ${open.map((b) => `${b.name} (${brl(b.value)})`).join("; ")}` : "todas aparecem pagas"}.` : "",
        "",
        `Total: ${brl(total)}.${chosen[0]?.due ? ` Vence primeiro: ${chosen[0].name} (${date(chosen[0])}).` : ""}${top ? ` Mais cara: ${top.name} (${brl(top.value)}).` : ""}`,
        left.length ? `Fora do filtro — NÃO ponha estas na resposta nem no documento: ${left.map((b) => `${b.name} (${date(b)})`).join("; ")}.` : "",
        skipped.length ? `Com nome de conta mas sem valor legível: ${skipped.join(", ")}.` : "",
        "Use estes valores e datas exatamente como estão aqui.",
      ].filter((l, i, all) => l || all[i - 1]).join("\n").trim();
    },
  },
];
