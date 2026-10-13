// The check of a code file as soon as it is written (SWE-agent's lint-on-edit: an edit that breaks the
// syntax is reported at once, with the line, instead of failing three steps later when it runs). Fast
// and local: JavaScript by node's own parser, JSON by JSON.parse, Python by py_compile when there is a
// Python, HTML by its local scripts and styles that do not exist.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const run = (cmd, args, opts = {}) => new Promise((done) => execFile(cmd, args, { windowsHide: true, timeout: 20000, ...opts }, (error, stdout, stderr) => done({ ok: !error, out: String(stderr || stdout || error?.message || "") })));

/** The first useful line of a parser's message, with the line number. */
function firstError(text, file) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const where = lines.find((l) => l.includes(file) && /:\d+/.test(l)) || "";
  const line = where.match(/:(\d+)(?::\d+)?\)?$/)?.[1] || String(text).match(/line (\d+)/i)?.[1] || null;
  const message = lines.find((l) => /(Error|Erro|error:|Unexpected|Invalid|missing)/.test(l) && !l.startsWith("at ")) || lines.at(-1) || "";
  return { line: line ? Number(line) : null, message: message.slice(0, 220) };
}

/**
 * Problems of a code file just written: [] when fine, otherwise [{ line, message }]. JSX and
 * TypeScript are not parsed here (they need a build); the check never throws.
 */
export async function checkCode(file) {
  const ext = extname(file).toLowerCase();
  try {
    if (ext === ".json") { try { JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")); return []; } catch (e) { const pos = Number(String(e.message).match(/position (\d+)/)?.[1]); const text = readFileSync(file, "utf8"); return [{ line: Number.isFinite(pos) ? text.slice(0, pos).split("\n").length : null, message: e.message.slice(0, 200) }]; } }
    if ([".js", ".mjs", ".cjs"].includes(ext)) {
      const r = await run(process.execPath, ["--check", file], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
      return r.ok ? [] : [firstError(r.out, file)];
    }
    if (ext === ".py") {
      for (const py of ["python", "py"]) {
        const r = await run(py, ["-m", "py_compile", file]);
        if (r.ok) return [];
        if (/not recognized|ENOENT|não é reconhecido/i.test(r.out)) continue;
        return [firstError(r.out, file)];
      }
      return [];
    }
    if (ext === ".html" || ext === ".htm") {
      // Local scripts and styles the page asks for and that do not exist (the site of 13/10 linked a
      // style.css and a main.js nobody wrote).
      const text = readFileSync(file, "utf8");
      const missing = [...text.matchAll(/<(?:script[^>]+src|link[^>]+href)=["']([^"'#?]+)["']/gi)].map((m) => m[1])
        .filter((u) => !/^(https?:)?\/\/|^data:|^mailto:/i.test(u) && /\.(js|mjs|css|jsx)$/i.test(u))
        .filter((u) => !existsSync(resolve(dirname(file), u.replace(/^\//, ""))));
      return missing.length ? [{ line: null, missing, message: `a página usa arquivos que ainda não existem: ${missing.join(", ")}` }] : [];
    }
  } catch { /* a check that cannot run says nothing */ }
  return [];
}

/** The sentence added to "Salvei …" when the file has problems. */
export function checkNote(file, problems) {
  if (!problems.length) return "";
  if (problems.every((p) => p.missing)) return `
Falta criar: ${problems.flatMap((p) => p.missing).join(", ")} (a página usa; grave-os em seguida, ou tire a referência).`;
  return `\nATENÇÃO, o arquivo gravado tem erro: ${problems.map((p) => `${p.line ? `linha ${p.line}: ` : ""}${p.message}`).join("; ")}. Corrija com edit_file (só o trecho) antes de seguir.`;
}
