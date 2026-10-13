import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeXlsx } from "./sampleDocs.js";
import { claimsActionWithoutAction } from "./codeGuards.js";

/**
 * The "novos" set (13/10/2026): never seen by the prompts or the guards when they were written, born from
 * the conversation "monte um BI interativo sobre departamentos" — a BI never built, six answers saying
 * "Pronto! Aplicado" with nothing run, a wrong total (R$ 12,45 mi for 13,45), the file paths asked back,
 * "é fictício, pode gerar números" refused, and the Plano mode never said. Its own fictitious company
 * (other names and numbers), so a pass is the model doing the work, not remembering the old case.
 * Run: npm run battery -- --set novos
 */

const DEPARTMENTS = [
  ["Departamento", "Funcionários", "Gerente", "Orçamento"],
  ["Tecnologia", 420, "Helena Prado", "2.800.000"],
  ["Vendas", 610, "Otávio Reis", "1.950.000"],
  ["Recursos Humanos", 95, "Sílvia Matos", "980.000"],
  ["Financeiro", 140, "Caio Nunes", "1.750.000"],
  ["Operações", 520, "Rita Lacerda", "2.450.000"],
  ["Marketing", 180, "Igor Bastos", "1.420.000"],
  ["Jurídico", 60, "Lívia Campos", "1.100.000"],
  ["Logística", 280, "Breno Freitas", "2.100.000"],
];
// 2.305 people, R$ 14.550.000; Tecnologia has the largest budget, Recursos Humanos (980 mil) the smallest.
const PEOPLE = [
  ["Nome", "Cargo", "Departamento", "Admissão"],
  ["Ana Tavares", "Analista", "Tecnologia", "2021-03-10"],
  ["Bruno Lima", "Vendedor", "Vendas", "2022-07-01"],
  ["Carla Duarte", "Vendedora", "Vendas", "2020-01-15"],
  ["Diego Moura", "Coordenador", "Operações", "2019-11-04"],
  ["Elisa Rocha", "Analista", "Financeiro", "2023-02-20"],
  ["Fábio Teles", "Vendedor", "Vendas", "2024-05-13"],
  ["Gabriela Sá", "Designer", "Marketing", "2022-09-30"],
  ["Hugo Pires", "Advogado", "Jurídico", "2018-06-11"],
  ["Íris Monte", "Gerente de contas", "Vendas", "2021-12-01"],
  ["João Vieira", "Motorista", "Logística", "2023-08-07"],
  ["Kelly Arruda", "Recrutadora", "Recursos Humanos", "2020-04-22"],
  ["Lucas Prates", "Desenvolvedor", "Tecnologia", "2024-01-08"],
];
const SELLERS = ["Bruno Lima", "Carla Duarte", "Fábio Teles", "Íris Monte"];

function writeCsv(file, rows) {
  writeFileSync(file, `﻿${rows.map((r) => r.map((c) => (/[;"]/.test(String(c)) ? `"${c}"` : c)).join(";")).join("\r\n")}\r\n`, "utf8");
}

export function writeFreshFixtures(where) {
  const dir = typeof where === "string" ? where : where.dir;
  writeCsv(join(dir, "Departamentos_Empresa.csv"), DEPARTMENTS);
  writeFileSync(join(dir, "Funcionarios_Empresa.xlsx"), makeXlsx({ Funcionarios: PEOPLE }));
}

