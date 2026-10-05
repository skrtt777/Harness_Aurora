import { existsSync, statSync } from "node:fs";
import { mkdir, open, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { IMAGE_EXTENSIONS, extractText } from "../docText.js";
import { DOCUMENT_FORMATS, renderDocument } from "../documentWriter.js";

// Binary office formats are read as their text; everything else as UTF-8.
const EXTRACTED = new Set([".docx", ".xlsx", ".pptx", ".pdf", ".rtf", ...IMAGE_EXTENSIONS]);

// Under MAX_TOOL_RESULT (4500, agentTools/index.js): a longer read lost its own "continue com
// offset" line to that cut, and the model re-read the same lines until the repeat guard stopped it.
const READ_CHUNK = 4200;
const MAX_WALK = 20000;

const foldText = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Rows of a sheet (as docText writes it: "## Planilha", then "a | b | c" lines) that match
 * "Coluna=texto", or lines containing a text. A small model reading 120 rows page by page
 * stops at the first page ("ninguém entra de férias em outubro"); a filter gives it the
 * header, only the rows that count and the total.
 */
// "Dias em atraso>30", "Início das férias>=01/10/2026": the comparison is done here, because a
// small model reading the rows put 10-day-late bills in a "more than 30 days" list (04/10/2026).
const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
export function cellValue(text) {
  const s = String(text ?? "").trim().replace(/^R\$\s*/i, "");
  const date = s.match(DATE);
  if (date) return Date.UTC(Number(date[3]), Number(date[2]) - 1, Number(date[1]));
  // "1.234,56", "8,07%", "69062.05", "-3.12%"
  const plain = s.replace(/%$/, "");
  const number = /,\d+$/.test(plain) ? plain.replace(/\./g, "").replace(",", ".") : plain;
  return /^-?\d+(\.\d+)?$/.test(number) ? Number(number) : null;
}
const COMPARE = { ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b };

// Columns that hold codes, not quantities: never summed.
const ID_COLUMN = /matr[ií]cula|c[óo]digo|^n[º°o.]|n[uú]mero|chamado|pedido|t[ií]tulo|documento|cpf|cnpj|^ano$|^id$|telefone|ramal|cep/i;
const brNumber = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(n) ? 0 : 2 });

/**
 * One sheet's rows as read_file shows them: sorted if asked ("Término", "-Valor"), then the
 * totals of the numeric columns. "Qual vence primeiro?" and "quanto falta pagar?" were answered
 * wrong by a model sorting and adding in its head (05/10/2026).
 */
