// The powerbi tool: a complete BI from the person's spreadsheets, and the semantic model of an open Power
// BI (read it, ask it with DAX, add and fix measures, relationships and formats — each measure checked and
// undone if it fails). The engine is app/powerbi.js; the design, app/powerbiDesign.js.
import { existsSync } from "node:fs";
import { buildReport, connectReport, connectedReport, modelNames, pbiRequest, rememberModel } from "../powerbi.js";
import { desktopRequest } from "../desktop.js";
import { expandPath, resolveExisting } from "./files.js";

const ok = (reply) => { if (!reply.ok) throw new Error(reply.error); return reply.text; };
const NEXT = "\nAgora diga à pessoa, em 2-3 frases, o que ficou pronto (os números principais) e pergunte se está certo, com **Quer ajustar?** e opções numeradas (ex.: 1. Está ótimo (recomendado) 2. Criar outra medida 3. Mudar o nome do painel).";

async function resolveFile(path, ctx) {
  const direct = expandPath(String(path || ""), ctx.knownFolders, ctx.workspace);
  if (direct && existsSync(direct)) return direct;
  const found = await resolveExisting(String(path || ""), ctx).catch(() => null);
  if (found && existsSync(found)) return found;
  throw new Error(`Não achei o arquivo "${path}". Diga o caminho ou o nome exato (ex.: Documentos/vendas.xlsx).`);
}

