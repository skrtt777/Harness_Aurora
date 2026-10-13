// Tools for code: check_page (look at a page as a person would, app/pageCheck.js) and code_map (the
// files of a project with their functions and classes, like Aider's repo map: a small model sees the
// whole project in a few hundred tokens instead of reading every file and running out of context).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { checkPage, pageAddress, shotsFolder } from "../pageCheck.js";
import { buildApi } from "../apiBuilder.js";
import { askedFolder, recordedWrite } from "./files.js";
import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";

/** node --test in a folder, with the app's own Node: { ok, summary }. */
export function runNodeTests(dir) {
  return new Promise((done) => execFile(process.execPath, ["--test"], { cwd: dir, windowsHide: true, timeout: 120000, env: (({ NODE_TEST_CONTEXT, ...rest }) => ({ ...rest, ELECTRON_RUN_AS_NODE: "1" }))(process.env) }, (error, stdout, stderr) => {
    const out = `${stdout}${stderr}`;
    const pass = out.match(/^\S*\s*pass (\d+)/m)?.[1], fail = out.match(/^\S*\s*fail (\d+)/m)?.[1];
    const firstFail = out.split(/\r?\n/).find((l) => /not ok|✖|AssertionError|Error:/.test(l)) || "";
    done({ ok: !error, summary: pass !== undefined ? `${pass} testes passaram, ${fail || 0} falharam${error && firstFail ? ` (${firstFail.trim().slice(0, 160)})` : ""}` : String(out || error?.message || "").trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 300) });
  }));
}

const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".aurora", "__pycache__", ".venv", "venv", "target", ".next"]);
const SOURCE = /\.(m?jsx?|cjs|tsx?|py|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|html?|css|json|sql|ya?ml|toml|md)$/i;

