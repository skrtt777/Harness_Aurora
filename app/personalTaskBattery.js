import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { extractText } from "./docText.js";

/**
 * Phase F of docs/AGENTES_ROTEIRO.md: personal agents (organize files, code and test, research
 * and summarize), each task with a result the computer can check. The folders are generated here.
 */

const ORGANIZE = {
  Documentos: ["relatorio anual.pdf", "contrato aluguel.docx", "anotacoes.txt"],
  Imagens: ["foto praia.jpg", "print tela.png"],
  Planilhas: ["gastos.xlsx", "contatos.csv"],
  Compactados: ["backup fotos.zip"],
};

const MEDIA_JS = `// Média de uma lista de números; lista vazia dá 0.
export function media(numeros) {
  let soma = 0;
  for (let i = 0; i <= numeros.length; i++) soma += numeros[i];
  return soma / (numeros.length + 1);
}
`;
const MEDIA_TEST = `import test from "node:test";
import assert from "node:assert/strict";
import { media } from "./media.js";

test("média de vários números", () => assert.equal(media([2, 4, 6]), 4));
test("média de um número", () => assert.equal(media([7]), 7));
test("lista vazia dá 0", () => assert.equal(media([]), 0));
`;

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
const nodeTest = (dir) => new Promise((resolve) => execFile(process.execPath, ["--test"], { cwd: dir, timeout: 60_000, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }, (error, stdout) => resolve({ ok: !error, out: String(stdout).slice(-600) })));

export const PERSONAL_TASKS = [
  {
    id: "organizar-pasta",
    request: "Organize esta pasta: coloque cada arquivo numa subpasta por tipo — Documentos (pdf, docx, txt), Imagens (jpg, png), Planilhas (xlsx, csv) e Compactados (zip). Não apague nada.",
    setup(dir) {
      for (const name of Object.values(ORGANIZE).flat()) writeFileSync(join(dir, name), `conteúdo de ${name}`);
    },
    async check(dir) {
      // Windows folders ignore case: "documentos" is "Documentos".
      const all = filesUnder(dir).map((f) => relative(dir, f).replace(/\\/g, "/").toLowerCase());
      const names = Object.values(ORGANIZE).flat().map((n) => n.toLowerCase());
      const expected = Object.entries(ORGANIZE).flatMap(([folder, list]) => list.map((n) => `${folder}/${n}`.toLowerCase()));
      const misplaced = names.filter((name) => !expected.includes(all.find((f) => f.endsWith(`/${name}`) || f === name)));
      return [
        { name: "nenhum arquivo perdido", ok: names.every((name) => all.some((f) => f.split("/").pop() === name)) },
        { name: "cada arquivo na subpasta do seu tipo", ok: misplaced.length === 0, detail: misplaced.join(", ") },
        { name: "nada solto na raiz", ok: !all.some((f) => !f.includes("/") && names.includes(f)) },
      ];
    },
  },
  {
    id: "corrigir-codigo",
    request: "Os testes em media.test.js estão falhando. Corrija o código de media.js para todos passarem (rode node --test para conferir), sem mudar os testes.",
    setup(dir) {
      writeFileSync(join(dir, "media.js"), MEDIA_JS);
      writeFileSync(join(dir, "media.test.js"), MEDIA_TEST);
      writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
      this.testHash = sha(join(dir, "media.test.js"));
    },
    async check(dir) {
      const result = await nodeTest(dir);
      return [
        { name: "os testes passam", ok: result.ok, detail: result.ok ? "" : result.out },
        { name: "o arquivo de testes não mudou", ok: existsSync(join(dir, "media.test.js")) && sha(join(dir, "media.test.js")) === this.testHash },
      ];
    },
  },
  {
    id: "pesquisar-resumir",
    online: true,
    request: "Pesquise na web o que é o protocolo HTTP/3 e por que ele usa QUIC. Salve um resumo em Word com pelo menos 3 fontes (links) no fim.",
    setup() {},
    async check(dir, run) {
      const doc = filesUnder(dir).find((f) => [".docx", ".md", ".pdf"].includes(extname(f).toLowerCase()));
      const text = doc ? await extractText(doc).catch(() => "") : "";
      const links = new Set(String(text).match(/https?:\/\/[^\s)\]|]+/g) || []);
      return [
        { name: "salvou um documento", ok: Boolean(doc) },
        { name: "fala de HTTP/3 e QUIC", ok: /HTTP\/3/i.test(text) && /QUIC/i.test(text) },
        { name: "cita 3 ou mais fontes", ok: links.size >= 3, detail: `${links.size} link(s)` },
        { name: "pesquisou de verdade", ok: (run.steps || []).some((s) => /^web_/.test(s)) },
      ];
    },
  },
];

export function prepareTask(task, base, run) {
  const dir = join(base, `${task.id}-${run}`);
  mkdirSync(dir, { recursive: true });
  task.setup(dir);
  return dir;
}

export const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
