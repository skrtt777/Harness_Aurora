import { createMemory, selectRelevantMemories } from "../store.js";
import { allSkills, importSkill } from "../skills.js";
import { importCatalogSkill, searchSkillCatalog } from "../skillCatalog.js";
import { createSource, knowledgeMap, listSources, searchKnowledge, startIndexing } from "../knowledge.js";
import { discoverCompanyFolders } from "../fileAccess.js";

// Paid providers (Claude/Codex chats) only see restricted company documents
// when the person approves; the local model sees everything it indexed.
async function shareAccess(ctx, what) {
  if (!ctx.provider || ctx.provider === "local") return { kind: "meta" };
  const restricted = (await listSources()).filter((s) => !s.paidAllowed);
  return restricted.length ? { kind: "share", summary: `${what} — inclui documentos de ${[...new Set(restricted.map((s) => s.department))].join(", ")} que não estão liberados para IA paga` } : { kind: "meta" };
}

const rememberRestricted = (ctx, items) => { for (const item of items) if (!item.paidAllowed) ctx.restrictedSources?.add(item.sourceId); };

const clip = (text, max) => (String(text).length > max ? `${String(text).slice(0, max)}…` : String(text));

/** A spreadsheet hit is only a slice of its rows: say how to count or list them all. */
export const sheetHint = (path) => (/\.(xlsx|csv|tsv)$/i.test(String(path)) ? `\n(Planilha: isto é só um trecho. Para contar ou listar linhas — quem, quantos, quais — use read_file com path="${path}" e filter="Coluna=texto" ou uma comparação como filter="Coluna>30" ou "Coluna>=01/10/2026; Coluna<=31/10/2026". Para "quem mais/o maior/o primeiro a vencer", use sort="-Coluna" (decrescente) ou sort="Coluna"; a ferramenta também soma as colunas numéricas.)` : "");

async function findLocalSkill(id) {
  const skills = await allSkills();
  return skills.find((s) => s.id === id) || skills.find((s) => s.name === id) || null;
}

