import { mkdir, open, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { extractText } from "../docText.js";

// Binary office formats are read as their text; everything else as UTF-8.
const EXTRACTED = new Set([".docx", ".xlsx", ".pptx", ".pdf", ".rtf"]);

const MAX_READ = 12000;
const MAX_WALK = 20000;
const SKIP_DIRS = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".cache", "$recycle.bin", "appdata"]);

export function expandPath(input, knownFolders = {}, base) {
  let text = String(input || "").trim().replace(/^["']|["']$/g, "");
  if (!text) throw new Error("Informe o caminho.");
  if (text === "~" || text.startsWith("~/") || text.startsWith("~\\")) text = join(homedir(), text.slice(1));
  text = text.replace(/%([A-Z_]+)%/gi, (m, name) => process.env[name] ?? m);
  if (!isAbsolute(text)) {
    // "Desktop/notas.txt", "área de trabalho\\x" → the real known folder;
    // anything else is relative to the project folder (or the Desktop).
    const [head, ...rest] = text.split(/[\\/]/);
    const alias = { desktop: "desktop", "área de trabalho": "desktop", "area de trabalho": "desktop", documents: "documents", documentos: "documents", downloads: "downloads" }[head.toLowerCase()];
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
    description: "Procura arquivos pelo nome com um padrão glob, ex.: \"**/*.py\", \"src/**/App.tsx\", \"*relatorio*\". Ignora node_modules, .git e pastas ocultas.",
    parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string", description: "pasta onde procurar (padrão: pasta do projeto)" } }, required: ["pattern"] },
    stage: (a) => `Procurando ${a.pattern}…`,
    describe: (a, ctx) => ({ kind: "read", paths: [full(a.path || ".", ctx)] }),
    async run({ pattern, path }, ctx) {
      const root = full(path || ".", ctx);
      const regex = globToRegExp(pattern);
      const found = [];
      for await (const file of walk(root, ctx.signal)) {
        if (regex.test(rel(root, file))) found.push(rel(root, file));
        if (found.length >= 200) break;
      }
      return found.length ? `${root}\n${found.join("\n")}${found.length >= 200 ? "\n… (limite de 200)" : ""}` : `Nenhum arquivo com "${pattern}" em ${root}.`;
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
    description: "Lê um arquivo com números de linha: texto, código, e também Word (.docx), Excel (.xlsx), PowerPoint (.pptx) e PDF. Para arquivos grandes use offset (linha inicial, a partir de 1) e limit (quantidade de linhas).",
    parameters: { type: "object", properties: { path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } }, required: ["path"] },
    stage: (a) => `Lendo ${a.path}…`,
    describe: (a, ctx) => ({ kind: "read", paths: [full(a.path, ctx)] }),
    async run({ path, offset = 1, limit = 400 }, ctx) {
      const file = full(path, ctx);
      const office = EXTRACTED.has(extname(file).toLowerCase());
      if (!office && (await stat(file)).size > 5_000_000) throw new Error("Arquivo grande demais (mais de 5 MB).");
      const lines = (office ? await extractText(file) : await readFile(file, "utf8")).split(/\r?\n/);
      ctx.onFileRead?.(file);
      const start = Math.max(1, Number(offset) || 1);
      const count = Math.min(Math.max(1, Number(limit) || 400), 2000);
      let text = "";
      for (let i = start - 1; i < Math.min(lines.length, start - 1 + count); i += 1) {
        const line = `${String(i + 1).padStart(5)}  ${lines[i]}\n`;
        if (text.length + line.length > MAX_READ) { text += `… (cortado; continue com offset=${i + 1})\n`; break; }
        text += line;
      }
      const shown = start - 1 + count < lines.length ? `\n(linhas ${start}–${Math.min(lines.length, start - 1 + count)} de ${lines.length})` : "";
      return `${file}\n${text || "(vazio)"}${shown}`;
    },
  },
  {
    name: "write_file",
    description: "Cria ou substitui um arquivo de texto com o conteúdo informado. Cria as pastas que faltarem.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    stage: (a) => `Salvando ${a.path}…`,
    describe: (a, ctx) => ({ kind: "write", paths: [full(a.path, ctx)], summary: `Salvar ${full(a.path, ctx)}` }),
    async run({ path, content }, ctx) {
      const file = full(path, ctx);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, String(content ?? ""), "utf8");
      return `Salvei ${file} (${Buffer.byteLength(String(content ?? ""))} bytes).`;
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
      if (!before || count === 0) throw new Error("O trecho 'before' não existe no arquivo. Leia o arquivo e copie o trecho exato.");
      if (count > 1) throw new Error(`O trecho 'before' aparece ${count} vezes; inclua mais contexto para ser único.`);
      await writeFile(file, text.replace(String(before), () => String(after ?? "")), "utf8");
      return `Editei ${file}.`;
    },
  },
];
