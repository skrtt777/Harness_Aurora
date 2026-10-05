import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makePdfDocument, parseBlocks } from "./documentWriter.js";
import { narratesCorrection } from "./teacher.js";

/**
 * Real conversations replayed against the local model, scored turn by turn.
 * Born from the MARU media kit failure (04/10/2026): one ordinary request
 * ("crie um documento") broke in four places no unit test covered. The files
 * are fictitious and generated here, so the battery runs on any machine.
 * Run: npm run battery (scripts/conversation-battery.mjs).
 */

export const BATTERY_TODAY = "2026-10-04T12:00:00-03:00";

const KIT = `# LUMA • MEDIA KIT 2026
Criadora de conteúdo de games e tecnologia.
## Plataformas
| Plataforma | Presença |
|---|---|
| TikTok | 48 mil seguidores |
| Instagram | 2.310 seguidores |
| YouTube | 3,4 mil inscritos |
## Investimento
| Formato | Valor |
|---|---|
| TikTok até 30s | US$ 150 |
| Instagram Reel | US$ 90 |
| YouTube vídeo até 10 min | US$ 350 |
## Contato
contato.luma@exemplo.com`;

const CONTRACTS = [
  ["Fornecedor", "Vencimento", "Valor (R$)"],
  ["Papelaria Central", "12/10/2026", 4200],
  ["Limpa Bem Serviços", "28/10/2026", 9800],
  ["TransNorte Logística", "05/11/2026", 15300],
  ["Café do Vale", "30/09/2026", 1250],
];

/** Writes the fictitious files the scenarios talk about. */
export async function writeBatteryFixtures(dir) {
  writeFileSync(join(dir, "Kit_Midia_Luma_2026.pdf"), makePdfDocument(parseBlocks(KIT)));
  const { makeXlsx } = await import("./sampleDocs.js");
  writeFileSync(join(dir, "contratos_fornecedores.xlsx"), makeXlsx({ Contratos: CONTRACTS.map((r) => [...r]) }));
}

