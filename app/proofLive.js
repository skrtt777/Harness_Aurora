/**
 * A resposta viva: an answer the comprovante proved (app/proof.js) knows the cell each number came from,
 * so when the sheet changes after the answer, the answer can be checked again — no model, the same code.
 * "O total de outubro que te passei (R$ 286.650,00) agora é R$ 291.000,00: Vendas.xlsx › Outubro › D4
 * mudou." Other assistants cite a file once; here the citation keeps watching it.
 *
 * Only files that changed after the answer are read again (their modified time is later than the
 * answer), so checking a whole conversation costs a stat per file when nothing changed.
 * Each proven number ends as:
 * - "confere": still what the file says (or the file did not change);
 * - "mudou": the same row and column (or the same line of a document) now says another number — `now`;
 * - "sumiu": the row, the line or the file is not there any more;
 * - "mantido": its source is not a file (a web page, the memory, a calculation the turn ran): not rechecked.
 */
import { claimsOf, columnsOf, factsOf, matches, parseNumber } from "./proof.js";

export const LIVE_VERSION = 1;
// A file the answer can be checked against again: a full path, or a document's name (not a site's host).
const FILE_PATH = /^([A-Za-z]:[\\/]|\/)|\.(xlsx|xlsm|csv|tsv|docx|pdf|pptx|rtf|txt|md|json)$/i;
const baseName = (p) => String(p || "").split(/[\\/]/).pop();
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const words = (s) => norm(String(s || "").replace(/[Rr]\$\s?/g, "").replace(/[\d.,]+\s?%?/g, " "));
const isText = (cell) => !/\d/.test(cell) && String(cell).trim() !== "";

