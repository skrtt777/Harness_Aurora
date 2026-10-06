// Computer map: what is where on the person's PC, from names, types, sizes and dates only (no file
// is opened). A throttled background scan keeps it current, re-reading only folders whose date
// changed; rules label each folder ("projeto de código", "fotos", "notas fiscais") with no AI.
// The agent asks it "onde ficam minhas fotos?" and finds files by name instantly, instead of
// walking the disk on every search.
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { getDb } from "./db.js";
import { computerRoots, isSensitivePath } from "./fileAccess.js";

// Folders that are the system's, programs', caches or build output — not the person's.
const SKIP = new Set([
  "windows", "program files", "program files (x86)", "programdata", "$recycle.bin", "system volume information", "perflogs", "recovery",
  "msocache", "$windows.~bt", "$windows.~ws", "$sysreset", "config.msi", "windows.old", "appdata", "intel", "amd",
  "node_modules", ".git", ".svn", ".hg", ".venv", "venv", "env", "__pycache__", ".pytest_cache", ".mypy_cache", ".next", ".nuxt", ".cache",
  ".gradle", ".m2", ".nuget", ".cargo", ".rustup", "bower_components", ".terraform", ".idea", ".vs", ".vscode", "obj", "deriveddatacache",
  "intermediate", "saved", "binaries", "ddc", "$getcurrent", "onedrivetemp",
  // Installed toolchains and libraries: on this PC they were most of the files (site-packages of
  // three Python environments, the Android SDK), none of them the person's own.
  "site-packages", "dist-packages", "python_embeded", "python_embedded", "pkgs", "android-sdk", "ndk", ".icons", "__pypackages__",
  // Package managers' stores (F:\.pnpm-store alone was thousands of folders with hashed names).
  ".pnpm-store", "pnpm-store", ".yarn", ".npm", "_cacache", ".pip", ".turbo", ".nx", ".angular",
]);
// Prefixes and endings of the same kind: ".venv-motion", "venv311", "miniforge3", "ShaderCache", "npm-cache".
const SKIP_PREFIX = /^(\.?venv|miniforge|miniconda|anaconda|mambaforge)|cache$|[-_](env|pkgs)$/i;
// The inside of an installed program's tree (a bundled ffmpeg's Library\share\doc, usr\lib).
const PROGRAM_TREE = /[\\/](library|usr)[\\/](share|include|lib|libexec|man|etc)$/i;
// An installed game is shown by its name only: its thousands of internal files are not the person's.
const GAME_DIR = /[\\/](steamapps[\\/]common|epic games|riot games|gog games)[\\/][^\\/]+$/i;
// Bumped when the skip or label rules change: the next pass re-reads every folder once, so old
// folders get the new rules too (an unchanged folder is otherwise never re-labeled).
const RULES_VERSION = 3;
const MAX_DEPTH = 14;
const MAX_FILES_PER_DIR = 3000; // a dump of 50k photos keeps counts, and 3000 names to search
const BATCH = 40;               // folders per step before yielding
const STEP_PAUSE_MS = 15;

