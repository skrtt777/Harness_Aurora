// Uma planilha como as que chegam das empresas: título e linha em branco antes do cabeçalho, colunas sem
// nome, linha de "Total" no fim, uma aba de observações, valores em texto com "R$" e datas escritas de
// jeitos diferentes. O BI precisa sair igual ao de uma planilha limpa. node make-baguncada.mjs <pasta>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeXlsx } from "../../app/sampleDocs.js";

const folder = process.argv[2];
mkdirSync(folder, { recursive: true });
let seed = 5;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const stores = ["Centro", "Savassi", "Pampulha", "Barreiro"];
const products = ["Pão francês", "Bolo de fubá", "Café", "Pão de queijo", "Croissant", "Suco"];
const rows = [["Relatório de vendas — Rede Sabor", "", "", "", "", ""], ["Gerado em 11/10/2026", "", "", "", "", ""], ["", "", "", "", "", ""],
  ["Data", "Loja", "Produto", "Qtd", "Valor (R$)", ""]];
let total = 0;
for (let i = 0; i < 400; i += 1) {
  const d = new Date(2026, 6 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 28));
  const day = String(d.getDate()).padStart(2, "0"); const month = String(d.getMonth() + 1).padStart(2, "0");
  // Dates written three ways; money as text with R$ and a comma.
  const date = i % 3 === 0 ? `${day}/${month}/${d.getFullYear()}` : i % 3 === 1 ? `${d.getFullYear()}-${month}-${day}` : `${day}/${month}/${String(d.getFullYear()).slice(2)}`;
  const qty = 1 + Math.floor(rand() * 30);
  const value = Math.round(qty * (3 + rand() * 20) * 100) / 100;
  total += value;
  rows.push([date, stores[Math.floor(rand() * stores.length)], products[Math.floor(rand() * products.length)], qty, i % 4 === 0 ? `R$ ${value.toFixed(2).replace(".", ",")}` : value, ""]);
  if (i === 200) rows.push(["", "", "", "", "", ""]);
}
rows.push(["Total", "", "", "", Math.round(total * 100) / 100, ""]);
writeFileSync(join(folder, "vendas_baguncada.xlsx"), makeXlsx({ Vendas: rows, Observações: [["Planilha mantida pelo financeiro."], ["Valores sem impostos."]] }));
writeFileSync(join(folder, "esperado-baguncada.json"), JSON.stringify({ linhas: 400, total: Math.round(total * 100) / 100 }));
console.log("400 vendas, total", Math.round(total * 100) / 100);
