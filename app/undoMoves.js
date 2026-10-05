import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

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
