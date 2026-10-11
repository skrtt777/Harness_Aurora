// Dados de teste de um centro de distribuição: embarques (pedido, caminhão, doca, etapa, prazo) e o
// estoque, num .xlsx gerado aqui mesmo (sem Excel). As datas vão até hoje, então há caminhões nas docas,
// na fila, em trânsito e entregues, alguns atrasados. node scripts/powerbi-lab/make-logistica.mjs <pasta>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeXlsx } from "../../app/sampleDocs.js";

const folder = process.argv[2];
mkdirSync(folder, { recursive: true });
let seed = 11;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (list) => list[Math.floor(rand() * list.length)];
const day = 86_400_000;
const today = new Date(); today.setHours(0, 0, 0, 0);
const br = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

const clients = [["Atacadão Serra", "Belo Horizonte", "MG"], ["Rede Bom Preço", "Recife", "PE"], ["Supermercados Pampa", "Porto Alegre", "RS"], ["Mercantil Paulista", "Campinas", "SP"], ["Distribuidora Cerrado", "Goiânia", "GO"], ["Empório Litoral", "Santos", "SP"], ["Casa & Lar", "Curitiba", "PR"], ["Farma Vida", "Salvador", "BA"], ["Mega Construção", "Uberlândia", "MG"], ["Rede Norte", "Belém", "PA"]];
const carriers = ["TransRápido", "Via Sul Logística", "Expresso Minas", "Rota Nordeste"];
const trucks = [
  ["RTA-4B21", "Carlos Souza"], ["QPL-2C88", "Marina Alves"], ["FGH-7D34", "João Pereira"], ["KLM-9E12", "Ana Ribeiro"], ["BRA-2E19", "Paulo Lima"],
  ["XYZ-3F45", "Rita Gomes"], ["MNO-6G78", "Diego Castro"], ["PQR-1H23", "Lúcia Martins"], ["STU-5J67", "Bruno Rocha"], ["VWX-8K90", "Fernanda Dias"],
  ["JKL-4L56", "Márcio Teixeira"], ["DEF-7M89", "Sílvia Nunes"], ["GHI-0N12", "Rafael Costa"], ["ABC-3P34", "Tatiane Melo"],
];
const docks = ["Doca 01", "Doca 02", "Doca 03", "Doca 04", "Doca 05", "Doca 06", "Doca 07", "Doca 08"];
const rows = [["Pedido", "Data do pedido", "Cliente", "Cidade destino", "UF", "Transportadora", "Placa", "Motorista", "Doca", "Status", "Previsão de entrega", "Data de entrega", "Volumes", "Peso (kg)", "Valor da carga", "Valor do frete"]];
let n = 0;
const add = (ageDays, status, truck, dock) => {
  n += 1;
  const [client, city, uf] = pick(clients);
  const ordered = new Date(today.getTime() - ageDays * day);
  const lead = 2 + Math.floor(rand() * 5);
  const due = new Date(ordered.getTime() + lead * day);
  // Delivered: most on time, some 1-3 days late.
  const late = rand() < 0.14;
  const delivered = status === "Entregue" ? new Date(due.getTime() + (late ? (1 + Math.floor(rand() * 3)) : -Math.floor(rand() * 2)) * day) : null;
  const volumes = 8 + Math.floor(rand() * 60);
  const weight = Math.round(volumes * (35 + rand() * 40));
  const cargo = Math.round(weight * (9 + rand() * 25) * 100) / 100;
  const freight = Math.round((180 + weight * 0.11 + rand() * 300) * 100) / 100;
  rows.push([`PED-${String(10000 + n)}`, br(ordered), client, city, uf, pick(carriers), truck[0], truck[1], dock, status, br(due), delivered ? br(delivered) : "", volumes, weight, cargo, freight]);
};
// History: ~180 days of delivered shipments.
for (let i = 0; i < 520; i += 1) add(8 + Math.floor(rand() * 175), "Entregue", pick(trucks), pick(docks));
// Now: 6 docks busy (separating or loading), 2 free; 3 trucks waiting in the queue; 4 on the road (1 late).
const busy = [[0, "Carregando"], [1, "Em separação"], [2, "Carregando"], [4, "Carregando"], [5, "Em separação"], [6, "Carregando"]];
busy.forEach(([d, status], i) => add(1 + (i % 3), status, trucks[i], docks[d]));
for (let i = 0; i < 3; i += 1) add(0, "Pedido recebido", trucks[6 + i], "");
for (let i = 0; i < 4; i += 1) add(i === 0 ? 9 : 1 + i, "Em trânsito", trucks[9 + i], pick(docks));
writeFileSync(join(folder, "operacao_cd.xlsx"), makeXlsx({
  Embarques: rows,
  Estoque: [["SKU", "Produto", "Categoria", "Estoque atual", "Estoque mínimo"],
    ...[["SKU-001", "Arroz 5 kg", "Alimentos"], ["SKU-002", "Feijão 1 kg", "Alimentos"], ["SKU-003", "Óleo 900 ml", "Alimentos"], ["SKU-004", "Detergente", "Limpeza"], ["SKU-005", "Sabão em pó", "Limpeza"], ["SKU-006", "Cimento 50 kg", "Construção"], ["SKU-007", "Tinta 18 L", "Construção"], ["SKU-008", "Papel higiênico", "Higiene"], ["SKU-009", "Shampoo", "Higiene"], ["SKU-010", "Café 500 g", "Alimentos"]]
      .map(([sku, name, cat]) => [sku, name, cat, 200 + Math.floor(rand() * 4800), 300 + Math.floor(rand() * 700)])],
}));
const active = rows.slice(1).filter((r) => r[9] !== "Entregue");
const delivered = rows.slice(1).filter((r) => r[9] === "Entregue");
const parse = (s) => { const [d, m, y] = s.split("/").map(Number); return new Date(y, m - 1, d).getTime(); };
const onTime = delivered.filter((r) => parse(r[11]) <= parse(r[10])).length;
const expected = {
  shipments: rows.length - 1, active: active.length, delivered: delivered.length, onTime,
  onTimePct: onTime / delivered.length, atDocks: active.filter((r) => /separa|carreg/i.test(r[9])).length,
  waiting: active.filter((r) => /recebido/i.test(r[9])).length, transit: active.filter((r) => /trânsito/i.test(r[9])).length,
};
writeFileSync(join(folder, "esperado-logistica.json"), JSON.stringify(expected, null, 2));
console.log(expected);
