import http from "node:http";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdf } from "./sampleDocs.js";

/**
 * Fixed agent benchmark (docs/REVISAO_2026-09-27.md, Fase 3). Each task
 * seeds a fresh project folder (and, for browser tasks, a local test site),
 * sends one real chat message to the local agent and checks the outcome
 * deterministically — files on disk, program output, facts in the answer.
 * Runs with the teacher off: it measures the local model plus whatever it
 * has learned (memories), which is the number that should rise over time.
 */

const node = (script, args = [], cwd) => new Promise((resolve) => execFile(process.execPath, [script, ...args], { cwd, timeout: 15000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, out: `${stdout}${stderr}`.trim() })));
const read = (dir, file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : null);
const has = (text, ...needles) => needles.every((n) => (n instanceof RegExp ? n.test(String(text || "")) : String(text || "").toLowerCase().includes(String(n).toLowerCase())));

const SITE = {
  "/": `<title>Loja Aurora</title><h1>Loja Aurora</h1><form action="/busca"><input name="q" placeholder="Buscar produtos"><button>Buscar</button></form><a href="/contato">Contato</a>`,
  "/contato": `<title>Contato</title><h1>Fale conosco</h1><p>E-mail: atendimento@loja-aurora.test</p><p>Telefone: (71) 4002-8922</p>`,
};
const RESULTS = { teclado: [["Teclado Mecânico RGB", "R$ 289,90"], ["Teclado Sem Fio", "R$ 149,00"]], mouse: [["Mouse Gamer", "R$ 99,90"]] };

export function startTestSite() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/busca") {
      const items = RESULTS[String(url.searchParams.get("q") || "").toLowerCase().trim()] || [];
      return res.end(`<title>Busca</title><h1>Resultados</h1><ol>${items.map(([name, price]) => `<li><a href="/p/${encodeURIComponent(name)}">${name}</a> — <b>${price}</b></li>`).join("") || "<li>Nada encontrado</li>"}</ol>`);
    }
    res.end(SITE[url.pathname] || "<title>404</title>Não encontrado");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

