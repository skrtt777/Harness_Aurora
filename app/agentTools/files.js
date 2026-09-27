import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_READ = 12000;

export function expandPath(input, knownFolders = {}) {
  let text = String(input || "").trim().replace(/^["']|["']$/g, "");
  if (!text) throw new Error("Informe o caminho.");
  if (text === "~" || text.startsWith("~/") || text.startsWith("~\\")) text = join(homedir(), text.slice(1));
  text = text.replace(/%([A-Z_]+)%/gi, (m, name) => process.env[name] ?? m);
  if (!isAbsolute(text)) {
    // "Desktop/notas.txt", "área de trabalho\\x" → the real known folder.
    const [head, ...rest] = text.split(/[\\/]/);
    const alias = { desktop: "desktop", "área de trabalho": "desktop", "area de trabalho": "desktop", documents: "documents", documentos: "documents", downloads: "downloads" }[head.toLowerCase()];
    text = alias && knownFolders[alias] ? join(knownFolders[alias], ...rest) : join(knownFolders.desktop || homedir(), text);
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

async function guard(ctx, path, verb) {
  if (await isInsideRoots(path, ctx.allowedRoots)) return;
  const ok = await ctx.approve({ tool: verb, summary: `${verb === "ler" ? "Ler" : "Alterar"} fora das pastas permitidas: ${path}` });
  if (!ok) throw new Error(`O usuário não autorizou ${verb} ${path}.`);
}

export const fileTools = [
  {
    name: "list_dir",
    description: "Lista arquivos e pastas de um diretório. Aceita caminho absoluto ou atalhos: Desktop, Documentos, Downloads.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    risk: "safe",
    stage: (a) => `Listando ${a.path}…`,
    async run({ path }, ctx) {
      const full = expandPath(path, ctx.knownFolders);
      await guard(ctx, full, "ler");
      const entries = await readdir(full, { withFileTypes: true });
      const lines = entries.slice(0, 200).map((e) => `${e.isDirectory() ? "[pasta]" : "       "} ${e.name}`);
      return `${full}\n${lines.join("\n") || "(vazio)"}${entries.length > 200 ? `\n… mais ${entries.length - 200}` : ""}`;
    },
  },
  {
    name: "read_file",
    description: "Lê um arquivo de texto.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    risk: "safe",
    stage: (a) => `Lendo ${a.path}…`,
    async run({ path }, ctx) {
      const full = expandPath(path, ctx.knownFolders);
      await guard(ctx, full, "ler");
      if ((await stat(full)).size > 2_000_000) throw new Error("Arquivo grande demais para ler (mais de 2 MB).");
      const text = await readFile(full, "utf8");
      return `${full}\n\n${text.slice(0, MAX_READ)}${text.length > MAX_READ ? "\n… (cortado)" : ""}`;
    },
  },
  {
    name: "write_file",
    description: "Cria ou substitui um arquivo de texto com o conteúdo informado. Cria as pastas que faltarem.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    risk: "write",
    stage: (a) => `Salvando ${a.path}…`,
    async run({ path, content }, ctx) {
      const full = expandPath(path, ctx.knownFolders);
      await guard(ctx, full, "alterar");
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, String(content ?? ""), "utf8");
      return `Salvei ${full} (${Buffer.byteLength(String(content ?? ""))} bytes).`;
    },
  },
  {
    name: "edit_file",
    description: "Edita um arquivo trocando um trecho exato (before) por outro (after).",
    parameters: { type: "object", properties: { path: { type: "string" }, before: { type: "string" }, after: { type: "string" } }, required: ["path", "before", "after"] },
    risk: "write",
    stage: (a) => `Editando ${a.path}…`,
    async run({ path, before, after }, ctx) {
      const full = expandPath(path, ctx.knownFolders);
      await guard(ctx, full, "alterar");
      const text = await readFile(full, "utf8");
      const count = text.split(String(before)).length - 1;
      if (!before || count === 0) throw new Error("O trecho 'before' não existe no arquivo. Leia o arquivo e copie o trecho exato.");
      if (count > 1) throw new Error(`O trecho 'before' aparece ${count} vezes; inclua mais contexto para ser único.`);
      await writeFile(full, text.replace(String(before), () => String(after ?? "")), "utf8");
      return `Editei ${full}.`;
    },
  },
];
