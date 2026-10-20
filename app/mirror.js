// The synthetic mirror (docs/ESTUDO_PAGOS_SEM_VAZAR_2026-10-19.md): a copy of the project folder where each
// spreadsheet keeps its columns, types, formats and number of distinct values but every value is fake, and every
// other file is only listed. A paid model works on the mirror and writes a script; the Aurora runs that script
// here, on the real files. The map real -> fake also pseudonymizes the request and the conversation, so the
// paid model reads "Cliente 3" where the person wrote "Maria Souza".
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { xlsxSheets } from "./docText.js";
import { makeXlsx } from "./sampleDocs.js";

const TABLE_EXT = new Set([".csv", ".tsv", ".xlsx", ".xlsm"]);
// Code and configuration are copied with the marks applied (names, identifiers, values, keys): the teacher and
// the engine read a project's code the way it is, minus what identifies someone. Documents (.docx, .pdf, .txt,
// .md, .json data…) are only listed.
const CODE_EXT = new Set([".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html", ".htm", ".css", ".scss", ".sql", ".dax", ".m", ".pq", ".r", ".ps1", ".bat", ".cmd", ".sh", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".java", ".cs", ".c", ".cpp", ".h", ".go", ".rs", ".php", ".rb", ".kt", ".swift", ".vb", ".bas", ".ipynb"]);
const CODE_NAMES = new Set(["package.json", "tsconfig.json", "requirements.txt", "pyproject.toml", "dockerfile", "makefile"]);
const MAX_CODE_BYTES = 300 * 1024;
const SECRET = /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g;
const SKIP_DIRS = new Set(["node_modules", "__pycache__", ".git", ".venv", "venv"]);
export const MIRROR_SCRIPT = "aurora_tarefa.py";
export const MIRROR_MANIFEST = "AURORA_ESPELHO.md";

// Words that say nothing about the company: kept as they are, so "Janeiro" stays a month.
const MONTHS = ["janeiro", "fevereiro", "março", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro", "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const COMMON = new Set([...MONTHS, "segunda", "terça", "terca", "quarta", "quinta", "sexta", "sábado", "sabado", "domingo", "sim", "não", "nao", "s", "n", "true", "false", "verdadeiro", "falso", "total", "subtotal", "-", "—", "n/a", "na", "ok"]);

const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g;
const PHONE = /(?:\+55\s?)?\(?\b\d{2}\)?\s?9?\d{4}-\d{4}\b/g;
const MONEY = /R\$\s?-?\d{1,3}(?:\.\d{3})*(?:,\d{2})?|R\$\s?-?\d+(?:,\d{2})?/g;

/** How a cell value looks, to make a fake of the same shape. */
export function cellShape(value) {
  const s = String(value ?? "").trim();
  if (!s) return "empty";
  if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(s)) return "cpf";
  if (/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(s)) return "cnpj";
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(s)) return "email";
  if (/^(?:\+55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/.test(s)) return "phone";
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return "date-br";
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(s)) return "date-iso";
  if (/^R\$\s?-?[\d.]+(,\d+)?$/.test(s)) return "money";
  if (/^-?\d+(?:[.,]\d+)?%$/.test(s)) return "percent";
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) return "number-br";
  if (/^-?\d+(\.\d+)?$/.test(s)) return "number";
  if (COMMON.has(s.toLowerCase())) return "common";
  return s.length > 40 ? "text" : "category";
}

const parseNumber = (s) => {
  const t = String(s).replace(/^R\$\s?/, "").replace(/%$/, "").trim();
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /,/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t);
};
const decimalsOf = (s) => (String(s).match(/[.,](\d+)%?$/)?.[1]?.length ?? 0);
const brNumber = (n, decimals) => n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const pad = (n, size) => String(n).padStart(size, "0");

/**
 * A fake number written exactly like the real one: the same count of integer digits, the same thousands
 * separator and decimal places, the same sign. 20/10: every fake of a budget column had 7 digits
 * ("3.000.000"), so the engine's parser never met a "980.000" and read the real one as 980 (R$ 13.570.980
 * instead of 14.550.000). The leading digit is the row's step (1–9), never the real one.
 */
