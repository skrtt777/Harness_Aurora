// Subagents: the Aurora splits a delivery with parts (planilhas + um Power BI, um relatório de várias
// seções, a pesquisa de vários itens) into tasks and hands each to a subagent — the same agent, with the
// same tools and rules, focused on one part and a smaller step limit — then checks what came back and
// puts it together. A small model doing everything in one long turn lost track of its own files and
// wrote reports where spreadsheets were asked (12/10); a focused turn per part keeps each one short.
// The subagents run in the turn's own context (chatTurn.js toolContext.runSubagent), two at a time on
// the local model; they show in the agents' office beside their Aurora (pendingTurns subagents).
import { sessionName } from "../office.js";
import { setSubagent } from "../pendingTurns.js";
import { WRITE_TOOLS } from "../teacher.js";

export const SUBAGENT_EXCLUDED = new Set(["subagents", "team_request", "agent_delegate"]);
const MAX_TASKS = 5;

const PARTS = [
  ["planilhas", /\bplanilhas\b/],
  ["planilha", /\b(planilha|excel|execel|exel|xlsx)\b/],
  ["Power BI", /\b(power ?bi|painel|dashboard)\b/],
  ["relatório", /\b(relatorios?|documento word|docx)\b/],
  ["apresentação", /\b(apresentacao|slides?|powerpoint|pptx)\b/],
  ["pdf", /\bpdf\b/],
];
/**
 * The parts a request asks to deliver ("faça planilhas … e monte um Power BI" -> planilhas, Power BI),
 * when there are two or more; null otherwise (one file, a question).
 */
