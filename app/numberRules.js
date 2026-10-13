// The number rules a person gives for made-up data ("todos os departamentos com mais de 300
// funcionários", "preços entre 10 e 50", "pelo menos 5 carros por setor") and the rows of a table that
// break them. A small model wrote 312 employees in all for "more than 300 in each department", then a
// subagent wrote Logística 250 and Vendas 280 (12/10): the spreadsheet writer now checks each row.

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const stem = (w) => fold(w).replace(/(oes|aes)$/, "ao").replace(/(ns)$/, "m").replace(/(is)$/, "l").replace(/s$/, "");
const num = (s) => Number(String(s).replace(/\./g, "").replace(",", "."));

/**
 * The rules in a text: [{ op: ">"|">="|"<"|"<="|"between", n, m?, unit }] where unit is the stem of the
 * word after the number ("funcionario", "carro", "real").
 */
export function numberRules(text) {
  const t = fold(text);
  const rules = [];
  const N = "(\\d{1,3}(?:\\.\\d{3})+|\\d+(?:,\\d+)?)";
  const UNIT = "(?:\\s+(?:mil\\s+)?(?:de\\s+)?)?\\s*([a-z]{3,})";
  const add = (op, n, unit, m) => { const u = stem(unit); if (!u || /^(e|ou|em|por|cada|com|no|na|do|da)$/.test(u)) return; rules.push({ op, n: num(n), ...(m != null ? { m: num(m) } : {}), unit: u }); };
  for (const [, n, m, unit] of t.matchAll(new RegExp(`\\bentre\\s+${N}\\s+e\\s+${N}${UNIT}`, "g"))) add("between", n, unit, m);
  const ops = [[">", "mais de|acima de|superior a|maior que|mais que"], [">=", "pelo menos|no minimo|minimo de|ao menos"], ["<", "menos de|abaixo de|inferior a|menor que"], ["<=", "ate|no maximo|maximo de"]];
  for (const [op, words] of ops) for (const [, n, unit] of t.matchAll(new RegExp(`\\b(?:${words})\\s+${N}${UNIT}`, "g"))) add(op, n, unit);
  return rules;
}

const ok = (v, r) => (r.op === ">" ? v > r.n : r.op === ">=" ? v >= r.n : r.op === "<" ? v < r.n : r.op === "<=" ? v <= r.n : v >= r.n && v <= r.m);
const said = (r) => (r.op === "between" ? `entre ${r.n} e ${r.m}` : `${{ ">": "mais de", ">=": "pelo menos", "<": "menos de", "<=": "até" }[r.op]} ${r.n}`);

/**
 * The rows that break a rule, for a table [header, ...rows]: a rule applies to the columns whose name
 * holds its unit ("Quantidade de Funcionários" for "funcionarios"). Returns [{ rule, column, row, value }].
 */
export function ruleBreaks(rows, rules) {
  if (!rules.length || rows.length < 2) return [];
  const header = rows[0].map((h) => fold(h).split(/[^a-z]+/).filter(Boolean).map(stem));
  const out = [];
  for (const rule of rules) {
    const col = header.findIndex((words) => words.includes(rule.unit));
    if (col < 0) continue;
    const label = rows[0].findIndex((_, i) => i !== col && rows.slice(1).every((r) => Number.isNaN(num(r[i])) || /[a-z]/i.test(String(r[i]))));
    for (const r of rows.slice(1)) {
      const v = typeof r[col] === "number" ? r[col] : num(String(r[col]).replace(/^R\$\s*/, ""));
      if (Number.isFinite(v) && !ok(v, rule)) out.push({ rule: `${said(rule)} na coluna ${rows[0][col]}`, column: rows[0][col], row: label >= 0 ? String(r[label]) : String(r[0]), value: v });
    }
  }
  return out;
}

/** The refusal a writer gives for breaks, naming them (null when there are none). */
export function breaksMessage(breaks) {
  if (!breaks.length) return null;
  const byRule = new Map();
  for (const b of breaks) { if (!byRule.has(b.rule)) byRule.set(b.rule, []); byRule.get(b.rule).push(`${b.row} ${b.value}`); }
  return `A pessoa pediu ${[...byRule.keys()].map((r) => `"${r}"`).join(" e ")} em CADA linha, e estas não obedecem: ${[...byRule.values()].map((l) => l.slice(0, 12).join(", ")).join("; ")}. Corrija esses números (cada linha dentro da regra) e grave de novo no mesmo caminho.`;
}
