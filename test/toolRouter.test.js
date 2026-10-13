import test from "node:test";
import assert from "node:assert/strict";

const { routeTools, activeGroups, BASE_TOOLS } = await import("../app/toolRouter.js");
const { AGENT_TOOLS, toolSchemas } = await import("../app/agentTools/index.js");
const { agentRules, topicRules } = await import("../app/economy.js");

test("tools by subject: the base for every request, a group only when the request speaks of it", () => {
  const names = (q, o) => [...routeTools(q, o)];
  assert.deepEqual(names("Gere uma planilha com os funcionários que começam as férias em outubro").sort(), [...BASE_TOOLS].sort());
  assert.ok(names("abra http://127.0.0.1:5000/contato e envie a mensagem").includes("browser_fill"));
  assert.ok(names("organize minha pasta Downloads").includes("organize_folder"));
  assert.ok(names("faça um parecer sobre a Lei do Inquilinato").includes("web_fetch"));
  assert.ok(names("monte um Power BI com a planilha vendas.xlsx").includes("powerbi"));
  assert.ok(names("abre o excel e cria uma planilha de estoque").includes("excel"));
  assert.ok(names("e agora salve isso", { history: ["abre o excel"] }).includes("excel"), "the last messages count");
  assert.ok(names("x", { extra: ["create_site"] }).includes("create_site"));
  // Every routed name exists.
  const all = new Set(AGENT_TOOLS.map((t) => t.name));
  for (const n of names("abra o site, rode o script, power bi, organize, excel, skill, agente, access, indexe a pasta da empresa")) assert.ok(all.has(n), n);
});

test("the cost of a request: a file request reads under a quarter of the old tools and rules", () => {
  const all = JSON.stringify(toolSchemas(AGENT_TOOLS)).length;
  const routed = JSON.stringify(toolSchemas(AGENT_TOOLS.filter((t) => routeTools("Liste os clientes inadimplentes numa planilha").has(t.name)))).length;
  assert.ok(routed < all / 4, `${routed} de ${all}`);
  assert.ok(agentRules.length < 5000, `AGENT.md ${agentRules.length}`);
  assert.deepEqual(activeGroups("abra o site da loja e preencha o formulário"), ["web", "navegador"]);
  assert.match(topicRules.navegador, /browser_fill/);
  assert.doesNotMatch(agentRules, /browser_fill|desktop_snapshot|organize_folder/);
});
