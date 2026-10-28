// The Aurora in the code editor, installed from the Harness (Settings → Editor de código): the .vsix
// that comes with the installer (vscode/dist/aurora-harness.vsix; resources/vscode in the packaged app),
// the editors found on this PC (VS Code, Insiders, Cursor, Windsurf, VSCodium) with the version they
// have, and "Instalar"/"Atualizar", which runs the editor's own CLI (--install-extension). Only when the
// person clicks; nothing is installed by itself.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec, execFile } from "node:child_process";

const ID = "harness-aurora.aurora-harness";
const HERE = dirname(fileURLToPath(import.meta.url));

/** The .vsix this Harness carries, and its version (read from inside the zip's manifest). */
export function bundledVsix(env = process.env) {
  const candidates = [
    env.AURORA_VSIX,
    process.resourcesPath && join(process.resourcesPath, "vscode", "aurora-harness.vsix"),
    join(HERE, "..", "vscode", "dist", "aurora-harness.vsix"),
  ].filter(Boolean);
  const path = candidates.find((p) => existsSync(p));
  if (!path) return null;
  // The version is in extension.vsixmanifest, stored uncompressed by scripts/pack-vscode.mjs.
  let version = null;
  try {
    const raw = readFileSync(path);
    const m = /<Identity[^>]*Version="([^"]+)"/.exec(raw.toString("latin1"));
    version = m?.[1] || null;
  } catch { /* unreadable: no version */ }
  if (!version) { try { version = JSON.parse(readFileSync(join(HERE, "..", "vscode", "aurora", "package.json"), "utf8")).version; } catch { /* none */ } }
  return { path, version };
}

/** The editors' CLIs that may exist on Windows (and on PATH elsewhere). */
function editorCandidates(env = process.env) {
  const local = env.LOCALAPPDATA || "", programs = env.ProgramFiles || "C:\\Program Files";
  const win = process.platform === "win32";
  return [
    { id: "vscode", name: "VS Code", cli: win ? [join(local, "Programs", "Microsoft VS Code", "bin", "code.cmd"), join(programs, "Microsoft VS Code", "bin", "code.cmd")] : ["/usr/bin/code", "/usr/local/bin/code", "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"] },
    { id: "insiders", name: "VS Code Insiders", cli: win ? [join(local, "Programs", "Microsoft VS Code Insiders", "bin", "code-insiders.cmd")] : ["/usr/bin/code-insiders"] },
    { id: "cursor", name: "Cursor", cli: win ? [join(local, "Programs", "cursor", "resources", "app", "bin", "cursor.cmd")] : ["/usr/bin/cursor"] },
    { id: "windsurf", name: "Windsurf", cli: win ? [join(local, "Programs", "Windsurf", "bin", "windsurf.cmd")] : ["/usr/bin/windsurf"] },
    { id: "vscodium", name: "VSCodium", cli: win ? [join(local, "Programs", "VSCodium", "bin", "codium.cmd"), join(programs, "VSCodium", "bin", "codium.cmd")] : ["/usr/bin/codium"] },
  ];
}

function runCli(cli, args, { timeout = 120000 } = {}) {
  return new Promise((done) => {
    const finish = (error, stdout, stderr) => done({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || ""), error: error?.message || null });
    const options = { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 };
    // .cmd files run through the shell on Windows: one command line (the arguments are fixed flags or
    // the .vsix path, quoted by quote()).
    if (/\.cmd"?$/i.test(cli)) exec([cli, ...args].join(" "), options, finish);
    else execFile(cli, args, options, finish);
  });
}
const quote = (p) => (/\s/.test(p) && process.platform === "win32" ? `"${p}"` : p);

/** The version of the Aurora extension an editor has, or null. */
export function installedVersion(listing) {
  const line = String(listing || "").split(/\r?\n/).find((l) => l.toLowerCase().startsWith(`${ID}@`));
  return line ? line.split("@")[1].trim() : null;
}

/** a < b for "0.2.1" < "0.3.0". */
export function older(a, b) {
  const pa = String(a || "0").split(".").map(Number), pb = String(b || "0").split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  return false;
}

/** What Settings → Editor de código shows: the .vsix and each editor found, with what it has. */
export async function vscodeStatus({ env = process.env, run = runCli } = {}) {
  const vsix = bundledVsix(env);
  const editors = [];
  for (const e of editorCandidates(env)) {
    const cli = e.cli.find((p) => existsSync(p));
    if (!cli) continue;
    const r = await run(quote(cli), ["--list-extensions", "--show-versions"], { timeout: 30000 });
    const installed = r.ok ? installedVersion(r.stdout) : null;
    editors.push({ id: e.id, name: e.name, installed, update: Boolean(installed && vsix?.version && older(installed, vsix.version)) });
  }
  return { id: ID, vsix: vsix ? { version: vsix.version } : null, editors };
}

/** Installs (or updates) the bundled extension in one editor. */
export async function installInEditor(editorId, { env = process.env, run = runCli } = {}) {
  const vsix = bundledVsix(env);
  if (!vsix) throw Object.assign(new Error("Esta instalação não trouxe a extensão do VS Code."), { status: 404 });
  const editor = editorCandidates(env).find((e) => e.id === editorId);
  const cli = editor?.cli.find((p) => existsSync(p));
  if (!cli) throw Object.assign(new Error("Editor não encontrado neste computador."), { status: 404 });
  const r = await run(quote(cli), ["--install-extension", quote(vsix.path), "--force"]);
  if (!r.ok || (/failed|error/i.test(r.stderr) && !/successfully installed/i.test(r.stdout))) throw Object.assign(new Error(`O ${editor.name} não instalou: ${(r.stderr || r.error || "").trim().slice(0, 300)}`), { status: 502 });
  return { ok: true, editor: editor.name, version: vsix.version, message: `Aurora ${vsix.version} instalada no ${editor.name}. Recarregue a janela do editor (Ctrl+Shift+P → "Recarregar a janela") se ele estiver aberto.` };
}
