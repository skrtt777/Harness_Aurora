// The files of a folder whose names the person wrote, spaces and all ("leia o Regional Sales Sample.pbix"):
// the name patterns of chatTurn.fileMentions stop at a space and found only "Sample.pbix" (28/10).
import { readdir } from "node:fs/promises";
import { join, extname } from "node:path";

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const SKIP = new Set(["node_modules", ".git", "$recycle.bin", "appdata"]);

/** Every file under the roots (two levels down at most, 3000 entries), as full paths. */
async function listFiles(roots, depth = 2) {
  const out = [];
  const walk = async (dir, level) => {
    if (out.length >= 3000) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (out.length >= 3000) return;
      if (e.isFile()) out.push(join(dir, e.name));
      else if (e.isDirectory() && level < depth && !SKIP.has(e.name.toLowerCase()) && !e.name.startsWith(".")) await walk(join(dir, e.name), level + 1);
    }
  };
  for (const root of roots.filter(Boolean)) await walk(root, 0);
  return out;
}

/**
 * Files under the roots whose whole name (or name without the extension, 6+ letters) is in the text,
 * the longest names first. `exts` (".pbix", …) narrows them.
 */
export async function filesNamedIn(text, roots = [], { exts = null, limit = 3 } = {}) {
  const said = fold(text);
  if (!said.trim()) return [];
  const files = (await listFiles(roots)).filter((f) => !exts || exts.includes(extname(f).toLowerCase()));
  const hits = files.map((f) => {
    const name = fold(f.split(/[\\/]/).pop());
    const stem = name.replace(/\.[^.]+$/, "");
    return said.includes(name) ? { f, n: name.length } : stem.length >= 6 && said.includes(stem) ? { f, n: stem.length } : null;
  }).filter(Boolean);
  return hits.sort((a, b) => b.n - a.n).slice(0, limit).map((h) => h.f);
}
