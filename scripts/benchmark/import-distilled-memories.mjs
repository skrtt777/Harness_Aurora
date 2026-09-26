// B.2 (docs/ROADMAP_MODELO_LOCAL.md): import the curated, deduplicated
// memory list from docs/PROACTIVE_DISTILLATION_ROUND2_2026-09-26.md into
// the REAL production database (Electron userData/harness.db), as global
// memories. Uses the app's own createMemory() -- the exact function the
// real "Revisar" flow and the API already use -- so schema/embedding
// handling matches production exactly. WAL mode + busy_timeout (app/db.js)
// make this safe to run while the real app is open. Explicit user
// confirmation obtained before running this against the real database.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
process.env.HARNESS_DB_FILE = process.argv[2];
if (!process.env.HARNESS_DB_FILE) throw new Error("Usage: import-distilled-memories.mjs <path-to-real-harness.db>");
const { createMemory } = await import(pathToFileURL(resolve("app/store.js")));

const source = "Destilação proativa — rodadas 1 e 2 (26/09/2026), lista curada e deduplicada, ver docs/PROACTIVE_DISTILLATION_ROUND2_2026-09-26.md";
const tags = ["destilacao-proativa", "importado-26-09-2026"];
const items = [
  ["Formatação numérica en-US sem separador de milhar", "Para formatar números em en-US sem separador de milhar, use toLocaleString('en-US', { useGrouping: false }) ou Intl.NumberFormat('en-US', { useGrouping: false }).format(valor)."],
  ["Visibilidade definida por CSS", "element.style só lê estilos inline; use getComputedStyle(element).display para consultar o display efetivo quando a visibilidade inicial é definida por CSS."],
  ["Conteúdo no elemento correto", "O texto exigido para uma resposta deve estar no elemento da resposta, mesmo quando esse elemento começa escondido."],
  ["Alternância repetida", "Um controle de alternância deve mostrar o elemento no primeiro clique quando ele começa oculto, e inverter a visibilidade em cada clique seguinte."],
  ["Seletores exigem controle editável", "Quando um requisito exige preencher um seletor, esse seletor deve identificar um controle editável (input de texto, textarea, etc.), nunca um elemento só de exibição."],
  ["Recalcular ao mudar o select", "Um resultado dependente de um <select> deve ser calculado na inicialização e recalculado no evento change."],
  ["Texto literal seguro", "Para preservar texto literal do usuário sem interpretar HTML, use createElement e atribua o texto por textContent, nunca innerHTML nem remoção de tags por regex."],
  ["Estado inicial explícito de select", "Quando o painel/controle deve começar num estado específico declarado no pedido, marque a opção correspondente com selected (ou .value explícito antes do primeiro cálculo) — não deixe a ordem das opções no HTML decidir o estado inicial por padrão."],
  ["Validar entrada numérica antes de acumular", "Antes de acumular uma entrada numérica, verifique que ela é finita e maior que zero, e que a soma permanece finita."],
  ["Persistência após reload", "Para manter um valor após recarregar a página, salve cada atualização em localStorage e restaure um valor validado antes da primeira renderização, usando zero como padrão seguro se a leitura falhar."],
];

for (const [title, content] of items) {
  const saved = await createMemory({ scope: "global", title, content, tags, kind: "extracted", source });
  console.log(JSON.stringify({ id: saved.id, title: saved.title }));
}
console.log(`\n${items.length} memórias globais importadas em ${process.env.HARNESS_DB_FILE}`);
