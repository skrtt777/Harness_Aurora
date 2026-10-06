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

export const delegateTools = [
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