export const knowledgeTools = [
  {
    name: "knowledge_search",
    description: "Procura nos documentos da empresa (pastas da rede e SharePoint indexados: políticas, procedimentos, comunicados, planilhas, contatos). Use para QUALQUER pergunta sobre a empresa ou um departamento. Devolve trechos com o arquivo de origem para citar.",
    parameters: { type: "object", properties: { query: { type: "string", description: "o que procurar, com as palavras do usuário" }, category: { type: "string", description: "opcional; só uma categoria que apareceu no knowledge_map ou numa busca anterior" } }, required: ["query"] },
    stage: (a) => `Procurando nos documentos da empresa: "${clip(a.query, 40)}"…`,
    describe: (a, ctx) => shareAccess(ctx, `Buscar "${clip(a.query, 60)}" nos documentos da empresa`),
    async run({ query, category }, ctx) {
      // "Política de home office" (there is none) took 10 searches with the words shuffled (usage
      // tests, 06/10). From the 4th on, the answer reminds it that not finding is an answer.
      // Someone at home has no company documents: "o condomínio de setembro" is their own paper
      // (it answered "não encontrei nos documentos da empresa", usage tests 06/10).
      if (!(await listSources()).some((s) => s.documents > 0)) return "Não há documentos de empresa cadastrados nesta Aurora. Se a pergunta é sobre um papel ou arquivo da pessoa (conta, boleto, contrato, extrato, planilha), procure nas pastas dela com search_files e leia com read_file.";
      ctx.knowledgeSearches = (ctx.knowledgeSearches || 0) + 1;
      if (ctx.knowledgeSearches > 6) return "Você já procurou 6 vezes nos documentos da empresa. Pare de procurar: diga à pessoa o que encontrou, ou que isso não consta nos documentos da empresa.";
      const enough = ctx.knowledgeSearches >= 4 ? `\n\n(Esta é a ${ctx.knowledgeSearches}ª busca. Se o que a pessoa pediu não está nestes trechos, responda que não consta nos documentos da empresa em vez de procurar de novo.)` : "";
      const search = (cat) => searchKnowledge(String(query || ""), { category: cat, env: ctx.env, signal: ctx.signal, sourceIds: ctx.knowledgeSourceIds });
      // A remembered or guessed category ("RH/Eventos" from another share) must not hide the answer.
      let hits = await search(category);
      if (!hits.length && category) hits = await search(undefined);
      if (!hits.length) return `Nada encontrado nos documentos indexados. Diga ao usuário que não encontrou e sugira onde o documento poderia estar.${enough}`;
      rememberRestricted(ctx, hits);
      // Sheets seen here only as excerpts: a table written from them without reading them whole is
      // flagged by write_document (a Controladoria agent wrote its report from this, 05/10/2026).
      ctx.excerptSheets = [...new Set([...(ctx.excerptSheets || []), ...hits.map((h) => h.path).filter((p) => /\.(xlsx|xlsm|csv)$/i.test(p))])];
      return hits.map((h, i) => `${i + 1}. Fonte: ${h.path} (${h.category}, atualizado em ${new Date(h.updatedAt).toLocaleDateString("pt-BR")})\n${clip(h.text, 900)}${sheetHint(h.path)}`).join("\n\n") + "\n\nResponda com base nesses trechos (copie datas, valores e nomes exatamente) e cite o arquivo de origem." + enough;
    },
  },
  {
    name: "knowledge_map",
    description: "Mostra como os documentos da empresa estão organizados: categorias por departamento, cada documento com resumo, datas e fluxos (passo a passo). Use para visão geral ou para listar o que existe num assunto.",
    parameters: { type: "object", properties: { department: { type: "string" }, category: { type: "string" } } },
    stage: () => "Consultando o mapa de documentos…",
    describe: (a, ctx) => shareAccess(ctx, "Ver o mapa de documentos da empresa"),
    async run({ department, category }, ctx) {
      const map = await knowledgeMap({ department, category });
      if (!map.length) return "Nenhum documento indexado ainda. As pastas são cadastradas em Configurações → Conhecimento da empresa.";
      return map.map((c) => `# ${c.category}\n${c.documents.map((d) => `- ${d.title} — arquivo: ${d.path}${d.summary ? `: ${clip(d.summary, 220)}` : ""}${d.flow.length ? `\n  Fluxo: ${d.flow.map((s, i) => `${i + 1}) ${clip(s, 80)}`).join(" ")}` : ""}`).join("\n")}`).join("\n\n").slice(0, 8000);
    },
  },
  {
    name: "knowledge_setup",
    description: "Configura as pastas da empresa que a Aurora conhece. action=list mostra as pastas cadastradas; action=discover procura pastas de setor (RH, Financeiro, Jurídico…) dentro de root (a pasta que o usuário disse, ex.: F:\\Empresa ou \\\\servidor\\dados) ou, sem root, na rede e no SharePoint sincronizado; action=add cadastra folders=[{path, department}] depois que o usuário confirmar a lista. Use quando o usuário disser onde ficam os arquivos da empresa.",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["list", "discover", "add"] }, root: { type: "string" }, folders: { type: "array", items: { type: "object", properties: { path: { type: "string" }, department: { type: "string" } }, required: ["path", "department"] } } }, required: ["action"] },
    stage: (a) => (a.action === "add" ? "Cadastrando pastas da empresa…" : a.action === "discover" ? "Procurando pastas de setor…" : "Consultando as pastas cadastradas…"),
    // Adding folders changes what Aurora reads and indexes: the person confirms the list.
    describe: (a) => (a.action === "add"
      ? { kind: "configure", summary: `Cadastrar ${(a.folders || []).length} pasta(s) no conhecimento da empresa: ${(a.folders || []).map((f) => `${f.department} (${f.path})`).join("; ").slice(0, 400)}` }
      : a.action === "discover" && a.root ? { kind: "read", paths: [String(a.root)] } : { kind: "meta" }),
    async run({ action, root, folders }) {
      if (action === "list") {
        const sources = await listSources();
        return sources.length ? sources.map((s) => `- ${s.department}: ${s.path} (${s.documents} documentos)`).join("\n") : "Nenhuma pasta da empresa cadastrada ainda.";
      }
      if (action === "discover") {
        const found = await discoverCompanyFolders({ roots: root ? [String(root)] : [] });
        if (!found.length) return root ? `Não achei pastas com nome de setor em ${root}. Pergunte ao usuário o setor de cada pasta.` : "Não achei unidades de rede nem SharePoint sincronizado. Pergunte ao usuário onde ficam os arquivos da empresa.";
        return `${found.map((f) => `- ${f.department}: ${f.path} (${f.documents} documentos)`).join("\n")}\n\nMostre esta lista ao usuário e pergunte se pode cadastrar; só depois use action=add.`;
      }
      if (action === "add") {
        const existing = new Set((await listSources()).map((s) => s.path.toLowerCase()));
        const added = [];
        for (const f of (folders || []).slice(0, 40)) {
          if (!f?.path || !f?.department || existing.has(String(f.path).toLowerCase())) continue;
          const source = await createSource({ name: `${f.department} (${String(f.path).split(/[\\/]/).filter(Boolean).pop()})`, path: f.path, department: f.department });
          void startIndexing(source.id).catch(() => {});
          added.push(`${f.department}: ${f.path}`);
        }
        return added.length ? `Cadastradas ${added.length} pasta(s); a indexação roda em segundo plano:\n${added.join("\n")}` : "Essas pastas já estavam cadastradas.";
      }
      return "Ação inválida: use list, discover ou add.";
    },
  },
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