const TYPES = {
  imagem: /^(jpe?g|png|gif|webp|bmp|heic|tiff?|raw|cr2|nef|arw|dng|svg|psd)$/,
  video: /^(mp4|mkv|mov|avi|wmv|webm|m4v|mts)$/,
  audio: /^(mp3|wav|flac|m4a|ogg|aac|opus|wma)$/,
  documento: /^(pdf|docx?|odt|rtf|txt|md|epub|pptx?|odp)$/,
  planilha: /^(xlsx?|xlsm|ods|csv)$/,
  instalador: /^(exe|msi|msix|appx|iso|dmg|apk)$/,
  compactado: /^(zip|rar|7z|tar|gz|bz2|xz)$/,
  codigo: /^(js|mjs|cjs|ts|tsx|jsx|py|java|c|cpp|h|hpp|cs|go|rs|rb|php|kt|swift|lua|gd|sh|ps1|sql|html?|css|scss|vue|svelte)$/,
};
const typeOf = (ext) => Object.keys(TYPES).find((t) => TYPES[t].test(ext)) || "outro";
const PROJECT_MARKERS = [
  [/^package\.json$/i, "Node/JavaScript"], [/^(pyproject\.toml|requirements\.txt|setup\.py)$/i, "Python"], [/\.(sln|csproj)$/i, ".NET"],
  [/^(pom\.xml|build\.gradle(\.kts)?)$/i, "Java"], [/^cargo\.toml$/i, "Rust"], [/^go\.mod$/i, "Go"], [/\.uproject$/i, "Unreal"],
  [/^project\.godot$/i, "Godot"], [/^(cmakelists\.txt|makefile)$/i, "C/C++"], [/^composer\.json$/i, "PHP"], [/^pubspec\.yaml$/i, "Flutter"],
];
const FINANCE = /\b(nf-?e?|nota[ s_-]?fiscal|boleto|fatura|recibo|comprovante|extrato|contrato|holerite|imposto|darf|ir(pf)?)\b/i;

