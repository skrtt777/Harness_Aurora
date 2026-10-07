import test from "node:test";
import assert from "node:assert/strict";
import { adjustOptions } from "../.test-build/adjustOptions.js";

test("the numbered options under 'Quer ajustar?' become buttons, the recommended one marked", () => {
  const answer = "🎉 Convite...\n\n**Quer ajustar?**\nEscolhi um tom alegre e deixei a data em branco.\n1. Versão para imprimir em PDF (recomendado)\n2. **Versão mais formal**\n3. Versão curta para status\n\nÉ só pedir.";
  assert.deepEqual(adjustOptions(answer), [
    { label: "Versão para imprimir em PDF", recommended: true },
    { label: "Versão mais formal", recommended: false },
    { label: "Versão curta para status", recommended: false },
  ]);
  assert.deepEqual(adjustOptions("Resposta comum.\n1. item de lista\n2. outro"), []);
});
