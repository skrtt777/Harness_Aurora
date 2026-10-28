// Which model should Ctrl+I's "Forte" profile use? Each candidate GGUF goes through scripts/code-bench.mjs
// (Ctrl+I only, the held-out sets 2 and 3, two rounds each) as the strong model, and the table says how
// many edits were right and how long one took. "padrao" is the chat model (no strong model).
//   node scripts/code-tournament.mjs [--so nome,nome] [--sets holdout2,holdout3] [--vezes 2]
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const OLLAMA = "F:/Modelos_Aurora/ollama/blobs/";
const GGUF = "F:/Modelos_Aurora/gguf/";
export const CANDIDATES = [
  { name: "padrao (qwen3.5 4B do chat)", path: null, size: 3.3, license: "Apache-2.0" },
  { name: "Qwen3-Coder 30B-A3B Q4 (UD-Q4_K_XL)", path: `${GGUF}qwen3-coder-30b-a3b/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf`, size: 17.7, license: "Apache-2.0" },
  { name: "Qwen3-Coder 30B-A3B Q3 (UD-Q3_K_XL)", path: `${GGUF}candidatos/Qwen3-Coder-30B-A3B-Instruct-UD-Q3_K_XL.gguf`, size: 13.8, license: "Apache-2.0" },
  { name: "Qwen3-Coder 30B-A3B Q2 (UD-Q2_K_XL)", path: `${GGUF}candidatos/Qwen3-Coder-30B-A3B-Instruct-UD-Q2_K_XL.gguf`, size: 11.8, license: "Apache-2.0" },
  { name: "Qwen3-Coder 30B-A3B IQ2 (UD-IQ2_M)", path: `${GGUF}candidatos/Qwen3-Coder-30B-A3B-Instruct-UD-IQ2_M.gguf`, size: 10.8, license: "Apache-2.0" },
  { name: "Seed-Coder 8B Q8 (ByteDance)", path: `${GGUF}candidatos/Seed-Coder-8B-Instruct-Q8_0.gguf`, size: 8.8, license: "MIT" },
  { name: "Qwen2.5-Coder 14B", path: `${GGUF}candidatos/qwen2.5-coder-14b-instruct-q4_k_m.gguf`, size: 9.0, license: "Apache-2.0" },
  { name: "Qwen2.5-Coder 7B", path: `${GGUF}candidatos/qwen2.5-coder-7b-instruct-q4_k_m.gguf`, size: 4.7, license: "Apache-2.0" },
  { name: "NextCoder 7B (Microsoft)", path: `${GGUF}candidatos/NextCoder-7B-q4_k_m.gguf`, size: 4.8, license: "MIT" },
  { name: "Seed-Coder 8B (ByteDance)", path: `${GGUF}candidatos/Seed-Coder-8B-Instruct-Q4_K_M.gguf`, size: 5.1, license: "MIT" },
  { name: "qwen3.5 9B", path: `${OLLAMA}sha256-02d45dc1cf451ba2475ac33b301c2dd8f985abe4c182ce04a1f2f5bf0260278d`, size: 5.6, license: "Apache-2.0" },
  { name: "ministral-3 8B", path: `${OLLAMA}sha256-3ea32f882c990baebcfe6ab5cda2e3167d54ab16d7937c0b9aa3db11aba01574`, size: 6.0, license: "Apache-2.0" },
  { name: "ministral-3 14B", path: `${OLLAMA}sha256-bfb40fc6bb9c3b2ed529b480e04f824c005ea8f86733d4ebbf0c204de484891e`, size: 9.1, license: "Apache-2.0" },
  { name: "granite4.1 8B", path: `${OLLAMA}sha256-ed902ac9eb6adce5a90c6a08c8ea201b50e23fdc5976d1cd0362006afac5309e`, size: 5.3, license: "Apache-2.0" },
  { name: "lfm2.5 8B-A1B", path: `${OLLAMA}sha256-63c9be0cc3d5d7b0377161064a74c82b1a5a6ee9ba4a9a3cf034293d6dd09282`, size: 5.2, license: "LFM Open" },
  { name: "ornith 9B", path: `${OLLAMA}sha256-af63361d2ac3ba2cb454f440842e345b926a50fe89cbdbe6a55160f32fc28e93`, size: 5.6, license: "?" },
  { name: "qwen3.8-distill 9B", path: `${OLLAMA}sha256-df13d66021cef676f82be74053220fd75af6bf2a6a7fb77f5222ab9e50744a7a`, size: 5.8, license: "?" },
];

const only = arg("so") ? arg("so").split(",").map((s) => s.trim().toLowerCase()) : null;
const sets = arg("sets", "holdout2,holdout3").split(",");
const times = arg("vezes", "2");
const rows = [];
for (const c of CANDIDATES) {
  if (only && !only.some((o) => c.name.toLowerCase().includes(o))) continue;
  if (c.path && !existsSync(c.path)) { console.log(`— ${c.name}: arquivo não está lá, pulado`); continue; }
  const env = { ...process.env, ...(c.path ? { AURORA_CODE_PROFILE: "forte", AURORA_STRONG_CODE_MODEL: c.path } : { AURORA_CODE_PROFILE: "padrao" }) };
  let ok = 0, n = 0; const ms = []; const per = {};
  for (const set of sets) {
    const r = spawnSync(process.execPath, ["scripts/code-bench.mjs", "--casos-arquivo", set, "--so", "edits", "--vezes", times], { env, encoding: "utf8", timeout: 60 * 60 * 1000 });
    const m = /Ctrl\+I: (\d+)\/(\d+) \(\d+%\) · mediana (\d+) ms/.exec(r.stdout || "");
    if (!m) { per[set] = "erro"; console.log(`${c.name} ${set}: sem resultado\n${String(r.stdout || r.stderr).slice(-400)}`); continue; }
    ok += Number(m[1]); n += Number(m[2]); ms.push(Number(m[3]));
    per[set] = `${m[1]}/${m[2]}`;
  }
  const row = { name: c.name, size: c.size, license: c.license, ok, n, pct: n ? Math.round((1000 * ok) / n) / 10 : 0, ms: ms.length ? Math.max(...ms) : null, per };
  rows.push(row);
  console.log(`${row.name}: ${ok}/${n} (${row.pct}%) · ${row.ms} ms · ${Object.entries(per).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
}
rows.sort((a, b) => b.pct - a.pct || a.size - b.size);
const table = ["| Modelo | Tamanho | Licença | Ctrl+I certo | Tempo (mediana) | " + sets.join(" | ") + " |", "|---|---|---|---|---|" + sets.map(() => "---|").join(""),
  ...rows.map((r) => `| ${r.name} | ${r.size} GB | ${r.license} | ${r.ok}/${r.n} (${r.pct}%) | ${r.ms ?? "—"} ms | ${sets.map((s) => r.per[s] || "—").join(" | ")} |`)].join("\n");
console.log(`\n${table}`);
if (arg("saida")) writeFileSync(arg("saida"), table);
