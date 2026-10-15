// The powerbi tool: a complete BI from the person's spreadsheets, and the semantic model of an open Power
// BI (read it, ask it with DAX, add and fix measures, relationships and formats — each measure checked and
// undone if it fails). The engine is app/powerbi.js; the design, app/powerbiDesign.js.
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { REFRESH_MINUTES, buildReport, connectReport, connectedReport, modelNames, pbiRequest, rememberModel } from "../powerbi.js";
import { desktopRequest } from "../desktop.js";
import { askedStyle, groundedName, localPlanAsk } from "../powerbiPlanner.js";
import { expandPath, resolveExisting } from "./files.js";
import { asksDeck, wantsPowerBi } from "../toolRouter.js";

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

const plain = (s) => String(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/**
 * The filters of a simple question, against the values the column really has: a value written another way
 * ("entregue", "Em transito") becomes the real one; one that is not there ("Status=Atrasado", 11/10: the
 * model got 0 and said there were no delays) goes back with the values and the measure that answers it.
 */
export async function checkFilters(filter, modelText, values = columnValues) {
  // ("\"Categoria=Marketing\"": quotes around the whole filter, 11/10.)
  const parts = String(filter || "").split(/;\s*/).map((p) => p.trim().replace(/^["']+|["']+$/g, "")).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const [, column, raw] = /^(.+?)\s*=\s*(.+)$/.exec(part) || [];
    if (!column) { out.push(part); continue; }
    const value = raw.trim().replace(/^["']+|["']+$/g, "");
    if (/^-?\d+([.,]\d+)?$/.test(value)) { out.push(`${column}=${value}`); continue; }
    const ref = columnRef(modelText, column);
    const existing = await values(ref);
    if (!existing.length || existing.includes(value)) { out.push(`${column}=${value}`); continue; }
    const same = existing.filter((v) => plain(v) === plain(value));
    if (same.length === 1) { out.push(`${column}=${same[0]}`); continue; }
    const stem = plain(value).replace(/\s+/g, " ").split(" ").filter((w) => w.length >= 4).map((w) => w.slice(0, 5));
    const measures = [...modelIndex(modelText).measures.values()].map((m) => m.name).filter((n) => stem.some((s) => plain(n).includes(s)));
    throw new Error(`${column} não tem "${value}". Os valores de ${column} são: ${existing.slice(0, 15).join(", ")}.${measures.length ? ` Para "${value}" já existe a medida ${measures.slice(0, 3).map((n) => `[${n}]`).join(" ou ")}: use measure "${measures[0]}" sem esse filtro.` : " Use um desses valores ou tire o filtro."}`);
  }
  return out.join("; ");
}

/**
 * The measure of a simple question is one the model has: an expression ("[Saldo] - [Orçado]", 11/10, the
 * wrong answer) or an invented name goes back with the measures whose words match the question.
 */
export function checkMeasure(measure, modelText, request = "") {
  const name = String(measure || "").trim().replace(/^\[|\]$/g, "");
  const { measures } = modelIndex(modelText);
  const found = measures.get(name.toLowerCase());
  if (found) return found.name;
  const stems = plain(`${name} ${request}`).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 5).map((w) => w.slice(0, 5));
  const like = [...measures.values()].map((m) => m.name).filter((n) => stems.some((s) => plain(n).includes(s))).slice(0, 5);
  throw new Error(`Não há a medida "${name}". ${like.length ? `As que combinam com a pergunta: ${like.map((n) => `[${n}]`).join(", ")}. ` : ""}measure é o nome de UMA medida que existe (veja com action=model); para "o que mais estourou o orçamento", por exemplo, measure "Execução do orçamento %", by a coluna, top 1.`);
}

async function columnValues(ref) {
  const reply = await pbiRequest("query", { dax: `EVALUATE TOPN(60, DISTINCT(${ref}))`, max: 60 });
  if (!reply.ok) return [];
  return String(reply.text || "").split("\n").slice(2).map((l) => l.trim()).filter((l) => l && !/^…/.test(l));
}

const foldName = (t) => String(t || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/**
 * The sheet the request is about, next to the ones chosen: "um BI sobre os departamentos" built from
 * Funcionarios_Empresa.xlsx alone, with Departamentos_Empresa.csv in the same folder (13/10, 1 run in 3).
 */
export function namedSheets(paths, request) {
  const words = [...new Set(foldName(request).split(/[^a-z0-9]+/).filter((w) => w.length >= 6).map((w) => w.replace(/s$/, "")))];
  if (!words.length || !paths.length) return [];
  const have = new Set(paths.map((p) => foldName(resolve(p))));
  const out = [];
  for (const dir of new Set(paths.map((p) => dirname(p)))) {
    let names = []; try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const full = join(dir, n);
      if (!/\.(xlsx|csv)$/i.test(n) || have.has(foldName(resolve(full))) || /^~\$/.test(n)) continue;
      if (words.some((w) => foldName(basename(n)).includes(w))) { out.push(full); have.add(foldName(resolve(full))); }
    }
  }
  return out.slice(0, 2);
}

const ASKS_PBI = /power ?bi|\bbi\b|dashboard|painel|modelo sem[âa]ntico|\bdax\b|medida|\.pbix|\.pbip/i;
// "deixe o tema azul e amarelo": colours for the report, with no ops for them (13/10: the model made up
// {"format":"colors","settings":{...}} three times, each asking the person's permission for nothing).
const COLOR_CHANGE = (a) => a.action === "change" && /colou?r|\bcor(es)?\b|tema|theme|palet|#[0-9a-f]{6}|fundo|background/i.test(JSON.stringify(a.ops || a));
const THEME_TIP = "O tema e as cores de um painel que a Aurora montou mudam com um build novo: chame powerbi com action=build, os MESMOS files do build anterior e goal com as cores pedidas (ex.: goal=\"tema azul e amarelo\"). A ferramenta monta o painel de novo com essas cores.";

export const powerBiTools = [
  {
    name: "powerbi",
    description: "Power BI. action=build cria um BI completo a partir de planilhas (files: [\"Documentos/vendas.xlsx\"], .xlsx ou .csv; name: o título do painel; goal: o que a pessoa quer ver, nas palavras dela): modelo semântico (tabelas, calendário, relações, medidas em R$) e as páginas que o pedido e os dados pedem — com etapas/status (pedidos, entregas, chamados) vem a página de operação com a cena desenhada pelos dados (docas e caminhões, rastreamento, item selecionado); \"só a operação\" ou \"sem a tendência\" no goal mudam as páginas — e abre no Power BI Desktop já atualizado. Num Power BI aberto: action=connect (window: parte do título, se houver vários), action=model mostra tabelas, colunas, medidas e relações; action=query responde com números — use measure + by (+ top, filter): ex. \"qual produto vendeu mais em 2026\" = measure \"Faturamento\", by \"Produto\", top 1, filter \"Ano=2026\"; a medida pelo sentido (gasto/despesa = Saídas; receita = Entradas; quantos = contagem) e o item citado no filter (\"quanto gastamos com marketing\" = measure \"Saídas no período\", filter \"Categoria=Marketing\"); dax só se isso não bastar; action=vr abre o painel em 3D, realidade mista, VR e AR (computador, óculos Quest ou celular; dê os endereços que ela devolver); action=show acende no painel o que a pessoa pediu para ver (values com os nomes exatos, note com a frase curta; ex. \"mostra a doca parada\" = consulte, depois show values [\"Doca 03\"]); action=change altera o modelo (ops: [{op:\"measure\", name, expression, format}], a expressão reaproveitando as medidas que existem, ex. DIVIDE([Lucro], [Qtd. de pedidos]); também column, relationship {from:\"Vendas[Produto]\", to:\"Produtos[Produto]\"}, format, hide, rename, delete) — cada medida é conferida e desfeita se der erro; action=refresh atualiza os dados; action=save salva o arquivo aberto.",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["build", "connect", "model", "query", "show", "vr", "change", "refresh", "save"] },
      values: { type: "array", items: { type: "string" }, description: "show: o que acender no painel, com o nome exato como está nos dados (ex.: [\"Doca 03\"], [\"ABC-3P34\"], [\"Caixa 04\"], [\"MG\"]); vazio apaga" },
      note: { type: "string", description: "show: a frase curta que aparece na cena (ex.: \"Doca 03 parada há 40 min\")" },
      files: { type: "array", items: { type: "string" }, description: "build: TODAS as planilhas .xlsx/.csv do pedido, com o caminho completo que a ferramenta que as criou ou achou devolveu; cada uma é uma tabela (cabeçalho e linhas, uma célula por coluna)" },
      name: { type: "string", description: "título do painel (build)" },
      goal: { type: "string", description: "build: UMA frase curta (até 25 palavras) com o que a pessoa quer ver; pode omitir (usa o pedido dela). Nunca descreva páginas, gráficos, cores ou dados aqui: a ferramenta lê as planilhas e monta tudo." },
      folder: { type: "string", description: "onde criar o projeto (build; padrão Documentos/Power BI)" },
      window: { type: "string", description: "parte do título do Power BI aberto (connect)" },
      measure: { type: "string" }, by: { type: "string" }, top: { type: "number" }, filter: { type: "string" },
      dax: { type: "string", description: "consulta DAX que começa com EVALUATE" },
      ops: { type: "array", items: { type: "object" }, description: "mudanças no modelo (change)" },
    }, required: ["action"] },
    stage: (a) => ({ build: "Montando o Power BI…", connect: "Conectando ao Power BI…", model: "Lendo o modelo semântico…", query: "Consultando o Power BI…", show: "Mostrando no Power BI…", change: "Alterando o modelo semântico…", refresh: "Atualizando os dados do Power BI…", save: "Salvando o Power BI…" }[a.action] || "Usando o Power BI…"),
    describe: (a, ctx) => {
      if (a.action === "build") {
        const folder = expandPath(a.folder || "Documentos/Power BI", ctx.knownFolders, ctx.workspace);
        return { kind: "write", paths: [folder], summary: `Criar o painel do Power BI em ${folder}` };
      }
      // Changing or saving the person's open report: their authorization, once per turn.
      if (a.action === "vr") return { kind: "desktop", program: "PBIDesktop", summary: "Abrir o gêmeo digital do Power BI em 3D/VR: um endereço só de leitura nesta rede (para o óculos) e neste computador" };
      if (a.action === "show") return { kind: "desktop", program: "PBIDesktop", summary: `Destacar no Power BI: ${[a.values].flat().filter(Boolean).join(", ") || "(apagar o destaque)"}` };
      if (COLOR_CHANGE(a)) return { kind: "meta" };
      if (a.action === "change" || a.action === "save" || a.action === "refresh") return { kind: "desktop", program: "PBIDesktop", summary: a.action === "change" ? `Alterar o modelo do Power BI: ${(a.ops || []).map((o) => `${o.op} ${o.name || o.column || o.from || ""}`).join(", ")}` : a.action === "save" ? "Salvar o arquivo do Power BI" : "Atualizar os dados do Power BI" };
      return { kind: "meta" };
    },
    async run(args, ctx) {
      const action = args.action;
      const conversation = ctx.conversationId || "";
      if (action === "build") {
        if (asksDeck(ctx.request) && !wantsPowerBi(ctx.request) && !args.__fromOpen) throw new Error("O pedido é uma apresentação: o dashboard é um SLIDE, não um Power BI. Use write_document com um .pptx e, no slide, um bloco ```indicadores (| Nome | Valor | variação |) e blocos ```grafico TIPO: Título com a tabela dos dados.");
        if (!ASKS_PBI.test(String(ctx.request || "")) && !askedStyle(ctx.request) && !args.__fromOpen) throw new Error("A pessoa não pediu um Power BI/painel: para uma planilha ou relatório comum, use write_document.");
        const files = [args.files].flat().filter(Boolean);
        if (!files.length) throw new Error("Diga as planilhas em files (ex.: [\"Documentos/vendas.xlsx\"]).");
        const paths = [];
        for (const f of files) paths.push(await resolveFile(f, ctx));
        for (const extra of namedSheets(paths, `${ctx.request || ""} ${args.goal || ""}`)) paths.push(extra);
        const folder = expandPath(args.folder || "Documentos/Power BI", ctx.knownFolders, ctx.workspace);
        // The pages follow what was asked: the goal, or the request itself.
        const r = await buildReport({ files: paths, folder, name: groundedName(args.name, `${ctx.request || ""} ${args.goal || ""} ${files.join(" ")}`), goal: `${args.goal || ctx.request || ""}${askedStyle(ctx.request) && !askedStyle(args.goal) ? ` (${ctx.request})` : ""}`, conversationId: conversation, onStage: (s) => ctx.onStage?.(s),
          // The local model plans this BI's pages, layout and style (ctx.ask in tests).
          planner: { ask: ctx.planAsk || await localPlanAsk(ctx.env || process.env).catch(() => null), env: ctx.env || process.env } });
        const pages = r.plan.pages.map((p) => `${p.displayName} (${p.visuals.filter((v) => v.type !== "textbox").length} visuais)`).join(", ");
        return [
          r.opened ? `Pronto: o painel "${r.plan.name}" está aberto no Power BI Desktop, na frente da pessoa (projeto em ${r.folder}).` : `Pronto: o painel "${r.plan.name}" foi criado em ${r.pbip} (o Power BI Desktop não foi aberto; a pessoa abre esse arquivo).`,
          // The plan first: the result is cut when stored, and the pages are what the person should hear.
          `Plano (${r.plan.plan.planner === "modelo" ? "feito pela IA local" : "automático"}): ${r.plan.plan.paginas.map((p) => `"${p.nome}" (${p.pergunta}${p.cena !== "nenhuma" ? `; cena ${p.cena}` : ""})`).join("; ")}.`,
          r.refreshed,
          `Atualização: a Aurora atualiza este painel sozinha quando as planilhas mudam e pelo menos a cada ${REFRESH_MINUTES} min, enquanto ele estiver aberto (a hora aparece no selo AO VIVO da cena).`,
          `Números dos cartões (todos os dados):\n${r.cards || r.checks}`,
          `Páginas: ${pages}.`,
          r.plan.flow?.place ? `A página ${r.plan.pages[0].displayName} tem a cena com as ${r.plan.flow.place.toLowerCase()}s e os ${r.plan.flow.vehicles || "itens"} desenhados pelos dados; clicar num item da tabela acende ele na cena e mostra o detalhe.` : "",
          r.plan.summary,
          `Diga à pessoa o plano: as páginas (${r.plan.plan.paginas.map((p) => p.nome).join(", ")}) e o que cada uma responde.`,
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
          const modelText = ok(await pbiRequest("model", {}));
          args = { ...args, measure: checkMeasure(args.measure, modelText, ctx.request), filter: await checkFilters(args.filter, modelText) };
          dax = simpleDax(args, modelText);
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
      if (COLOR_CHANGE(args)) throw new Error(THEME_TIP);
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
      if (action === "vr") {
        // The open report's twin in 3D and VR: the same state as the scene, read only, refreshed every 15 s.
        const { startTwinServer } = await import("../twinServer.js");
        const { twinNow } = await import("../powerbi.js");
        const info = await startTwinServer({ getState: () => twinNow() });
        return [
          `Gêmeo digital aberto em 3D: ${info.local} (neste computador).`,
          info.network.length ? `No óculos (Quest) ou no celular, no navegador: ${info.network.join(" ou ")} — o aviso de certificado é esperado (o certificado é desta Aurora): toque em Avançado e continue; depois, "Realidade mista" (a maquete vai para a sua mesa) ou "Entrar em VR"; no celular, "Ver na mesa (AR)".` : "Sem rede local agora: só neste computador.",
          "Ele mostra o Power BI que a Aurora abriu por último, com os mesmos números da cena, e se atualiza a cada 15 s. Diga à pessoa os endereços como estão acima.",
        ].join("\n");
      }
      if (action === "show") {
        // The Aurora points at something in the report: the scenes ring it and show her note.
        const values = [args.values || args.value].flat().filter((v) => String(v || "").trim()).map((v) => String(v).trim()).slice(0, 20);
        const note = String(args.note || "").replace(/\s+/g, " ").trim().slice(0, 120);
        const esc = (v) => v.replace(/"/g, "\"\"");
        const rows = values.length ? values.map((v) => `{"${esc(v)}", "${esc(note)}"}`) : [`{"", "${esc(note)}"}`];
        const reply = await pbiRequest("apply", { ops: [{ op: "tableExpression", name: "Destaque", expression: `DATATABLE("Valor", STRING, "Nota", STRING, {${rows.join(", ")}})` }] });
        if (!reply.ok) throw new Error(/Destaque/.test(reply.error) ? "Este painel não tem a tabela Destaque (foi feito antes desta versão da Aurora): monte de novo com action=build." : reply.error);
        return values.length ? `Destaquei ${values.join(", ")} no Power BI aberto (anel roxo na cena${note ? ` e a nota "${note}"` : ""}). Diga à pessoa o que destacou e por quê, com os números da consulta.` : "Apaguei o destaque do Power BI.";
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


export { groundedName };
