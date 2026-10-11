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
const rows = [["Pedido", "CD", "Data do pedido", "Cliente", "Cidade destino", "UF", "Transportadora", "Placa", "Motorista", "Doca", "Status", "Previsão de entrega", "Data de entrega", "Volumes", "Peso (kg)", "Valor da carga", "Valor do frete"]];
let n = 0;
// Two units: Contagem with 8 docks, Betim with 6.
const units = { "CD Contagem": docks, "CD Betim": docks.slice(0, 6) };
const add = (ageDays, status, truck, dock, unit = pick(Object.keys(units))) => {
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
  rows.push([`PED-${String(10000 + n)}`, unit, br(ordered), client, city, uf, pick(carriers), truck[0], truck[1], dock, status, br(due), delivered ? br(delivered) : "", volumes, weight, cargo, freight]);
};
// History: ~180 days of delivered shipments.
for (let i = 0; i < 520; i += 1) { const unit = pick(Object.keys(units)); add(8 + Math.floor(rand() * 175), "Entregue", pick(trucks), pick(units[unit]), unit); }
// Now: 6 docks busy (separating or loading), 2 free; 3 trucks waiting in the queue; 4 on the road (1 late).
const busy = [[0, "Carregando"], [1, "Em separação"], [2, "Carregando"], [4, "Carregando"], [5, "Em separação"], [6, "Carregando"]];
// Contagem: 6 docks busy, 2 free; Betim: 2 busy (docks 2 and 5), 4 free.
busy.forEach(([d, status], i) => add(1 + (i % 3), status, trucks[i], docks[d], "CD Contagem"));
add(1, "Carregando", trucks[13], docks[1], "CD Betim");
add(2, "Em separação", ["HJK-2Q45", "Otávio Reis"], docks[4], "CD Betim");
for (let i = 0; i < 3; i += 1) add(0, "Pedido recebido", trucks[6 + i], "", i < 2 ? "CD Contagem" : "CD Betim");
// The hard cases for a faithful picture:
// two trucks at the same dock (Contagem, Doca 03);
add(1, "Carregando", ["LMN-7R21", "Wesley Prado"], docks[2], "CD Contagem");
// a queue longer than one row of parking (Contagem: 6 waiting);
for (const [plate, driver] of [["OPQ-1S11", "Ivo Lopes"], ["RST-2T22", "Joana Faria"], ["UVW-3U33", "Kátia Moura"], ["XYZ-4V44", "Luís Prado"]]) add(0, "Pedido recebido", [plate, driver], "", "CD Contagem");
// one truck with two active orders: it is where its latest one is (RTA-4B21 loads at Doca 01, not in the queue);
add(3, "Pedido recebido", trucks[0], "", "CD Contagem");
// four trucks on the road from Contagem, one from Betim.
for (let i = 0; i < 4; i += 1) add(i === 0 ? 9 : 1 + i, "Em trânsito", trucks[9 + i], pick(docks.slice(0, 6)), "CD Contagem");
add(2, "Em trânsito", ["BCD-5W55", "Mara Teles"], docks[3], "CD Betim");
writeFileSync(join(folder, "operacao_cd.xlsx"), makeXlsx({
  Embarques: rows,
  Estoque: [["SKU", "Produto", "Categoria", "Estoque atual", "Estoque mínimo"],
    ...[["SKU-001", "Arroz 5 kg", "Alimentos"], ["SKU-002", "Feijão 1 kg", "Alimentos"], ["SKU-003", "Óleo 900 ml", "Alimentos"], ["SKU-004", "Detergente", "Limpeza"], ["SKU-005", "Sabão em pó", "Limpeza"], ["SKU-006", "Cimento 50 kg", "Construção"], ["SKU-007", "Tinta 18 L", "Construção"], ["SKU-008", "Papel higiênico", "Higiene"], ["SKU-009", "Shampoo", "Higiene"], ["SKU-010", "Café 500 g", "Alimentos"]]
      .map(([sku, name, cat]) => [sku, name, cat, 200 + Math.floor(rand() * 4800), 300 + Math.floor(rand() * 700)])],
}));
const S = 10; const DUE = 11; const DONE = 12;
const active = rows.slice(1).filter((r) => r[S] !== "Entregue");
const delivered = rows.slice(1).filter((r) => r[S] === "Entregue");
const parse = (s) => { const [d, m, y] = s.split("/").map(Number); return new Date(y, m - 1, d).getTime(); };
const onTime = delivered.filter((r) => parse(r[DONE]) <= parse(r[DUE])).length;
const expected = {
  shipments: rows.length - 1, active: active.length, delivered: delivered.length, onTime,
  onTimePct: onTime / delivered.length, atDocks: active.filter((r) => /separa|carreg/i.test(r[S])).length,
  waiting: active.filter((r) => /recebido/i.test(r[S])).length, transit: active.filter((r) => /trânsito/i.test(r[S])).length,
  units: {},
};
// Where each truck is now, by the same rule the BI uses: its latest active record (date, then order).
const key = (r) => [parse(r[2]), r[0]];
for (const u of Object.keys(units)) {
  const latest = new Map();
  for (const r of active.filter((x) => x[1] === u)) {
    const plate = r[7]; const have = latest.get(plate);
    if (!have || key(r)[0] > key(have)[0] || (key(r)[0] === key(have)[0] && key(r)[1] > key(have)[1])) latest.set(plate, r);
  }
  const now = [...latest.values()];
  const where = (r) => (/trânsito/i.test(r[S]) ? "estrada" : /separa|carreg/i.test(r[S]) && r[9] ? "doca" : "fila");
  const perDock = {};
  for (const r of now.filter((x) => where(x) === "doca")) perDock[r[9]] = (perDock[r[9]] || 0) + 1;
  expected.units[u] = { doca: now.filter((x) => where(x) === "doca").length, fila: now.filter((x) => where(x) === "fila").length, estrada: now.filter((x) => where(x) === "estrada").length, perDock };
}
writeFileSync(join(folder, "esperado-logistica.json"), JSON.stringify(expected, null, 2));
console.log(expected);