function sheetBlock(s, hits, sort) {
  let rows = hits;
  const columnOf = (name) => { const exact = s.header?.cells.findIndex((c) => c === name) ?? -1; return exact >= 0 ? exact : s.header?.cells.findIndex((c) => c.includes(name)) ?? -1; };
  if (sort?.col) {
    const at = columnOf(sort.col);
    if (at >= 0) {
      const key = (line) => { const cell = line.split(" | ")[at] ?? ""; const v = cellValue(cell); return v === null ? foldText(cell) : v; };
      rows = [...hits].sort((a, b) => { const x = key(a.line), y = key(b.line); const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR"); return sort.desc ? -order : order; });
    }
  }
  const header = s.header?.line.split(" | ") || [];
  const totals = rows.length >= 2 ? header.map((name, j) => {
    if (ID_COLUMN.test(name.trim())) return null;
    const cells = rows.map(({ line }) => (line.split(" | ")[j] ?? "").trim()).filter(Boolean);
    if (!cells.length || cells.some((c) => DATE.test(c) || cellValue(c) === null)) return null;
    return `${name.trim()} = ${brNumber(cells.reduce((sum, c) => sum + cellValue(c), 0))}`;
  }).filter(Boolean) : [];
  return [
    ...[s.name, s.header?.line].filter(Boolean),
    ...rows.map(({ line, i }) => `${String(i + 1).padStart(5)}  ${line}`),
    ...(totals.length ? [`Soma das ${rows.length} linhas acima: ${totals.join("; ")}`] : []),
    "",
  ];
}

/** "Término" (crescente) or "-Valor" (decrescente). */
export function parseSort(sort) {
  const text = String(sort || "").trim().replace(/["“”']/g, "");
  if (!text) return null;
  const desc = /^-|\b(desc|decrescente|maior)\b/i.test(text);
  return { col: foldText(text.replace(/^[-+]\s*/, "").replace(/\s*\b(asc|desc|crescente|decrescente)\b\s*$/i, "")), desc };
}

export function filterRows(lines, filter, { sort } = {}) {
  sort = typeof sort === "string" ? parseSort(sort) : sort;
  // Sorting (or adding up) the whole sheet: every row of every sheet.
  if (!String(filter || "").trim()) {
    const sheets = parseSheets(lines).filter((s) => s.header && s.rows.length);
    if (!sheets.length) return "Nenhuma tabela neste arquivo.";
    return `${sheets.flatMap((s) => sheetBlock(s, s.rows, sort)).join("\n")}\n${sheets.reduce((n, s) => n + s.rows.length, 0)} linha(s)${sort ? `, em ordem de ${sort.col}${sort.desc ? " (decrescente)" : ""}` : ""}.`;
  }
  // The model copies the example literally: "Coluna=Dias em atraso>30", "\"Dias em atraso\">30".
  filter = String(filter).split(/\s*;\s*/).map((c) => c.replace(/^\s*coluna\s*[=:>]\s*(?=\S+.*[=<>])/i, "").replace(/["“”']/g, "").trim()).join("; ");
  // Several conditions: "Dias em atraso>30; Situação=Em atraso" (all must hold).
  const parts = String(filter).split(/\s*;\s*/).filter(Boolean);
  if (parts.length > 1) return filterAll(lines, parts, filter, sort);
  const [, colPart, op, valuePart] = filter.match(/^([^=<>!]{1,60}?)\s*(>=|<=|!=|>|<|=)\s*(.+)$/) || [];
  if (op && op !== "=") return filterAll(lines, [filter], filter, sort);
  // "entrega até 15/10" written as "Entrega prevista=15/10/2026" brought only the 15th.
  // A plain reminder was ignored 5 times out of 5; the counts make the difference visible.
  const count = (f) => Number(/(\d+) linha\(s\)/.exec(filterAll(lines, [f], f))?.[1] || 0);
  const dateNote = op === "=" && DATE.test(String(valuePart).trim())
    ? `\n(ATENÇÃO: isto é só o dia ${valuePart.trim()}. "Até" essa data (${colPart.trim()}<=${valuePart.trim()}) dá ${count(`${colPart}<=${valuePart}`)} linha(s); "a partir de" (>=) dá ${count(`${colPart}>=${valuePart}`)}. Se o pedido é "até" ou "a partir de", leia de novo com o operador certo.)`
    : "";
  const wanted = foldText(valuePart ?? filter);
  const column = colPart ? foldText(colPart) : null;
  const sheets = [];
  let sheet = { name: "", header: null, rows: [] };
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) { sheets.push(sheet = { name: line, header: null, rows: [] }); return; }
    if (!line.trim()) return;
    if (!sheet.header && line.includes(" | ")) { sheet.header = { line, i, cells: line.split(" | ").map(foldText) }; return; }
    sheet.rows.push({ line, i });
  });
  if (!sheets.includes(sheet)) sheets.unshift(sheet);
  const anyColumn = column && sheets.some((s) => s.header?.cells.some((c) => c.includes(column)));
  const out = [];
  let total = 0;
  for (const s of sheets) {
    const at = anyColumn ? (s.header?.cells.findIndex((c) => c === column) ?? -1) : -1;
    const index = anyColumn ? (at >= 0 ? at : s.header?.cells.findIndex((c) => c.includes(column)) ?? -1) : -1;
    if (anyColumn && index < 0) continue;
    const hits = s.rows.filter(({ line }) => (index >= 0 ? foldText(line.split(" | ")[index] ?? "").includes(wanted) : foldText(line).includes(wanted)));
    if (!hits.length) continue;
    total += hits.length;
    out.push(...sheetBlock(s, hits, sort));
  }
  const columns = [...new Set(sheets.flatMap((s) => s.header?.line.split(" | ") || []))].join(", ");
  if (!total) return `Nenhuma linha com "${filter}".${columns ? ` Colunas: ${columns}.` : ""}${dateNote}`;
  return `${out.join("\n")}\n${total} linha(s) com "${filter}"${column && !anyColumn ? ` (coluna "${colPart}" não existe; procurei o texto na linha inteira)` : ""}.${dateNote}`;
}
function parseSheets(lines) {
  const sheets = [];
  let sheet = { name: "", header: null, rows: [] };
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) { sheets.push(sheet = { name: line, header: null, rows: [] }); return; }
    if (!line.trim()) return;
    if (!sheet.header && line.includes(" | ")) { sheet.header = { line, i, cells: line.split(" | ").map(foldText) }; return; }
    sheet.rows.push({ line, i });
  });
  if (!sheets.includes(sheet)) sheets.unshift(sheet);
  return sheets;
}

/** Every condition must hold; each names its column ("Coluna>30", "Coluna=texto"). */
function filterAll(lines, conditions, label, sort = null) {
  const parsed = conditions.map((c) => {
    const [, col, op, value] = c.match(/^([^=<>!]{1,60}?)\s*(>=|<=|!=|>|<|=)\s*(.+)$/) || [];
    return col ? { col: foldText(col), op, text: foldText(value), number: cellValue(value.trim()), raw: c } : null;
  });
  const sheets = parseSheets(lines);
  const headerCells = sheets.flatMap((s) => s.header?.cells || []);
  const columns = [...new Set(sheets.flatMap((s) => s.header?.line.split(" | ") || []))].join(", ");
  // "Saldo<Estoque mínimo": the other side is a column of the same row.
  for (const p of parsed) if (p && COMPARE[p.op] && p.number === null && headerCells.some((c) => c === p.text || c.includes(p.text))) p.otherCol = p.text;
  const bad = parsed.find((p) => !p || (COMPARE[p.op] && p.number === null && !p.otherCol));
  if (bad !== undefined) return `Condição inválida: "${bad?.raw || conditions[parsed.indexOf(bad)]}". Use Coluna>número, Coluna>=dd/mm/aaaa, Coluna<OutraColuna, Coluna=texto ou Coluna!=texto, separadas por ";".${columns ? ` Colunas: ${columns}.` : ""}`;
  const out = [];
  let total = 0;
  let found = false;
  for (const s of sheets) {
    const columnOf = (name) => { const exact = s.header?.cells.findIndex((c) => c === name) ?? -1; return exact >= 0 ? exact : s.header?.cells.findIndex((c) => c.includes(name)) ?? -1; };
    const indexes = parsed.map((p) => columnOf(p.col));
    const others = parsed.map((p) => (p.otherCol ? columnOf(p.otherCol) : null));
    if (indexes.some((i) => i < 0) || others.some((i) => i !== null && i < 0)) continue;
    found = true;
    const hits = s.rows.filter(({ line }) => {
      const cells = line.split(" | ");
      return parsed.every((p, k) => {
        const cell = cells[indexes[k]] ?? "";
        if (p.op === "=") return foldText(cell).includes(p.text);
        if (p.op === "!=") return !foldText(cell).includes(p.text);
        const value = cellValue(cell);
        const against = others[k] !== null ? cellValue(cells[others[k]] ?? "") : p.number;
        return value !== null && against !== null && COMPARE[p.op](value, against);
      });
    });
    if (!hits.length) continue;
    total += hits.length;
    out.push(...sheetBlock(s, hits, sort));
  }
  if (!found) return `Nenhuma planilha tem as colunas de "${label}".${columns ? ` Colunas: ${columns}.` : ""}`;
  if (!total) return `Nenhuma linha com "${label}".`;
  return `${out.join("\n")}\n${total} linha(s) com "${label}".`;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".cache", "$recycle.bin", "appdata"]);

