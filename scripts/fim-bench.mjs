// How good and how fast the gray suggestion (app/codeAssist.js) is on each way to ask the local model:
// Ollama raw FIM, llama-server /completion with the FIM tokens (with and without the file's name) and
// llama-server /infill. Small cases in JS, Python, TS, Java and C++, each with what a right answer
// looks like. A test llama-server on its own port; a temporary database; nothing is downloaded.
//   node scripts/fim-bench.mjs
import "./evalSandbox.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-fim-")), "harness.db");
process.env.LLAMA_SERVER_PORT ||= "18192";
const { resolveLocalModel } = await import("../app/ollamaSetup.js");
const { ensureLlamaServer, stopLlamaServer } = await import("../app/llamaServer.js");
const { cleanCompletion } = await import("../app/codeAssist.js");

const CASES = [
  { file: "media.js", prefix: "function media(numeros) {\n  if (!numeros.length) return 0;\n  const total = ", suffix: "\n  return total / numeros.length;\n}\n", ok: /reduce|for/ },
  { file: "media.py", prefix: "def media(valores):\n    if not valores:\n        return 0\n    total = ", suffix: "\n    return total / len(valores)\n", ok: /sum\(valores\)|sum\(/ },
  { file: "fat.py", prefix: "def fatorial(n):\n    if n <= 1:\n        return 1\n    ", suffix: "\n", ok: /return n \* fatorial\(n ?- ?1\)/ },
  { file: "nomes.js", prefix: "const usuarios = [{ nome: 'Ana', idade: 31 }, { nome: 'Bruno', idade: 25 }];\nconst nomes = usuarios.map(", suffix: ");\n", ok: /\.nome/ },
  { file: "adultos.js", prefix: "const pessoas = [{ nome: 'Ana', idade: 31 }, { nome: 'Leo', idade: 12 }];\nconst adultos = pessoas.filter(", suffix: ");\n", ok: /idade\s*>=?\s*18/ },
  { file: "cpf.ts", prefix: "export function soDigitos(cpf: string): string {\n  return cpf.", suffix: "\n}\n", ok: /replace\(\/\\D\/g|replace\(\/\[\^0-9\]\/g|replace\(\/\[\^\\d\]\/g/ },
  { file: "server.js", prefix: "const http = require('node:http');\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { 'content-type': 'application/json' });\n  ", suffix: "\n});\nserver.listen(3000);\n", ok: /res\.end\(/ },
  { file: "Soma.java", prefix: "public class Soma {\n    public static int soma(int[] v) {\n        int total = 0;\n        for (int x : v) ", suffix: "\n        return total;\n    }\n}\n", ok: /total\s*\+=\s*x/ },
  { file: "max.cpp", prefix: "#include <vector>\nint maior(const std::vector<int>& v) {\n  int m = v[0];\n  for (int x : v) ", suffix: "\n  return m;\n}\n", ok: /if\s*\(x\s*>\s*m\)|std::max|m\s*=\s*\(?x\s*>\s*m/ },
  { file: "util.py", prefix: "import json\n\ndef ler_json(caminho):\n    with open(caminho, encoding='utf-8') as f:\n        ", suffix: "\n", ok: /return json\.load\(f\)/ },
  { file: "vendas.js", prefix: "// total vendido por vendedor\nfunction totalPorVendedor(vendas) {\n  const total = {};\n  for (const v of vendas) {\n    ", suffix: "\n  }\n  return total;\n}\n", ok: /total\[v\.vendedor\]/ },
  { file: "test.js", prefix: "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { soma } from './soma.js';\n\ntest('soma dois números', () => {\n  ", suffix: "\n});\n", ok: /assert\.(strictEqual|equal|deepEqual)\(soma\(/ },
];
const FIM = (c, header) => `<|fim_prefix|>${header ? `<|file_sep|>${c.file}\n` : ""}${c.prefix}<|fim_suffix|>${c.suffix}<|fim_middle|>`;
const STOP = ["<|fim_pad|>", "<|endoftext|>", "<|im_end|>", "<|fim_prefix|>", "<|file_sep|>", "<|repo_name|>"];

const model = await resolveLocalModel();
const llama = await ensureLlamaServer({ model, contextTokens: 8192 });
console.log(`modelo ${model} · llama-server ${llama || "não subiu"}`);
const post = async (url, body) => { const t = Date.now(); const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); return { d, ms: Date.now() - t }; };
const ways = {
  "ollama raw": async (c) => { const { d, ms } = await post("http://127.0.0.1:11434/api/generate", { model, prompt: FIM(c, true), raw: true, stream: false, options: { num_predict: 64, temperature: 0.1, stop: STOP } }); return { text: d.response, ms }; },
  ...(llama ? {
    "llama /completion + arquivo": async (c) => { const { d, ms } = await post(`${llama}/completion`, { prompt: FIM(c, true), n_predict: 64, temperature: 0.1, stop: STOP, cache_prompt: true }); return { text: d.content, ms }; },
    "llama /completion": async (c) => { const { d, ms } = await post(`${llama}/completion`, { prompt: FIM(c, false), n_predict: 64, temperature: 0.1, stop: STOP, cache_prompt: true }); return { text: d.content, ms }; },
    "llama /infill": async (c) => { const { d, ms } = await post(`${llama}/infill`, { input_prefix: c.prefix, input_suffix: c.suffix, n_predict: 64, temperature: 0.1, stop: STOP, cache_prompt: true }); return { text: d.content ?? d.error?.message, ms }; },
  } : {}),
};
for (const [name, ask] of Object.entries(ways)) {
  await ask(CASES[0]).catch(() => null);           // warm: the model in memory first
  let right = 0; const times = []; const wrong = [];
  for (const c of CASES) {
    const r = await ask(c).catch((e) => ({ text: `ERRO ${e.message}`, ms: 0 }));
    const text = cleanCompletion(r.text, { prefix: c.prefix, suffix: c.suffix, maxLines: c.suffix.split("\n")[0].trim() ? 1 : 8 });
    times.push(r.ms);
    if (c.ok.test(text)) right += 1; else wrong.push(`${c.file}: ${JSON.stringify(text).slice(0, 70)}`);
  }
  times.sort((a, b) => a - b);
  console.log(`\n${name}: ${right}/${CASES.length} certas · mediana ${times[Math.floor(times.length / 2)]} ms · pior ${times.at(-1)} ms`);
  for (const w of wrong) console.log(`  ✗ ${w}`);
}
stopLlamaServer();
process.exit(0);
