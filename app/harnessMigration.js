// Coming from another harness (docs/VISAO_HARNESS_2.0.md, phase 3, item 5): what Hermes and OpenClaw remember
// becomes Aurora memories. Read in place from their folders, never changed:
//   - Hermes: ~/.hermes/memories/MEMORY.md (what it learned) and USER.md (about the person); entries separated
//     by "§" lines (or, in a hand-written file, by list items / paragraphs);
//   - OpenClaw: ~/.openclaw/workspace/MEMORY.md (long-term), USER.md, and the daily notes memory/YYYY-MM-DD.md.
// Each entry becomes one memory (kind "imported", tagged with its origin); the store's dedupe skips what is
// already here, so importing twice adds nothing. Skills come through skills.js (both use SKILL.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createMemory } from "./store.js";

const MAX_ENTRIES = 600;
const MAX_FILE = 512 * 1024;

const read = (path) => { try { const st = statSync(path); return st.isFile() && st.size <= MAX_FILE ? readFileSync(path, "utf8") : null; } catch { return null; } };

/** A memory file's entries: "§" separators, else list items, else paragraphs (headings and comments dropped). */
export function memoryEntries(text) {
  const clean = String(text || "").replace(/^﻿/, "").replace(/<!--[\s\S]*?-->/g, "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  let parts;
  if (/^\s*§\s*$/m.test(clean) || /\n§\n/.test(clean)) parts = clean.split(/^\s*§\s*$/m);
  else if (/^\s*[-*]\s+\S/m.test(clean)) parts = clean.split(/^\s*[-*]\s+/m).slice(1);
  else parts = clean.split(/\r?\n\s*\r?\n/);
  return parts
    .map((p) => p.split(/\r?\n/).filter((l) => !/^\s*#{1,6}\s/.test(l)).join("\n").trim())
    .filter((p) => p.replace(/\W/g, "").length >= 8)
    .map((p) => p.slice(0, 4000));
}

const titleOf = (text) => text.split(/\r?\n/)[0].replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim().slice(0, 90) || "Memória importada";

/** What each harness has, where (nothing is read beyond its own folders). */
export function scanHarnesses(env = process.env) {
  const home = env.AURORA_SKILL_HOME || homedir();
  const sources = [];
  const add = (harness, path, tags) => { const text = read(path); if (text === null) return; const entries = memoryEntries(text); if (entries.length) sources.push({ harness, file: path, tags, entries }); };
  add("hermes", join(home, ".hermes", "memories", "MEMORY.md"), ["hermes"]);
  add("hermes", join(home, ".hermes", "memories", "USER.md"), ["hermes", "sobre a pessoa"]);
  const ws = join(home, ".openclaw", "workspace");
  add("openclaw", join(ws, "MEMORY.md"), ["openclaw"]);
  add("openclaw", join(ws, "USER.md"), ["openclaw", "sobre a pessoa"]);
  let days = [];
  try { days = readdirSync(join(ws, "memory")).filter((f) => /^\d{4}-\d{2}-\d{2}.*\.md$/i.test(f)).sort().reverse().slice(0, 120); } catch { /* no daily notes */ }
  for (const day of days) add("openclaw", join(ws, "memory", day), ["openclaw", day.slice(0, 10)]);
  return sources;
}

/** The scan as the app shows it: per harness, its files and how many entries each would bring. */
export function harnessSummary(env = process.env) {
  const out = {};
  for (const s of scanHarnesses(env)) {
    const h = (out[s.harness] ||= { harness: s.harness, files: [], entries: 0, sample: [] });
    h.files.push({ file: s.file, entries: s.entries.length });
    h.entries += s.entries.length;
    if (h.sample.length < 3) h.sample.push(...s.entries.slice(0, 3 - h.sample.length).map(titleOf));
  }
  return Object.values(out);
}

/** Bring one harness' memories in (global scope; the dedupe skips what is already here). */
export async function importHarness(harness, env = process.env) {
  if (!["hermes", "openclaw"].includes(harness)) throw Object.assign(new Error("Harness desconhecido."), { status: 400 });
  let imported = 0, skipped = 0, seen = 0;
  for (const s of scanHarnesses(env).filter((x) => x.harness === harness)) {
    for (const entry of s.entries) {
      if (seen++ >= MAX_ENTRIES) break;
      const m = await createMemory({ scope: "global", title: titleOf(entry), content: entry, tags: s.tags, kind: "imported", source: `${harness}:${basename(s.file)}`, env, dedupe: true });
      // createMemory returns the memory already here on a duplicate (deduplicated).
      if (m?.deduplicated) skipped += 1; else imported += 1;
    }
  }
  return { harness, imported, skipped };
}