export function expandPath(input, knownFolders = {}, base) {
  let text = String(input || "").trim().replace(/^["'`]+|["'`,;]+$/g, "");
  if (!text) throw new Error("Informe o caminho.");
  if (text === "~" || text.startsWith("~/") || text.startsWith("~\\")) text = join(homedir(), text.slice(1));
  // Windows (%USERPROFILE%) and PowerShell ($env:USERPROFILE, $HOME) variables,
  // and the doubled backslashes small models copy from JSON (UNC prefix kept).
  text = text.replace(/%([A-Z_]+)%/gi, (m, name) => process.env[name] ?? m)
    .replace(/\$env:([A-Z_][A-Z0-9_]*)/gi, (m, name) => process.env[name] ?? process.env[name.toUpperCase()] ?? m)
    .replace(/^\$HOME(?=$|[\\/])/i, homedir());
  text = text.replace(/^(\\\\)?/, "$1").replace(/(?!^)\\{2,}/g, "\\").replace(/\/{2,}/g, "/");
  if (!isAbsolute(text)) {
    // "Desktop/notas.txt", "área de trabalho\\x" → the real known folder;
    // anything else is relative to the project folder (or the Desktop).
    const [head, ...rest] = text.split(/[\\/]/);
    // With a project folder, relative is relative to it (as the agent is told): organizing a folder
    // into "Documentos/" sent the files to the user's Documents. The user's folders go by full path.
    const alias = base ? null : { desktop: "desktop", "área de trabalho": "desktop", "area de trabalho": "desktop", documents: "documents", documentos: "documents", downloads: "downloads" }[head.toLowerCase()];
    // "planilha-1/x.csv" inside the folder planilha-1 means the folder itself: a small model
    // repeats the project's name, and the file landed in planilha-1\planilha-1 (unless that exists).
    if (base && rest.length && head.toLowerCase() === basename(base).toLowerCase() && !existsSync(join(base, head))) text = rest.join("/");
    text = alias && knownFolders[alias] ? join(knownFolders[alias], ...rest) : join(base || knownFolders.desktop || homedir(), text);
  }
  return resolve(text);
}

// Resolves symlinks/junctions through the nearest existing ancestor, so a
// link inside an allowed folder can't be used to reach outside it.
async function realish(path) {
  let current = path;
  const tail = [];
  for (;;) {
    try { return join(await realpath(current), ...tail.reverse()); }
    catch {
      const parent = dirname(current);
      if (parent === current) return path;
      tail.push(current.slice(parent.length).replace(/^[\\/]/, ""));
      current = parent;
    }
  }
}

export async function isInsideRoots(path, roots = []) {
  const real = await realish(path);
  for (const root of roots) {
    const realRoot = await realish(resolve(root));
    const rel = relative(realRoot.toLowerCase(), real.toLowerCase());
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes(".."))) return true;
  }
  return false;
}