function fakeNumber(s, step, br) {
  const text = String(s).trim();
  const negative = text.startsWith("-");
  const body = text.replace(/^-/, "");
  const [intPart, decPart = ""] = br ? body.split(",") : body.split(".");
  const digits = intPart.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const decimals = decPart.replace(/\D/g, "").length;
  const value = digits === "0" ? step / 10 : step * 10 ** (digits.length - 1);
  const grouped = br && /\./.test(intPart);
  let out = br
    ? value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped })
    : decimals ? value.toFixed(decimals) : String(Math.round(value));
  if (digits === "0" && !decimals) out = "0";
  return negative ? `-${out}` : out;
}

/** The column's scale (a power of ten near its median), so fake numbers keep the axis but not the values. */
function columnScale(values) {
  const nums = values.map(parseNumber).filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b);
  if (!nums.length) return 1;
  const median = nums[Math.floor(nums.length / 2)];
  return median >= 1 ? 10 ** Math.floor(Math.log10(median)) : median > 0 ? 10 ** Math.floor(Math.log10(median)) : 1;
}

// Shapes whose real values identify someone or something of the company: these go in the map (the request is
// pseudonymized with it, the script gets the real ones back). Numbers and dates are not: in a request they are
// parameters ("acima de 1000", "em 2025"), and a fake would change the task.
const NAMED = new Set(["category", "text", "email", "cpf", "cnpj", "phone"]);

// A column whose values are the business's vocabulary, not someone: a status, a region, a category. Faking
// them hid nothing and confused the engine (20/10: "a conta mais atrasada" reached it as "a conta mais
// Situação 1"). Kept real only when the header says so, there are few distinct values and none looks like a
// name or carries digits; any other column (cliente, fornecedor, nome, an unknown header) stays fake.
const VOCAB_HEADER = /^(situa[çc][ãa]o|status|estado|uf|regi[ãa]o|categoria|subcategoria|tipo|classe|classifica[çc][ãa]o|segmento|setor|departamento|[áa]rea|canal|forma de pagamento|pagamento|prioridade|fase|etapa|modalidade|turno|m[êe]s|trimestre|semestre|dia da semana)$/i;
const NAME_LIKE = /\p{Lu}\p{Ll}+[ \t]+(?:(?:da|de|do|dos|das)[ \t]+)?\p{Lu}\p{Ll}/u;
export function isVocabulary(header, values) {
  if (!VOCAB_HEADER.test(String(header || "").trim().replace(/_/g, " "))) return false;
  const filled = values.map((v) => String(v ?? "").trim()).filter(Boolean);
  const distinct = new Set(filled.map((v) => v.toLowerCase()));
  return filled.length > 0 && distinct.size <= 20 && filled.every((v) => v.length <= 30 && !/\d|@/.test(v) && !NAME_LIKE.test(v));
}

/**
 * One fake per real value of a column: same shape, the same distinct count, a stable numbering. A value seen
 * in another column or file keeps the fake it got there, so the request and every file agree.
 */
function fakeColumn(header, values, ctx) {
  const { map, counters } = ctx;
  if (isVocabulary(header, values)) { (ctx.kept ||= new Set()).add(String(header).trim()); return values.map((v) => String(v ?? "").trim()); }
  const shapes = values.map(cellShape);
  const label = String(header || "Valor").trim().slice(0, 30) || "Valor";
  const distinct = new Map();
  return values.map((value, i) => {
    const s = String(value ?? "").trim();
    const shape = shapes[i];
    const n = i + 1;
    const step = 1 + (i % 9);
    let fake;
    switch (shape) {
      case "empty": return "";
      case "common": return s;
      case "cpf": fake = `000.000.${pad(Math.floor(n / 100) % 1000, 3)}-${pad(n % 100, 2)}`; break;
      case "cnpj": fake = `00.000.000/${pad(n % 10000, 4)}-00`; break;
      case "email": fake = `pessoa${n}@exemplo.com`; break;
      case "phone": fake = `(00) 0000-${pad(n % 10000, 4)}`; break;
      case "date-br": { const d = new Date(Date.UTC(2020, 0, 1 + i)); fake = `${pad(d.getUTCDate(), 2)}/${pad(d.getUTCMonth() + 1, 2)}/${s.split("/")[2].length === 2 ? pad(d.getUTCFullYear() % 100, 2) : d.getUTCFullYear()}`; break; }
      case "date-iso": { const d = new Date(Date.UTC(2020, 0, 1 + i)); fake = d.toISOString().slice(0, 10) + (s.length > 10 ? s.slice(10).replace(/\d/g, "0") : ""); break; }
      case "money": fake = `R$ ${fakeNumber(s.replace(/^R\$\s?/, ""), step, true)}`; break;
      case "percent": fake = `${String(step * 10)}%`; break;
      case "number-br": fake = fakeNumber(s, step, true); break;
      case "number": fake = fakeNumber(s, step, false); break;
      case "text": fake = `Texto de exemplo ${n} da coluna ${label}`; break;
      default: {
        // A category keeps how many distinct values there are (and which rows share one), not the names.
        const key = s.toLowerCase();
        if (!distinct.has(key)) {
          const known = map.get(s);
          if (known) distinct.set(key, known);
          else { const next = (counters.get(label) || 0) + 1; counters.set(label, next); distinct.set(key, `${label} ${next}`); }
        }
        fake = distinct.get(key);
      }
    }
    if (NAMED.has(shape) && s.length >= 2 && !map.has(s)) map.set(s, fake);
    return fake;
  });
}

