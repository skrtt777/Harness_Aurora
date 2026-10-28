// The data model of a .pbix read without Power BI Desktop (28/10: at work the Aurora could not read a
// .pbix at all; its model is compressed (XPress9 + VertiPaq) and only an open Power BI could answer).
// PBIXRay (MIT, Python) unpacks it in well under a second: the tables with their rows, the measures with
// their DAX, the relationships. Each table goes to a CSV in the Harness folder, so read_file counts and
// sums it with filter/sort and the comprovante proves the numbers like any spreadsheet.
// Python: the person's own (3.9+, a venv beside the Harness data), or else one that uv (Astral, MIT/Apache)
// downloads; the first .pbix sets it up (a minute or two), the next ones reuse it.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const PBIXRAY = "pbixray==0.15.5";
const UV = {
  version: "0.13.0",
  url: "https://github.com/astral-sh/uv/releases/download/0.13.0/uv-x86_64-pc-windows-msvc.zip",
  sha256: "088962f9e7b7bd9ea740c04c650b2a21c8928c345bd99ac24350dc924dba656c",
};
const MAX_ROWS = 200_000;

// Runs with -I (isolated: nothing from the current folder is imported). argv: the .pbix, the output
// folder, the row limit per table. Prints the model as JSON; writes one CSV per table.
const SCRIPT = String.raw`
import sys, os, json, re
from pbixray import PBIXRay
src, out, limit, stem = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
os.makedirs(out, exist_ok=True)
m = PBIXRay(src)
res = {"tables": [], "measures": [], "relationships": [], "errors": []}
used = set()
for name in m.tables:
    if name.startswith(("DateTableTemplate_", "LocalDateTable_")):
        continue
    try:
        df = m.get_table(name)
        base = stem + " - " + (re.sub(r'[^\w\- ]', '_', name).strip() or "tabela")
        file = base
        n = 2
        while file.lower() in used:
            file = f"{base}_{n}"; n += 1
        used.add(file.lower())
        path = os.path.join(out, file + ".csv")
        df.head(limit).to_csv(path, index=False, encoding="utf-8-sig")
        res["tables"].append({"name": name, "rows": int(len(df)), "columns": [str(c) for c in df.columns], "csv": path,
            "preview": [[("" if v is None else str(v))[:40] for v in row] for row in df.head(3).values.tolist()]})
    except Exception as e:
        res["errors"].append(f"{name}: {e}"[:200])
try:
    for r in m.dax_measures.to_dict("records"):
        res["measures"].append({"table": r.get("TableName"), "name": r.get("Name"), "expression": str(r.get("Expression") or "").strip(), "description": r.get("Description") or ""})
except Exception as e:
    res["errors"].append(f"medidas: {e}"[:200])
try:
    for r in m.relationships.to_dict("records"):
        res["relationships"].append({"from": f"{r.get('FromTableName')}[{r.get('FromColumnName')}]", "to": f"{r.get('ToTableName')}[{r.get('ToColumnName')}]", "active": bool(r.get("IsActive")), "cardinality": r.get("Cardinality")})
except Exception as e:
    res["errors"].append(f"relacionamentos: {e}"[:200])
print(json.dumps(res, ensure_ascii=False, default=str))
`;

const dataDir = (env) => dirname(env.HARNESS_DB_FILE || join(homedir(), ".aurora", "harness.db"));
/** Where the tables of the .pbix files read go (read_file finds a CSV there by its name alone). */
export const pbixCacheDir = (env = process.env) => join(dataDir(env), "pbix-cache");
const run = (command, args, { timeout = 120_000, env, signal } = {}) => new Promise((resolve, reject) => {
  execFile(command, args, { timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env, signal }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stderr: String(stderr || "") }));
    else resolve(String(stdout || ""));
  });
});

/** A Python 3.9+ of 64 bits already on the PC ("py -3" or "python"), or null. */
async function systemPython() {
  for (const [command, ...prefix] of [["py", "-3"], ["python"], ["python3"]]) {
    const out = await run(command, [...prefix, "-I", "-c", "import sys;print(sys.executable if sys.version_info[:2]>=(3,9) and sys.maxsize>2**32 else '')"], { timeout: 15_000 }).catch(() => "");
    // The Microsoft Store's python.exe stub prints nothing (it only opens the Store).
    const exe = out.trim().split(/\r?\n/).pop();
    if (exe && existsSync(exe)) return exe;
  }
  return null;
}