/** The functions, classes and routes of a source file, one short line each. */
export function symbolsOf(text, ext) {
  const out = [];
  const add = (s) => { const t = s.replace(/\s+/g, " ").trim().slice(0, 90); if (t && !out.includes(t)) out.push(t); };
  const lines = String(text).split(/\r?\n/);
  let pyClass = null;
  for (const line of lines) {
    if (/\.(m?jsx?|cjs|tsx?)$/.test(ext)) {
      let m = line.match(/^\s*(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*([\w$]+)\s*\(([^)]*)\)/); if (m) { add(`${m[1] ? "export " : ""}function ${m[4]}(${m[5]})`); continue; }
      m = line.match(/^\s*(export\s+)?class\s+([\w$]+)/); if (m) { add(`${m[1] ? "export " : ""}class ${m[2]}`); continue; }
      m = line.match(/^\s*(export\s+)?const\s+([\w$]+)\s*=\s*(async\s*)?(\([^)]*\)|[\w$]+)\s*=>/); if (m) { add(`${m[1] ? "export " : ""}${m[2]}${m[4].startsWith("(") ? m[4] : `(${m[4]})`}`); continue; }
      m = line.match(/\b(app|router|server)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)/i); if (m) { add(`${m[2].toUpperCase()} ${m[3]}`); continue; }
      m = line.match(/module\.exports\s*=\s*(.+)/); if (m) add(`module.exports = ${m[1].slice(0, 60)}`);
    } else if (ext === ".py") {
      const m = line.match(/^(\s*)(async\s+)?(def|class)\s+(\w+)\s*(\([^)]*\))?/); if (m) { if (m[3] === "class") pyClass = m[4]; else if (!m[1].length) pyClass = null; add(`${m[3]} ${m[1].length && pyClass && m[3] === "def" ? `${pyClass}.` : ""}${m[4]}${m[5] || ""}`); }
    } else if (/\.(java|cs)$/.test(ext)) {
      const m = line.match(/^\s*(public|private|protected)?\s*(static\s+)?(class|interface|record|enum|[\w<>[\],\s]+?)\s+(\w+)\s*(\([^)]*\))?\s*(\{|throws|$)/);
      if (m && (m[3] === "class" || m[3] === "interface" || m[3] === "record" || m[3] === "enum" || m[5])) add(`${m[3] === "class" || m[3] === "interface" || m[3] === "record" || m[3] === "enum" ? m[3] : m[3].trim()} ${m[4]}${m[5] || ""}`);
    } else if (/\.(c|cc|cpp|h|hpp)$/.test(ext)) {
      const m = line.match(/^\s*(struct|class)\s+(\w+)|^\s*[\w:<>*&\s]+?\s+([\w:]+)\s*\(([^;]*)\)\s*(const)?\s*\{?\s*$/); if (m && !/^(for|while|if|switch|return|else|catch)$/.test(m[3] || "")) add(m[2] ? `${m[1]} ${m[2]}` : `${m[3]}(${m[4]})`);
    } else if (/\.html?$/.test(ext)) {
      const m = line.match(/<(script|link)[^>]+(src|href)=["']([^"']+)["']/i); if (m) add(`${m[1]} ${m[3]}`);
      const id = line.match(/<(section|main|header|nav|footer)[^>]*id=["']([^"']+)/i); if (id) add(`<${id[1]} #${id[2]}>`);
    }
    if (out.length >= 14) break;
  }
  return out;
}

/** The map of a folder: each file, its size in lines and its symbols. */
export function codeMap(root, { maxFiles = 60, maxChars = 6000 } = {}) {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 6 || files.length >= maxFiles) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => Number(b.isFile()) - Number(a.isFile()) || a.name.localeCompare(b.name))) {
      if (files.length >= maxFiles) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(p, depth + 1); continue; }
      if (!SOURCE.test(e.name)) continue;
      let size = 0; try { size = statSync(p).size; } catch {}
      if (size > 400_000) { files.push({ path: relative(root, p), lines: null, symbols: ["(arquivo grande, não lido)"] }); continue; }
      const text = readFileSync(p, "utf8");
      files.push({ path: relative(root, p), lines: text.split("\n").length, symbols: /\.(json|md|css|ya?ml|toml|sql)$/i.test(e.name) ? [] : symbolsOf(text, extname(p).toLowerCase()) });
    }
  };
  walk(root, 0);
  let text = files.map((f) => `${f.path}${f.lines ? ` (${f.lines} linhas)` : ""}${f.symbols.length ? `\n${f.symbols.map((s) => `  ${s}`).join("\n")}` : ""}`).join("\n");
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n… (mais arquivos; peça code_map de uma subpasta)`;
  return { files, text: files.length ? text : "Nenhum arquivo de código nesta pasta." };
}

export const codeTools = [
  {
    name: "create_api",
    description: "Cria uma API REST completa em Node.js (sem dependências) numa pasta: rotas de listar, buscar, criar, editar e apagar sobre um arquivo JSON, validação dos campos, e testes com node:test que JÁ RODAM e passam. Você só diz o recurso (ex.: jogos) e os campos. Use SEMPRE que pedirem uma API, um backend ou um CRUD em Node.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string", description: "pasta da API dentro do projeto (ex.: api)" },
        resource: { type: "string", description: "o que a API cadastra, no plural (ex.: jogos)" },
        fields: { type: "array", items: { type: "object", properties: { name: { type: "string" }, type: { type: "string", enum: ["texto", "numero", "inteiro", "booleano", "data"] }, required: { type: "boolean" } }, required: ["name"] } },
        sample: { type: "array", description: "3 a 10 registros de exemplo (objetos com os campos)", items: { type: "object" } },
        port: { type: "number" },
      },
      required: ["resource", "fields"],
    },
    stage: (a) => `Criando a API de ${a.resource || ""}…`,
    describe: (a, ctx) => ({ kind: "write", paths: [resolve(ctx.workspace || ".", a.folder || askedFolder(ctx.request) || "api")], summary: `Criar a API de ${a.resource || ""}` }),
    async run(args, ctx) {
      const name = String(args.folder || askedFolder(ctx.request) || "api");
      const dir = resolve(ctx.workspace || ".", name);
      if (ctx.workspace) { const inside = relative(resolve(ctx.workspace), dir); if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("A API vai dentro da pasta do projeto: use um caminho relativo (ex.: api)."); }
      const { spec, files } = await buildApi(dir, args, { write: (file, text) => recordedWrite(file, Buffer.from(text, "utf8"), ctx) });
      ctx.onStage?.("Rodando os testes da API…");
      const t = await runNodeTests(dir);
      return [
        `Criei a API de ${spec.resource} em ${dir}:`, ...files.map((f) => `- ${f}`),
        `Rotas: GET/POST /${spec.resource}, GET/PUT/DELETE /${spec.resource}/:id (busca ?q=). Campos: ${spec.fields.map((f) => `${f.name} (${f.type}${f.required ? ", obrigatório" : ""})`).join(", ")}.`,
        `Testes (node --test): ${t.summary}.`,
        `Rodar: na pasta ${dir}, node server.js (http://localhost:${spec.port}/${spec.resource}).`,
        "Na resposta, mostre o resultado REAL dos testes acima e como rodar.",
      ].join("\n");
    },
  },
  {
    name: "check_page",
    description: "Confere uma página web como uma pessoa veria: abre escondida no tamanho de computador e de celular e diz os erros do console, arquivos que não carregam (CSS/JS faltando), página mais larga que a tela, seções vazias, imagens quebradas, e salva as fotos. Use SEMPRE depois de criar ou mudar um site ou página, e corrija o que ela apontar antes de responder.",
    parameters: { type: "object", properties: { target: { type: "string", description: "o index.html, a pasta do site ou um endereço http://localhost:…" } }, required: ["target"] },
    risk: "safe",
    describe: () => ({ kind: "browse" }),
    stage: (a) => `Conferindo a página ${a.target}…`,
    async run({ target }, ctx) {
      const address = pageAddress(target, ctx.workspace);
      const { report } = await checkPage(address, { shotsDir: shotsFolder(address), env: ctx.env });
      return `Conferi ${address}:\n${report}`;
    },
  },
  {
    name: "code_map",
    description: "Mapa do projeto: cada arquivo de código com o número de linhas e as funções, classes e rotas dele. Use no começo de um trabalho num projeto que já existe (antes de ler arquivo por arquivo) e para achar onde mexer.",
    parameters: { type: "object", properties: { folder: { type: "string", description: "pasta (padrão: a do projeto)" } } },
    risk: "safe",
    describe: () => ({ kind: "read" }),
    stage: () => "Mapeando o projeto…",
    async run({ folder }, ctx) {
      const root = resolve(ctx.workspace || ".", folder || ".");
      return `Mapa de ${root}:\n${codeMap(root).text}`;
    },
  },
];
