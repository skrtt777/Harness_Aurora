// Dados de teste das finanças de uma empresa: lançamentos de 18 meses (receitas e despesas por categoria e
// centro de custo) e as categorias com o orçamento mensal, num .xlsx gerado aqui mesmo (sem Excel).
// node scripts/powerbi-lab/make-financas.mjs <pasta>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeXlsx } from "../../app/sampleDocs.js";

const folder = process.argv[2];
mkdirSync(folder, { recursive: true });
let seed = 23;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (list) => list[Math.floor(rand() * list.length)];
const br = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

// [categoria, tipo, grupo, orçamento mensal, lançamentos por mês, valor médio, centros]
const categories = [
  ["Venda de produtos", "Receita", "Receita operacional", 180000, 22, 8200, ["Comercial"]],
  ["Prestação de serviços", "Receita", "Receita operacional", 60000, 10, 6100, ["Operações"]],
  ["Receita financeira", "Receita", "Receita financeira", 3000, 1, 2900, ["Administrativo"]],
  ["Folha de pagamento", "Despesa", "Pessoal", 92000, 4, 23500, ["Comercial", "Operações", "Administrativo", "TI"]],
  ["Fornecedores", "Despesa", "Custo dos produtos", 61000, 14, 4300, ["Operações"]],
  ["Aluguel", "Despesa", "Ocupação", 14000, 1, 14000, ["Administrativo"]],
  ["Impostos", "Despesa", "Tributos", 26000, 3, 8800, ["Administrativo"]],
  ["Marketing", "Despesa", "Comercial", 12000, 6, 2300, ["Comercial"]],
  ["Energia e água", "Despesa", "Ocupação", 4200, 2, 2050, ["Operações", "Administrativo"]],
  ["Tecnologia", "Despesa", "Tecnologia", 9000, 5, 1750, ["TI"]],
  ["Logística", "Despesa", "Custo dos produtos", 11000, 8, 1450, ["Operações"]],
  ["Manutenção", "Despesa", "Ocupação", 3500, 2, 1900, ["Operações"]],
];
const forms = ["PIX", "Boleto", "Transferência", "Cartão corporativo"];
const rows = [["Data", "Tipo", "Categoria", "Centro de custo", "Descrição", "Forma de pagamento", "Valor"]];
const now = new Date(); now.setDate(1); now.setHours(0, 0, 0, 0);
const totals = { receita: 0, despesa: 0, byYear: {} };
for (let back = 17; back >= 0; back -= 1) {
  const month = new Date(now.getFullYear(), now.getMonth() - back, 1);
  const season = 1 + 0.12 * Math.sin((month.getMonth() / 12) * Math.PI * 2) + (17 - back) * 0.008;
  for (const [cat, type, , , perMonth, avg, centres] of categories) {
    for (let i = 0; i < perMonth; i += 1) {
      const day = new Date(month.getFullYear(), month.getMonth(), 1 + Math.floor(rand() * 27));
      // Marketing ran over budget in the last months; the rest moves around the average.
      const drift = cat === "Marketing" && back < 4 ? 1.6 : 1;
      const value = Math.round(avg * (0.7 + rand() * 0.6) * (type === "Receita" ? season : 1) * drift * 100) / 100;
      rows.push([br(day), type, cat, pick(centres), `${cat} ${String(month.getMonth() + 1).padStart(2, "0")}/${month.getFullYear()}`, pick(forms), value]);
      const key = type === "Receita" ? "receita" : "despesa";
      totals[key] += value;
      const y = month.getFullYear();
      totals.byYear[y] ||= { receita: 0, despesa: 0 };
      totals.byYear[y][key] += value;
    }
  }
}
writeFileSync(join(folder, "financeiro_empresa.xlsx"), makeXlsx({
  Lançamentos: rows,
  Categorias: [["Categoria", "Grupo", "Orçamento mensal"], ...categories.map(([cat, , group, budget]) => [cat, group, budget])],
}));
const round = (n) => Math.round(n * 100) / 100;
const expected = { rows: rows.length - 1, receita: round(totals.receita), despesa: round(totals.despesa), saldo: round(totals.receita - totals.despesa), byYear: Object.fromEntries(Object.entries(totals.byYear).map(([y, t]) => [y, { receita: round(t.receita), despesa: round(t.despesa) }])) };
writeFileSync(join(folder, "esperado-financas.json"), JSON.stringify(expected, null, 2));
console.log(expected);