export const EVAL_TASKS = [
  { id: "criar-arquivo", area: "arquivos", prompt: "Crie o arquivo notas.txt com o texto: reunião às 15h",
    check: ({ dir }) => has(read(dir, "notas.txt"), "reunião às 15h") },
  { id: "editar-json", area: "arquivos", seed: { "config.json": '{\n  "nome": "api",\n  "porta": 3000\n}\n' }, prompt: "No config.json, mude a porta para 8080 sem mexer no resto.",
    check: ({ dir }) => { try { const c = JSON.parse(read(dir, "config.json")); return c.porta === 8080 && c.nome === "api"; } catch { return false; } } },
  { id: "achar-funcao", area: "busca", seed: { "src/pedido.js": "export function total(i){return i.reduce((a,b)=>a+b,0)}\n", "src/entrega/frete.js": "export function calcularFrete(peso){return 10+peso*2}\n", "src/util.js": "export const x=1\n" }, prompt: "Em qual arquivo está definida a função calcularFrete? Responda com o caminho.",
    check: ({ answer }) => has(answer, "frete.js") },
  { id: "contar-arquivos", area: "terminal", seed: { "a.txt": "1", "b.txt": "2", "c.txt": "3", "d.md": "4" }, prompt: "Usando o terminal, conte quantos arquivos .txt existem nesta pasta e me diga o número.",
    check: ({ answer, steps }) => has(answer, /\b3\b|três/) && steps.some((s) => s.tool === "run_command") },
  { id: "script-media", area: "código", prompt: "Crie media.js que recebe números pela linha de comando e imprime só a média deles. Rode com 2 4 9 para conferir.",
    check: async ({ dir }) => existsSync(join(dir, "media.js")) && Number(((await node("media.js", ["2", "4", "9"], dir)).out.match(/-?\d+(?:[.,]\d+)?/g) || []).at(-1)?.replace(",", ".")) === 5 },
  { id: "corrigir-bug", area: "código", seed: { "calc.js": "function dobro(n) {\n  return n + 2;\n}\nmodule.exports = { dobro };\n", "teste.js": "const { dobro } = require('./calc');\nif (dobro(4) !== 8 || dobro(10) !== 20) { console.error('FALHOU'); process.exit(1); }\nconsole.log('OK');\n" }, prompt: "O teste.js está falhando. Descubra o erro no calc.js, corrija e rode o teste.",
    check: async ({ dir }) => (await node("teste.js", [], dir)).code === 0 && has(read(dir, "teste.js"), "dobro(4) !== 8") },
  { id: "renomear", area: "código", seed: { "a.js": "function velhoNome(){return 1}\nmodule.exports={velhoNome}\n", "b.js": "const {velhoNome}=require('./a');\nconsole.log(velhoNome());\n" }, prompt: "Renomeie a função velhoNome para novoNome em todos os arquivos e confira rodando node b.js.",
    check: async ({ dir }) => !has(read(dir, "a.js") + read(dir, "b.js"), "velhoNome") && (await node("b.js", [], dir)).out === "1" },
  { id: "pasta-leiame", area: "arquivos", prompt: "Crie a pasta docs e dentro dela um leiame.md cujo título seja: # Projeto Aurora",
    check: ({ dir }) => has(read(join(dir, "docs"), "leiame.md"), /^#\s*Projeto Aurora/m) },
  { id: "site-busca", area: "navegador", browser: true, prompt: ({ site }) => `Abra ${site} no navegador, pesquise por teclado e me diga o preço do primeiro resultado.`,
    check: ({ answer }) => has(answer, /289,90/) },
  { id: "site-contato", area: "navegador", browser: true, prompt: ({ site }) => `Acesse ${site}, entre na página de contato e me diga o e-mail de atendimento.`,
    check: ({ answer }) => has(answer, "atendimento@loja-aurora.test") },
  { id: "lembrar", area: "memória", prompt: "Lembre que meu time de futebol é o Bahia.",
    check: ({ memories }) => memories.some((m) => has(m.content, "bahia")) },
  // Company knowledge: a fictitious HR share (app/sampleDocs.js) is indexed
  // first; the questions never say where the answer is.
  { id: "rh-final-de-ano", area: "conhecimento", knowledge: true, prompt: "Me traz um resumo da programação de final de ano.",
    check: ({ answer }) => has(answer, /19\b/, /Espa[çc]o Jardim/i, /recesso|24\/12/i, /Confraterniza[çc][ãa]o 2026/i) },
  { id: "rh-vale", area: "conhecimento", knowledge: true, prompt: "Quanto é o vale-refeição?",
    check: ({ answer }) => has(answer, /42,00/, /Benef[íi]cios/i) },
  { id: "rh-ferias", area: "conhecimento", knowledge: true, prompt: "Como eu faço para pedir férias?",
    check: ({ answer }) => has(answer, /45 dias/, /portal/i) },
  { id: "rh-folha", area: "conhecimento", knowledge: true, prompt: "Quem cuida da folha de pagamento e qual o ramal?",
    check: ({ answer }) => has(answer, "Diego", "2204") },
  { id: "rh-admissao", area: "conhecimento", knowledge: true, prompt: "O que eu preciso levar no meu primeiro dia de trabalho?",
    check: ({ answer }) => has(answer, "RG", "CPF") },
  { id: "rh-calendario", area: "conhecimento", knowledge: true, prompt: "Quando é o Dia das Crianças em família?",
    check: ({ answer }) => has(answer, /10\/10|10 de outubro/i) },
  { id: "rh-inexistente", area: "conhecimento", knowledge: true, prompt: "Qual é a política de viagens a trabalho da empresa?",
    // Honest "not found" (any wording) and no value attributed to travel.
    check: ({ answer }) => NOT_FOUND.test(answer) && !/(viage|di[áa]ri)[^.\n]{0,80}R\$|R\$[^.\n]{0,40}(viage|di[áa]ri)/i.test(answer) },
  // A file named only by its name, like "resuma o MARU_MEDIA_KIT" (27/09).
  { id: "pdf-citado", area: "arquivos", seed: { "PROPOSTA_COMERCIAL_ACME.pdf": () => makePdf(["Proposta comercial ACME 2026", "Plano mensal: US$ 120", "Plano anual: US$ 1.200 (2 meses grátis)", "Validade da proposta: 30 dias"]) }, prompt: "Quanto custa o plano anual no PROPOSTA_COMERCIAL_ACME?",
    check: ({ answer, steps }) => has(answer, /1\.200/) && !steps.some((s) => s.tool === "web_fetch" || s.tool === "open") },
  { id: "resposta-direta", area: "conversa", prompt: "Quanto é 17 vezes 3? Responda só o número.",
    check: ({ answer, steps }) => has(answer, "51") && !steps.some((s) => ["write_file", "run_command"].includes(s.tool)) },
  // Long conversations about company knowledge (where the invented source
  // and the forced answer showed up): follow-ups that don't repeat the
  // subject, small talk in between, a policy that doesn't exist, the
  // scanned notice and a person contradicting the document. Every turn must
  // pass, and any "Fonte:" must name a real file of the share.
  { id: "conversa-fim-de-ano", area: "conversa longa", knowledge: true, turns: [
    { prompt: "Me traz um resumo da programação de final de ano.", check: ({ answer }) => has(answer, /19\b/, /Espa[çc]o Jardim/i) },
    { prompt: "E até quando eu confirmo presença?", check: ({ answer }) => has(answer, /05\/12|5 de dezembro|05 de dezembro/i) },
    { prompt: "Quanto é o valor do amigo secreto?", check: ({ answer }) => has(answer, /\b80\b/) },
    { prompt: "Quem fica de plantão no RH durante o recesso?", check: ({ answer }) => has(answer, /Marcos/i, /2210/) },
    { prompt: "E qual o horário desse plantão?", check: ({ answer }) => has(answer, /9\s*h|9:00|09:00/i, /15\s*h|15:00/i) },
    { prompt: "Valeu!", check: ({ docs, steps }) => !docs.length && !steps.some((s) => s.tool.startsWith("knowledge_")) },
    { prompt: "Mas me disseram que a confraternização vai ser dia 20, é isso mesmo?", check: ({ answer }) => has(answer, /\b19\b/) },
  ] },
  { id: "conversa-beneficios", area: "conversa longa", knowledge: true, turns: [
    { prompt: "Quanto é o vale-refeição?", check: ({ answer }) => has(answer, /42,00/) },
    { prompt: "E o auxílio home office?", check: ({ answer }) => has(answer, /150/) },
    { prompt: "Quem eu procuro pra tirar dúvida sobre isso?", check: ({ answer }) => has(answer, /J[úu]lia/i, /2207/) },
    { prompt: "Qual é a política de bônus anual?", check: ({ answer }) => NOT_FOUND.test(answer) && !/b[ôo]nus[^.\n]{0,80}R\$\s*\d/i.test(answer) },
    { prompt: "Ok. E a coparticipação do plano de saúde?", check: ({ answer }) => has(answer, /20\s*%/) },
    { prompt: "Crie um arquivo resumo.txt com o valor do vale-refeição.", check: ({ dir }) => has(read(dir, "resumo.txt"), /42/) },
  ] },
  { id: "conversa-ferias-admissao", area: "conversa longa", knowledge: true, turns: [
    { prompt: "Como eu faço para pedir férias?", check: ({ answer }) => has(answer, /45 dias/, /portal/i) },
    { prompt: "Posso dividir em quantas partes?", check: ({ answer }) => has(answer, /\b3\b|tr[êe]s/i) },
    { prompt: "E em quanto tempo o gestor aprova?", check: ({ answer }) => has(answer, /5 dias [úu]teis|cinco dias [úu]teis/i) },
    { prompt: "Oi, tudo bem?", check: ({ docs }) => !docs.length },
    { prompt: "Voltando ao RH: o que eu preciso levar na admissão?", check: ({ answer }) => has(answer, "RG", "CPF") },
    { prompt: "E que horas é a integração no primeiro dia?", check: ({ answer }) => has(answer, /9\s*h|9:00|09:00/i) },
    { prompt: "A empresa paga curso de inglês?", check: ({ answer }) => NOT_FOUND.test(answer) },
  ] },
];

const NOT_FOUND = /n[ãa]o (encontrei|achei|localizei|h[áa]|existe|consta|tenho|identifiquei|cont[ée]m|menciona|foi (poss[íi]vel )?(encontrad|localizad|encontrar|localizar))|nenhum(a)? (documento|informa[çc][ãa]o|pol[íi]tica)/i;
const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\.(docx|xlsx|pptx|pdf|txt)\b/g, "").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
/** Every "Fonte:" in the answer names a real file of the share (no invented sources). */
export function citesRealFiles(answer, files) {
  const names = files.map((f) => fold(f.split("/").pop()));
  return [...String(answer).matchAll(/fontes?\**\s*:\**\s*([^\n]+)/gi)].every(([, cited]) => names.some((n) => fold(cited).includes(n)));
}

function seedFolder(dir, files = {}) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, ...path.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...path.split("/")), typeof content === "function" ? content() : content);
  }
}