/** "Produto" -> 'Produtos'[Produto], from the model's own description. */
export function columnRef(modelText, name) {
  if (/\[.+\]$/.test(String(name).trim())) return String(name).trim();
  const wanted = String(name).trim().toLowerCase();
  let table = null;
  const hits = [];
  for (const line of String(modelText).split("\n")) {
    const t = /^Tabela (.+?)( \(calculada\))?( \[oculta\])?:$/.exec(line);
    if (t) { table = t[1]; continue; }
    const cols = /^\s+colunas: (.*)$/.exec(line);
    if (cols && table) for (const c of cols[1].split(/, (?=[^,]+ \()/)) { const n = c.replace(/ \(.*$/, ""); if (n.toLowerCase() === wanted) hits.push(`'${table.replace(/'/g, "''")}'[${n}]`); }
  }
  // A dimension table's column wins over the fact's copy of it (it filters every table).
  if (!hits.length) throw new Error(`Não há coluna "${name}" no modelo. Veja as colunas com action=model.`);
  return hits.length > 1 ? hits.find((h) => !/Vendas|Fato|Dados/i.test(h)) || hits[0] : hits[0];
}

/** Measures with their format strings, and numeric columns with their tables, from the model text. */
export function modelIndex(modelText) {
  const measures = new Map();
  const numeric = new Map();
  let table = null;
  for (const line of String(modelText).split("\n")) {
    const t = /^Tabela (.+?)( \(calculada\))?( \[oculta\])?:$/.exec(line);
    if (t) { table = t[1]; continue; }
    const m = /^\s+medida \[([^\]]+)\] = .*?(?:\s{2}\(formato (.*)\))?$/.exec(line);
    if (m) { measures.set(m[1].toLowerCase(), { name: m[1], format: m[2] || "" }); continue; }
    const cols = /^\s+colunas: (.*)$/.exec(line);
    if (cols && table) for (const c of cols[1].split(/, (?=[^,]+ \()/)) { const [, n, kind] = /^(.*?) \(([^,)]+)/.exec(c) || []; if (n && /número|inteiro|decimal/.test(kind)) numeric.set(n.toLowerCase(), { table, name: n }); }
  }
  return { measures, numeric };
}

/**
 * A measure written by a small model, made valid where the intent is plain: "[Valor total] - [Custo]"
 * names columns as if they were measures (a DAX error) and becomes SUM('Vendas'[Valor total]) - ….
 */
export function fixMeasureRefs(expression, modelText) {
  const { measures, numeric } = modelIndex(modelText);
  return String(expression).replace(/(^|[^\w\]'])\[([^\]]+)\]/g, (whole, before, name) => {
    if (measures.has(name.toLowerCase())) return whole;
    const col = numeric.get(name.toLowerCase());
    return col ? `${before}SUM('${col.table.replace(/'/g, "''")}'[${col.name}])` : whole;
  });
}

/** The simple question ("Faturamento por produto, top 5, em 2026") as DAX. */
export function simpleDax({ measure, by, top, filter }, modelText) {
  const m = `[${String(measure).replace(/^\[|\]$/g, "")}]`;
  // Also the value as the report shows it ("66,0%", "R$ 11.382,00"): 0,66 read as 0,66% before.
  const format = modelIndex(modelText).measures.get(String(measure).replace(/^\[|\]$/g, "").toLowerCase())?.format;
  const shown = format ? `, "Exibido", FORMAT(${m}, "${format.replace(/"/g, "\"\"")}")` : "";
  const filters = String(filter || "").split(/;\s*/).filter(Boolean).map((f) => {
    const [, column, value] = /^(.+?)\s*=\s*(.+)$/.exec(f) || [];
    if (!column) throw new Error(`Filtro "${f}": use Coluna=valor (ex.: Ano=2026).`);
    const v = /^-?\d+([.,]\d+)?$/.test(value.trim()) ? value.trim().replace(",", ".") : `"${value.trim().replace(/^["']|["']$/g, "").replace(/"/g, "\"\"")}"`;
    return `KEEPFILTERS(TREATAS({${v}}, ${columnRef(modelText, column)}))`;
  });
  if (!by) {
    const value = filters.length ? `CALCULATE(${m}, ${filters.join(", ")})` : m;
    return `EVALUATE ROW("${String(measure).replace(/"/g, "")}", ${value}${format ? `, "Exibido", FORMAT(${value}, "${format.replace(/"/g, "\"\"")}")` : ""})`;
  }
  const groups = String(by).split(/\s*,\s*/).map((b) => columnRef(modelText, b));
  const table = `SUMMARIZECOLUMNS(${[...groups, ...filters].join(", ")}, "Valor", ${m}${shown})`;
  return top ? `EVALUATE TOPN(${Number(top)}, ${table}, [Valor], DESC) ORDER BY [Valor] DESC` : `EVALUATE ${table} ORDER BY [Valor] DESC`;
}

const ASKS_PBI = /power ?bi|\bbi\b|dashboard|painel|modelo sem[âa]ntico|\bdax\b|medida|\.pbix|\.pbip/i;

export const powerBiTools = [
  {
    name: "powerbi",
    description: "Power BI. action=build cria um BI completo a partir de planilhas (files: [\"Documentos/vendas.xlsx\"], .xlsx ou .csv; name: o título do painel): modelo semântico (tabelas, calendário, relações, medidas em R$) e 3 páginas (visão geral, detalhamento, tendência), e abre no Power BI Desktop já atualizado. Num Power BI aberto: action=connect (window: parte do título, se houver vários), action=model mostra tabelas, colunas, medidas e relações; action=query responde com números — use measure + by (+ top, filter): ex. \"qual produto vendeu mais em 2026\" = measure \"Faturamento\", by \"Produto\", top 1, filter \"Ano=2026\"; dax só se isso não bastar; action=change altera o modelo (ops: [{op:\"measure\", name, expression, format}], a expressão reaproveitando as medidas que existem, ex. DIVIDE([Lucro], [Qtd. de pedidos]); também column, relationship {from:\"Vendas[Produto]\", to:\"Produtos[Produto]\"}, format, hide, rename, delete) — cada medida é conferida e desfeita se der erro; action=refresh atualiza os dados; action=save salva o arquivo aberto.",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["build", "connect", "model", "query", "change", "refresh", "save"] },
      files: { type: "array", items: { type: "string" }, description: "planilhas .xlsx/.csv (build)" },
      name: { type: "string", description: "título do painel (build)" },
      folder: { type: "string", description: "onde criar o projeto (build; padrão Documentos/Power BI)" },
      window: { type: "string", description: "parte do título do Power BI aberto (connect)" },
      measure: { type: "string" }, by: { type: "string" }, top: { type: "number" }, filter: { type: "string" },
      dax: { type: "string", description: "consulta DAX que começa com EVALUATE" },
      ops: { type: "array", items: { type: "object" }, description: "mudanças no modelo (change)" },
    }, required: ["action"] },
    stage: (a) => ({ build: "Montando o Power BI…", connect: "Conectando ao Power BI…", model: "Lendo o modelo semântico…", query: "Consultando o Power BI…", change: "Alterando o modelo semântico…", refresh: "Atualizando os dados do Power BI…", save: "Salvando o Power BI…" }[a.action] || "Usando o Power BI…"),
    describe: (a, ctx) => {
      if (a.action === "build") {
        const folder = expandPath(a.folder || "Documentos/Power BI", ctx.knownFolders, ctx.workspace);
        return { kind: "write", paths: [folder], summary: `Criar o painel do Power BI em ${folder}` };
      }
      // Changing or saving the person's open report: their authorization, once per turn.
      if (a.action === "change" || a.action === "save" || a.action === "refresh") return { kind: "desktop", program: "PBIDesktop", summary: a.action === "change" ? `Alterar o modelo do Power BI: ${(a.ops || []).map((o) => `${o.op} ${o.name || o.column || o.from || ""}`).join(", ")}` : a.action === "save" ? "Salvar o arquivo do Power BI" : "Atualizar os dados do Power BI" };
      return { kind: "meta" };
    },
    async run(args, ctx) {
      const action = args.action;
      const conversation = ctx.conversationId || "";
      if (action === "build") {
        if (!ASKS_PBI.test(String(ctx.request || "")) && !args.__fromOpen) throw new Error("A pessoa não pediu um Power BI/painel: para uma planilha ou relatório comum, use write_document.");
        const files = [args.files].flat().filter(Boolean);
        if (!files.length) throw new Error("Diga as planilhas em files (ex.: [\"Documentos/vendas.xlsx\"]).");
        const paths = [];
        for (const f of files) paths.push(await resolveFile(f, ctx));
        const folder = expandPath(args.folder || "Documentos/Power BI", ctx.knownFolders, ctx.workspace);
        const r = await buildReport({ files: paths, folder, name: args.name, conversationId: conversation, onStage: (s) => ctx.onStage?.(s) });
        const pages = r.plan.pages.map((p) => `${p.displayName} (${p.visuals.filter((v) => v.type !== "textbox").length} visuais)`).join(", ");
        return [
          `Pronto: o painel "${r.plan.name}" está aberto no Power BI Desktop, na frente da pessoa (projeto em ${r.folder}).`,
          r.refreshed,
          `Números dos cartões (todos os dados):\n${r.checks}`,
          `Páginas: ${pages}.`,
          r.plan.summary,
        ].join("\n") + NEXT;
      }
      if (action === "connect") {
        const c = await connectReport(conversation, args.window);
        return `Conectei ao Power BI "${c.title}".\n${c.text}\nAgora pergunte à pessoa o que fazer, com 2 ou 3 sugestões numeradas em **Quer ajustar?** (ex.: 1. Responder uma pergunta sobre os números (recomendado) 2. Criar uma medida 3. Revisar o modelo).`;
      }
      if (!connectedReport(conversation)) {
        // A report opened by the person since: connect to it on the way.
        await connectReport(conversation, args.window);
      }
      if (action === "model") return ok(await pbiRequest("model", { full: true }));
      if (action === "query") {
        let dax = String(args.dax || "").trim();
        if (!dax) {
          if (!args.measure) throw new Error("Diga a medida (measure) e, se quiser, por qual coluna (by), ou mande dax.");
          dax = simpleDax(args, ok(await pbiRequest("model", {})));
        }
        // A failed DAX of the model's own goes back with the simple form and the right names (a small
        // model wrote 7 broken queries in a row and then answered wrong, 11/10).
        const simpleHint = () => {
          const { measures, columns } = modelNames(conversation);
          return `Use a forma simples: measure (uma de: ${measures.slice(0, 20).join(", ")}), by (uma coluna: ${columns.join(" | ")}), top e filter (ex.: "Ano=2026"). Ex.: {"action":"query","measure":"${measures[0] || "Faturamento"}","by":"Produto","top":1,"filter":"Ano=2026"}.`;
        };
        if (!/^(EVALUATE|DEFINE)\b/i.test(dax)) throw new Error(`A consulta DAX começa com EVALUATE. ${simpleHint()}`);
        if (/\b(CREATE|ALTER|DELETE|DROP)\b/i.test(dax.replace(/"[^"]*"/g, ""))) throw new Error("Consultas só leem: para mudar o modelo, use action=change.");
        const reply = await pbiRequest("query", { dax, max: Number(args.top) > 0 ? Number(args.top) : 30 });
        if (!reply.ok) throw new Error(`${reply.error}\n${args.dax ? simpleHint() : ""}`);
        return `${reply.text}\n(DAX: ${dax})\nResponda com estes números, sem arredondar e sem inventar outros. A primeira linha depois dos títulos é a maior.`;
      }
      if (action === "change") {
        const ops = [args.ops].flat().filter(Boolean);
        if (!ops.length) throw new Error("Mande as mudanças em ops (ex.: [{\"op\":\"measure\",\"name\":\"Margem\",\"expression\":\"DIVIDE([Lucro], [Faturamento])\",\"format\":\"0.0%\"}]).");
        const modelText = ok(await pbiRequest("model", {}));
        for (const op of ops) {
          if (op.op === "measure" && op.expression) {
            op.expression = fixMeasureRefs(op.expression, modelText);
            // "Lucro por pedido" written as the total: the name says per something, the expression must divide.
            if (/\bpor\s+\p{L}/iu.test(String(op.name)) && !/DIVIDE|\/|AVERAGE/i.test(op.expression)) {
              const counts = [...modelIndex(modelText).measures.values()].map((x) => x.name).filter((n) => /^Qtd\./i.test(n));
              throw new Error(`O nome "${op.name}" diz "por …": a expressão precisa dividir, ex.: DIVIDE(${op.expression}, ${counts.length ? `[${counts[0]}]` : "COUNTROWS(Tabela)"}).`);
            }
          }
        }
        const done = ok(await pbiRequest("apply", { ops }));
        rememberModel(conversation, ok(await pbiRequest("model", {})));
        return `${done}Confira se o valor faz sentido para o nome (ex.: algo "por pedido" é bem menor que o total); se não fizer, corrija com outra action=change.${NEXT}`;
      }
      if (action === "refresh") return ok(await pbiRequest("refresh", {}, 600_000));
      if (action === "save") {
        const report = connectedReport(conversation);
        const reply = await desktopRequest("key", { keys: "^s", window: report.title });
        if (!reply.ok) throw new Error(reply.error);
        return `Salvei o arquivo aberto no Power BI ("${report.title}").`;
      }
      throw new Error("action: build, connect, model, query, change, refresh ou save.");
    },
  },
];