const full = (path, ctx) => expandPath(path, ctx.knownFolders, ctx.workspace);
/**
 * `before` matched line by line ignoring leading (and trailing) spaces; only a unique match counts.
 * `after` is re-indented by the difference between the file's indentation and the model's.
 */
export function looseReplace(text, before, after) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const raw = before.replace(/\r\n/g, "\n").split("\n");
  while (raw.length && !raw[0].trim()) raw.shift();
  while (raw.length && !raw.at(-1).trim()) raw.pop();
  const want = raw.map((l) => l.trim());
  if (!want.length) return null;
  const hits = [];
  for (let i = 0; i + want.length <= lines.length; i += 1) if (want.every((w, k) => lines[i + k].trim() === w)) hits.push(i);
  if (hits.length !== 1) return null;
  const at = hits[0];
  const indent = (s) => s.match(/^\s*/)[0].length;
  // The difference shows on the first indented line (a top-level first line has 0 on both sides).
  const k = Math.max(0, raw.findIndex((l, j) => indent(l) > 0 || indent(lines[at + j]) > 0));
  const delta = indent(lines[at + k]) - indent(raw[k]);
  const fixed = after.replace(/\r\n/g, "\n").split("\n").map((l) => (!l.trim() ? l : delta >= 0 ? " ".repeat(delta) + l : l.replace(new RegExp(`^ {0,${-delta}}`), "")));
  return [...lines.slice(0, at), ...fixed, ...lines.slice(at + want.length)].join(eol);
}

// "to" may be a folder (ends with a slash, or an existing folder): the file keeps its name there.
function moveTarget({ from, to }, ctx) {
  const target = full(to, ctx);
  // "relatorio.pdf" → "...\Documentos" (no slash, folder not created yet) renamed the PDF to a
  // file called "Documentos". A target with no extension, for a source that has one, is a folder.
  const looksLikeFolder = !existsSync(target) && !extname(target) && Boolean(extname(String(from)));
  const isFolder = /[\\/]$/.test(String(to)) || looksLikeFolder || (existsSync(target) && statSafe(target)?.isDirectory());
  return isFolder ? join(target, basename(String(from))) : target;
}
function statSafe(path) { try { return statSync(path); } catch { return null; } }

// Documents write_document created while the app runs: those (only those) may be replaced.
const OWN_DOCUMENTS = new Set();
// The format wins over a missing or wrong extension ("proposta" + docx → proposta.docx).
function documentPath(args, ctx) {
  // Small models name the field after other tools ("file_path", "filename").
  const path = args.path || args.file_path || args.filePath || args.filename || args.file || args.name;
  const format = args.format;
  // "planilha-1/contratos.xlsx" inside the folder planilha-1 meant the folder itself,
  // not a new planilha-1\planilha-1 (a small model repeats the project's name).
  if (ctx.workspace && !isAbsolute(String(path || ""))) {
    const [head, ...rest] = String(path).split(/[\\/]/);
    if (rest.length && head.toLowerCase() === basename(ctx.workspace).toLowerCase() && !existsSync(join(ctx.workspace, head))) return documentPath({ ...args, path: rest.join("/"), file_path: undefined, filePath: undefined, filename: undefined, file: undefined, name: undefined }, ctx);
  }
  if (!String(path || "").trim()) throw new Error('Falta "path": informe o caminho com o nome do arquivo (ex.: C:\\Users\\voce\\Documents\\proposta_atualizada.docx) e o "content" completo em markdown.');
  const file = full(path, ctx);
  const ext = extname(file).slice(1).toLowerCase();
  const wanted = DOCUMENT_FORMATS.includes(String(format || "").toLowerCase()) ? String(format).toLowerCase() : DOCUMENT_FORMATS.includes(ext) ? ext : "docx";
  return ext === wanted ? file : `${DOCUMENT_FORMATS.includes(ext) ? file.slice(0, -ext.length - 1) : file}.${wanted}`;
}

// Explicit folder, else the project, else the person's usual folders.
const searchRoots = ({ path }, ctx) => (path ? [full(path, ctx)] : ctx.workspace ? [ctx.workspace] : (ctx.workspaceRoots?.length ? ctx.workspaceRoots : personalFolders(ctx)).filter((p) => existsSync(p)));