/**
 * Runs inside an isolated process whose HARNESS_DB_FILE is a copy of the
 * user's database, so the agent uses the memories it has learned without
 * the benchmark writing anything into the real one.
 */
export async function runAgentEval({ tasks = EVAL_TASKS.filter((t) => !process.env.EVAL_ONLY || process.env.EVAL_ONLY.split(",").includes(t.id)), onProgress = () => {}, env = process.env } = {}) {
  const store = await import("./store.js");
  const { handleChatTurn } = await import("./server.js");
  const { closeBrowserContext } = await import("./browserAgent.js");
  const knowledge = await import("./knowledge.js");
  const { SAMPLE_HR_FILES, writeSampleHrShare } = await import("./sampleDocs.js");
  const shareFiles = Object.keys(SAMPLE_HR_FILES);
  await store.setSetting("teacher_mode", "off");
  await store.setSetting("agent_mode", "auto");
  const root = mkdtempSync(join(tmpdir(), "aurora-eval-"));
  const { server, url: site } = await startTestSite();
  const results = [];
  if (tasks.some((t) => t.knowledge)) {
    // The benchmark's own HR share; the user's real sources are left out so
    // the score doesn't depend on what they happen to have indexed.
    for (const source of await knowledge.listSources()) await knowledge.deleteSource(source.id);
    const share = writeSampleHrShare(join(root, "compartilhamento-rh"));
    const source = await knowledge.createSource({ name: "Pasta do RH (teste)", path: share, department: "RH" });
    await knowledge.indexSource(source.id, { env });
  }
  try {
    for (const [index, task] of tasks.entries()) {
      onProgress({ index, total: tasks.length, task: task.id });
      const dir = join(root, task.id);
      mkdirSync(dir, { recursive: true });
      seedFolder(dir, task.seed);
      const project = await store.createProject({ name: `Avaliação ${task.id}`, workspaceDir: dir });
      const conversation = await store.createConversation({ provider: "local", projectId: project.id });
      const started = Date.now();
      // A conversation is several turns on the same chat; a plain task is one.
      const turns = task.turns || [{ prompt: task.prompt, check: task.check }];
      const outcomes = [];
      for (const step of turns) {
        const turnStarted = Date.now();
        const prompt = typeof step.prompt === "function" ? step.prompt({ site }) : step.prompt;
        let turn;
        try { turn = await handleChatTurn({ conversationId: conversation.id, message: prompt, env }); }
        catch (error) { turn = { ok: false, error: error.message }; }
        const steps = turn.message?.execution?.toolSteps || [];
        const docs = turn.message?.execution?.knowledgeDocs || [];
        const answer = turn.message?.content || "";
        const memories = await store.listMemories({});
        let passed = false;
        try { passed = turn.ok && Boolean(await step.check({ dir, answer, steps, memories, docs })) && (!task.turns || citesRealFiles(answer, shareFiles)); } catch { passed = false; }
        outcomes.push({ prompt, passed, turn, steps, docs, ms: Date.now() - turnStarted });
      }
      const all = outcomes.flatMap((o) => o.steps);
      const calls = outcomes.flatMap((o) => o.turn.message?.execution?.calls || []);
      const failed = outcomes.find((o) => !o.turn.ok);
      results.push({
        id: task.id, area: task.area, passed: outcomes.every((o) => o.passed), ms: Date.now() - started, steps: all.length, failedSteps: all.filter((s) => !s.ok).length,
        modelMs: Math.round(calls.reduce((n, c) => n + (c.metrics?.wallMs || 0), 0)), toolMs: all.reduce((n, s) => n + (s.ms || 0), 0),
        actions: all.map((s) => `${s.ok ? "" : "✕ "}${s.tool} ${JSON.stringify(s.args).slice(0, 80)} (${s.ms}ms)`),
        memoryIds: outcomes.flatMap((o) => o.turn.message?.memoryAccess || []),
        error: failed ? failed.turn.error : null, answer: String(outcomes.at(-1).turn.message?.content || "").slice(0, 300),
        ...(task.turns ? { turns: outcomes.map((o) => ({ prompt: o.prompt, passed: o.passed, ms: o.ms, docs: o.docs.map((d) => d.split(/[\/]/).pop()), answer: String(o.turn.message?.content || o.turn.error || "").slice(0, 300) })) } : {}),
      });
    }
  } finally {
    await closeBrowserContext().catch(() => {});
    server.close();
  }
  return results;
}

export function summarizeEval(results) {
  const passed = results.filter((r) => r.passed).length;
  const byArea = {};
  for (const r of results) { byArea[r.area] ||= { passed: 0, total: 0 }; byArea[r.area].total += 1; byArea[r.area].passed += r.passed ? 1 : 0; }
  // Turns of the long conversations, so one slip doesn't hide 6 good answers.
  const turns = results.flatMap((r) => r.turns || []);
  return { passed, total: results.length, rate: results.length ? passed / results.length : 0, ms: results.reduce((n, r) => n + r.ms, 0), byArea, ...(turns.length ? { turns: { passed: turns.filter((t) => t.passed).length, total: turns.length } } : {}) };
}
