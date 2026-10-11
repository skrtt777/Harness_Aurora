// Dados de teste para o Power BI da Aurora: uma rede de padarias (vendas de jan/2025 a set/2026, com
// produtos numa aba própria) em .xlsx feito pelo próprio Excel (datas e números de verdade), e um .csv
// brasileiro (ponto e vírgula, vírgula decimal) de chamados de suporte. Num Excel que a Aurora abre.
// node scripts/powerbi-lab/make-data.mjs <pasta>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");

const folder = process.argv[2];
mkdirSync(folder, { recursive: true });
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (list) => list[Math.floor(rand() * list.length)];

const products = [
  ["Pão francês", "Pães", 0.9, 0.35], ["Pão de queijo", "Salgados", 4.5, 1.6], ["Croissant", "Pães", 7.5, 2.8], ["Bolo de cenoura", "Bolos", 32, 11],
  ["Bolo de chocolate", "Bolos", 38, 13], ["Coxinha", "Salgados", 7, 2.4], ["Café expresso", "Bebidas", 6, 1.2], ["Suco natural", "Bebidas", 9, 3],
  ["Sonho", "Doces", 6.5, 2], ["Torta de limão", "Doces", 42, 15],
];
const stores = [["Centro", "Sudeste"], ["Savassi", "Sudeste"], ["Boa Viagem", "Nordeste"], ["Moinhos", "Sul"], ["Asa Sul", "Centro-Oeste"]];
const sellers = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio"];
const channels = ["Balcão", "Delivery", "Encomenda"];
const sales = [["Pedido", "Data", "Loja", "Região", "Vendedor", "Canal", "Produto", "Quantidade", "Preço unitário", "Valor total", "Custo"]];
let order = 10000;
const expected = { total: 0, cost: 0, orders: 0, qty: 0 };
for (let month = 0; month < 21; month += 1) {
  const year = 2025 + Math.floor(month / 12);
  const m = (month % 12) + 1;
  const n = 40 + Math.floor(rand() * 20) + month * 2;
  for (let i = 0; i < n; i += 1) {
    const [product, , price, unitCost] = pick(products);
    const [store, region] = pick(stores);
    const qty = 1 + Math.floor(rand() * (price < 5 ? 40 : 6));
    const day = 1 + Math.floor(rand() * 28);
    const total = Math.round(qty * price * 100) / 100;
    const cost = Math.round(qty * unitCost * 100) / 100;
    order += 1;
    sales.push([order, { date: `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}` }, store, region, pick(sellers), pick(channels), product, qty, price, total, cost]);
    expected.total += total; expected.cost += cost; expected.orders += 1; expected.qty += qty;
  }
}
const productSheet = [["Produto", "Categoria", "Fornecedor"], ...products.map(([p, c]) => [p, c, c === "Bebidas" ? "Café Serra" : c === "Bolos" || c === "Doces" ? "Confeitaria própria" : "Produção própria"])];

console.log((await desktopRequest("excel_open", { file: "" })).text);
try {
  for (const [sheet, rows] of [["Vendas", sales], ["Produtos", productSheet]]) {
    const r = await desktopRequest("excel_write", { sheet, cell: "A1", rows });
    if (!r.ok) throw new Error(r.error);
  }
  const saved = await desktopRequest("excel_save", { path: join(folder, "vendas_padarias.xlsx") });
  console.log(saved.text || saved.error);
} finally {
  await desktopRequest("excel_close");
  stopDesktop();
}

// Chamados de suporte: CSV brasileiro.
const lines = ["Chamado;Abertura;Cliente;Categoria;Prioridade;Status;Horas gastas;Custo do atendimento"];
const csvExpected = { hours: 0, tickets: 0 };
for (let i = 0; i < 300; i += 1) {
  const day = new Date(Date.UTC(2026, 0, 1) + Math.floor(rand() * 270) * 86400000);
  const hours = Math.round((0.5 + rand() * 8) * 10) / 10;
  const cost = Math.round(hours * 85 * 100) / 100;
  csvExpected.hours += hours; csvExpected.tickets += 1;
  lines.push([`CH-${2000 + i}`, `${String(day.getUTCDate()).padStart(2, "0")}/${String(day.getUTCMonth() + 1).padStart(2, "0")}/${day.getUTCFullYear()}`, pick(["Mercado Bom Preço", "Farmácia Vida", "Auto Peças Silva", "Escola Aprender", "Clínica Sorriso"]), pick(["Acesso", "Impressora", "Rede", "Sistema", "E-mail"]), pick(["Alta", "Média", "Baixa"]), pick(["Resolvido", "Resolvido", "Em andamento", "Aguardando cliente"]), String(hours).replace(".", ","), cost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })].join(";"));
}
writeFileSync(join(folder, "chamados_suporte.csv"), `﻿${lines.join("\r\n")}\r\n`);
writeFileSync(join(folder, "esperado.json"), JSON.stringify({ vendas: { ...expected, total: Math.round(expected.total * 100) / 100, cost: Math.round(expected.cost * 100) / 100 }, chamados: { ...csvExpected, hours: Math.round(csvExpected.hours * 10) / 10 } }, null, 2));
console.log("ok", JSON.stringify(expected));
process.exit(0);
