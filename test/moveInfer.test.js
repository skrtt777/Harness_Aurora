import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("move_file with only 'to' finds the source in the request or by the destination's name", async () => {
  const home = mkdtempSync(join(tmpdir(), "aurora-mv-"));
  for (const d of ["Desktop", "Documents", "Downloads"]) mkdirSync(join(home, d));
  writeFileSync(join(home, "Downloads", "IMG_20260912.jpg"), "x");
  mkdirSync(join(home, "Desktop", "Fotos Praia 2025"));
  writeFileSync(join(home, "Desktop", "Fotos Praia 2025", "praia_01.jpg"), "x");
  const env = { ...process.env, HARNESS_KNOWN_FOLDERS: JSON.stringify({ desktop: join(home, "Desktop"), documents: join(home, "Documents"), downloads: join(home, "Downloads"), home }) };
  process.env.HARNESS_KNOWN_FOLDERS = env.HARNESS_KNOWN_FOLDERS;
  const { fileTools } = await import("../app/agentTools/files.js");
  const move = fileTools.find((t) => t.name === "move_file");
  const base = { env, workspace: home, folderAccess: "computer", knownFolders: { desktop: join(home, "Desktop"), documents: join(home, "Documents"), downloads: join(home, "Downloads"), home } };
  await move.run({ to: join(home, "Downloads", "foto_aniversario.jpg") }, { ...base, request: "muda o nome do arquivo IMG_20260912.jpg q ta nos downloads pra foto_aniversario" });
  assert.ok(existsSync(join(home, "Downloads", "foto_aniversario.jpg")), "renamed");
  await move.run({ to: join(home, "Documents", "Fotos Praia 2025") }, { ...base, request: "passa essas fotos da praia pra pasta documentos" });
  assert.ok(existsSync(join(home, "Documents", "Fotos Praia 2025", "praia_01.jpg")), "folder moved");
});
