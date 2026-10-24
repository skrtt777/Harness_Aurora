// Exact arithmetic for a small model: "tirei 4,7, 7,8, 4,2 nas provas, qual a média" came back as the mean of
// four notes (one read twice), and a 15% discount a few cents off (ladder D01, 24/10). Numbers are Brazilian
// ("1.234,56", "4,7"); the model writes the expression, the code does the sum.

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fmt = (v) => (Number.isInteger(v) ? v.toLocaleString("pt-BR") : v.toLocaleString("pt-BR", { maximumFractionDigits: 4 }));

/** One number as people write it: "1.234,56", "4,7", "1234.5", "1.800". */
export function brNumber(token) {
  const t = String(token).trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d+,\d+$/.test(t)) return Number(t.replace(",", "."));
  return Number(t);
}

/** "4,7, 7,8 e 4,2" / "4,7; 7,8; 4,2" → [4.7, 7.8, 4.2]: a comma followed by a space separates, without one it is decimal. */
export function numberList(text) {
  return String(text || "").replace(/r\$\s*/gi, "").split(/,\s+|;\s*|\s+e\s+|\s*\n\s*|\s{2,}/)
    .map((p) => p.match(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/)?.[0]).filter(Boolean).map(brNumber).filter(Number.isFinite);
}

/** An arithmetic expression in Brazilian notation → its value (only numbers, + - * / ^ ( ) and "x% de y"). */
export function evaluate(expression) {
  let s = fold(expression).replace(/r\$\s*/g, "").replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/\bmais\b/g, "+").replace(/\bmenos\b/g, "-").replace(/\bvezes\b/g, "*").replace(/\bdividido por\b/g, "/");
  s = s.replace(/(\d+(?:[.,]\d+)*)\s*%\s*(?:de|of)\s*/g, "$1/100*").replace(/(\d+(?:[.,]\d+)*)\s*%/g, "($1/100)");
  s = s.replace(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+|\d+(?:\.\d+)?/g, (n) => String(brNumber(n))).replace(/\^/g, "**");
  if (!/^[\d.+\-*/()\s]+$/.test(s) || !/\d/.test(s)) throw new Error(`Só números e + - * / ( ) %: "${expression}".`);
  const value = Function(`"use strict"; return (${s});`)();
  if (!Number.isFinite(value)) throw new Error("A conta não dá um número (divisão por zero?).");
  return Math.round(value * 1e6) / 1e6;
}

const OPS = {
  soma: (n) => n.reduce((a, b) => a + b, 0),
  media: (n) => n.reduce((a, b) => a + b, 0) / n.length,
  maior: (n) => Math.max(...n),
  menor: (n) => Math.min(...n),
  diferenca: (n) => n[0] - n.slice(1).reduce((a, b) => a + b, 0),
};

export const calcTools = [
  {
    name: "calculate",
    description: "Faz contas exatas — use em vez de calcular de cabeça (porcentagem, desconto, troco, parcela, média, soma, diferença). Ou expressao (ex.: \"100 - 21,58 - 47,55 - 7,17\", \"12% de 500\", \"395,73 * (1 - 40%)\", \"(870 + 920) / 3\"), ou numeros com operacao (soma, media, maior, menor, diferenca): passe os números como a pessoa escreveu (\"4,7, 7,8 e 4,2\"). Números no jeito brasileiro (1.234,56).",
    parameters: { type: "object", properties: { expressao: { type: "string" }, numeros: { type: "string", description: "Lista de números, como a pessoa escreveu" }, operacao: { type: "string", enum: Object.keys(OPS) } } },
    stage: () => "Calculando…",
    describe: () => ({ kind: "read", paths: [] }),
    async run({ expressao, numeros, operacao }, ctx = {}) {
      if (numeros) {
        let list = numberList(numeros);
        // "8,7,6,3,9" (the spaces dropped) for "tirei 8,7, 6,3, 9": the person's own list, when its digits match.
        if (list.length < 2 && /\d,\d+,\d/.test(numeros)) {
          const asked = numberList(ctx.request), digits = String(numeros).replace(/\D/g, "");
          for (let i = 0; i < asked.length && list.length < 2; i += 1) for (let j = asked.length; j > i + 1; j -= 1) if (asked.slice(i, j).map((n) => String(n).replace(/\D/g, "")).join("") === digits) { list = asked.slice(i, j); break; }
        }
        if (!list.length) throw new Error(`Não achei números em "${numeros}".`);
        const op = OPS[operacao] ? operacao : "soma";
        const value = Math.round(OPS[op](list) * 1e6) / 1e6;
        return `${op} de ${list.length} número(s) (${list.map(fmt).join("; ")}) = ${fmt(value)}${op === "media" ? ` (com 2 casas: ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : ""}`;
      }
      if (!expressao) throw new Error("Passe expressao, ou numeros com operacao.");
      const value = evaluate(expressao);
      return `${expressao} = ${fmt(value)}${Number.isInteger(value) ? "" : ` (com 2 casas: ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`}`;
    },
  },
];
