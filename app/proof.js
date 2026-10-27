/**
 * O comprovante: every number the answer states, traced to where it came from — a cell of a sheet the
 * turn read (file, tab, C14), a line of a document, an exact calculation, a sum or count of a column
 * read, or the person's own message. No model takes part: the code reads the same tool results the model
 * read and decides, so a proof is the same every time it is computed and can be checked by hand.
 *
 * The idea is the one of "a frozen 4B model as a candidate generator under an external acceptance layer"
 * (arXiv 2609.30219): the small model writes, a deterministic layer says what is proven. Other harnesses
 * cite a file; this one points at the cell, and says plainly which numbers have no source.
 */

export const PROOF_VERSION = 1;

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const SCALE = { mil: 1e3, k: 1e3, milhao: 1e6, milhoes: 1e6, mi: 1e6, m: 1e6, bilhao: 1e9, bilhoes: 1e9, bi: 1e9, b: 1e9 };

/** One number as written in pt-BR or plain: "1.234,56", "4,7", "1234.5", "2.800.000", "-3,12". */
export function parseNumber(token) {
  const t = String(token).trim().replace(/^R\$\s*/i, "").replace(/%$/, "").replace(/\s/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^-?\d+,\d+$/.test(t)) return Number(t.replace(",", "."));
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ""));
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

const decimalsOf = (raw) => { const m = /[.,](\d{1,2})$/.exec(String(raw).replace(/%$/, "")); return m && !/\d{1,3}\.\d{3}$/.test(raw) ? m[1].length : 0; };
const dateValue = (raw) => { const m = DATE.exec(raw); return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null; };

// Money, a percentage, a date, or a number with a scale word ("38,19 milhões"); else a plain number.
// A number stands alone: not glued to letters ("Moto G84", "50MP", "25W", "9h"), not part of a time
// ("08:30"), a code or a version. The sign is read apart: "900-1100" is a range, not -1100.
const NUM = String.raw`\d[\d.,]*\d|\d`;
// A scale after the number: "38,19 milhões", "R$ 5,84 mi", "38,19M", "5k" (case matters: 50m is metres).
const SCALE_RE = String.raw`(?:\s?(?:M|mi|bi|k|K|B)|\s(?:mil|milh[õo]es|milh[ãa]o|bilh[õo]es|bilh[ãa]o))(?!\p{L})`;
const CLAIM = new RegExp(String.raw`R\$\s?(?:${NUM})(?:${SCALE_RE})?|(?<![\p{L}\d.,:/])(?:${NUM})\s?%|(?<![\p{L}\d/])\d{1,2}\/\d{1,2}\/\d{4}(?![\d/])|(?<![\p{L}\d.,:/])(?:${NUM})(?:${SCALE_RE}|(?![\p{L}\d/]|:\d|\s?%))`, "gu");
const MONTH_AFTER = /^\s+de\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i;

/**
 * The numbers an answer states, with their place in the text. Left out: numbers inside paths, file
 * names, links and code (`relatorio_2026.xlsx`, `C:\…`), a list's own numbering ("1." at a line start),
 * a year on its own (2026), and small plain numbers (0–9) that are words more than data ("os 3 mais
 * caros"), unless they are money or a percentage.
 */
export function claimsOf(text) {
  const s = String(text || "");
  const masked = s
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length))
    .replace(/\]\([^)]*\)/g, (m) => " ".repeat(m.length))
    .replace(/(?:[A-Za-z]:\\|\/|~\/)?[\w\-. ]*[\\/][\w\-. \\/]*\.\w{2,5}\b|[\w\-]+\.(?:xlsx|xlsm|csv|tsv|docx|pdf|pptx|txt|md|json|png|jpg)\b/gi, (m) => " ".repeat(m.length))
    .replace(/^(\s*)(\d{1,2})([.)]\s)/gm, (m, a, n, b) => a + " ".repeat(n.length) + b);
  const out = [];
  for (const m of masked.matchAll(CLAIM)) {
    const raw = s.slice(m.index, m.index + m[0].length);
    const money = /^R\$/i.test(raw), percent = /%$/.test(raw);
    const date = DATE.test(raw);
    const scaled = /(?:\s?(M|mi|bi|k|K|B)|\s(mil|milh[õo]es|milh[ãa]o|bilh[õo]es|bilh[ãa]o))$/u.exec(raw);
    const scaleWord = scaled ? scaled[1] || scaled[2] : null;
    const numberPart = (scaled ? raw.slice(0, scaled.index) : raw).replace(/^R\$\s?/i, "").replace(/\s?%$/, "").trim();
    let value = date ? dateValue(raw) : parseNumber(numberPart);
    if (value === null || !Number.isFinite(value)) continue;
    if (scaleWord) value *= SCALE[fold(scaleWord)] || 1;
    // "-R$ 50", "( -3,2%)": a minus right before, after a space or at the start (not "900-1100").
    if (!date && s[m.index - 1] === "-" && !/[\p{L}\d]/u.test(s[m.index - 2] || "")) value = -value;
    // "13 de outubro" is a day of a date written in words, not a quantity.
    if (!money && !percent && !date && value >= 1 && value <= 31 && MONTH_AFTER.test(s.slice(m.index + raw.length))) continue;
    // A bare year, or a small plain number, is not data the answer has to prove.
    if (!money && !percent && !date && !scaleWord && /^\d{4}$/.test(numberPart) && value >= 1900 && value <= 2100) continue;
    if (!money && !percent && !date && Math.abs(value) < 10 && !/[.,]/.test(numberPart)) continue;
    // A phone, a CPF, a ramal: numbers made of digits more than quantities still count as data.
    out.push({ raw, value, kind: money ? "dinheiro" : percent ? "percentual" : date ? "data" : "numero", start: m.index, end: m.index + raw.length, decimals: date ? 0 : decimalsOf(numberPart), scaled: Boolean(scaleWord) });
  }
  return out;
}