async function ready() {
  const db = await getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS map_dirs (
      path TEXT PRIMARY KEY, parent TEXT, name TEXT NOT NULL, depth INTEGER NOT NULL, dir_mtime REAL,
      files INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, newest REAL, subdirs TEXT, types TEXT,
      kind TEXT, label TEXT, total_files INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER NOT NULL DEFAULT 0, scanned_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_map_dirs_parent ON map_dirs(parent);
    CREATE INDEX IF NOT EXISTS idx_map_dirs_kind ON map_dirs(kind);
    -- A file points to its folder by number: the full path, repeated per file, was most of the bytes.
    CREATE TABLE IF NOT EXISTS map_items (id INTEGER PRIMARY KEY, dir_id INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER, mtime REAL);
    CREATE INDEX IF NOT EXISTS idx_map_items_dir ON map_items(dir_id);
    CREATE INDEX IF NOT EXISTS idx_map_items_mtime ON map_items(mtime);
    CREATE VIRTUAL TABLE IF NOT EXISTS map_names USING fts5(name, content='map_items', content_rowid='id', tokenize="unicode61 remove_diacritics 2");
    CREATE TRIGGER IF NOT EXISTS map_items_ai AFTER INSERT ON map_items BEGIN INSERT INTO map_names(rowid, name) VALUES (new.id, new.name); END;
    CREATE TRIGGER IF NOT EXISTS map_items_ad AFTER DELETE ON map_items BEGIN INSERT INTO map_names(map_names, rowid, name) VALUES ('delete', old.id, old.name); END;`);
  return db;
}

/** Where the scan starts: the person's home, and every other drive (the system drive's own folders are skipped). */
export function mapRoots() {
  // Tests (and a narrower map, if ever wanted) point the scan elsewhere.
  try { const custom = JSON.parse(process.env.AURORA_MAP_ROOTS || "null"); if (Array.isArray(custom)) return custom; } catch { /* default roots */ }
  const home = homedir();
  const systemDrive = home.slice(0, 3).toUpperCase();
  return [home, ...computerRoots().filter((r) => r.toUpperCase() !== systemDrive), ...(process.platform === "win32" ? [systemDrive] : [])];
}

/** Whether a folder is left out of the map (system, programs, caches, other people's profiles, secrets). */
export function skipped(path, name, { home = homedir() } = {}) {
  const lower = name.toLowerCase();
  // Dot folders are programs' settings (.codex, .continue, .local), not the person's files.
  if (SKIP.has(lower) || SKIP_PREFIX.test(lower) || lower.startsWith(".") || lower.startsWith("$") || lower.startsWith("~")) return true;
  if (isSensitivePath(path) || PROGRAM_TREE.test(path)) return true;
  // C:\Users: the home is a root of its own, and other people's profiles stay out.
  if (path.toLowerCase() === dirname(home).toLowerCase()) return true;
  return false;
}

/** The folder's kind and a short label, from its own files and subfolder names only. */
export function labelFolder({ name, files = [], subdirs = [] }) {
  const counts = {};
  for (const f of files) counts[typeOf(extname(f).slice(1).toLowerCase())] = (counts[typeOf(extname(f).slice(1).toLowerCase())] || 0) + 1;
  const total = files.length;
  const project = PROJECT_MARKERS.find(([re]) => files.some((f) => re.test(f)));
  if (project || subdirs.some((d) => d.toLowerCase() === ".git")) return { kind: "projeto", label: `Projeto de código${project ? ` (${project[1]})` : ""}` };
  const lower = name.toLowerCase();
  // "steam" alone is also a game's settings folder (Battlefield 6\settings\steam): only with its library.
  if (lower === "steamapps" || /^(epic games|riot games|gog galaxy)$/i.test(name) || (lower === "steam" && subdirs.some((d) => d.toLowerCase() === "steamapps"))) return { kind: "jogos", label: "Jogos instalados" };
  if (lower === "downloads") return { kind: "downloads", label: `Downloads · ${total} arquivo(s) soltos` };
  const share = (t) => (counts[t] || 0) / Math.max(1, total);
  if (total >= 8 && share("imagem") >= 0.6) return { kind: "fotos", label: `Fotos e imagens · ${counts.imagem}` };
  if (total >= 4 && share("video") >= 0.5) return { kind: "videos", label: `Vídeos · ${counts.video}` };
  if (total >= 8 && share("audio") >= 0.6) return { kind: "musicas", label: `Músicas e áudios · ${counts.audio}` };
  if (total >= 3 && files.filter((f) => FINANCE.test(f)).length >= Math.max(3, total * 0.3)) return { kind: "financeiro", label: `Notas, boletos e comprovantes · ${total}` };
  // A program's own folder (bin, Release) holds its .exe, not installers to run.
  if (total >= 4 && share("instalador") >= 0.5 && !/^(bin|release|debug|x64|x86|build|out|windows_amd64|tools)$/i.test(name)) return { kind: "instaladores", label: `Instaladores · ${counts.instalador}` };
  if (total >= 4 && (share("documento") + share("planilha")) >= 0.5) return { kind: "documentos", label: `Documentos · ${(counts.documento || 0) + (counts.planilha || 0)}` };
  if (total >= 4 && share("compactado") >= 0.5) return { kind: "compactados", label: `Arquivos compactados · ${counts.compactado}` };
  return { kind: null, label: null };
}

const status = { running: false, dirs: 0, files: 0, reread: 0, startedAt: null, finishedAt: null, error: null };
export const mapStatus = () => ({ ...status });
let pauseCheck = () => false;
/** The desktop app adds its own reason to wait (running on battery). */
export const setMapPauseCheck = (fn) => { pauseCheck = fn; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One pass over the roots. A folder whose date did not change keeps its stored files and subfolders
 * (no readdir, no stat per file): after the first pass, a pass costs one stat per folder.
 */
export async function scanComputer({ roots = mapRoots(), shouldPause = () => false, batch = BATCH, pauseMs = STEP_PAUSE_MS, home = homedir() } = {}) {
  if (status.running) return mapStatus();
  // Running from the first moment: whoever started it (the "ligar" button) sees it at once.
  Object.assign(status, { running: true, dirs: 0, files: 0, reread: 0, startedAt: new Date().toISOString(), finishedAt: null, error: null });
  const db = await ready();
  db.exec("CREATE TABLE IF NOT EXISTS map_meta (key TEXT PRIMARY KEY, value TEXT)");
  const rulesChanged = db.prepare("SELECT value FROM map_meta WHERE key = 'rules'").get()?.value !== String(RULES_VERSION);
  const getDir = db.prepare("SELECT dir_mtime, subdirs, files FROM map_dirs WHERE path = ?");
  const putDir = db.prepare(`INSERT INTO map_dirs (path, parent, name, depth, dir_mtime, files, bytes, newest, subdirs, types, kind, label, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET parent=excluded.parent, name=excluded.name, depth=excluded.depth,
    dir_mtime=excluded.dir_mtime, files=excluded.files, bytes=excluded.bytes, newest=excluded.newest, subdirs=excluded.subdirs, types=excluded.types,
    kind=excluded.kind, label=excluded.label, scanned_at=excluded.scanned_at`);
  const dirId = db.prepare("SELECT rowid AS id FROM map_dirs WHERE path = ?");
  const dropFiles = db.prepare("DELETE FROM map_items WHERE dir_id = ?");
  const addFile = db.prepare("INSERT INTO map_items (dir_id, name, size, mtime) VALUES (?, ?, ?, ?)");
  const dropTreeDirs = db.prepare("DELETE FROM map_dirs WHERE path = ? OR path LIKE ? ESCAPE '!'");
  const dropTreeFiles = db.prepare("DELETE FROM map_items WHERE dir_id IN (SELECT rowid FROM map_dirs WHERE path = ? OR path LIKE ? ESCAPE '!')");
  const like = (p) => `${p.replace(/[!%_]/g, "!$&")}${p.endsWith("\\") || p.endsWith("/") ? "" : process.platform === "win32" ? "\\" : "/"}%`;
  const dropTree = (p) => { dropTreeFiles.run(p, like(p)); dropTreeDirs.run(p, like(p)); };
  const seenRoots = new Set();
  const stack = roots.filter((r) => { const k = r.toLowerCase(); if (seenRoots.has(k)) return false; seenRoots.add(k); return true; }).map((path) => ({ path, parent: null, depth: 0 }));
  let sinceYield = 0;
  try {
    while (stack.length) {
      const { path, parent, depth } = stack.pop();
      const info = await stat(path).catch(() => null);
      if (!info?.isDirectory()) { dropTree(path); continue; }
      const old = getDir.get(path);
      let subdirs;
      if (old && old.dir_mtime === info.mtimeMs && !rulesChanged) {
        // The stored list still goes through today's rules: a folder newly left out is forgotten.
        const stored = JSON.parse(old.subdirs || "[]");
        subdirs = stored.filter((d) => !skipped(join(path, d), d, { home }));
        if (subdirs.length !== stored.length) {
          for (const gone of stored.filter((d) => !subdirs.includes(d))) dropTree(join(path, gone));
          db.prepare("UPDATE map_dirs SET subdirs = ? WHERE path = ?").run(JSON.stringify(subdirs), path);
        }
        status.files += old.files;
      } else {
        status.reread += 1;
        const game = GAME_DIR.test(path);
        const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
        subdirs = game ? [] : entries.filter((e) => e.isDirectory() && !e.isSymbolicLink() && !skipped(join(path, e.name), e.name, { home })).map((e) => e.name);
        const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
        // Sizes first (the slow part: one stat per file), then one transaction for the folder's rows.
        const sized = [];
        const types = {};
        let bytes = 0, newest = 0;
        for (const [i, name] of fileNames.entries()) {
          const t = typeOf(extname(name).slice(1).toLowerCase());
          types[t] = (types[t] || 0) + 1;
          if (game || i >= MAX_FILES_PER_DIR) continue;
          const s = await stat(join(path, name)).catch(() => null);
          if (!s) continue;
          bytes += s.size; newest = Math.max(newest, s.mtimeMs);
          sized.push([name, s.size, s.mtimeMs]);
        }
        const { kind, label } = game ? { kind: "jogos", label: "Jogo instalado" } : labelFolder({ name: basename(path) || path, files: fileNames, subdirs });
        db.exec("BEGIN");
        try {
          // Folders gone since last time: their rows go too.
          for (const gone of JSON.parse(old?.subdirs || "[]").filter((d) => !subdirs.includes(d))) dropTree(join(path, gone));
          putDir.run(path, parent, basename(path) || path, depth, info.mtimeMs, fileNames.length, bytes, newest || null, JSON.stringify(subdirs), JSON.stringify(types), kind, label, new Date().toISOString());
          const id = dirId.get(path).id;
          dropFiles.run(id);
          for (const [name, size, mtime] of sized) addFile.run(id, name, size, mtime);
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        status.files += fileNames.length;
      }
      status.dirs += 1;
      if (depth < MAX_DEPTH) for (const d of subdirs) stack.push({ path: join(path, d), parent: path, depth: depth + 1 });
      if (++sinceYield >= batch) {
        sinceYield = 0;
        await sleep(pauseMs);
        while (shouldPause() || pauseCheck()) await sleep(2000);
      }
    }
    totals(db);
    db.prepare("INSERT INTO map_meta (key, value) VALUES ('rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(RULES_VERSION));
    status.finishedAt = new Date().toISOString();
  } catch (error) {
    status.error = String(error.message).slice(0, 300);
  } finally {
    status.running = false;
  }
  return mapStatus();
}

/** Sizes and counts of each folder including everything under it (deepest first). */
function totals(db) {
  const rows = db.prepare("SELECT path, parent, files, bytes FROM map_dirs ORDER BY depth DESC").all();
  const sum = new Map(rows.map((r) => [r.path, { files: r.files, bytes: r.bytes }]));
  for (const r of rows) {
    const mine = sum.get(r.path), up = r.parent && sum.get(r.parent);
    if (up) { up.files += mine.files; up.bytes += mine.bytes; }
  }
  const put = db.prepare("UPDATE map_dirs SET total_files = ?, total_bytes = ? WHERE path = ?");
  db.exec("BEGIN");
  try { for (const [path, t] of sum) put.run(t.files, t.bytes, path); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
}

const gb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const row = (r) => ({ path: r.path, name: r.name, kind: r.kind, label: r.label, files: r.total_files, bytes: r.total_bytes, size: gb(r.total_bytes), subdirs: JSON.parse(r.subdirs || "[]").length, newest: r.newest ? new Date(r.newest).toISOString() : null });

/** The subfolders of a folder (or the roots), biggest first. */
export async function mapChildren(path = null, { limit = 60 } = {}) {
  const db = await ready();
  const rows = path ? db.prepare("SELECT * FROM map_dirs WHERE parent = ? ORDER BY total_bytes DESC LIMIT ?").all(path, limit)
    : db.prepare("SELECT * FROM map_dirs WHERE parent IS NULL ORDER BY total_bytes DESC").all();
  return rows.map(row);
}

/** Files (and folders) by name: every word, accents ignored, newest first among the best. */
export async function mapSearch(query, { limit = 20 } = {}) {
  const db = await ready();
  const words = String(query || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  if (!words.length) return { files: [], folders: [] };
  const match = words.map((w) => `"${w}"*`).join(" ");
  const files = db.prepare(`SELECT d.path AS dir, f.name, f.size, f.mtime FROM map_names JOIN map_items f ON f.id = map_names.rowid JOIN map_dirs d ON d.rowid = f.dir_id
    WHERE map_names MATCH ? ORDER BY bm25(map_names), f.mtime DESC LIMIT ?`).all(match, limit)
    .map((f) => ({ path: join(f.dir, f.name), size: gb(f.size || 0), modified: f.mtime ? new Date(f.mtime).toISOString().slice(0, 10) : null }));
  const folders = db.prepare("SELECT * FROM map_dirs WHERE " + words.map(() => "lower(name) LIKE ?").join(" AND ") + " ORDER BY total_files DESC LIMIT ?")
    .all(...words.map((w) => `%${w}%`), Math.ceil(limit / 2)).map(row);
  return { files, folders };
}

/** Files changed in the last days, newest first (as of the last scan): "what's new on my PC?". */
export async function mapRecent(days = 1, { limit = 30 } = {}) {
  const db = await ready();
  const since = Date.now() - Math.max(0.1, Number(days) || 1) * 86_400_000;
  return db.prepare(`SELECT d.path AS dir, f.name, f.size, f.mtime FROM map_items f JOIN map_dirs d ON d.rowid = f.dir_id
    WHERE f.mtime >= ? ORDER BY f.mtime DESC LIMIT ?`).all(since, limit)
    .map((f) => ({ path: join(f.dir, f.name), size: gb(f.size || 0), modified: new Date(f.mtime).toISOString().slice(0, 16).replace("T", " ") }));
}

/** A few lines on how this PC is organized: what the agent reads before it acts. */
export async function mapOverview({ limit = 6 } = {}) {
  const db = await ready();
  const count = db.prepare("SELECT COUNT(*) AS n, SUM(files) AS f FROM map_dirs").get();
  if (!count.n) return null;
  // Folders inside a code project (its tests, renders, bundled tools) are the project's, not the
  // person's photos or documents: on this PC they crowded "Documentos" (go testdata, a Perl kit).
  const sep = process.platform === "win32" ? "\\" : "/";
  const projects = db.prepare("SELECT path FROM map_dirs WHERE kind = 'projeto'").all().map((r) => r.path.toLowerCase() + sep);
  const own = (r) => !projects.some((p) => r.path.toLowerCase().startsWith(p));
  const home = homedir().toLowerCase();
  // How much of what makes the folder its kind it holds; the person's own folder weighs double.
  const weight = (r) => {
    const t = JSON.parse(r.types || "{}");
    const n = { fotos: t.imagem, videos: t.video, musicas: t.audio, documentos: (t.documento || 0) + (t.planilha || 0), financeiro: r.files, instaladores: t.instalador }[r.kind] ?? r.total_files;
    return (n || 0) * (r.path.toLowerCase().startsWith(home) ? 2 : 1);
  };
  const pick = (kinds, { projectsOnTop = false } = {}) => db.prepare(`SELECT * FROM map_dirs WHERE kind IN (${kinds.map(() => "?").join(",")}) ORDER BY total_files DESC LIMIT 600`).all(...kinds)
    .filter((r) => (projectsOnTop ? !projects.some((p) => r.path.toLowerCase().startsWith(p)) : own(r)))
    .sort((a, b) => (projectsOnTop ? b.total_files - a.total_files : weight(b) - weight(a)))
    .slice(0, limit).map(row);
  const top = (kind) => pick([kind], { projectsOnTop: kind === "projeto" || kind === "jogos" });
  const docAreas = pick(["documentos", "financeiro"]);
  const roots = (await mapChildren(null)).map((r) => `${r.path} (${r.size}, ${r.files} arquivos)`);
  const lines = [`Mapa do computador (${count.n} pastas, ${count.f} arquivos; só nomes, tipos e datas):`, `- Discos e áreas: ${roots.join("; ")}`];
  for (const [title, list] of [["Projetos de código", top("projeto")], ["Fotos", top("fotos")], ["Documentos", docAreas], ["Vídeos", top("videos")], ["Jogos", top("jogos")], ["Instaladores", top("instaladores")]]) {
    if (list.length) lines.push(`- ${title}: ${list.map((r) => `${r.path}${r.label ? ` [${r.label}]` : ""}`).join("; ")}`);
  }
  return lines.join("\n");
}

export async function clearComputerMap() {
  const db = await ready();
  db.exec("DELETE FROM map_items; DELETE FROM map_dirs; INSERT INTO map_names(map_names) VALUES('rebuild');");
}

/**
 * Keeps the map current in the desktop app: a first pass a little after it opens, then every few
 * hours, only while the map is on; it waits while the Aurora is answering someone.
 */
export function startMapSchedule({ enabled, busy = () => false, firstDelayMs = 90_000, everyMs = 6 * 3600_000 }) {
  let timer = null, stopped = false;
  const run = async () => {
    if (stopped) return;
    try { if (await enabled()) await scanComputer({ shouldPause: busy }); } catch { /* next time */ }
    if (!stopped) timer = setTimeout(run, everyMs);
    timer?.unref?.();
  };
  timer = setTimeout(run, firstDelayMs);
  timer.unref?.();
  return () => { stopped = true; clearTimeout(timer); };
}
