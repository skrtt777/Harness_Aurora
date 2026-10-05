import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Puts back files that were moved ({ from, to } in the order they happened), newest first. Never
 * overwrites: a file whose old place is taken again, or that was moved/deleted since, stays where it
 * is and is reported. The folders the moves created stay too (an empty folder may have been there
 * before, and nothing is deleted).
 */
export async function undoMoves(moves = []) {
  const restored = [], skipped = [];
  for (const { from, to } of [...moves].reverse()) {
    if (!existsSync(to)) { skipped.push({ file: to, reason: "não está mais lá" }); continue; }
    if (existsSync(from)) { skipped.push({ file: to, reason: `já existe outro arquivo em ${from}` }); continue; }
    await mkdir(dirname(from), { recursive: true });
    await rename(to, from);
    restored.push(from);
  }
  return { restored, skipped };
}

const backupDir = () => join(dirname(process.env.HARNESS_DB_FILE || fileURLToPath(new URL("../data/harness.db", import.meta.url))), "undo");
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A copy of a file about to be changed by the agent: what "Desfazer" puts back. */
export async function backupBeforeChange(file) {
  if (!existsSync(file)) return null;
  await mkdir(backupDir(), { recursive: true });
  const backup = join(backupDir(), `${randomUUID()}.bak`);
  await copyFile(file, backup);
  return backup;
}

/**
 * Restores edited files ({ file, backup, after }: the copy from before and the hash right after the
 * agent's edit), newest first. A file changed again since (by the person or anything else) is left
 * as it is: their change is never thrown away.
 */
export async function undoEdits(edits = []) {
  const restored = [], skipped = [];
  for (const { file, backup, after } of [...edits].reverse()) {
    if (!backup || !existsSync(backup)) { skipped.push({ file, reason: "a cópia de antes não existe mais" }); continue; }
    if (!existsSync(file)) { skipped.push({ file, reason: "não está mais lá" }); continue; }
    if (sha(await readFile(file)) !== after) { skipped.push({ file, reason: "mudou depois da edição" }); continue; }
    await writeFile(file, await readFile(backup));
    restored.push(file);
  }
  return { restored, skipped };
}

/** Moves and edits of one answer or run, undone together (edits first: they may be on moved files). */
export async function undoChanges({ moves = [], edits = [] }) {
  const e = await undoEdits(edits);
  const m = await undoMoves(moves);
  return { restored: [...e.restored, ...m.restored], skipped: [...e.skipped, ...m.skipped] };
}
