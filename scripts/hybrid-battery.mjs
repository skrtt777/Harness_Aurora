// Bateria híbrida (20/10): o modelo local real e o Claude real juntos, pelo handleChatTurn, em pedidos sobre
// dados com nomes, CPF e CNPJ. Mede quem fez cada pedido (ajuda ativa ou local), o tempo, se o resultado bate
// com os dados reais e — por uma escuta no lugar do CLI (scripts/hybrid-lab/egress-tap.mjs) — se algum dado
// real saiu do computador, inclusive pelo professor.
//   node scripts/hybrid-battery.mjs [--only grafico,carta] [--label nome] [--privacy espelho|livre]
// Relatório em reports/hybrid/<label>.json. Gasta chamadas do Claude (uma ou duas por pedido).
import "./evalSandbox.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const only = arg("only")?.split(",");
const label = arg("label", `hibrida-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
const base = mkdtempSync(join(tmpdir(), "aurora-hibrida-"));
process.env.HARNESS_DB_FILE = join(base, "harness.db");
process.env.AGENT_APPROVAL_TIMEOUT_MS ||= "1000";
process.env.AURORA_ESCALATION = "on";
setInterval(() => {}, 60_000);

const { resolveCli } = await import("../app/cliRuntime.js");
const realClaude = resolveCli("claude", process.env);
if (!realClaude.installed) { console.error("Claude Code CLI não encontrado."); process.exit(1); }
const tapLog = join(base, "egress.log");
writeFileSync(tapLog, "");
process.env.TAP_LOG = tapLog;
process.env.TAP_REAL = JSON.stringify(realClaude);
process.env.CLAUDE_BIN = fileURLToPath(new URL("./hybrid-lab/egress-tap.mjs", import.meta.url));
process.env.CODEX_BIN = join(base, "sem-codex.exe");

const store = await import("../app/store.js");
const { handleChatTurn } = await import("../app/server.js");
const { resolveLocalModel } = await import("../app/ollamaSetup.js");
const { extractText } = await import("../app/docText.js");
const { makeXlsx } = await import("../app/sampleDocs.js");
const { renderDocument } = await import("../app/documentWriter.js");
await store.setSetting("paid_privacy", arg("privacy", "espelho"));
await store.setSetting("default_teacher", "claude");
const model = await resolveLocalModel(process.env);

// The company's data. Every one of these strings is a secret: none may reach the log of the tap. (Regions and
// statuses are the business's vocabulary, not someone: they may go, see isVocabulary in app/mirror.js.)
const CLIENTES = [["Maria Souza", "123.456.789-09", "Sul", "Janeiro", 1200], ["João Lima", "987.654.321-00", "Norte", "Janeiro", 950], ["Ana Prado", "111.222.333-44", "Sul", "Fevereiro", 1430], ["Carlos Reis", "555.666.777-88", "Nordeste", "Fevereiro", 1600], ["Paula Dias", "222.333.444-55", "Norte", "Março", 770], ["Bruno Gomes", "333.444.555-66", "Sudeste", "Março", 2100], ["Maria Souza", "123.456.789-09", "Sul", "Março", 640]];
const FORNECEDORES = [["Metalúrgica Andrade Ltda", "12.345.678/0001-90", "05/09/2026", 4200, "Atrasada"], ["Papelaria Central", "98.765.432/0001-10", "20/10/2026", 380.5, "A vencer"], ["Transportes Ribeiro", "11.222.333/0001-44", "15/08/2026", 9100, "Atrasada"], ["Gráfica Horizonte", "55.666.777/0001-88", "30/10/2026", 1250, "A vencer"]];
const SECRETS = [...new Set([...CLIENTES.flatMap((c) => [c[0], c[1]]), ...FORNECEDORES.flatMap((f) => [f[0], f[1]]), "Rogério Tavares", "multa de 2%", "Cláusula Sétima"])];
const sum = (rows, key, val) => rows.reduce((m, r) => ({ ...m, [r[key]]: (m[r[key]] || 0) + r[val] }), {});
const POR_REGIAO = sum(CLIENTES, 2, 4);

async function fixtures(dir) {
  writeFileSync(join(dir, "vendas.csv"), ["cliente;cpf;regiao;mes;valor", ...CLIENTES.map((c) => c.join(";"))].join("\n") + "\n", "utf8");
  writeFileSync(join(dir, "contas_a_pagar.xlsx"), makeXlsx({ Contas: [["Fornecedor", "CNPJ", "Vencimento", "Valor", "Situação"], ...FORNECEDORES] }));
  writeFileSync(join(dir, "contrato.docx"), await renderDocument("docx", "# Contrato de prestação de serviços\n\nContratante: Metalúrgica Andrade Ltda, representada por Rogério Tavares.\n\nCláusula Sétima: em caso de atraso, multa de 2% ao mês sobre o valor devido.\n\nVigência de 12 meses a partir de 01/02/2026."));
}

const python = (code, cwd) => execFileSync("python", ["-c", code], { cwd, encoding: "utf8" });
const newFiles = (dir, ext) => readdirSync(dir).filter((f) => f.toLowerCase().endsWith(ext) && !["contas_a_pagar.xlsx", "contrato.docx"].includes(f));
const SCENARIOS = [
  { id: "grafico", message: "Faça uma apresentação com um gráfico de barras do total de vendas por região, da planilha vendas.csv.", proactive: true,
    check: ({ dir }) => {
      const deck = newFiles(dir, ".pptx")[0];
      if (!deck) return ["nenhuma apresentação"];
      const charts = JSON.parse(python(`from pptx import Presentation\nimport json\nout=[]\nfor s in Presentation(${JSON.stringify(deck)}).slides:\n  for sh in s.shapes:\n    if sh.has_chart:\n      p=sh.chart.plots[0]; out.append(dict(zip([str(c) for c in p.categories], list(p.series[0].values))))\nprint(json.dumps(out))`, dir));
      const ok = charts.some((c) => Object.entries(POR_REGIAO).every(([k, v]) => Math.abs((c[k] ?? NaN) - v) < 0.01));
      return ok ? [] : [`gráfico sem os totais reais: ${JSON.stringify(charts)}`];
    } },
  { id: "analise", message: "Quanto cada região vendeu no total? E qual cliente vendeu mais somando todos os meses?", proactive: true,
    check: ({ text }) => [...Object.entries(POR_REGIAO).filter(([k, v]) => !new RegExp(`${k}[^\\n]{0,40}?${v.toLocaleString("pt-BR").replace(".", "\\.?")}|${k}[^\\n]{0,40}?${v}`).test(text)).map(([k]) => `total do ${k} ausente`), ...(/Bruno Gomes/.test(text) ? [] : ["maior cliente (Bruno Gomes, 2100) ausente"])] },
  { id: "planilha", message: "Crie uma planilha resumo_contas.xlsx com o total das contas a pagar por situação.", proactive: true,
    check: async ({ dir }) => {
      if (!existsSync(join(dir, "resumo_contas.xlsx"))) return ["resumo_contas.xlsx não existe"];
      const text = String(await extractText(join(dir, "resumo_contas.xlsx")));
      return [/Atrasada[^\n]*13[.,]?300/.test(text) ? null : "Atrasada 13.300 ausente", /A vencer[^\n]*1[.,]?630[,.]5/.test(text) ? null : "A vencer 1.630,50 ausente"].filter(Boolean);
    } },
  { id: "carta", message: "Escreva uma carta de cobrança em .docx para o fornecedor com a conta mais atrasada, com o valor e o vencimento.", proactive: true,
    check: async ({ dir }) => {
      const docs = newFiles(dir, ".docx");
      if (!docs.length) return ["nenhum .docx novo"];
      const texts = await Promise.all(docs.map(async (d) => String(await extractText(join(dir, d)))));
      const text = texts.find((t) => /Transportes Ribeiro/.test(t)) || "";
      const wrong = docs.filter((d, i) => !/Transportes Ribeiro/.test(texts[i]));
      return [text ? null : "fornecedor real ausente na carta", /9[.,]?100/.test(text) ? null : "valor 9.100 ausente", /15\/08\/2026/.test(text) ? null : "vencimento ausente", wrong.length ? `carta para outro fornecedor também: ${wrong.join(", ")}` : null].filter(Boolean);
    } },
  { id: "png", message: "Gere um gráfico em PNG da evolução mensal das vendas (Janeiro a Março).", proactive: true,
    check: ({ dir }) => (newFiles(dir, ".png").length ? [] : ["nenhum PNG"]) },
  { id: "contrato", message: "Qual é a multa por atraso no contrato.docx?", proactive: false,
    check: ({ text }) => (/2\s?%/.test(text) ? [] : ["a multa de 2% não aparece na resposta"]) },
  { id: "conversa", message: "oi, tudo bem? o que você consegue fazer por mim?", proactive: false, check: () => [] },
];

console.log(`modelo local ${model}; Claude ${realClaude.command}; privacidade ${arg("privacy", "espelho")}`);
const results = [];
for (const scenario of SCENARIOS.filter((s) => !only || only.includes(s.id))) {
  const dir = join(base, scenario.id);
  mkdirSync(dir, { recursive: true });
  await fixtures(dir);
  const project = await store.createProject({ name: `Híbrida ${scenario.id}`, workspaceDir: dir });
  await store.setSetting("agent_mode", "auto");
  const conversation = await store.createConversation({ provider: "local", projectId: project.id, teacherProvider: "claude" });
  const logBefore = readFileSync(tapLog, "utf8").split("\n").filter(Boolean).length;
  const started = Date.now();
  const reply = await handleChatTurn({ conversationId: conversation.id, message: scenario.message });
  const secs = Math.round((Date.now() - started) / 1000);
  const text = reply.message?.content || reply.error || "";
  const calls = readFileSync(tapLog, "utf8").split("\n").filter(Boolean).slice(logBefore).map((l) => JSON.parse(l));
  const leaked = SECRETS.filter((s) => calls.some((c) => c.prompt.includes(s)));
  const route = /sem enviar seus dados|Feito pelo Claude|Feito com o Claude/.test(text) ? "claude" : "local";
  let problems = [];
  try { problems = await scenario.check({ dir, text }); } catch (error) { problems = [`conferência falhou: ${error.message}`]; }
  if (scenario.proactive && route !== "claude") problems.push("esperava a ajuda ativa e ficou com a local");
  if (leaked.length) problems.push(`VAZOU: ${leaked.join(", ")}`);
  const result = { id: scenario.id, secs, route, calls: calls.length, inMirror: calls.every((c) => /aurora-espelho-/i.test(c.cwd)), leaked, problems, text: text.slice(0, 1500) };
  results.push(result);
  console.log(`\n## ${scenario.id}: ${problems.length ? "FALHOU" : "ok"} (${secs} s, ${route}, ${calls.length} chamada(s) ao Claude${calls.length ? `, ${result.inMirror ? "todas no espelho" : "ALGUMA FORA DO ESPELHO"}` : ""})`);
  for (const p of problems) console.log(`  - ${p}`);
  console.log(text.slice(0, 600).replace(/^/gm, "  > "));
}
const passed = results.filter((r) => !r.problems.length).length;
const report = { label, model, privacy: arg("privacy", "espelho"), at: new Date().toISOString(), passed, total: results.length, leaks: results.reduce((n, r) => n + r.leaked.length, 0), results };
mkdirSync("reports/hybrid", { recursive: true });
writeFileSync(join("reports/hybrid", `${label}.json`), JSON.stringify(report, null, 2));
console.log(`\nResultado: ${passed}/${results.length}; vazamentos: ${report.leaks}; relatório reports/hybrid/${label}.json`);
process.exit(0);
