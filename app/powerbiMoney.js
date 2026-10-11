// Money coming in and going out, read from the columns of any ledger: a type column (Entrada/Saída,
// Receita/Despesa, Crédito/Débito, A receber/A pagar), signed amounts, or two columns (Entradas, Saídas);
// the category and the cost centre around it; a budget or target in a table of its own. With it the BI
// opens on the money: where it comes from and where it goes (the picture of app/powerbiScene.js), the
// balance, the margin, the budget executed. app/powerbiDesign.js calls this.
import { moneyFlowScene, targetBar } from "./powerbiScene.js";

const IN = /entrada|receita|cr[ée]dito|recebiment|recebid|a receber|venda|aporte|rendiment|faturad/i;
const OUT = /sa[íi]da|despesa|d[ée]bito|pagament|a pagar|custo|gasto|compra|imposto|tarifa|pago/i;
const CATEGORY = /categoria|conta|plano|natureza|grupo|classifica|rubrica|tipo de (despesa|receita|gasto)/i;
const CENTRE = /centro de custo|departamento|setor|[áa]rea|filial|unidade|projeto/i;
const BUDGET = /or[çc]ad|or[çc]amento|meta|previst|planejad/i;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const col = (table, column) => `${q(table)}[${String(column).replace(/]/g, "]]")}]`;
const list = (values) => `{${values.map((v) => `"${String(v).replace(/"/g, "\"\"")}"`).join(", ")}}`;
const valuesOf = (table, column) => table.rows.map((r) => String(r[table.columns.indexOf(column)] ?? "").trim()).filter(Boolean);
const MONEY = "\"R$\" #,0.00";
const PCT = "0.0%";

/**
 * The money of a ledger, or null. relationships: [{ dim, key, to }] from the design (a budget lives in a
 * dimension table joined by the category).
 */
export function readMoney(fact, relationships = [], parse = Number) {
  const money = fact.columns.filter((c) => c.role === "money" || c.role === "value");
  if (!money.length) return null;
  const amount = money.find((c) => /valor|montante|quantia|realizado|total/i.test(c.name) && !BUDGET.test(c.name)) || money.find((c) => !BUDGET.test(c.name));
  let direction = null;
  // A type column whose values split into money in and money out.
  for (const c of fact.columns) {
    if (c.type !== "texto" || c.distinct < 2 || c.distinct > 8) continue;
    const distinct = [...new Set(valuesOf(fact, c))];
    const ins = distinct.filter((v) => IN.test(v) && !OUT.test(v));
    const outs = distinct.filter((v) => OUT.test(v) && !IN.test(v));
    if (ins.length && outs.length && ins.length + outs.length >= distinct.length * 0.8) { direction = { kind: "type", column: c.name, ins, outs }; break; }
  }
  // Two columns: Entradas and Saídas (Crédito and Débito).
  if (!direction) {
    const a = money.find((c) => IN.test(c.name)); const b = money.find((c) => OUT.test(c.name) && c !== a);
    if (a && b && !/custo/i.test(b.name)) direction = { kind: "columns", inColumn: a.name, outColumn: b.name };
  }
  // Signed amounts: expenses negative.
  if (!direction && amount) {
    const i = fact.columns.indexOf(amount);
    const nums = fact.rows.map((r) => parse(r[i])).filter(Number.isFinite);
    const negative = nums.filter((n) => n < 0).length;
    if (negative >= nums.length * 0.05 && negative <= nums.length * 0.95) direction = { kind: "signed" };
  }
  if (!direction || (!amount && direction.kind !== "columns")) return null;
  const dims = [
    ...relationships.flatMap((r) => r.dim.columns.filter((c) => c.type === "texto").map((c) => ({ table: r.dim.name, column: c, key: c.name === r.key, rel: r }))),
    ...fact.columns.filter((c) => c.type === "texto" && c.role === "dimension").map((c) => ({ table: fact.name, column: c })),
  ].filter((d) => d.column.name !== direction.column);
  const category = dims.find((d) => CATEGORY.test(d.column.name) && d.column.distinct >= 2 && d.column.distinct <= 60)
    || dims.find((d) => d.table === fact.name && d.column.distinct >= 3 && d.column.distinct <= 40 && !CENTRE.test(d.column.name));
  const centre = dims.find((d) => CENTRE.test(d.column.name) && d !== category && d.column.distinct >= 2 && d.column.distinct <= 40);
  // The budget: a number in the category's own table (Orçamento mensal per Categoria).
  let budget = null;
  if (category?.rel) {
    const b = category.rel.dim.columns.find((c) => BUDGET.test(c.name) && c.type !== "texto");
    if (b) budget = { table: category.rel.dim.name, column: b.name, monthly: !/anual|ano\b/i.test(b.name) };
  }
  if (!budget) {
    const b = money.find((c) => BUDGET.test(c.name));
    if (b) budget = { table: fact.name, column: b.name, inFact: true };
  }
  return { fact: fact.name, amount: amount?.name || null, direction, category: category ? { table: category.table, column: category.column.name } : null, centre: centre ? { table: centre.table, column: centre.column.name } : null, budget };
}

/**
 * The money's measures and its page. add() is the design's own; returns { kpis, page, income, outgo,
 * balance }. hasCalendar: the model has the 'Calendário' table.
 */
