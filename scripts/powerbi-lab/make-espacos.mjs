// Dados de teste de espaços (facilities / BIM): as salas de um escritório de 2 andares com posição (X, Y),
// tamanho (largura, profundidade, em metros), tipo, capacidade, ocupação e custo — cada linha é um objeto
// da planta. node scripts/powerbi-lab/make-espacos.mjs <pasta>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeXlsx } from "../../app/sampleDocs.js";

const folder = process.argv[2];
mkdirSync(folder, { recursive: true });
let seed = 31;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
// Each floor: a row of rooms on the north side, a corridor, a row on the south side.
const plan = [
  [["Recepção", "Atendimento", 8], ["Sala de reunião A", "Reunião", 6], ["Diretoria", "Escritório", 7], ["Financeiro", "Escritório", 9], ["Copa", "Apoio", 5], ["Banheiros", "Apoio", 4]],
  [["Comercial", "Escritório", 12], ["Sala de reunião B", "Reunião", 6], ["Arquivo", "Depósito", 5], ["Auditório", "Reunião", 11], ["TI", "Técnico", 6]],
  [["Engenharia", "Escritório", 14], ["Sala de reunião C", "Reunião", 5], ["Laboratório", "Técnico", 10], ["Copa 2", "Apoio", 4], ["Banheiros 2", "Apoio", 4]],
  [["RH", "Escritório", 8], ["Treinamento", "Reunião", 10], ["Depósito", "Depósito", 7], ["Servidores", "Técnico", 5], ["Descompressão", "Apoio", 8]],
];
const rows = [["Sala", "Tipo", "Andar", "X", "Y", "Largura", "Profundidade", "Área (m²)", "Capacidade", "Ocupação média", "Custo mensal"]];
plan.forEach((line, i) => {
  const floor = Math.floor(i / 2) + 1;
  const south = i % 2 === 1;
  let x = 0;
  for (const [name, type, width] of line) {
    const depth = 7;
    const area = width * depth;
    const capacity = type === "Reunião" ? Math.round(area / 2.2) : type === "Escritório" ? Math.round(area / 6) : type === "Atendimento" ? 6 : 0;
    const occupancy = capacity ? Math.round((0.35 + rand() * 0.6) * 100) / 100 : "";
    rows.push([name, type, floor, x, south ? 10 : 0, width, depth, area, capacity, occupancy === "" ? "" : `${Math.round(occupancy * 100)}%`, Math.round(area * (55 + rand() * 30))]);
    x += width + 0.5;
  }
});
writeFileSync(join(folder, "espacos_escritorio.xlsx"), makeXlsx({ Salas: rows }));
console.log(`${rows.length - 1} salas`);