const fold = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Where a file the person mentions by name usually lives. */
export function personalFolders(ctx = {}) {
  const f = ctx.knownFolders || {};
  const home = f.home || homedir();
  return [...new Set([ctx.workspace, f.desktop, f.documents, f.downloads, join(home, "OneDrive"), join(home, "Desktop"), join(home, "Documents"), join(home, "Downloads")].filter(Boolean))];
}

/**
 * Finds files by name (accent/case-insensitive; with or without extension)
 * in the person's folders: exact name first, then same name without
 * extension, then names containing it; newest first within each.
 */
export async function findFilesByName(name, roots, { limit = 5, signal } = {}) {
  const wanted = fold(String(name).replace(/\uFFFD/g, "").split(/[\\/]/).pop().trim());
  if (wanted.length < 3) return [];
  const stem = wanted.replace(/\.[a-z0-9]{1,5}$/, "");
  const hits = [];
  const seen = new Set();
  for (const root of roots) {
    const stack = [[root, 0]];
    let visited = 0;
    while (stack.length && visited < 15000 && !signal?.aborted) {
      const [dir, depth] = stack.pop();
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        visited += 1;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { if (depth < 5 && !SKIP_DIRS.has(entry.name.toLowerCase()) && !entry.name.startsWith(".")) stack.push([path, depth + 1]); continue; }
        if (!entry.isFile() || seen.has(path.toLowerCase())) continue;
        const base = fold(entry.name);
        const rank = base === wanted ? 0 : base.replace(/\.[a-z0-9]{1,5}$/, "") === stem ? 1 : stem.length >= 8 && base.includes(stem) ? 2 : -1;
        if (rank < 0) continue;
        seen.add(path.toLowerCase());
        hits.push({ path, rank, mtime: (await stat(path).catch(() => ({ mtimeMs: 0 }))).mtimeMs });
      }
    }
  }
  return hits.sort((a, b) => a.rank - b.rank || b.mtime - a.mtime).slice(0, limit).map((h) => h.path);
}

/**
 * The path as given if it exists; otherwise the same file name found in the
 * person's folders — models often guess the folder (Desktop vs Downloads) or
 * mangle accents ("\\�rea de Trabalho").
 */
export async function resolveExisting(path, ctx, { directory = false } = {}) {
  const target = full(path, ctx);
  const info = await stat(target).catch(() => null);
  if (info && (directory ? info.isDirectory() : true)) return target;
  if (directory) throw new Error(`A pasta ${target} não existe.`);
  const found = await findFilesByName(target, personalFolders(ctx), { limit: 3, signal: ctx.signal });
  if (found.length) return found[0];
  throw new Error(`O arquivo ${target} não existe e não encontrei "${target.split(/[\\/]/).pop()}" na pasta do projeto, Área de Trabalho, Documentos, Downloads nem OneDrive. Peça o caminho ao usuário.`);
}

