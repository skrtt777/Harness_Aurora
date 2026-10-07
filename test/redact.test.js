import test from "node:test";
import assert from "node:assert/strict";
import { redactRestricted } from "../app/agentTools/files.js";

test("a colleague's salary is not handed out in a chat; totals and an agent's run still see it", () => {
  const sheet = ["## Quadro", "Matrícula | Nome | Setor | Salário base", "1030 | Bruno Gomes | Produção | 2518.03", "1031 | Ana Lima | RH | 4100"];
  const chat = redactRestricted(sheet, "quanto ganha o Bruno Gomes?");
  assert.match(chat.join("\n"), /1030 \| Bruno Gomes \| Produção \| \(restrito\)/);
  assert.doesNotMatch(chat.join("\n"), /2518/);
  assert.match(chat.at(-1), /dados pessoais saem como/);
  assert.deepEqual(redactRestricted(sheet, "qual o total da folha de salários?"), sheet, "a total is fine");
  assert.deepEqual(redactRestricted(sheet, "quanto ganha o Bruno?", { AGENT_RUN_TRIGGER: "manual" }), sheet, "the RH agent's own run");
  assert.deepEqual(redactRestricted(["## Vendas", "Vendedor | Total", "Ana | 10"], "quanto vendeu a Ana"), ["## Vendas", "Vendedor | Total", "Ana | 10"]);
});