/** uv.exe in the Harness folder, downloaded and checked against its SHA-256 the first time. */
async function uvExe(env, fetchImpl = globalThis.fetch) {
  const exe = join(dataDir(env), "tools", `uv-${UV.version}`, "uv.exe");
  if (existsSync(exe)) return exe;
  if (process.platform !== "win32") throw new Error("Sem Python neste computador: instale o Python 3 para ler os dados do .pbix.");
  const response = await fetchImpl(UV.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Não consegui baixar o Python para ler o .pbix (HTTP ${response.status}).`);
  const zip = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(zip).digest("hex") !== UV.sha256) throw new Error("O download do Python para ler o .pbix não confere (SHA-256).");
  const { readZip } = await import("./docText.js");
  const entries = readZip(zip);
  const name = [...entries.keys()].find((n) => /(^|\/)uv\.exe$/i.test(n));
  if (!name) throw new Error("O pacote do uv não tem o uv.exe.");
  mkdirSync(dirname(exe), { recursive: true });
  writeFileSync(exe, entries.get(name)());
  return exe;
}

let setup = null;
/**
 * The Python that has PBIXRay: a venv in the Harness folder (pbix-python), made once from the PC's own
 * Python or, without one, from a Python that uv downloads. Resolves to its python.exe.
 */
export function pbixPython(env = process.env, { fetchImpl } = {}) {
  setup ||= (async () => {
    const root = dataDir(env);
    const venv = join(root, "pbix-python");
    const py = process.platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");
    const ready = join(venv, `${PBIXRAY.replace("==", "-")}.ok`);
    if (existsSync(py) && existsSync(ready)) return py;
    rmSync(venv, { recursive: true, force: true });
    // AURORA_PBIX_OWN_PYTHON=1: as on a PC without Python (measuring the uv path).
    const base = env.AURORA_PBIX_OWN_PYTHON === "1" ? null : await systemPython();
    if (base) {
      await run(base, ["-I", "-m", "venv", venv], { timeout: 180_000 });
      await run(py, ["-I", "-m", "pip", "install", "--disable-pip-version-check", "-q", PBIXRAY], { timeout: 900_000 });
    } else {
      const uv = await uvExe(env, fetchImpl);
      const uvEnv = { UV_PYTHON_INSTALL_DIR: join(root, "pbix-python-base"), UV_CACHE_DIR: join(root, "uv-cache") };
      await run(uv, ["venv", "--python", "3.12", venv], { timeout: 600_000, env: uvEnv });
      await run(uv, ["pip", "install", "--python", py, PBIXRAY], { timeout: 900_000, env: uvEnv });
    }
    writeFileSync(ready, new Date().toISOString());
    return py;
  })().catch((error) => { setup = null; throw error; });
  return setup;
}

/**
 * The model of a .pbix: { tables: [{ name, rows, columns, csv, preview }], measures, relationships,
 * errors }. Kept per file version (path, size, date) in pbix-cache: read once, then instant.
 */
export async function pbixModel(path, { env = process.env, signal } = {}) {
  if (env.AURORA_PBIX_READER === "off") return null;
  const info = statSync(path);
  const key = createHash("sha1").update(`v2|${path}|${info.size}|${info.mtimeMs}`).digest("hex").slice(0, 16);
  const out = join(pbixCacheDir(env), key);
  const saved = join(out, "model.json");
  if (existsSync(saved)) { try { return JSON.parse(readFileSync(saved, "utf8")); } catch { /* read again */ } }
  const py = await pbixPython(env);
  const stem = basename(path).replace(/\.pbix$/i, "").replace(/[^\p{L}\p{N}\- ]/gu, "_").trim().slice(0, 60) || "pbix";
  const stdout = await run(py, ["-I", "-c", SCRIPT, path, out, String(MAX_ROWS), stem], { timeout: 300_000, signal });
  const model = JSON.parse(stdout.trim().split(/\r?\n/).pop());
  writeFileSync(saved, JSON.stringify(model));
  return model;
}

/** The model as the text the Aurora reads: tables (rows, columns, the CSV with all the data), measures, relationships. */
export function pbixModelText(model) {
  const out = [`## Modelo de dados (${model.tables.length} tabelas, lido direto do arquivo, sem o Power BI)`];
  out.push(`Os dados de cada tabela estão num CSV (na pasta ${model.tables[0] ? dirname(model.tables[0].csv) : "do Harness"}; o nome basta). Para contar, somar ou listar: read_file no CSV com filter (ex.: "Status=Won") e/ou sort; a ferramenta devolve a contagem e a soma das colunas numéricas. Não some de cabeça nem leia o CSV inteiro.`);
  // The tables first and short (where their data is): an attached file is cut, and these lines are what
  // the answer needs; the measures, relationships and sample rows come after.
  for (const t of model.tables) {
    out.push(`### ${t.name} (${t.rows.toLocaleString("pt-BR")} linhas${t.rows > MAX_ROWS ? `; o CSV tem as primeiras ${MAX_ROWS.toLocaleString("pt-BR")}` : ""})`);
    out.push(`Dados: read_file "${basename(t.csv)}"`);
    out.push(`Colunas: ${t.columns.join(", ")}`);
  }
  if (model.relationships.length) out.push(`## Relacionamentos\n${model.relationships.map((r) => `${r.from} → ${r.to} (${r.cardinality || ""}${r.active ? "" : ", inativo"})`).join("\n")}`);
  if (model.measures.length) {
    out.push(`## Medidas (${model.measures.length})`);
    for (const m of model.measures) out.push(`Medida ${m.table}[${m.name}] = ${m.expression}${m.description ? `\n  (${m.description})` : ""}`);
  }
  const samples = model.tables.filter((t) => t.preview?.length);
  if (samples.length) out.push(`## Primeiras linhas de cada tabela\n${samples.map((t) => `### ${t.name}\n${[t.columns.join(" | "), ...t.preview.map((r) => r.join(" | "))].join("\n")}`).join("\n")}`);
  if (model.errors?.length) out.push(`(Não consegui ler: ${model.errors.join("; ")})`);
  return out.join("\n");
}