/** Rows (header first) with every column made fake; at most `maxRows` data rows. */
export function fakeTable(rows, ctx = { map: new Map(), counters: new Map() }, { maxRows = 40 } = {}) {
  if (!rows.length) return { rows: [], realRows: 0 };
  const [header, ...data] = rows;
  const width = Math.max(header.length, ...data.map((r) => r.length));
  const kept = data.slice(0, maxRows);
  const columns = Array.from({ length: width }, (_, c) => fakeColumn(header[c], kept.map((r) => r[c] ?? ""), ctx));
  return { rows: [header.slice(), ...kept.map((_, r) => columns.map((col) => col[r]))], realRows: data.length };
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i += 1; row.push(cell); if (row.some((c) => c.trim())) rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}
const delimiterOf = (text, ext) => {
  if (ext === ".tsv") return "\t";
  const first = text.split(/\r?\n/, 1)[0];
  return [";", "\t", ","].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
};
const quoteCell = (v, d) => (/["\n\r]/.test(v) || v.includes(d) ? `"${v.replace(/"/g, '""')}"` : v);

function walk(dir, root, depth, out) {
  if (depth < 0 || out.length > 2000) return out;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, root, depth - 1, out);
    else if (e.isFile()) out.push(relative(root, p));
  }
  return out;
}

/**
 * The mirror of `workspace` in a new temp folder: { dir, map, files: [{ path, kind, realRows?, bytes }] } where
 * kind is "table" (a fake copy is there) or "listed" (only its name and size are, in AURORA_ESPELHO.md).
 */
export function buildMirror(workspace, { maxRows = 40, depth = 3, maxTableBytes = 40 * 1024 * 1024 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "aurora-espelho-"));
  const map = new Map();
  const ctx = { map, counters: new Map() };
  const code = new Map();
  const files = [];
  const all = walk(workspace, workspace, depth, []);
  const isCode = (rel) => CODE_EXT.has(extname(rel).toLowerCase()) || CODE_NAMES.has(rel.split(/[\\/]/).pop().toLowerCase());
  // Tables first: their values fill the map the code copies are then marked with.
  for (const rel of [...all.filter((r) => !isCode(r)), ...all.filter(isCode)]) {
    const ext = extname(rel).toLowerCase();
    const real = join(workspace, rel);
    let bytes = 0;
    try { bytes = statSync(real).size; } catch { continue; }
    if (isCode(rel) && bytes <= MAX_CODE_BYTES) {
      try {
        const target = join(dir, rel);
        mkdirSync(dirname(target), { recursive: true });
        const text = readFileSync(real, "utf8").replace(SECRET, (m) => markFor(m, "SEGREDO", map));
        const blinded = pseudonymize(text, map, { names: true }).text;
        writeFileSync(target, blinded, "utf8");
        code.set(rel, blinded);
        files.push({ path: rel, kind: "code", bytes });
      } catch { files.push({ path: rel, kind: "listed", bytes }); }
      continue;
    }
    if (!TABLE_EXT.has(ext) || bytes > maxTableBytes) { files.push({ path: rel, kind: "listed", bytes }); continue; }
    try {
      const target = join(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      if (ext === ".csv" || ext === ".tsv") {
        const raw = readFileSync(real);
        const text = raw.toString("utf8").replace(/^﻿/, "");
        const d = delimiterOf(text, ext);
        const table = fakeTable(parseDelimited(text, d), ctx, { maxRows });
        writeFileSync(target, (raw[0] === 0xef ? "﻿" : "") + table.rows.map((r) => r.map((v) => quoteCell(String(v), d)).join(d)).join("\n") + "\n", "utf8");
        files.push({ path: rel, kind: "table", realRows: table.realRows, bytes });
      } else {
        const sheets = {};
        let realRows = 0;
        for (const sheet of xlsxSheets(readFileSync(real))) {
          const table = fakeTable(sheet.rows, ctx, { maxRows });
          realRows += table.realRows;
          if (table.rows.length) sheets[sheet.name] = table.rows.map((row, r) => (r === 0 ? row : row.map((v) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v))));
        }
        if (!Object.keys(sheets).length) { files.push({ path: rel, kind: "listed", bytes }); continue; }
        writeFileSync(target.replace(/\.xlsm$/i, ".xlsx"), makeXlsx(sheets));
        files.push({ path: rel, kind: "table", realRows, bytes, ...(ext === ".xlsm" ? { note: "copiada como .xlsx (sem macros)" } : {}) });
      }
    } catch { files.push({ path: rel, kind: "listed", bytes }); }
  }
  writeFileSync(join(dir, MIRROR_MANIFEST), manifest(files, [...(ctx.kept || [])]), "utf8");
  return { dir, map, files, code };
}

function manifest(files, kept = []) {
  const tables = files.filter((f) => f.kind === "table");
  const listed = files.filter((f) => f.kind === "listed");
  return [
    "# Espelho da pasta do projeto",
    "",
    "Os valores destas planilhas são FALSOS: as colunas, os tipos e os formatos são os reais, os valores e os nomes não.",
    "O script que você escrever vai rodar na pasta real, com os mesmos nomes de arquivo.",
    kept.length ? `Colunas com os valores reais (vocabulário do negócio, sem dado de pessoa): ${kept.join(", ")}.` : "",
    "",
    tables.length ? "## Planilhas (cópia falsa aqui)" : "",
    ...tables.map((f) => `- ${f.path.replace(/\\/g, "/")}: ${f.realRows} linhas de dados na pasta real${f.note ? ` (${f.note})` : ""}`),
    "",
    files.some((f) => f.kind === "code") ? "## Código e configuração (cópia aqui, com nomes, identificadores e chaves trocados por marcas como [NOME 1])" : "",
    ...files.filter((f) => f.kind === "code").slice(0, 300).map((f) => `- ${f.path.replace(/\\/g, "/")}`),
    "",
    listed.length ? "## Outros arquivos (só existem na pasta real; conteúdo não enviado)" : "",
    ...listed.slice(0, 200).map((f) => `- ${f.path.replace(/\\/g, "/")} (${Math.max(1, Math.round(f.bytes / 1024))} KB)`),
  ].filter((l, i, a) => l || a[i - 1]).join("\n") + "\n";
}

// Capitalized words that are products, places or the calendar, not someone of the company.
const NOT_NAMES = new Set(["aurora", "claude", "codex", "gemini", "chatgpt", "openai", "excel", "word", "powerpoint", "power", "bi", "python", "windows", "google", "microsoft", "brasil", "são", "paulo", "rio", "janeiro", "pdf", "csv", "lgpd", "sql", "dax", "outlook", "teams", "telegram", "whatsapp", "pix", "ltda", "s.a.", "me", "eu", "ok", ...MONTHS, "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]);
// Two or more capitalized words in a row ("Maria Souza", "Acme Indústria"), with "da/de/do/dos/das" between
// ("e" is not: "Maria da Silva e Acme Ltda" are two names).
const NAME = /(?<![\p{L}\p{N}])\p{Lu}[\p{Ll}'’]+(?:[ \t]+(?:(?:da|de|do|dos|das)[ \t]+)?\p{Lu}[\p{Ll}'’]+)+(?![\p{L}\p{N}])/gu;

/** A reversible mark for `real` of kind `kind` ("[CPF 2]"), the same one every time, kept in the map. */
function markFor(real, kind, map) {
  if (map.has(real)) return map.get(real);
  const n = [...map.values()].filter((v) => v.startsWith(`[${kind} `)).length + 1;
  const mark = `[${kind} ${n}]`;
  map.set(real, mark);
  return mark;
}

/**
 * `text` with what identifies people and the company replaced: every real spreadsheet value the mirror faked
 * (longest first) and, anywhere, CPF, CNPJ, e-mail, phone and amounts in R$ — and, with `names`, sequences of
 * capitalized words. The marks are reversible ("[CPF 1]", "[NOME 2]"): they go into `map`, so a script the paid
 * model writes with them gets the real values back here (restoreScript) and its words too (unfake).
 */
export function pseudonymize(text, map = new Map(), { names = false } = {}) {
  let out = String(text ?? "");
  let hits = 0;
  const pairs = [...map].filter(([real]) => real.length >= 2 && !COMMON.has(real.toLowerCase())).sort((a, b) => b[0].length - a[0].length);
  for (const [real, fake] of pairs) {
    const escaped = real.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(pattern, () => { hits += 1; return fake; });
  }
  const marks = [[CPF, "CPF"], [CNPJ, "CNPJ"], [EMAIL, "E-MAIL"], [MONEY, "VALOR"], [PHONE, "TELEFONE"]];
  for (const [pattern, kind] of marks) out = out.replace(pattern, (m) => { hits += 1; return markFor(m, kind, map); });
  if (names) {
    out = out.replace(NAME, (m) => {
      const words = m.split(/\s+/).filter((w) => !/^(da|de|do|dos|das|e)$/.test(w));
      // A fake the map already put there ("Nome Cliente 3") is not a name to hide.
      if (words.every((w) => NOT_NAMES.has(w.toLowerCase())) || [...map.values()].some((v) => v.includes(m))) return m;
      hits += 1;
      return markFor(m, "NOME", map);
    });
  }
  return { text: out, hits };
}

/** The real values (from the map) still present in `text`: empty when nothing leaks. */
export function leaks(text, map) {
  const s = String(text ?? "");
  return [...map.keys()].filter((real) => real.length >= 3 && !COMMON.has(real.toLowerCase()) && new RegExp(`(?<![\\p{L}\\p{N}])${real.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(s));
}

/** The paid model's words with each fake it named ("regiao 1") back to the real value ("Sul"), shown only here. */
export function unfake(text, map) {
  let out = String(text ?? "");
  for (const [real, fake] of [...map].sort((a, b) => b[1].length - a[1].length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${fake.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu"), () => real);
  }
  return out;
}

/**
 * The script the paid model wrote on the mirror, ready to run on the real folder: each fake it used (a filter on
 * "Região 2") back to the real value ("Sul"), escaped for a Python string. Returns { code, restored }.
 */
export function restoreScript(code, map) {
  const reverse = [...map].map(([real, fake]) => [fake, real]).sort((a, b) => b[0].length - a[0].length);
  let out = String(code ?? "");
  let restored = 0;
  for (const [fake, real] of reverse) {
    const escaped = fake.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"), () => { restored += 1; return real.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'"); });
  }
  return { code: out, restored };
}

/**
 * What the paid model changed in the mirror's code: [{ path, content, isNew }] with the real values back
 * (plain, as the copy was made). Edited code files always; new ones only with `withNew` (a task that was
 * code, not a script). The script, its real copy, the manifest and the tables are never part of it.
 */
export function codeChanges(mirror, { withNew = true } = {}) {
  const out = [];
  const seen = new Set();
  const visit = (dir, depth) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0) visit(p, depth - 1); continue; }
      const rel = relative(mirror.dir, p);
      if (rel === MIRROR_SCRIPT || rel === MIRROR_MANIFEST || rel === `_real_${MIRROR_SCRIPT}` || TABLE_EXT.has(extname(rel).toLowerCase())) continue;
      const known = mirror.code.has(rel);
      if (!known && !(withNew && (CODE_EXT.has(extname(rel).toLowerCase()) || CODE_NAMES.has(e.name.toLowerCase())))) continue;
      let text;
      try { text = readFileSync(p, "utf8"); } catch { continue; }
      seen.add(rel);
      if (known && mirror.code.get(rel) === text) continue;
      out.push({ path: rel, content: unfake(text, mirror.map), isNew: !known });
    }
  };
  visit(mirror.dir, 4);
  return out;
}