const columnLetter = (i) => { let n = i + 1, s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const baseName = (p) => String(p || "").split(/[\\/]/).pop();

/**
 * Every number a tool result shows, with where it is: a cell (file, tab, header, row, column letter and
 * the whole row, for the person to see it in place) or a line of text. Tables are the " | " lines the
 * file tools print; a "    14  " prefix is the line number of a read, and with it the sheet row.
 */
export function factsOf(source) {
  const { tool = "", args = {}, result = "" } = source;
  const host = (() => { try { return args.url ? new URL(String(args.url)).host : ""; } catch { return ""; } })();
  let file = args.path || args.file || args.from || host || (tool === "memory_search" ? "memória da Aurora" : args.query) || "";
  const facts = [];
  let sheet = null, sheetLine = null, header = null, inTable = false;
  for (const rawLine of String(result).split(/\r?\n/)) {
    const m = /^\s*(\d+) {2}(.*)$/.exec(rawLine);
    const lineNo = m ? Number(m[1]) : null;
    const line = m ? m[2] : rawLine;
    // knowledge_search: "2. Fonte: F:\Empresa\RH\Politica.pdf (rh, atualizado em …)" opens each excerpt.
    const fromDoc = /^\d+\.\s+Fonte:\s+(.+?)\s+\(/.exec(line);
    if (fromDoc) { file = fromDoc[1]; sheet = null; sheetLine = null; header = null; inTable = false; continue; }
    if (/^##\s/.test(line)) { sheet = line.replace(/^##\s*/, "").trim(); sheetLine = lineNo; header = null; inTable = false; continue; }
    if (line.includes(" | ")) {
      if (/^[\s|:-]+$/.test(line)) continue;
      const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split(" | ").map((c) => c.trim());
      // A table starts here: its first line is the header (numbers in a header are not data).
      if (!inTable) { header = cells; inTable = true; continue; }
      cells.forEach((cell, col) => {
        for (const c of claimsOf(cell.replace(/^\*+|\*+$/g, ""))) {
          // The sheet row, as Excel numbers it: the header is row 1 right under "## Aba" (or line 1 of a csv).
          const row = lineNo !== null ? (sheetLine !== null ? lineNo - sheetLine : lineNo) : null;
          facts.push({ value: c.value, raw: c.raw, kind: c.kind, tool, file, sheet, column: header[col] || columnLetter(col), cell: row !== null ? `${columnLetter(col)}${row}` : null, row: cells, header, lineNo, text: line });
        }
      });
      continue;
    }
    inTable = false;
    for (const c of claimsOf(line)) facts.push({ value: c.value, raw: c.raw, kind: c.kind, tool, file, sheet, lineNo, text: line.trim().slice(0, 240) });
  }
  return facts;
}

/** The columns of each table a tool result shows, for sums, counts and averages the answer may state. */
export function columnsOf(source) {
  const tables = [];
  let current = null;
  for (const rawLine of String(source.result || "").split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*\d+ {2}/, "");
    if (!line.includes(" | ") || /^[\s|:-]+$/.test(line)) { if (current) { tables.push(current); current = null; } continue; }
    const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split(" | ").map((c) => c.trim());
    if (!current) { current = { header: cells, rows: [] }; continue; }
    if (cells.some((c) => /^\**total\b/i.test(c))) continue;
    current.rows.push(cells);
  }
  if (current) tables.push(current);
  return tables.filter((t) => t.rows.length).map((t) => ({
    header: t.header, count: t.rows.length,
    columns: t.header.map((name, j) => {
      const values = t.rows.map((r) => parseNumber(String(r[j] || "").replace(/\*/g, ""))).filter((v) => v !== null);
      return values.length >= 2 && values.length >= t.rows.length * 0.6 ? { name, values } : null;
    }).filter(Boolean),
    // Each row's numbers, for "quantidade × preço" of one line (50 caixas × R$ 7,90 = R$ 395,00).
    rows: t.rows.slice(0, 200).map((r) => ({ label: r[0], nums: r.map((cell, j) => ({ name: t.header[j], raw: cell, v: parseNumber(String(cell).replace(/\*/g, "")) })).filter((n) => n.v !== null) })),
  }));
}

// Equal as written: the answer may round (R$ 1.234,56 → R$ 1.235, 38.190.000 → 38,19 milhões, 66,67% → 67%).
function matches(claim, value) {
  if (value === null || !Number.isFinite(value)) return false;
  if (claim.kind === "data") return claim.value === value;
  if (Math.abs(claim.value - value) < 1e-9) return true;
  const step = claim.scaled ? Math.pow(10, Math.floor(Math.log10(Math.abs(claim.value) || 1)) - 3) : Math.pow(10, -claim.decimals);
  return Math.abs(claim.value - value) <= step / 2 + 1e-9;
}

const pct = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * The proof of an answer. sources: [{ tool, args, result }] the turn read (ok results only); asked: the
 * person's own words this turn and before. Each claim gets one status:
 * - "fonte": the value is in a source (a cell or a line);
 * - "conta": an exact calculation the turn ran (calculate), or a sum/count/average of a column read, or
 *   a simple operation between two proven numbers (a − b, a ÷ b, the share in %);
 * - "pedido": the person said it;
 * - "sem-prova": none of the above.
 */
export function proveAnswer(answer, { sources = [], asked = [] } = {}) {
  const claims = claimsOf(answer);
  const usable = sources.filter((s) => s && s.result && !/^(memory_save|write_document|write_file|edit_file|move_file|make_folder)$/.test(s.tool || ""));
  if (!claims.length || !usable.length) return null;
  const facts = usable.flatMap(factsOf);
  const tables = usable.flatMap((s) => columnsOf(s).map((t) => ({ ...t, tool: s.tool, file: s.args?.path || "" })));
  const askedClaims = asked.flatMap((t) => claimsOf(t));
  const proven = [];
  const result = claims.map((claim) => {
    const base = { raw: claim.raw, start: claim.start, end: claim.end, kind: claim.kind };
    // 1. In a source, a cell first (a number in a table is the strongest place there is).
    const hits = facts.filter((f) => matches(claim, f.value)).sort((a, b) => Number(Boolean(b.cell)) - Number(Boolean(a.cell)) || Number(Boolean(b.header)) - Number(Boolean(a.header)));
    if (hits.length) {
      const f = hits[0];
      proven.push(claim);
      return { ...base, status: "fonte", source: { tool: f.tool, file: f.file, name: baseName(f.file), sheet: f.sheet || null, cell: f.cell || null, column: f.column || null, header: f.header || null, row: f.row || null, line: f.lineNo, text: f.text }, others: hits.length - 1 };
    }
    // The person's own numbers ("luz 230, água 90") are given, and a total may be built on them.
    if (askedClaims.some((a) => matches(claim, a.value))) { proven.push(claim); return { ...base, status: "pedido" }; }
    return { ...base, claim };
  });
  // 2. A sum, count or average of a column read; a total of the numbers written right before or after
  // it ("460 + 1.073 + 690 + 743 = 2.966"); an operation between two proven numbers. Again while
  // something new is proven: "R$ 73.350 abaixo da meta" needs the meta, proven after it.
  for (let pass = 0, changed = true; changed && pass < 4; pass += 1) {
  changed = false;
  for (const [index, r] of result.entries()) {
    if (!r.claim || r.status) continue;
    const claim = r.claim;
    let found = null;
    for (const t of tables) {
      if (claim.kind !== "percentual" && claim.kind !== "data" && matches(claim, t.count)) { found = { formula: `${t.count} linhas da tabela`, of: baseName(t.file) }; break; }
      for (const c of t.columns) {
        const sum = c.values.reduce((a, v) => a + v, 0);
        if (matches(claim, sum)) { found = { formula: `soma de ${c.name} (${c.values.length} linhas)`, of: baseName(t.file) }; break; }
        if (matches(claim, sum / c.values.length)) { found = { formula: `média de ${c.name} (${c.values.length} linhas)`, of: baseName(t.file) }; break; }
      }
      if (found) break;
      for (const row of t.rows) {
        for (let x = 0; x < row.nums.length && !found; x += 1) for (let y = x + 1; y < row.nums.length; y += 1) {
          if (matches(claim, row.nums[x].v * row.nums[y].v)) { found = { formula: `${row.nums[x].raw} × ${row.nums[y].raw} (${row.label}: ${row.nums[x].name} × ${row.nums[y].name})`, of: baseName(t.file) }; break; }
        }
        if (found) break;
      }
      if (found) break;
    }
    if (!found && claim.kind !== "data") {
      const isGiven = (x) => x && x.status && x.status !== "sem-prova" && x.kind !== "data";
      for (const dir of [-1, 1]) {
        let sum = 0;
        const terms = [];
        for (let j = index + dir, n = 0; j >= 0 && j < result.length && n < 12; j += dir, n += 1) {
          if (!isGiven(result[j])) break;
          sum += claims[j].value;
          terms.push(result[j].raw);
          if (terms.length >= 3 && matches(claim, sum)) { found = { formula: `${(dir < 0 ? terms.reverse() : terms).join(" + ")} = ${pct(sum)}` }; break; }
        }
        if (found) break;
      }
    }
    if (!found && proven.length >= 2 && proven.length <= 20) {
      const values = proven.filter((p) => p.kind !== "data");
      search: for (const a of values) for (const b of values) {
        if (a === b) continue;
        const ops = [[a.value + b.value, `${a.raw} + ${b.raw}`], [a.value - b.value, `${a.raw} − ${b.raw}`], [a.value * b.value, `${a.raw} × ${b.raw}`]];
        if (b.value) ops.push([a.value / b.value, `${a.raw} ÷ ${b.raw}`], [(100 * a.value) / b.value, `${a.raw} ÷ ${b.raw} × 100`], [(100 * (a.value - b.value)) / b.value, `(${a.raw} − ${b.raw}) ÷ ${b.raw} × 100`]);
        // "3% de desconto sobre R$ 993" → R$ 963,21; "10% de R$ 500" → R$ 50.
        if (b.kind === "percentual") ops.push([(a.value * b.value) / 100, `${b.raw} de ${a.raw}`], [a.value * (1 - b.value / 100), `${a.raw} − ${b.raw}`], [a.value * (1 + b.value / 100), `${a.raw} + ${b.raw}`]);
        for (const [v, formula] of ops) if (matches(claim, v)) { found = { formula: `${formula} = ${claim.kind === "percentual" ? `${pct(v)}%` : pct(v)}` }; break search; }
      }
    }
    if (found) { r.status = "conta"; r.formula = found.formula; if (found.of) r.of = found.of; proven.push(claim); changed = true; }
  }
  }
  for (const r of result) {
    if (!r.status) r.status = "sem-prova";
    delete r.claim;
  }
  const counted = result.filter((r) => r.status !== "pedido");
  const ok = counted.filter((r) => r.status === "fonte" || r.status === "conta").length;
  if (!counted.length) return null;
  return {
    version: PROOF_VERSION,
    claims: result,
    proven: ok,
    total: counted.length,
    seal: ok === counted.length ? "comprovado" : ok ? "parcial" : "sem-prova",
    // The files that proved something (not every search of the turn).
    sources: [...new Set(result.map((r) => r.source?.name || r.of).filter(Boolean))].slice(0, 12),
  };
}

/**
 * The proof in one line, for a channel with no hover (WhatsApp, Telegram): "✓ Comprovado: 6 de 6
 * números, de Vendas.xlsx" or "⚠ Sem fonte: R$ 5.062,50 (confira antes de usar)".
 */
export function proofSummary(proof) {
  if (!proof?.total) return "";
  const from = proof.sources.length ? `, de ${proof.sources.slice(0, 2).join(" e ")}${proof.sources.length > 2 ? "…" : ""}` : "";
  if (proof.seal === "comprovado") return `✓ Comprovado: ${proof.proven} de ${proof.total} número${proof.total === 1 ? "" : "s"}${from}.`;
  const missing = [...new Set(proof.claims.filter((c) => c.status === "sem-prova").map((c) => c.raw))];
  return `⚠ Sem fonte: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""} (confira antes de usar). ${proof.proven} de ${proof.total} com prova${from}.`;
}