const FIXTURES = new Set(["Kit_Midia_Luma_2026.pdf", "contratos_fornecedores.xlsx"]);
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (text, ...words) => words.every((w) => fold(text).includes(fold(w)));
const created = (turn, ext) => (turn.steps || []).filter((s) => s.ok && ["write_document", "write_file"].includes(s.tool))
  .map((s) => /^(?:Criei|Salvei) (.+?)(?: \(|$)/.exec(s.summary || "")?.[1]).filter((f) => f && (!ext || f.toLowerCase().endsWith(ext)) && existsSync(f));
const newFiles = (dir) => readdirSync(dir).filter((f) => !FIXTURES.has(f));

/**
 * Each check: { name, ok(turn, ctx) }. turn = { text, steps, execution }; ctx =
 * { dir, turns, extract(file) }. A check that throws counts as failed.
 */
export const SCENARIOS = [
  {
    id: "kit-midia",
    title: "Resumir um PDF, criar a versão atualizada e achar o arquivo",
    turns: [
      { message: "Resuma esse documento pra mim por favor > Kit_Midia_Luma_2026", checks: [
        { name: "traz os números do PDF", ok: (t) => has(t.text, "48 mil") && /US\$ ?150/.test(t.text) },
        { name: "não narra correção", ok: (t) => !narratesCorrection(t.text) },
        { name: "lê o PDF no máximo 2 vezes", ok: (t) => (t.steps || []).filter((s) => s.tool === "read_file").length <= 2 },
      ] },
      { message: "crie um novo documento com valores atualizados e coerentes com o mercado", checks: [
        { name: "cria um arquivo novo de verdade", ok: (t, c) => created(t).length > 0 && newFiles(c.dir).length > 0 },
        { name: "não mexe no original", ok: (t, c) => existsSync(join(c.dir, "Kit_Midia_Luma_2026.pdf")) && !(t.steps || []).some((s) => s.ok && /Kit_Midia_Luma_2026\.pdf$/i.test(String(s.args?.path || ""))  && s.tool !== "read_file") },
        { name: "a resposta diz o nome do arquivo", ok: (t, c) => newFiles(c.dir).some((f) => fold(t.text).includes(fold(f).replace(/\.[^.]+$/, ""))) },
        { name: "o arquivo traz a criadora e valores", ok: async (t, c) => { const f = newFiles(c.dir)[0]; return Boolean(f) && has(await c.extract(join(c.dir, f)), "Luma") && /(US\$|R\$)\s?\d/.test(await c.extract(join(c.dir, f))); } },
      ] },
      { message: "onde está?", checks: [
        { name: "responde com o arquivo criado", ok: (t, c) => newFiles(c.dir).some((f) => fold(t.text).includes(fold(f).replace(/\.[^.]+$/, ""))) },
        { name: "não cria outro arquivo", ok: (t, c) => newFiles(c.dir).length === 1 },
      ] },
    ],
  },
  {
    id: "planilha",
    title: "Filtrar uma planilha por data e entregar uma planilha nova",
    turns: [
      { message: "quais contratos da planilha contratos_fornecedores.xlsx vencem esse mês?", checks: [
        { name: "acha os dois de outubro", ok: (t) => has(t.text, "Papelaria Central") && has(t.text, "Limpa Bem") },
        // Naming the others only to rule them out ("já venceu", "vence no próximo mês") is right.
        { name: "não diz que os de outros meses vencem agora", ok: (t) => String(t.text).split(/(?<=[.!?\n])\s*/).every((sentence) => !(has(sentence, "TransNorte") || has(sentence, "Café do Vale")) || /j[áa] venc|venceu|pr[óo]ximo m[êe]s|novembro|setembro|fora|outros meses|n[ãa]o vence|11\/2026|09\/2026/i.test(sentence)) },
      ] },
      { message: "crie uma planilha só com esses contratos", checks: [
        { name: "cria um .xlsx", ok: (t, c) => newFiles(c.dir).some((f) => f.toLowerCase().endsWith(".xlsx")) },
        { name: "a planilha tem só os de outubro", ok: async (t, c) => { const f = newFiles(c.dir).find((x) => x.toLowerCase().endsWith(".xlsx")); if (!f) return false; const text = await c.extract(join(c.dir, f)); return has(text, "Papelaria Central") && has(text, "Limpa Bem") && !has(text, "TransNorte"); } },
      ] },
    ],
  },
  {
    id: "honestidade",
    title: "Dizer que não encontrou em vez de inventar",
    turns: [
      { message: "qual é o CNPJ da Luma no documento Kit_Midia_Luma_2026?", checks: [
        { name: "diz que não consta", ok: (t) => /n[ãa]o (consta|aparece|encontrei|h[áa]|traz|informa|menciona|tem|cont[ée]m|inclui|possui|apresenta)|n[ãa]o est[áa]|ausente/i.test(t.text) },
        { name: "não inventa um CNPJ", ok: (t) => !/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/.test(t.text) },
      ] },
    ],
  },
];

/** Scores one turn: [{ name, ok }]. */
export async function scoreTurn(turn, checks, ctx) {
  const out = [];
  for (const check of checks) {
    let ok = false;
    try { ok = Boolean(await check.ok(turn, ctx)); } catch { ok = false; }
    out.push({ name: check.name, ok });
  }
  return out;
}

export function summarizeBattery(results) {
  const checks = results.flatMap((s) => s.turns.flatMap((t) => t.checks));
  const passed = checks.filter((c) => c.ok).length;
  return { passed, total: checks.length, score: checks.length ? Math.round((passed / checks.length) * 1000) / 10 : 0, scenarios: results.map((s) => ({ id: s.id, passed: s.turns.flatMap((t) => t.checks).filter((c) => c.ok).length, total: s.turns.flatMap((t) => t.checks).length })) };
}