/** A number written like the one it replaces: "R$ 291.000,00", "64,5%", "1.204". */
export function formatLike(claim, value) {
  const decimals = Math.min(claim.decimals ?? 0, 2);
  const n = Number(value).toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (claim.kind === "dinheiro") return `R$ ${n}`;
  if (claim.kind === "percentual") return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: Math.max(decimals, 1) })}%`;
  return n;
}

/**
 * Where an old cell is in the sheet read again: the same tab, the row with the same first cell (the name,
 * the code — rows move when one is inserted above) and, among equals, the most words in common; then the
 * same column. Returns the facts of that cell, or why it is not there.
 */
export function locateCell(source, facts) {
  // The column by its name; a read that started inside a table (an excerpt, an offset) has a row of data
  // for a header and a letter for the column: then by position, in rows as long as the old one.
  const oldAt = source.header.indexOf(source.column) >= 0 ? source.header.indexOf(source.column) : /^[A-Z]{1,2}$/.test(source.column || "") ? [...source.column].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : -1;
  // A header of words is a real one; "1081 | … | 30 | Em gozo" is a row a read started at.
  const realHeader = (h) => h.every((cell) => !/^[\d.,/%\s-]+$/.test(cell) || !cell.trim());
  // The name only when the file has a column called so ("eira" from "…Feira" cut by an excerpt does not).
  const named = realHeader(source.header) && !/^[A-Z]{1,2}$/.test(source.column || "") && facts.some((f) => f.header && realHeader(f.header) && f.header.includes(source.column));
  const columnOf = (f) => (named && realHeader(f.header) ? f.header.indexOf(source.column) : f.row.length === source.row.length ? oldAt : -1);
  const usable = facts.filter((f) => f.row && f.header && columnOf(f) >= 0);
  const inSheet = source.sheet && usable.some((f) => f.sheet === source.sheet) ? usable.filter((f) => f.sheet === source.sheet) : usable;
  const rows = new Map();
  for (const f of inSheet) {
    const key = `${f.sheet}|${f.header.join("|")}|${f.lineNo}|${f.row.join("|")}`;
    if (!rows.has(key)) rows.set(key, { row: f.row, at: columnOf(f), facts: [] });
    rows.get(key).facts.push(f);
  }
  const label = norm(source.row[0]);
  const old = source.row.map(norm);
  let best = null;
  for (const r of rows.values()) {
    const same = norm(r.row[0]) === label;
    // Rows with the same name (a client's many bills): the one with the most cells still equal.
    const equal = r.row.map(norm).filter((cell, j) => cell === old[j]).length;
    if (!same && equal < Math.ceil(old.length * 0.67)) continue;
    const score = (same ? 100 : 0) + equal + (r.facts.some((f) => f.cell === source.cell) ? 0.5 : 0);
    if (!best || score > best.score) best = { ...r, score };
  }
  if (!best || oldAt < 0) return { why: `a linha de ${source.row[0]} não está mais${source.sheet ? ` na aba ${source.sheet}` : ""}` };
  // A number inside words ("Duplicata 2132", "CC-500"): the cell's text is what is compared.
  const before = source.row[oldAt] ?? "";
  if (/\p{L}/u.test(before.replace(/^[Rr]\$/, "")) && norm(best.row[best.at]) === norm(before)) return { same: true };
  const cellName = (f) => f.header[best.at];
  const inColumn = best.facts.filter((f) => f.column === cellName(f) || f.column === source.column);
  if (!inColumn.length) return { why: `a coluna ${source.column} de ${source.row[0]} ficou sem número` };
  return { facts: inColumn };
}

// What a tool writes around what it read (a note, the sum of the rows shown, the count of a filter): only
// a read run again has it, and one from an earlier answer is not run again.
const TOOL_NOTE = /^(\(|Soma das \d+ linhas|\d+ linha\(s\)|Contas prontas)/;

/** Where an old line of a document is now: the same words around the numbers. */
export function locateLine(source, claim, facts) {
  const text = String(source.text || "");
  const oldWords = words(text);
  const lines = new Map();
  for (const f of facts) if (!f.row && words(f.text) === oldWords) { if (!lines.has(f.lineNo)) lines.set(f.lineNo, []); lines.get(f.lineNo).push(f); }
  for (const lineFacts of lines.values()) {
    if (lineFacts.some((f) => matches(claim, f.value))) return { facts: lineFacts.filter((f) => matches(claim, f.value)) };
  }
  const first = [...lines.values()][0];
  if (first) {
    // The same place in the line: the old number's position among the numbers it had.
    const at = claimsOf(text).findIndex((c) => matches(claim, c.value));
    return { facts: [first[Math.max(0, Math.min(at, first.length - 1))]] };
  }
  // The line was rewritten: still fine if the number is anywhere in the file.
  const anywhere = facts.filter((f) => matches(claim, f.value));
  if (anywhere.length) return { facts: anywhere };
  // A note the search wrote around an excerpt ("(Planilha: isto é só um trecho…)") is not in the file.
  return TOOL_NOTE.test(text.trim()) ? { note: true } : { why: "o trecho não está mais no arquivo" };
}

// The calculations app/proof.js writes, evaluated again with today's numbers.
const OPS = { "+": [1, (a, b) => a + b], "−": [1, (a, b) => a - b], "×": [2, (a, b) => a * b], "÷": [2, (a, b) => a / b], de: [2, (a, b) => (a / 100) * b] };

/** "R$ 360.000,00 − R$ 286.650,00", "3% de R$ 993", "(a − b) ÷ b × 100": the value, with `value(raw)` for each operand. */
export function evaluateFormula(formula, value) {
  const left = String(formula).split(" = ")[0];
  const tokens = left.split(/(\s[+−×÷]\s|\sde\s|\(|\))/).map((t) => t.trim()).filter(Boolean);
  const out = [], ops = [];
  const apply = () => {
    const op = ops.pop(), b = out.pop(), a = out.pop();
    if (!a || !b) throw new Error("conta incompleta");
    // A percentage added to or taken from an amount is a change of it ("R$ 993 − 3%").
    if ((op === "+" || op === "−") && b.percent && !a.percent) out.push({ v: a.v * (1 + (op === "+" ? 1 : -1) * (b.v / 100)) });
    else out.push({ v: OPS[op][1](a.v, b.v) });
  };
  for (const t of tokens) {
    if (t === "(") ops.push(t);
    else if (t === ")") { while (ops.length && ops.at(-1) !== "(") apply(); ops.pop(); }
    else if (OPS[t]) { while (ops.length && ops.at(-1) !== "(" && OPS[ops.at(-1)][0] >= OPS[t][0]) apply(); ops.push(t); }
    else {
      const v = value(t);
      if (v === null || !Number.isFinite(v)) throw new Error(`não li ${t}`);
      out.push({ v, percent: /%$/.test(t) });
    }
  }
  while (ops.length) apply();
  if (out.length !== 1) throw new Error("conta incompleta");
  return out[0].v;
}

const operandValue = (raw) => claimsOf(raw)[0]?.value ?? parseNumber(raw);

/**
 * The recheck of one answer. message: { content, execution: { proof, toolSteps }, createdAt }.
 * io (the file system, so tests and the server give their own):
 * - stat(path) → { path, mtimeMs } of the file as the answer named it, or null when it is gone;
 * - readWhole(path) → the file as read_file prints it (numbered lines, "## Aba", " | " cells);
 * - replay(step, path) → the result of that read_file call (with its filter) run again on `path`.
 */
export async function recheckAnswer(message, io, { now = new Date() } = {}) {
  const proof = message?.execution?.proof;
  if (!proof?.claims?.length) return null;
  const created = Date.parse(message.createdAt || "") || 0;
  const reads = (message.execution.toolSteps || []).filter((s) => s.ok && s.tool === "read_file" && s.args?.path);
  const files = new Map();
  const fileOf = async (name) => {
    if (!name || !FILE_PATH.test(name)) return null;
    const key = norm(name);
    if (!files.has(key)) {
      const st = await io.stat(name).catch(() => null);
      files.set(key, { name: baseName(name), asked: name, path: st?.path || name, missing: !st, changed: Boolean(st && st.mtimeMs > created + 1000), modifiedAt: st ? new Date(st.mtimeMs).toISOString() : null });
    }
    return files.get(key);
  };
  // A calculation's file is named by its base name ("de Vendas.xlsx"): the path the turn read.
  const byBase = (name) => reads.find((s) => baseName(s.args.path).toLowerCase() === String(name).toLowerCase())?.args.path
    || proof.claims.find((c) => c.source?.file && baseName(c.source.file).toLowerCase() === String(name).toLowerCase())?.source.file || null;
  const fresh = new Map();
  const freshFacts = async (file) => {
    if (!fresh.has(file.path)) {
      const result = await io.readWhole(file.path).catch(() => null);
      if (result === null) { fresh.set(file.path, null); return null; }
      // The whole file, and the turn's own reads of it run again: what read_file adds to a read (the
      // sums of the rows shown, the totals per client, "16 linha(s) com …") is only in those.
      const sources = [{ tool: "read_file", args: { path: file.path }, result }];
      for (const step of reads.filter((s) => baseName(s.args.path).toLowerCase() === file.name.toLowerCase())) {
        const again = await io.replay(step, file.path).catch(() => null);
        if (again) sources.push({ tool: "read_file", args: { path: file.path }, result: again });
      }
      fresh.set(file.path, { facts: sources.flatMap(factsOf), tables: columnsOf(sources[0]) });
    }
    return fresh.get(file.path);
  };

  const out = [];
  const newValue = new Map();
  // 1. Each number that came from a file: the same cell or line, read again.
  for (const [i, c] of proof.claims.entries()) {
    if (c.status === "pedido") continue;
    const claim = { ...(claimsOf(c.raw)[0] || { value: parseNumber(c.raw), decimals: 0 }), kind: c.kind };
    const r = { i, raw: c.raw, kind: c.kind, claim };
    out.push(r);
    // A number with no proof stays so: there is nothing to check it against.
    if (c.status === "sem-prova") { r.status = "sem-prova"; continue; }
    if (c.status !== "fonte") continue;
    const file = await fileOf(c.source?.file);
    if (!file) { r.status = "mantido"; continue; }
    r.file = file.name;
    if (file.missing) { r.status = "sumiu"; r.why = `o arquivo não está mais em ${file.asked}`; continue; }
    if (!file.changed) { r.status = "confere"; continue; }
    const read = await freshFacts(file);
    if (!read) { r.status = "sumiu"; r.why = `não consegui ler ${file.name} de novo`; continue; }
    const found = c.source.row && c.source.header && c.source.column ? locateCell(c.source, read.facts) : locateLine(c.source, claim, read.facts);
    if (found.same) { r.status = "confere"; continue; }
    if (found.note) { r.status = "mantido"; continue; }
    if (!found.facts) { r.status = "sumiu"; r.why = found.why; continue; }
    const same = found.facts.find((f) => matches(claim, f.value));
    const f = same || found.facts[0];
    r.where = [f.sheet, f.cell || (f.lineNo ? `linha ${f.lineNo}` : "")].filter(Boolean).join(" › ");
    if (same) { r.status = "confere"; continue; }
    r.status = "mudou";
    r.now = r.claim.kind === "data" ? f.raw : formatLike(r.claim, f.value);
    newValue.set(c.raw, f.value);
  }
  // 2. The calculations. First the ones over a file: a column's sum, count or average with the turn's own
  // filter run again, a row's quantity × price. Then the operations between numbers of the answer, again
  // until nothing changes ("R$ 73.350 abaixo da meta" needs both the new total and the new meta).
  const gone = new Set(out.filter((r) => r.status === "sumiu").map((r) => r.raw));
  const settle = (r, formula, value, why) => {
    if (value === null) { r.status = why ? "sumiu" : "mantido"; if (why) { r.why = why; gone.add(r.raw); } return; }
    if (matches(r.claim, value)) { r.status = "confere"; delete r.now; newValue.delete(r.raw); return; }
    r.status = "mudou";
    r.now = formatLike(r.claim, value);
    r.formula = formula.split(" = ")[0];
    newValue.set(r.raw, value);
  };
  const operations = [];
  for (const r of out) {
    const c = proof.claims[r.i];
    if (c.status !== "conta") continue;
    const formula = String(c.formula || "");
    const column = /^(soma|média) de (.+) \((\d+) linhas\)$/.exec(formula);
    const count = /^(\d+) linhas da tabela$/.exec(formula);
    const product = /^(.+?) × (.+?) \((.+): (.+) × (.+)\)$/.exec(formula);
    if (!column && !count && !product) { operations.push(r); continue; }
    const file = await fileOf(c.read?.path || (c.of ? byBase(c.of) : null));
    if (!file) { r.status = "mantido"; continue; }
    r.file = file.name;
    if (file.missing) { settle(r, formula, null, `o arquivo não está mais em ${file.asked}`); continue; }
    if (!file.changed) { r.status = "confere"; continue; }
    let value = null;
    if (product) {
      const read = await freshFacts(file);
      const row = read?.tables.flatMap((t) => t.rows).find((x) => norm(x.label) === norm(product[3]));
      const a = row?.nums.find((n) => n.name === product[4]), b = row?.nums.find((n) => n.name === product[5]);
      if (a && b) value = a.v * b.v;
      settle(r, formula, value, `a linha de ${product[3]} não está mais`);
      continue;
    }
    // The turn's reads of that file, run again as they were (the same filter, the same order). A read can
    // show more than one table (the rows, the totals per client): the one that still gives the number
    // first, so a changed answer is one no table backs any more.
    const candidates = [];
    // The read it came from when the comprovante kept it (since v2); before, every read of the file.
    for (const step of c.read ? [{ tool: "read_file", ok: true, args: c.read }] : reads.filter((s) => baseName(s.args.path).toLowerCase() === file.name.toLowerCase())) {
      const result = await io.replay(step, file.path).catch(() => null);
      for (const t of result ? columnsOf({ result }) : []) {
        if (count) { candidates.push(t.count); continue; }
        const col = t.columns.find((x) => x.name === column[2]);
        if (col) { const sum = col.values.reduce((a, v) => a + v, 0); candidates.push(column[1] === "soma" ? sum : sum / col.values.length); }
      }
    }
    // An answer from before the comprovante kept its read (v1): a sum no table gives may have come from
    // another read (the conversation's earlier ones) — not told as changed.
    if (candidates.length) value = candidates.find((v) => matches(r.claim, v)) ?? (c.read ? candidates[0] : null);
    if (value === null && !c.read && candidates.length) { r.status = "mantido"; continue; }
    settle(r, formula, value, column ? `a coluna ${column[2]} não está mais em ${file.name}` : `a tabela não está mais em ${file.name}`);
  }
  for (let pass = 0, moved = true; moved && pass < 6; pass += 1) {
    moved = false;
    for (const r of operations) {
      const formula = String(proof.claims[r.i].formula || "");
      const left = formula.split(" = ")[0];
      const before = `${r.status}|${r.now}`;
      if ([...gone].some((raw) => left.includes(raw))) settle(r, formula, null, "a conta usa um número que não está mais no arquivo");
      else if ([...newValue.keys()].some((raw) => raw !== r.raw && left.includes(raw))) {
        let value = null;
        try { value = evaluateFormula(formula, (t) => (newValue.has(t) ? newValue.get(t) : operandValue(t))); } catch { /* left as it was */ }
        if (value === null) r.status = "mantido"; else settle(r, formula, value, null);
      } else r.status = "confere";
      if (`${r.status}|${r.now}` !== before) moved = true;
    }
  }
  const claims = out.map(({ claim, ...r }) => ({ ...r, status: r.status || "mantido" }));
  const changed = claims.filter((r) => r.status === "mudou" || r.status === "sumiu").length;
  const list = [...files.values()];
  return {
    version: LIVE_VERSION,
    checkedAt: now.toISOString(),
    verdict: changed ? "mudou" : "vale",
    changed,
    checked: claims.filter((r) => r.status !== "mantido" && r.status !== "sem-prova").length,
    files: list.map(({ asked, ...f }) => f),
    claims,
  };
}

/** The recheck in one line, for a list or a channel: "2 números mudaram desde a resposta: R$ 101.250,00 → R$ 104.800,00…". */
export function recheckSummary(live) {
  if (!live) return "";
  if (live.verdict === "vale") return `✓ Ainda vale: ${live.checked} número${live.checked === 1 ? "" : "s"} conferido${live.checked === 1 ? "" : "s"} de novo${live.files.some((f) => f.changed) ? " (o arquivo mudou, estes números não)" : ""}.`;
  const items = live.claims.filter((r) => r.status === "mudou" || r.status === "sumiu").map((r) => (r.status === "mudou" ? `${r.raw} → ${r.now}` : `${r.raw} (${r.why})`));
  return `⚠ ${live.changed === 1 ? "1 número mudou" : `${live.changed} números mudaram`} desde a resposta: ${items.slice(0, 4).join("; ")}${items.length > 4 ? "…" : ""}.`;
}

/**
 * The file system for recheckAnswer, as the chat reads it: a path relative to the project folder, a sheet
 * printed as read_file prints it (the same extraction, the same restricted columns), a read replayed with
 * its own arguments on the exact file (never a look-alike).
 */
export async function liveIo({ workspace = "", request = "", env = process.env, roots: companyRoots = null } = {}) {
  const { stat, readFile } = await import("node:fs/promises");
  const { extname, isAbsolute, join } = await import("node:path");
  const { extractText } = await import("./docText.js");
  const files = await import("./agentTools/files.js");
  // The path as read_file resolves it: "Desktop/x.docx" is the real Desktop, a bare name the project folder.
  const known = await (await import("./agentTools/index.js")).knownFolders().catch(() => ({}));
  const resolve = (p) => { try { return files.expandPath(p, known, workspace || undefined); } catch { return isAbsolute(p) ? p : join(workspace || "", p); } };
  // A company document named by its name only ("Pedidos de Compra em Aberto.xlsx"): the file with exactly
  // that name in the company folders.
  let roots = companyRoots;
  const inCompany = async (name) => {
    roots ??= await (await import("./knowledge.js")).listSources().then((list) => list.map((s) => s.path)).catch(() => []);
    const hits = roots.length ? await files.findFilesByName(name, roots, { limit: 5 }).catch(() => []) : [];
    return hits.find((h) => baseName(h).toLowerCase() === String(name).toLowerCase()) || null;
  };
  return {
    async stat(p) {
      let path = resolve(p);
      let info = await stat(path).catch(() => null);
      if (!info?.isFile() && !/[\\/]/.test(p)) { const found = await inCompany(p); if (found) { path = found; info = await stat(found).catch(() => null); } }
      return info?.isFile() ? { path, mtimeMs: info.mtimeMs } : null;
    },
    async readWhole(path) {
      const ext = extname(path).toLowerCase();
      if ((await stat(path)).size > 20_000_000) throw new Error("grande demais");
      let lines;
      if (ext === ".csv" || ext === ".tsv") lines = files.csvTable(await readFile(path, "utf8"), baseName(path));
      else if ([".docx", ".xlsx", ".xlsm", ".pptx", ".pdf", ".rtf"].includes(ext)) lines = (await extractText(path)).split(/\r?\n/);
      else lines = (await readFile(path, "utf8")).split(/\r?\n/);
      if (/\.(xlsx|xlsm)$/.test(ext)) lines = files.redactRestricted(lines, request, env);
      return lines.slice(0, 20000).map((l, i) => `${String(i + 1).padStart(5)}  ${l}`).join("\n");
    },
    async replay(step, path) {
      const tool = files.fileTools.find((t) => t.name === "read_file");
      return String(await tool.run({ ...step.args, path }, { workspace, request, env, knownFolders: known, knowledgeRoots: [] }));
    },
  };
}
