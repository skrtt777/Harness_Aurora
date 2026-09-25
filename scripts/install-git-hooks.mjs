import { copyFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// Runs on `npm install` via the "prepare" script, so every checkout of this
// repo (this machine or another one) gets the pre-push hook without a manual
// step — see scripts/git-hooks/pre-push for what it actually checks and why.
const root = dirname(dirname(fileURLToPath(import.meta.url)));

let hooksDir;
try {
  // git-path resolves correctly for a plain checkout, a worktree, or a
  // submodule (unlike hardcoding <root>/.git/hooks).
  hooksDir = resolve(root, execSync("git rev-parse --git-path hooks", { cwd: root }).toString().trim());
} catch {
  console.log("Sem repositório git aqui (ex.: build empacotado) — pulando instalação de hooks.");
  process.exit(0);
}

mkdirSync(hooksDir, { recursive: true });
const dest = join(hooksDir, "pre-push");
copyFileSync(join(root, "scripts", "git-hooks", "pre-push"), dest);
chmodSync(dest, 0o755);
console.log(`Hook de pre-push instalado em ${dest} (roda check/build/testes antes de cada git push).`);