export function moneyDesign(money, { add, hasCalendar }) {
  const F = money.fact;
  const d = money.direction;
  const amt = money.amount ? col(F, money.amount) : null;
  const m = (n) => `[${n}]`;
  let inExpr; let outExpr;
  if (d.kind === "type") {
    inExpr = `CALCULATE(SUMX(${q(F)}, ABS(${amt})), KEEPFILTERS(${col(F, d.column)} IN ${list(d.ins)}))`;
    outExpr = `CALCULATE(SUMX(${q(F)}, ABS(${amt})), KEEPFILTERS(${col(F, d.column)} IN ${list(d.outs)}))`;
  } else if (d.kind === "columns") {
    inExpr = `SUM(${col(F, d.inColumn)})`;
    outExpr = `SUM(${col(F, d.outColumn)})`;
  } else {
    inExpr = `SUMX(FILTER(${q(F)}, ${amt} > 0), ${amt})`;
    outExpr = `-SUMX(FILTER(${q(F)}, ${amt} < 0), ${amt})`;
  }
  const income = add("Entradas no período", inExpr, MONEY, "Finanças", "Tudo o que entrou");
  const outgo = add("Saídas no período", outExpr, MONEY, "Finanças", "Tudo o que saiu");
  const balance = add("Saldo do período", `${m(income)} - ${m(outgo)}`, MONEY, "Finanças", "Entradas menos saídas");
  const margin = add("Margem do período %", `DIVIDE(${m(balance)}, ${m(income)})`, PCT, "Finanças", "Quanto das entradas sobrou");
  const kpis = [income, outgo, balance, margin];
  let running = null;
  if (hasCalendar) running = add("Saldo acumulado", `CALCULATE(${m(balance)}, FILTER(ALLSELECTED('Calendário'[Data]), 'Calendário'[Data] <= MAX('Calendário'[Data])))`, MONEY, "Finanças", "O saldo somado mês a mês");
  let planned = null; let execution = null; let executionBar = null;
  if (money.budget) {
    const b = money.budget;
    const sum = `SUM(${col(b.table, b.column)})`;
    // A monthly budget counts once per month in view; an annual one, a twelfth per month.
    // The months with entries (the calendar starts in January: counting its empty months made 84% of 103%).
    const months = `COUNTROWS(SUMMARIZE(CALCULATETABLE(${q(F)}, REMOVEFILTERS(${q(b.table)})), 'Calendário'[Ano-mês nº]))`;
    const perMonth = b.inFact || !hasCalendar ? `${sum} + 0` : `${sum} * ${months}${b.monthly ? "" : " / 12"}`;
    // The spending budget: the categories where money went out (a revenue line has a budget too — a goal —
    // and summed with the expenses it made the execution 41%, 11/10).
    const cat = money.category ? col(money.category.table, money.category.column) : null;
    // CALCULATE: each category's own budget (without it every row summed all of them: 5%, 11/10).
    planned = add("Orçado no período", cat ? `SUMX(FILTER(VALUES(${cat}), ${m(outgo)} > 0), CALCULATE(${perMonth}))` : perMonth, MONEY, "Orçamento", `${b.column}${b.inFact ? "" : b.monthly ? " por mês" : " por ano"}, das categorias de saída`);
    const realized = cat ? `SUMX(FILTER(VALUES(${cat}), ${m(outgo)} > 0), ${m(outgo)})` : m(outgo);
    execution = add("Execução do orçamento %", `DIVIDE(${realized}, ${m(planned)})`, PCT, "Orçamento", "Saídas sobre o orçado para elas");
    executionBar = add("Execução", targetBar({ actual: realized, target: m(planned), lowerIsBetter: true }), null, "Cenas", "Barra das saídas sobre o orçado", { category: "ImageUrl" });
    kpis.push(execution);
  }
  const scene = money.category ? add("Fluxo do dinheiro", moneyFlowScene({ category: col(money.category.table, money.category.column), income: m(income), outgo: m(outgo) }), null, "Cenas", "De onde vem e para onde vai o dinheiro", { category: "ImageUrl" }) : null;

  // The blocks a plan can place.
  const cat = money.category ? col(money.category.table, money.category.column) : null;
  const scenes = {};
  if (scene) scenes.dinheiro = { desc: `de onde vem e para onde vai o dinheiro: entradas → caixa → saídas por ${money.category.column.toLowerCase()}, na espessura dos valores, com o saldo`, make: () => ({ type: "image", url: m(scene), title: "Para onde vai o dinheiro" }) };
  const specials = {};
  if (hasCalendar) specials.entradas_e_saidas = { desc: "entradas e saídas lado a lado, mês a mês", make: () => ({ type: "clusteredColumnChart", title: "Entradas e saídas por mês", category: "'Calendário'[Mês/ano]", values: [m(income), m(outgo)], sort: { by: "'Calendário'[Mês/ano]", desc: false } }) };
  if (running) specials.saldo_acumulado = { desc: "o saldo somado mês a mês (linha)", make: () => ({ type: "lineChart", title: "Saldo acumulado", category: "'Calendário'[Mês/ano]", values: m(running), sort: { by: "'Calendário'[Mês/ano]", desc: false } }) };
  if (planned && cat) specials.orcamento_por_categoria = { desc: `cada ${money.category.column.toLowerCase()} de saída com o gasto e a barra do orçamento (vermelho quando estoura)`, make: () => ({ type: "tableEx", title: "Saídas × orçamento", values: [cat, m(outgo), m(executionBar)], totals: false, image: { height: 20, width: 120 }, sort: { by: m(outgo) } }) };
  const slicers = [money.centre ? col(money.centre.table, money.centre.column) : null, d.kind === "type" ? col(F, d.column) : null].filter(Boolean);
  return { kpis, income, outgo, balance, margin, running, planned, execution, scenes, specials, slicers };
}
