// Dados de teste de uma transportadora de cargas: CT-e, UF de origem e de destino, placa, status (aguardando
// coleta, coletado, em trânsito, em rota de entrega, entregue), coleta, previsão e entrega, peso e frete —
// 6 meses de histórico e as cargas de agora. O gabarito (quantas a caminho, em cada rota) sai daqui.
// node scripts/powerbi-lab/make-frete.mjs <pasta>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeXlsx } from "../../app/sampleDocs.js";

const folder = process.argv[2];
mkdirSync(folder, { recursive: true });
let seed = 53;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (l) => l[Math.floor(rand() * l.length)];
const day = 86_400_000;
const today = new Date(); today.setHours(0, 0, 0, 0);
const br = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const origins = ["SP", "SP", "SP", "MG", "PR"];
const dests = ["RJ", "MG", "BA", "PE", "RS", "SC", "GO", "DF", "CE", "PA", "AM", "MT", "ES", "PR", "SP"];
const carriers = ["Rodoviário Rápido", "TransNorte", "Sul Cargas"];
const rows = [["CT-e", "UF origem", "UF destino", "Cidade destino", "Transportadora", "Placa", "Motorista", "Status", "Data de coleta", "Previsão de entrega", "Data de entrega", "Peso (kg)", "Valor do frete"]];
let n = 0;
const plate = () => `${String.fromCharCode(65 + Math.floor(rand() * 26))}${String.fromCharCode(65 + Math.floor(rand() * 26))}${String.fromCharCode(65 + Math.floor(rand() * 26))}-${Math.floor(rand() * 10)}${String.fromCharCode(65 + Math.floor(rand() * 26))}${Math.floor(rand() * 90 + 10)}`;
const add = (age, status, o = pick(origins), d = pick(dests.filter((x) => x !== o))) => {
  n += 1;
  const pickup = new Date(today.getTime() - age * day);
  const due = new Date(pickup.getTime() + (2 + Math.floor(rand() * 6)) * day);
  const delivered = status === "Entregue" ? new Date(due.getTime() + (rand() < 0.15 ? 1 + Math.floor(rand() * 3) : -Math.floor(rand() * 2)) * day) : null;
  const weight = Math.round(800 + rand() * 24000);
  rows.push([`CTE-${String(50000 + n)}`, o, d, `Cidade ${d}`, pick(carriers), plate(), `Motorista ${n}`, status, br(pickup), br(due), delivered ? br(delivered) : "", weight, Math.round((weight * 0.12 + 300 + rand() * 900) * 100) / 100]);
  return rows[rows.length - 1];
};
for (let i = 0; i < 700; i += 1) add(10 + Math.floor(rand() * 170), "Entregue");
const now = [];
for (let i = 0; i < 5; i += 1) now.push(add(0, "Aguardando coleta"));
for (let i = 0; i < 4; i += 1) now.push(add(1, "Coletado"));
for (let i = 0; i < 23; i += 1) now.push(add(1 + Math.floor(rand() * 5), "Em trânsito"));
for (let i = 0; i < 6; i += 1) now.push(add(3 + Math.floor(rand() * 3), "Em rota de entrega"));
writeFileSync(join(folder, "fretes.xlsx"), makeXlsx({ Fretes: rows }));
// On their way (in transit or out for delivery): one truck each.
const onWay = now.filter((r) => /trânsito|rota/i.test(r[7]));
const perRoute = {};
for (const r of onWay) perRoute[`${r[1]}>${r[2]}`] = (perRoute[`${r[1]}>${r[2]}`] || 0) + 1;
const expected = { aCaminho: onWay.length, perRoute, perDest: Object.fromEntries(dests.map((d) => [d, onWay.filter((r) => r[2] === d).length]).filter(([, k]) => k)) };
writeFileSync(join(folder, "esperado-frete.json"), JSON.stringify(expected, null, 2));
console.log(`${rows.length - 1} CT-e; a caminho agora: ${onWay.length}`);