export function multiPart(text) {
  const t = String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // A spreadsheet that already exists ("com a planilha vendas.xlsx", "das planilhas") is the input, not a part.
  const existing = /\b(com|da|das|na|nas|usando|a partir d[ae]s?)\s+(as?\s+)?planilhas?\b|\b[\w-]+\.(xlsx|csv)\b/.test(t);
  const found = [];
  for (const [name, re] of PARTS) if (re.test(t) && !((name === "planilha" || name === "planilhas") && existing) && !(name === "planilha" && found.includes("planilhas"))) found.push(name);
  // A website, app or system with several technologies (React, Three.js, Java, C++…): one part per area.
  // A website is made by create_site (app/siteBuilder.js) in one action, not divided (13/10).
  if (/\b(site|website|pagina web|landing page|portal)\b/.test(t) && !/\b(planilhas?|power ?bi|relatorio|apresentacao)\b/.test(t)) return null;
  if (/\b(cri[ae]|fa[cz]a|desenvolv[ae]|mont[ae]|construa|gere|programe)\b/.test(t) && /\b(app|aplicativo|sistema|jogo|plataforma|api)\b/.test(t)) {
    const techs = [...new Set((t.replace(/c\+\+/g, "cpp").match(/\b(react|vue|angular|three ?\.?js|java(?!script)|c\+\+|cpp|c#|python|node|express|spring|django|flask|typescript|html|css|sql|php|kotlin|swift|go|rust)\b/g) || []).map((x) => x.replace(/\s|\./g, "")))];
    if (techs.length >= 3) return [...found, ...techs.map((x) => `código ${x}`)];
  }
  const many = found.includes("planilhas") ? found.length + 1 : found.length;
  return many >= 2 ? found : null;
}

/** The schema the plan of the parts is held to (the local model can write nothing else). */
export const PARTS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["partes", "final"],
  properties: {
    partes: { type: "array", minItems: 2, maxItems: MAX_TASKS, items: { type: "object", additionalProperties: false, required: ["nome", "tarefa", "entrega"],
      properties: { nome: { type: "string", maxLength: 30 }, tarefa: { type: "string", maxLength: 900 }, entrega: { type: "string", maxLength: 300 } } } },
    final: { type: "string", maxLength: 500 },
  },
};
/**
 * The parts of a request, planned by the local model with the answer held to PARTS_SCHEMA (a 4B model
 * did not pick the subagents tool by itself, 12/10): ask(messages, schemaText) -> { ok, text }.
 * Returns { tasks: [{ name, task, deliver }], final } or null.
 */
export async function planParts({ request, history = [], folder = "Documentos", ask }) {
  const recent = history.slice(-4).map((m) => `${m.role === "user" ? "Pessoa" : "Aurora"}: ${String(m.content || "").slice(0, 1500)}`).join("\n");
  const system = [
    "Você é a Aurora planejando como dividir um pedido entre subagentes (cópias suas, cada uma faz uma parte sozinha, com as ferramentas).",
    "Divida em 2 a 5 partes INDEPENDENTES: UMA PARTE POR ARQUIVO A ENTREGAR (uma planilha por assunto: Departamentos, Funcionários, Frota…), o nome da parte é o assunto. Etapas como extrair, limpar, juntar ou modelar dados NÃO são partes. A parte que depende de todas as outras (ex.: o Power BI com as planilhas) NÃO é uma parte: diga em \"final\" o que a Aurora faz no fim com o que voltar.",
    "Cada tarefa traz tudo o que o subagente precisa saber: as colunas da planilha, quantas linhas, e as REGRAS DE NÚMERO de toda a conversa valendo para cada linha (ex.: \"mais de 300 funcionários em cada departamento\" = toda linha acima de 300, não o total). Se os dados que já existem na conversa não obedecem a uma regra pedida, a tarefa manda corrigir.",
    "Escreva o mesmo nome em todas as tarefas para o que liga as planilhas (ex.: a coluna Departamento com os mesmos departamentos).",
    "Num projeto de código, uma parte por ÁREA (ex.: o front em React com Three.js; o módulo C++; o servidor Java), cada uma com os seus arquivos pequenos na pasta do projeto (caminhos relativos a ela) e o contrato entre elas (rotas, nomes de funções, formato dos dados) escrito igual em todas; juntar e conferir fica no \"final\".",
    `A entrega diz o arquivo com o caminho (na pasta ${folder}) e o formato (.xlsx para planilha, .docx para documento).`,
  ].join("\n");
  const user = `${recent ? `Conversa até aqui:\n${recent}\n\n` : ""}Pedido agora: ${request}`;
  const reply = await ask([{ role: "system", content: system }, { role: "user", content: user }], JSON.stringify(PARTS_SCHEMA)).catch(() => null);
  if (!reply?.ok) return null;
  let plan; try { plan = JSON.parse(reply.text); } catch { return null; }
  const tasks = (plan.partes || []).map((x) => ({ name: String(x.nome || "").trim(), task: String(x.tarefa || "").trim(), deliver: String(x.entrega || "").trim() })).filter((x) => x.task);
  return tasks.length >= 2 ? { tasks: tasks.slice(0, MAX_TASKS), final: String(plan.final || "").trim() } : null;
}

/** What a subagent turn delivered: its answer, the files it wrote, the actions that failed. */
export function deliveryOf(result) {
  const steps = result?.steps || [];
  const files = [...new Set(steps.filter((s) => s.ok && WRITE_TOOLS.has(s.tool)).map((s) => /(?:Criei|Salvei|Editei|Gravei) (.+?)(?: \(|\.$|$)/.exec(String(s.summary || ""))?.[1]).filter(Boolean))];
  const failed = steps.filter((s) => !s.ok && !s.denied).map((s) => `${s.tool}: ${String(s.summary || "").replace(/^ERRO:\s*/, "").slice(0, 160)}`);
  return { ok: !!result?.ok, answer: String(result?.text || result?.error || "").trim(), files, failed, steps };
}

/** The prompt of one part: the person's request for context, the part, what to deliver. */
export function subagentPrompt({ name, task, deliver, request, others }) {
  return [
    `Você é ${name}, um subagente da Aurora. A Aurora dividiu o pedido da pessoa em partes e esta é a SUA parte; faça só ela, com as ferramentas, até entregar.`,
    `Pedido da pessoa (para contexto): «${String(request || "").slice(0, 1500)}»`,
    `Sua parte: ${task}`,
    deliver ? `Entrega: ${deliver}` : "",
    others.length ? `Outros subagentes fazem: ${others.join("; ")}. Não faça essas partes.` : "",
    "Entregue o que a sua parte pede (o arquivo, ou os arquivos pequenos da sua área de código), cada um gravado uma vez no caminho da entrega (se a ferramenta recusar, corrija e grave de novo no MESMO caminho). Planilha é uma tabela (cabeçalho e linhas com | entre as células). Confira as regras de número do pedido em cada linha antes de gravar. Não pergunte nada à pessoa: decida o razoável e siga.",
    "Termine com 2 ou 3 frases: o que você entregou, o caminho completo de cada arquivo e os números principais.",
  ].filter(Boolean).join("\n");
}

/** Runs tasks with at most `limit` at once, in order of the list. */
async function pool(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

export const subagentTools = [
  {
    name: "subagents",
    description: "Divide uma entrega com várias partes entre subagentes (cópias focadas de você, com as mesmas ferramentas) e devolve o que cada um entregou. Use quando o pedido tem 2 ou mais partes independentes: várias planilhas, as planilhas e depois o Power BI, um relatório de várias seções, a pesquisa de vários itens. Cada tarefa diz o que fazer e o que entregar (de preferência um arquivo, com o caminho completo). Depois confira as entregas (read_file) e junte; o que depende de tudo pronto (ex.: o Power BI com as planilhas) faça você depois.",
    parameters: { type: "object", properties: {
      tasks: { type: "array", minItems: 2, maxItems: MAX_TASKS, items: { type: "object", properties: {
        task: { type: "string", description: "a parte, completa (o que fazer, com os dados e regras que ela precisa)" },
        deliver: { type: "string", description: "o que entregar, ex.: \"C:\\\\Users\\\\...\\\\Documentos\\\\Frota.xlsx com Modelo, Placa, Departamento, Valor\"" },
        name: { type: "string", description: "um nome curto para a parte (ex.: Frota)" },
      }, required: ["task"] } },
    }, required: ["tasks"] },
    stage: (a) => `Dividindo o trabalho entre ${Math.min(MAX_TASKS, (a.tasks || []).length) || "os"} subagentes…`,
    describe: () => ({ kind: "meta" }),
    async run(args, ctx) {
      if (ctx.subagent) throw new Error("Um subagente não cria outros: faça você mesmo a sua parte.");
      if (typeof ctx.runSubagent !== "function") throw new Error("Subagentes não estão disponíveis aqui: faça você mesmo, uma parte de cada vez.");
      const tasks = [args.tasks].flat().filter((t) => t && String(t.task || t.tarefa || "").trim()).map((t) => ({ task: String(t.task || t.tarefa).trim(), deliver: String(t.deliver || t.entrega || "").trim(), title: String(t.name || t.nome || "").trim() }));
      if (tasks.length < 2) throw new Error("Subagentes são para 2 ou mais partes: com uma só, faça você mesmo.");
      if (tasks.length > MAX_TASKS) throw new Error(`No máximo ${MAX_TASKS} partes por vez: junte as menores.`);
      // Each one a person's name of its own (the office shows them), never the Aurora's own.
      const taken = new Set(["Aurora"]);
      tasks.forEach((t, i) => { t.name = sessionName(t.title || t.task, `${ctx.conversationId || ""}:${i}:${t.task}`, taken); taken.add(t.name); });
      const parallel = Math.max(1, Math.min(3, Number(ctx.env?.AURORA_SUBAGENTS_PARALLEL) || 2));
      ctx.onStage?.(`${tasks.length} subagentes trabalhando: ${tasks.map((t) => t.name).join(", ")}…`);
      const results = await pool(tasks, parallel, async (t, i) => {
        const id = `${i}`;
        setSubagent(ctx.conversationId, id, { name: t.name, task: t.title || t.task.slice(0, 80), stage: "Esperando a vez", steps: [], done: false, since: Date.now() });
        const others = tasks.filter((x) => x !== t).map((x) => `${x.name}: ${(x.title || x.task).slice(0, 80)}`);
        let result;
        try {
          result = await ctx.runSubagent(subagentPrompt({ name: t.name, task: t.task, deliver: t.deliver, request: ctx.request, others }), {
            name: t.name,
            onStage: (stage) => setSubagent(ctx.conversationId, id, { stage }),
            onStep: (step) => setSubagent(ctx.conversationId, id, { step }),
          });
        } catch (error) { result = { ok: false, error: error.message, steps: [] }; }
        const d = deliveryOf(result);
        setSubagent(ctx.conversationId, id, { stage: d.ok ? "Entregou" : "Não terminou", done: true, ok: d.ok, endedAt: Date.now() });
        return { ...t, ...d };
      });
      // The parts' deliveries count as this turn's (the checks of "I created the file" see them).
      ctx.subagentSteps = results.flatMap((r) => r.steps.filter((s) => s.ok && WRITE_TOOLS.has(s.tool)).map((s) => ({ ...s, by: r.name })));
      ctx.subagentRuns = results.map((r) => ({ name: r.name, task: r.title || r.task.slice(0, 120), ok: r.ok, files: r.files, failed: r.failed.length }));
      const lines = results.map((r) => [
        `## ${r.name} — ${r.title || r.task.slice(0, 80)}: ${r.ok && !r.failed.length ? "entregou" : r.ok ? "entregou, com ações que falharam" : "NÃO terminou"}`,
        r.files.length ? `Arquivos: ${r.files.join("; ")}` : "Nenhum arquivo gravado.",
        r.failed.length ? `Falhas: ${r.failed.slice(0, 3).join(" | ")}` : "",
        `Resposta: ${r.answer.slice(0, 900)}`,
      ].filter(Boolean).join("\n"));
      const pending = results.filter((r) => !r.ok || (!r.files.length && /\.(xlsx|csv|docx|pdf|pptx|md)\b/i.test(r.deliver)));
      return `${lines.join("\n\n")}\n\nAgora: confira as entregas antes de responder (read_file nos arquivos; números e linhas batem com o pedido?).${pending.length ? ` Refaça você mesmo o que não ficou pronto: ${pending.map((r) => r.name).join(", ")}.` : ""} Depois faça o que depende de tudo pronto e responda à pessoa com o que cada subagente entregou e os caminhos completos.`;
    },
  },
];