/** "src/**\/*.ts" → RegExp over forward-slash relative paths. */
export function globToRegExp(pattern) {
  const source = String(pattern).replace(/\\/g, "/").replace(/^\.\//, "");
  let out = "";
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === "*" && source[i + 1] === "*") { out += source[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += source[i + 2] === "/" ? 2 : 1; }
    else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "{") { const end = source.indexOf("}", i); if (end > i) { out += `(?:${source.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`; i = end; } else out += "\\{"; }
    else out += /[.+^$()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${source.includes("/") ? "" : "(?:.*/)?"}${out}$`, "i");
}

async function* walk(root, signal) {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    if (signal?.aborted) return;
    const dir = stack.pop();
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (++seen > MAX_WALK) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name.toLowerCase()) && !entry.name.startsWith(".")) stack.push(path); }
      else if (entry.isFile()) yield path;
    }
  }
}

const rel = (root, path) => relative(root, path).split(sep).join("/");

async function looksBinary(path) {
  const handle = await open(path, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(1024), 0, 1024, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally { await handle.close(); }
}

export const fileTools = [
  {
    name: "list_dir",
    description: "Lista arquivos e pastas de um diretório. Caminhos relativos partem da pasta do projeto; aceita também Desktop, Documentos e Downloads.",
    parameters: { type: "object", properties: { path: { type: "string", description: "pasta (padrão: pasta do projeto)" } } },
    stage: (a) => `Listando ${a.path || "a pasta do projeto"}…`,
    describe: (a, ctx) => ({ kind: "read", paths: [full(a.path || ".", ctx)] }),
    async run({ path }, ctx) {
      const dir = full(path || ".", ctx);
      const entries = await readdir(dir, { withFileTypes: true });
      const lines = entries.slice(0, 200).map((e) => `${e.isDirectory() ? "[pasta]" : "       "} ${e.name}`);
      return `${dir}\n${lines.join("\n") || "(vazio)"}${entries.length > 200 ? `\n… mais ${entries.length - 200}` : ""}`;
    },
  },
  {
    name: "search_files",
    description: "Procura arquivos pelo nome: um nome ou parte dele (ex.: \"MARU_MEDIA_KIT\", \"relatorio\") ou um padrão glob (\"**/*.py\", \"src/**/App.tsx\"). Sem path, procura na pasta do projeto ou, sem projeto, na Área de Trabalho, Documentos, Downloads e OneDrive. Ignora node_modules, .git e pastas ocultas.",
    parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string", description: "pasta onde procurar (opcional)" } }, required: ["pattern"] },
    stage: (a) => `Procurando ${a.pattern}…`,
    describe: (a, ctx) => ({ kind: "read", paths: searchRoots(a, ctx) }),
    async run({ pattern, path }, ctx) {
      const roots = searchRoots({ path }, ctx);
      // A bare name is a "contains" search, accent- and case-insensitive.
      const glob = /[*?{]/.test(pattern) ? pattern : `*${fold(String(pattern).replace(/\.[a-z0-9]{1,5}$/i, ""))}*`;
      const regex = globToRegExp(glob);
      const found = [];
      for (const root of roots) {
        for await (const file of walk(root, ctx.signal)) {
          if (regex.test(fold(rel(root, file)))) found.push(roots.length > 1 ? file : rel(root, file));
          if (found.length >= 200) break;
        }
      }
      return found.length ? `${roots.length > 1 ? "" : `${roots[0]}\n`}${found.join("\n")}${found.length >= 200 ? "\n… (limite de 200)" : ""}` : `Nenhum arquivo com "${pattern}" em ${roots.join("; ")}.`;
    },
  },
  {
    name: "grep",
    description: "Procura um texto ou expressão regular DENTRO dos arquivos e devolve arquivo:linha: trecho. Use glob para filtrar, ex.: \"**/*.js\".",
    parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, glob: { type: "string" }, ignoreCase: { type: "boolean" } }, required: ["pattern"] },
    stage: (a) => `Procurando "${a.pattern}" nos arquivos…`,
    describe: (a, ctx) => ({ kind: "read", paths: [full(a.path || ".", ctx)] }),
    async run({ pattern, path, glob, ignoreCase = true }, ctx) {
      const root = full(path || ".", ctx);
      let regex;
      try { regex = new RegExp(pattern, ignoreCase ? "i" : ""); } catch { regex = new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), ignoreCase ? "i" : ""); }
      const filter = glob ? globToRegExp(glob) : null;
      const target = await stat(root).catch(() => null);
      if (!target) throw new Error(`${root} não existe.`);
      const files = target.isFile() ? [root] : walk(root, ctx.signal);
      const hits = [];
      for await (const file of files) {
        if (filter && !filter.test(rel(root, file))) continue;
        const info = await stat(file).catch(() => null);
        if (!info || info.size > 1_000_000 || await looksBinary(file).catch(() => true)) continue;
        const lines = (await readFile(file, "utf8")).split(/\r?\n/);
        lines.forEach((line, i) => { if (hits.length < 100 && regex.test(line)) hits.push(`${target.isFile() ? file : rel(root, file)}:${i + 1}: ${line.trim().slice(0, 200)}`); });
        if (hits.length >= 100) break;
      }
      return hits.length ? hits.join("\n") + (hits.length >= 100 ? "\n… (limite de 100)" : "") : `Nada encontrado para "${pattern}".`;
    },
  },
  {
    name: "read_file",
    description: "Lê um arquivo com números de linha: texto, código, e também Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PDF (inclusive escaneado) e imagens com texto (lidas por OCR). Para arquivos grandes use offset (linha inicial, a partir de 1) e limit (quantidade de linhas). Para contar ou listar linhas de uma planilha (quem, quantos, quais) use filter: \"Coluna=texto\" (ex.: \"Situação=Aberto\"), comparação de número ou data (\"Dias em atraso>30\", \"Desvio (%)>5\", \"Início das férias>=01/10/2026; Início das férias<=31/10/2026\"), diferente (\"Situação!=Resolvido\"), entre duas colunas (\"Saldo<Estoque mínimo\") ou só um texto; condições separadas por \";\" valem juntas. Para \"qual vence primeiro\", \"o maior\", \"os 3 mais caros\" use sort: \"Coluna\" (crescente) ou \"-Coluna\" (decrescente), com ou sem filter. Devolve o cabeçalho, as linhas que batem, a soma das colunas numéricas e o total: use esse resultado em vez de comparar, ordenar ou somar de cabeça.",
    parameters: { type: "object", properties: { path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" }, filter: { type: "string", description: "opcional: \"Coluna=texto\", \"Coluna>30\", \"Coluna>=01/10/2026\" (várias com ;) ou texto que a linha precisa conter" }, sort: { type: "string", description: "opcional: \"Coluna\" para ordem crescente, \"-Coluna\" para decrescente" } }, required: ["path"] },
    stage: (a) => `Lendo ${a.path}…`,
    async describe(a, ctx) {
      const path = await resolveExisting(a.path, ctx).catch(() => full(a.path, ctx));
      // A paid chat only sees a restricted company document with consent.
      if (ctx.provider && ctx.provider !== "local" && (await ctx.isRestricted?.(path))) return { kind: "share", summary: `Ler ${path} (documento interno não liberado para IA paga)` };
      return { kind: "read", paths: [path] };
    },
    async run({ path, offset = 1, limit = 400, filter, sort }, ctx) {
      const file = await resolveExisting(path, ctx);
      const office = EXTRACTED.has(extname(file).toLowerCase());
      if (!office && (await stat(file)).size > 5_000_000) throw new Error("Arquivo grande demais (mais de 5 MB).");
      const lines = (office ? await extractText(file) : await readFile(file, "utf8")).split(/\r?\n/);
      ctx.onFileRead?.(file);
      if (String(filter || "").trim() || String(sort || "").trim()) {
        const found = `${file}\n${filterRows(lines, String(filter || ""), { sort })}`;
        return found.length > READ_CHUNK ? `${found.slice(0, READ_CHUNK)}\n… (resultado grande: use um filtro mais específico ou combine condições com ";")` : found;
      }
      const start = Math.max(1, Number(offset) || 1);
      const count = Math.min(Math.max(1, Number(limit) || 400), 2000);
      const sheet = /\.(xlsx|csv|tsv)$/i.test(file);
      let text = "";
      for (let i = start - 1; i < Math.min(lines.length, start - 1 + count); i += 1) {
        const line = `${String(i + 1).padStart(5)}  ${lines[i]}\n`;
        if (text.length + line.length > READ_CHUNK) {
          const columns = sheet ? lines.find((l) => l.includes(" | ")) : null;
          text += `… (cortado; continue com offset=${i + 1}${columns ? `, ou use filter para trazer só as linhas que interessam, ex.: filter="${columns.split(" | ")[0]}=texto" ou "Coluna>número". Colunas: ${columns.slice(0, 400)}` : ""})\n`;
          break;
        }
        text += line;
      }
      const shown = start - 1 + count < lines.length ? `\n(linhas ${start}–${Math.min(lines.length, start - 1 + count)} de ${lines.length})` : "";
      // Read whole, a sheet was filtered "by eye" and 10-day-late bills went into a >30 list.
      const tip = sheet && text && !text.includes("… (cortado") ? `\n(Para listar só as linhas que atendem a uma condição, leia de novo com filter, ex.: "Coluna>30" ou "Coluna=texto": a ferramenta faz a comparação.)` : "";
      return `${file}\n${text || "(vazio)"}${shown}${tip}`;
    },
  },
  {
    name: "write_file",
    description: "Cria ou substitui um arquivo de TEXTO (código, .txt, .md, .csv, .json…) com o conteúdo informado. Cria as pastas que faltarem. Word, Excel, PDF e PowerPoint: use write_document.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    stage: (a) => `Salvando ${a.path}…`,
    describe: (a, ctx) => ({ kind: "write", paths: [full(a.path, ctx)], summary: `Salvar ${full(a.path, ctx)}` }),
    async run({ path, content }, ctx) {
      const file = full(path, ctx);
      // Text written into a .xlsx is a file Excel refuses (an agent delivered one, 05/10/2026).
      if (/\.(xlsx|docx|pdf|pptx)$/i.test(file)) throw new Error(`write_file grava texto e ${extname(file)} é binário: use write_document com o mesmo caminho e o conteúdo em markdown (tabelas | a | b |).`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, String(content ?? ""), "utf8");
      return `Salvei ${file} (${Buffer.byteLength(String(content ?? ""))} bytes).`;
    },
  },
  {
    name: "write_document",
    description: "Cria um documento NOVO (Word .docx, Excel .xlsx, PDF, .md ou .csv) a partir de texto em markdown simples: # títulos, - listas e tabelas | a | b |. Use para \"crie um documento/relatório/planilha/proposta\". Para corrigir um documento que você mesma criou, chame de novo com o mesmo caminho: ele é atualizado. Nunca sobrescreve um arquivo do usuário: se o nome já existe, salva com (2). Responda com o caminho que esta ferramenta devolver.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Caminho com o nome do arquivo, ex.: Documentos/proposta_atualizada.docx" }, format: { type: "string", enum: DOCUMENT_FORMATS }, content: { type: "string", description: "Conteúdo completo em markdown simples" } }, required: ["path", "content"] },
    stage: (a) => `Criando ${a.path || a.file_path || a.filename || "o documento"}…`,
    describe: (a, ctx) => ({ kind: "write", paths: [documentPath(a, ctx)], summary: `Criar ${documentPath(a, ctx)}` }),
    async run(args, ctx) {
      let file = documentPath(args, ctx);
      const format = extname(file).slice(1).toLowerCase();
      // A file Aurora created is updated in place (a redo made "... (2).md" next to its own first try).
      for (let n = 2; existsSync(file) && !OWN_DOCUMENTS.has(file.toLowerCase()); n += 1) file = documentPath(args, ctx).replace(/(\.[^.\\/]+)$/, ` (${n})$1`);
      const bytes = await renderDocument(format, args.content ?? args.text ?? args.markdown ?? "");
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
      OWN_DOCUMENTS.add(file.toLowerCase());
      return `Criei ${file} (${format.toUpperCase()}, ${bytes.length} bytes).`;
    },
  },
  {
    // Organizing a folder needs moving and renaming; through run_command a small model wrote
    // shell one-liners that were hard to check. Never overwrites, never deletes.
    name: "move_file",
    description: "Move ou renomeia um arquivo ou pasta (ex.: organizar Downloads em subpastas por tipo). Cria a pasta de destino se faltar. Nunca sobrescreve: se o destino já existe, salva com (2). Não apaga nada.",
    parameters: { type: "object", properties: { from: { type: "string", description: "Caminho atual" }, to: { type: "string", description: "Novo caminho completo, com o nome, ou uma pasta terminada em \\ ou /" } }, required: ["from", "to"] },
    stage: (a) => `Movendo ${a.from}…`,
    describe: (a, ctx) => ({ kind: "write", paths: [full(a.from, ctx), moveTarget(a, ctx)], summary: `Mover ${full(a.from, ctx)} para ${moveTarget(a, ctx)}` }),
    async run(args, ctx) {
      // The exact path only: read_file's tolerant lookup found a same-named file in a subfolder
      // and moved that one instead.
      const from = full(args.from, ctx);
      if (!existsSync(from)) {
        // "notacoes.txt" for "anotacoes.txt": name the closest file and show what is there.
        let names = [];
        try { names = (await readdir(dirname(from))).slice(0, 40); } catch { /* folder missing */ }
        const wanted = foldText(basename(from));
        const close = names.find((n) => foldText(n).includes(wanted) || wanted.includes(foldText(n))) || names.find((n) => foldText(n).slice(-8) === wanted.slice(-8));
        throw new Error(`${from} não existe.${close ? ` Você quis dizer "${close}"?` : ""}${names.length ? ` Nessa pasta: ${names.join(", ")}.` : ""}`);
      }
      let to = moveTarget({ ...args, from }, ctx);
      if (resolve(from) === resolve(to)) return `${from} já está nesse lugar.`;
      for (let n = 2; existsSync(to); n += 1) to = moveTarget({ ...args, from }, ctx).replace(/(\.[^.\\/]+)?$/, (ext) => ` (${n})${ext}`);
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      return `Movi ${from} para ${to}.`;
    },
  },
  {
    name: "edit_file",
    description: "Edita um arquivo trocando um trecho exato (before) por outro (after). Leia o arquivo antes e copie o trecho literalmente.",
    parameters: { type: "object", properties: { path: { type: "string" }, before: { type: "string" }, after: { type: "string" } }, required: ["path", "before", "after"] },
    stage: (a) => `Editando ${a.path}…`,
    describe: (a, ctx) => ({ kind: "write", paths: [full(a.path, ctx)], summary: `Editar ${full(a.path, ctx)}` }),
    async run({ path, before, after }, ctx) {
      const file = full(path, ctx);
      const text = await readFile(file, "utf8");
      const count = text.split(String(before)).length - 1;
      if (count > 1) throw new Error(`O trecho 'before' aparece ${count} vezes; inclua mais contexto para ser único.`);
      if (before && count === 1) {
        await writeFile(file, text.replace(String(before), () => String(after ?? "")), "utf8");
        return `Editei ${file}.`;
      }
      // The model copies code with its own indentation (4 spaces for a 2-space file) and never
      // matched: the same lines, ignoring leading spaces, found once, are replaced re-indented.
      const loose = before ? looseReplace(text, String(before), String(after ?? "")) : null;
      if (loose) {
        await writeFile(file, loose, "utf8");
        return `Editei ${file} (o trecho batia ignorando a indentação; mantive a do arquivo).`;
      }
      throw new Error("O trecho 'before' não existe no arquivo. Leia o arquivo e copie o trecho exato (sem os números de linha).");
    },
  },
];