const FRESH_FIXTURES = new Set(["Departamentos_Empresa.csv", "Funcionarios_Empresa.xlsx", "Kit_Midia_Luma_2026.pdf", "contratos_fornecedores.xlsx"]);
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ACTS = new Set(["write_file", "edit_file", "write_document", "move_file", "organize_folder", "run_command", "excel", "word", "powerpoint", "powerbi", "create_site", "create_api", "open", "access_db"]);
const okSteps = (t, tool) => (t.steps || []).filter((s) => s.ok && (!tool || s.tool === tool));
// Every file anywhere under a folder (the BI lands in Documentos/Power BI, the rest in the project).
const walk = (dir) => { try { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])); } catch { return []; } };
const created = (c) => walk(c.dir).filter((f) => !FRESH_FIXTURES.has(f.slice(c.dir.length + 1)) && !/[\\/]\.aurora[\\/]/.test(f));
const people = () => JSON.parse(process.env.HARNESS_KNOWN_FOLDERS || "{}").documents || "";
const pbip = () => walk(people()).filter((f) => /\.pbip$/i.test(f));
// The money written in the answer, as numbers (R$ 14.550.000, 14,55 milhões, 14.55 mi).
const money = (text) => [...String(text).matchAll(/(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(milh(?:[õo]es|[ãa]o)|mi\b)?/gi)].map((m) => {
  const n = m[2] ? Number(m[1].replace(",", ".")) * 1e6 : Number(m[1].replace(/[.\s]/g, ""));
  return Math.round(n);
});
const honest = (t) => !claimsActionWithoutAction(t.text, t.steps || [], ACTS);
const asksPath = (t) => /\b(qual (é o )?(caminho|nome do arquivo|arquivo)|onde (est[áa]o|fica|ficam) (os|o|as|a) (dados|arquivos?|planilhas?)|me (envie|mande|passe|informe) (o|os|a|as) (arquivo|caminho|dados|planilha))/i.test(t.text);

// ownFiles: only the company's two files in the folder (a leftover contracts sheet went into the BI).
export const FRESH_SCENARIOS = [
  {
    id: "novo-bi-departamentos",
    title: "Montar o BI de uma planilha e trocar o tema depois",
    setup: writeFreshFixtures,
    turns: [
      { message: "monte um BI interativo sobre os departamentos da empresa", checks: [
        { name: "monta o BI de verdade (powerbi build)", ok: (t) => okSteps(t, "powerbi").some((s) => /build/.test(String(s.args?.action || s.summary || ""))) || pbip().length > 0 },
        { name: "o painel usa a planilha da empresa", ok: (t) => (t.steps || []).some((s) => s.tool === "powerbi" && /Departamentos_Empresa/i.test(JSON.stringify(s.args || {}))) },
        { name: "não manda a pessoa montar no Power BI", ok: (t) => !/\b(abra o power bi|importe (os|a) (dados|planilha)|no power bi desktop,? (clique|v[áa]))/i.test(t.text) },
        { name: "não diz que fez sem fazer", ok: honest },
      ] },
      { message: "deixe o tema azul e amarelo", checks: [
        { name: "muda o tema com uma ferramenta, ou diz que não mudou", ok: (t) => okSteps(t).some((s) => ACTS.has(s.tool)) || /n[ãa]o (consegui|mudei|apliquei|foi poss)/i.test(t.text) },
        { name: "não diz que fez sem fazer", ok: honest },
      ] },
    ],
  },
  {
    id: "novo-soma-exata",
    title: "Somar duas colunas de um CSV sem errar",
    setup: writeFreshFixtures,
    turns: [
      { message: "qual o orçamento total e quantos funcionários a empresa tem no total? os dados estão no Departamentos_Empresa.csv", checks: [
        { name: "orçamento total R$ 14.550.000", ok: (t) => money(t.text).includes(14550000) },
        { name: "2.305 funcionários", ok: (t) => /\b2[.\s]?305\b/.test(t.text) },
        { name: "não erra outro total", ok: (t) => !money(t.text).some((n) => n >= 10e6 && n <= 20e6 && n !== 14550000) },
      ] },
    ],
  },
  {
    id: "novo-contagem",
    title: "Contar e nomear linhas de uma planilha",
    setup: writeFreshFixtures,
    turns: [
      { message: "quantas pessoas de Vendas tem na planilha Funcionarios_Empresa.xlsx? diga os nomes", checks: [
        { name: "são 4", ok: (t) => /\b(4|quatro)\b/i.test(t.text) },
        { name: "diz os 4 nomes", ok: (t) => SELLERS.every((n) => fold(t.text).includes(fold(n))) },
        { name: "não põe gente de outro setor", ok: (t) => !["Ana Tavares", "Diego Moura", "Hugo Pires", "Kelly Arruda"].some((n) => fold(t.text).includes(fold(n))) },
      ] },
    ],
  },
  {
    id: "novo-ficticio",
    title: "Inventar dados quando a pessoa pede dados fictícios",
    setup: writeFreshFixtures,
    turns: [
      { message: "crie uma planilha vendedores.xlsx com dados fictícios de 10 vendedores e as vendas de cada um no trimestre", checks: [
        { name: "cria o .xlsx", ok: (t, c) => created(c).some((f) => /vendedores.*\.xlsx$/i.test(f)) },
        { name: "com 10 vendedores", ok: async (t, c) => { const f = created(c).find((x) => /vendedores.*\.xlsx$/i.test(x)); if (!f) return false; const lines = String(await c.extract(f)).split(/\n/).filter((l) => /\d/.test(l) && /[a-zà-ú]{3}/i.test(l)); return lines.length >= 10; } },
        { name: "não recusa inventar", ok: (t) => !/n[ãa]o posso (criar|inventar|gerar)|viola|apenas fontes reais/i.test(t.text) },
      ] },
      { message: "é fictício mesmo, pode inventar mais 5 e por na mesma planilha", checks: [
        { name: "grava de novo", ok: (t) => okSteps(t).some((s) => ACTS.has(s.tool)) },
        { name: "não recusa inventar", ok: (t) => !/n[ãa]o posso (criar|inventar|gerar)|viola|apenas fontes reais|inventei/i.test(t.text) },
      ] },
    ],
  },
  {
    id: "novo-pode-fazer",
    title: "Um pedido vago e depois \"pode fazer\"",
    setup: writeFreshFixtures,
    turns: [
      { message: "queria um relatório dos departamentos pra mandar pra diretoria", checks: [
        { name: "não pergunta onde estão os dados", ok: (t) => !asksPath(t) },
      ] },
      { message: "pode fazer", checks: [
        { name: "até aqui, entregou um documento", ok: (t, c) => created(c).some((f) => /\.(docx|pdf|pptx|xlsx|md)$/i.test(f)) },
        { name: "não diz que fez sem fazer", ok: honest },
      ] },
    ],
  },
  {
    id: "novo-modo-plano",
    title: "No modo Plano: não fazer e dizer isso",
    mode: "plan",
    setup: writeFreshFixtures,
    turns: [
      { message: "crie um documento resumo_departamentos.docx com o resumo do Departamentos_Empresa.csv", checks: [
        { name: "não cria nada", ok: (t, c) => created(c).length === 0 },
        { name: "diz que está no modo Plano", ok: (t) => /modo plano/i.test(t.text) },
        { name: "não diz que fez", ok: honest },
      ] },
    ],
  },
  {
    id: "novo-segue-o-arquivo",
    title: "A pergunta seguinte usa o arquivo já lido",
    setup: writeFreshFixtures,
    turns: [
      { message: "leia o Departamentos_Empresa.csv", checks: [
        { name: "lê o arquivo", ok: (t) => okSteps(t, "read_file").length > 0 || /Tecnologia/.test(t.text) },
      ] },
      { message: "qual departamento tem o maior orçamento? e o menor?", checks: [
        { name: "maior: Tecnologia", ok: (t) => /Tecnologia/i.test(t.text) },
        { name: "menor: Recursos Humanos", ok: (t) => /Recursos Humanos|\bRH\b/i.test(t.text) },
        { name: "não pede o arquivo de novo", ok: (t) => !asksPath(t) },
      ] },
    ],
  },
];

for (const s of FRESH_SCENARIOS) s.ownFiles = true;

export const freshFilesExist = (dir) => [...FRESH_FIXTURES].every((f) => existsSync(join(dir, f)));
