// The computer map as an agent tool: how the PC is organized, and files by name anywhere, from the
// index the background scan keeps (app/computerMap.js) — no disk walk, no file opened.
import { mapChildren, mapOverview, mapRecent, mapSearch, mapStatus } from "../computerMap.js";
import { getSetting } from "../store.js";

export const mapEnabled = async () => (await getSetting("computer_map")) === "true";

export const computerTools = [
  {
    name: "computer_map",
    description: "Mapa do computador da pessoa: onde ficam projetos, fotos, documentos, downloads, jogos. Sem argumentos: a visão geral. query: acha arquivos e pastas pelo nome em todo o computador, na hora (ex.: \"contrato aluguel\"). path: o que há dentro de uma pasta. recent_days: o que chegou ou mudou nos últimos dias. Use antes de procurar no disco quando não souber onde algo está.",
    parameters: { type: "object", properties: { query: { type: "string", description: "palavras do nome do arquivo ou pasta" }, path: { type: "string", description: "uma pasta para ver o que tem dentro" }, recent_days: { type: "number", description: "arquivos novos ou alterados nos últimos N dias" } } },
    stage: (a) => (a.query ? `Procurando "${a.query}" no mapa do computador…` : "Consultando o mapa do computador…"),
    describe: () => ({ kind: "meta" }),
    async run({ query, path, recent_days: recentDays }) {
      if (!(await mapEnabled())) return "O mapa do computador está desligado (Configurações → Pastas). Use search_files para procurar no disco.";
      const s = mapStatus();
      const note = s.running ? `\n(O mapa ainda está sendo feito: ${s.dirs} pastas até agora; o que falta pode não aparecer.)` : "";
      if (recentDays) {
        const recent = await mapRecent(recentDays);
        const asOf = s.finishedAt ? ` (mapa atualizado em ${new Date(s.finishedAt).toLocaleString("pt-BR")})` : "";
        return recent.length ? `Arquivos novos ou alterados nos últimos ${recentDays} dia(s)${asOf}:\n${recent.map((f) => `- ${f.path} (${f.size}, ${f.modified})`).join("\n")}\n(Na resposta, diga o nome de cada arquivo e a pasta onde está.)${note}` : `Nenhum arquivo novo ou alterado nos últimos ${recentDays} dia(s)${asOf}.${note}`;
      }
      if (query) {
        const { files, folders } = await mapSearch(query, { limit: 20 });
        if (!files.length && !folders.length) return `Nada com "${query}" no nome, no mapa do computador.${note}`;
        return [
          ...(folders.length ? ["Pastas:", ...folders.map((f) => `- ${f.path}${f.label ? ` [${f.label}]` : ""} (${f.files} arquivos)`)] : []),
          ...(files.length ? ["Arquivos:", ...files.map((f) => `- ${f.path} (${f.size}, ${f.modified || "?"})`)] : []),
        ].join("\n") + note;
      }
      if (path) {
        const children = await mapChildren(path, { limit: 40 });
        if (!children.length) return `${path} não tem subpastas no mapa (ou não está mapeada). Para ver os arquivos, use list_dir.${note}`;
        return `${path}:\n${children.map((c) => `- ${c.name}${c.label ? ` [${c.label}]` : ""} — ${c.files} arquivos, ${c.size}`).join("\n")}${note}`;
      }
      return ((await mapOverview()) || "O mapa do computador ainda está vazio: a primeira passagem leva alguns minutos.") + note;
    },
  },
];
