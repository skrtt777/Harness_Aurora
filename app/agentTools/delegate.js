import { join } from "node:path";
// The Aurora hands a job to one of its agents ("peça ao agente financeiro a lista de cobrança"): the
// agent runs as usual (its folder, its rules, its record) and its answer and files come back. From the
// chat or the phone. An agent's own run can't delegate (no loops between agents).

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** The agent a name points to: exact, then "contains" either way, then by department. */
export function findAgent(agents, name) {
  const wanted = fold(name).replace(/^(o |a )?agente\s+(d[oa]s?\s+)?/, "");
  if (!wanted) return null;
  const named = (a) => fold(a.name).replace(/^agente\s+(d[oa]s?\s+)?/, "");
  return agents.find((a) => named(a) === wanted)
    || agents.find((a) => named(a).includes(wanted) || wanted.includes(named(a)))
    || agents.find((a) => a.department && fold(a.department) === wanted)
    || null;
}

/** "Pedi à equipe…": what each agent did and where the summary is, in a few lines. */
export function teamAnswer(tasks, results, summaryFile) {
  const lines = results.map((r) => `- ${r.agentName}: ${r.status === "done" ? "entregou" : "não terminou"}${(r.files || []).length ? ` ${r.files.map((f) => f.split(/[\\/]/).pop()).join(", ")}` : ""}${r.status !== "done" && r.error ? ` (${String(r.error).slice(0, 120)})` : ""}`);
  const files = results.flatMap((r) => r.files || []);
  return `Pedi à equipe (${tasks.length} agente${tasks.length > 1 ? "s" : ""}):\n${lines.join("\n")}${files.length ? `\n\nArquivos:\n${files.map((f) => `- ${f}`).join("\n")}` : ""}${summaryFile ? `\n\nResumo da equipe em Word: ${summaryFile}` : ""}`;
}

export const delegateTools = [
  {
    name: "team_request",
    description: "Divide um pedido grande entre os agentes da pessoa (a equipe), roda todos e devolve o que cada um entregou e um resumo em Word. Use quando a pessoa pedir algo PARA A EQUIPE ou que envolve vários setores ao mesmo tempo (\"feche o mês\", \"prepare a reunião de segunda com RH e Financeiro\").",
    parameters: { type: "object", properties: { request: { type: "string", description: "o pedido, com as palavras da pessoa" } }, required: ["request"] },
    stage: () => "Dividindo o pedido entre a equipe…",
    describe: () => ({ kind: "meta" }),
    async run({ request }, ctx) {
      if (ctx.env?.AGENT_RUN_TRIGGER) throw new Error("Um agente não aciona a equipe: faça você mesmo esta parte.");
      const text = String(request || "").trim();
      if (!text) throw new Error("Diga o que a equipe deve fazer.");
      const agents = await import("../agents.js");
      const team = await import("../orchestrator.js");
      const { knownFolders } = await import("./index.js");
      const handleChatTurn = ctx.handleChatTurn || (await import("../chatTurn.js")).handleChatTurn;
      const plan = await (ctx.planTeam || team.planRequest)({ request: text, agents: await agents.listAgents(), env: ctx.env });
      if (!plan.tasks.length) return "Nenhum agente da equipe tem a ver com esse pedido. Os agentes são criados na tela Agentes.";
      const dir = join((await knownFolders()).documents, "Aurora", "Equipe");
      const { id, done } = await team.startOrchestration({ request: text, tasks: plan.tasks, dir, runAgent: agents.runAgent, handleChatTurn });
      await done;
      const finished = await team.getOrchestration(id);
      const answer = teamAnswer(plan.tasks, finished?.results || [], finished?.summaryFile || null);
      ctx.delegatedTo = "A equipe";
      ctx.delegatedAnswer = answer;
      return answer;
    },
  },
  {
    name: "agent_delegate",
    description: "Passa um trabalho para um dos agentes da pessoa (os \"funcionários\" da tela Agentes) e devolve o que ele respondeu e os arquivos que entregou. Use quando a pessoa pedir algo a um agente pelo nome (\"peça ao agente financeiro…\", \"manda o Resumo da manhã rodar\"). Sem agent, lista os agentes.",
    parameters: { type: "object", properties: { agent: { type: "string", description: "nome do agente" }, request: { type: "string", description: "o que ele deve fazer, com as palavras da pessoa" } } },
    stage: (a) => (a.agent ? `Pedindo a ${a.agent}…` : "Vendo os agentes…"),
    describe: () => ({ kind: "meta" }),
    async run({ agent, request }, ctx) {
      if (ctx.env?.AGENT_RUN_TRIGGER) throw new Error("Um agente não passa trabalho para outro: faça você mesmo esta parte.");
      const agents = await import("../agents.js");
      const list = await agents.listAgents();
      if (!list.length) return "A pessoa ainda não tem agentes. Eles são criados na tela Agentes.";
      if (!String(agent || "").trim()) return `Agentes: ${list.map((a) => `${a.name}${a.enabled ? "" : " (desligado)"} — ${a.mission.slice(0, 100)}`).join("; ")}`;
      const target = findAgent(list, agent);
      if (!target) return `Não há agente chamado "${agent}". Agentes: ${list.map((a) => a.name).join(", ")}.`;
      if (!target.enabled) return `${target.name} está desligado. A pessoa liga em Agentes.`;
      if (agents.isAgentRunning(target.id)) return `${target.name} já está trabalhando agora; tente daqui a pouco.`;
      const handleChatTurn = ctx.handleChatTurn || (await import("../chatTurn.js")).handleChatTurn;
      const run = await agents.runAgent(target.id, { request: String(request || "").trim() || target.trigger?.request || target.mission, trigger: "manual", handleChatTurn });
      const files = (run.files || []).map((f) => `- ${f}`).join("\n");
      // The job is the agent's now: the chat went on to search and write its own copy (06/10).
      if (run.status === "done") {
        ctx.delegatedTo = target.name;
        // The answer the person gets (chatAgent ends the turn with it).
        ctx.delegatedAnswer = `Pedi a ${target.name}, e ele terminou:\n\n${String(run.answer || "Feito.").trim()}${(run.files || []).length ? `\n\nArquivos entregues:\n${run.files.map((f) => `- ${f}`).join("\n")}` : ""}`;
      }
      return `${target.name} ${run.status === "done" ? "terminou" : "não conseguiu terminar"}:\n${String(run.answer || run.error || "").slice(0, 2500)}${files ? `\n\nArquivos entregues:\n${files}` : ""}\n(${run.status === "done" ? "O trabalho está feito pelo agente: não refaça nem crie outro arquivo. Só conte à pessoa o resultado e onde estão os arquivos." : "Conte à pessoa que o agente não terminou e por quê; não faça o trabalho no lugar dele sem ela pedir."})`;
    },
  },
];
