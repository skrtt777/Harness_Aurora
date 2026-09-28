import { createMemory, selectRelevantMemories } from "../store.js";
import { allSkills, importSkill } from "../skills.js";
import { importCatalogSkill, searchSkillCatalog } from "../skillCatalog.js";

const clip = (text, max) => (String(text).length > max ? `${String(text).slice(0, max)}…` : String(text));

async function findLocalSkill(id) {
  const skills = await allSkills();
  return skills.find((s) => s.id === id) || skills.find((s) => s.name === id) || null;
}

export const knowledgeTools = [
  {
    name: "memory_search",
    description: "Procura nas memórias da Aurora (fatos, preferências e lições aprendidas com correções anteriores). Use antes de tarefas parecidas com algo já feito ou quando o usuário perguntar o que você lembra.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    stage: (a) => `Consultando memórias sobre "${clip(a.query, 40)}"…`,
    describe: () => ({ kind: "meta" }),
    async run({ query }, ctx) {
      const found = await selectRelevantMemories(String(query || ""), { conversationId: ctx.conversationId, projectId: ctx.projectId }, 8, ctx.env, ctx.signal);
      return found.length ? found.map((m) => `- [${m.scope}] ${m.title}: ${clip(m.content, 400)}`).join("\n") : "Nenhuma memória relevante.";
    },
  },
  {
    name: "memory_save",
    description: "Guarda algo para lembrar em conversas futuras: um fato ou preferência do usuário (\"lembre que…\"), ou uma lição que você aprendeu ao resolver um erro. Uma frase objetiva. scope: global (vale sempre), project (só neste projeto) ou conversation.",
    parameters: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, scope: { type: "string", enum: ["global", "project", "conversation"] } }, required: ["content"] },
    stage: () => "Guardando na memória…",
    describe: () => ({ kind: "meta" }),
    async run({ title, content, scope }, ctx) {
      const target = scope === "project" && ctx.projectId ? "project" : scope === "conversation" ? "conversation" : "global";
      const memory = await createMemory({
        scope: target, projectId: ctx.projectId, conversationId: ctx.conversationId,
        title: clip(title || content, 80), content: clip(content, 600), kind: "extracted",
        source: "Salvo pela Aurora durante a conversa", env: ctx.env,
      });
      return memory.deduplicated ? `Já existia uma memória igual: "${memory.title}".` : `Guardei: "${memory.title}" (${target}).`;
    },
  },
  {
    name: "skill_search",
    description: "Procura skills (procedimentos prontos para um tipo de tarefa) na biblioteca da Aurora e no catálogo público. Use quando a tarefa for especializada (ex.: planilhas, PDF, deploy, uma API específica).",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    stage: (a) => `Procurando skills de "${clip(a.query, 40)}"…`,
    describe: () => ({ kind: "meta" }),
    async run({ query }) {
      const words = String(query || "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
      const local = (await allSkills()).map((s) => ({ s, score: words.filter((w) => `${s.name} ${s.description}`.toLowerCase().includes(w)).length }))
        .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 6)
        .map(({ s }) => `- ${s.id} — ${s.name}${s.enabled ? "" : " (inativa)"}: ${clip(s.description, 160)}`);
      let catalog = [];
      try {
        const result = await searchSkillCatalog({ query: String(query || "").slice(0, 150), limit: 6 });
        catalog = result.skills.filter((s) => s.importable).map((s) => `- ${s.id} — ${s.name} [${s.source}]: ${clip(s.description, 160)}`);
      } catch { /* catalog not synced yet */ }
      if (!local.length && !catalog.length) return "Nenhuma skill encontrada. (Se o catálogo público estiver vazio, ele pode ser sincronizado na tela Skills.)";
      return [local.length && `Biblioteca da Aurora:\n${local.join("\n")}`, catalog.length && `Catálogo público (usar pede autorização):\n${catalog.join("\n")}`].filter(Boolean).join("\n\n") + "\n\nUse skill_use com o id para ler as instruções.";
    },
  },
  {
    name: "skill_use",
    description: "Lê as instruções completas de uma skill (id vindo de skill_search) para seguir nesta tarefa. Skills do catálogo público são baixadas para a biblioteca antes (pede autorização).",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    stage: (a) => `Lendo a skill ${clip(a.id, 30)}…`,
    async describe({ id }) {
      return (await findLocalSkill(String(id))) ? { kind: "meta" } : { kind: "import", summary: `Baixar e usar a skill ${id} do catálogo público` };
    },
    async run({ id }) {
      let skill = await findLocalSkill(String(id));
      if (!skill) {
        const imported = await importCatalogSkill(String(id));
        skill = await findLocalSkill(imported.id);
      }
      if (!skill) throw new Error("Skill não encontrada.");
      return `Skill ${skill.name}${skill.enabled ? "" : " (inativa: vale só para esta tarefa)"}\n\n${clip(skill.body, 8000)}`;
    },
  },
  {
    name: "skill_create",
    description: "Cria uma skill nova com um procedimento reutilizável que você acabou de descobrir ou que o usuário pediu para guardar. Fica inativa até o usuário (ou o professor) aprovar.",
    parameters: { type: "object", properties: { name: { type: "string", description: "minúsculas e hífens, ex.: exportar-planilha-pdf" }, description: { type: "string", description: "quando usar" }, body: { type: "string", description: "procedimento em Markdown" } }, required: ["name", "description", "body"] },
    stage: (a) => `Criando a skill ${clip(a.name, 30)}…`,
    describe: () => ({ kind: "meta" }),
    async run({ name, description, body }, ctx) {
      const slug = String(name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
      if (!slug || !String(body || "").trim()) throw new Error("Informe nome e procedimento.");
      const text = `---\nname: ${JSON.stringify(slug)}\ndescription: ${JSON.stringify(clip(description, 1100))}\n---\n${clip(body, 12000)}`;
      const skill = await importSkill(text, `Aurora: criada pelo agente${ctx.conversationId ? ` na conversa ${ctx.conversationId}` : ""}`);
      return `Criei a skill ${skill.name} (${skill.id}). Ela fica inativa até ser aprovada na tela Skills.`;
    },
  },
  {
    name: "update_plan",
    description: "Registra ou atualiza a lista de etapas de um pedido longo (3 ou mais etapas), para você e o usuário acompanharem. status: pending, in_progress ou done.",
    parameters: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { text: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "done"] } }, required: ["text"] } } }, required: ["items"] },
    stage: () => "Organizando as etapas…",
    describe: () => ({ kind: "meta" }),
    async run({ items }, ctx) {
      const plan = (Array.isArray(items) ? items : []).slice(0, 20).map((i) => ({ text: clip(i?.text || "", 160), status: ["pending", "in_progress", "done"].includes(i?.status) ? i.status : "pending" })).filter((i) => i.text);
      if (!plan.length) throw new Error("Informe as etapas.");
      ctx.onPlan?.(plan);
      const mark = { pending: "[ ]", in_progress: "[~]", done: "[x]" };
      return `Plano:\n${plan.map((i) => `${mark[i.status]} ${i.text}`).join("\n")}`;
    },
  },
];
