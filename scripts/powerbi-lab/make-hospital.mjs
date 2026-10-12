// Dados de teste de um pronto-socorro: um dia de pacientes em 2 hospitais (chegada, triagem, consultório,
// início e fim do atendimento, classificação de risco, convênio), até agora — há pacientes aguardando, em
// triagem, sendo atendidos em cada consultório e já finalizados. Nenhum nome de pessoa: só códigos.
// node scripts/powerbi-lab/make-hospital.mjs <pasta>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeXlsx } from "../../app/sampleDocs.js";

const folder = process.argv[2];
mkdirSync(folder, { recursive: true });
let seed = 73;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const now = new Date(); now.setSeconds(0, 0);
const units = { "Hospital Norte": 6, "Hospital Sul": 4 };
const risks = [["Vermelho", 0.05, 0], ["Laranja", 0.12, 10], ["Amarelo", 0.33, 60], ["Verde", 0.4, 120], ["Azul", 0.1, 240]];
const pickRisk = () => { let r = rand(); for (const k of risks) { if ((r -= k[1]) <= 0) return k; } return risks[3]; };
const plans = ["SUS", "Unimed", "Bradesco Saúde", "Particular", "Amil"];
const rows = [["Atendimento", "Unidade", "Paciente", "Classificação de risco", "Consultório", "Status", "Hora de chegada", "Hora da triagem", "Início do atendimento", "Fim do atendimento", "Limite de espera", "Convênio", "Valor do atendimento"]];
let n = 0;
for (const [unit, rooms] of Object.entries(units)) {
  const free = Array.from({ length: rooms }, () => now.getTime() - 12 * 3600_000);
  for (let t = now.getTime() - 12 * 3600_000; t < now.getTime(); t += (unit === "Hospital Norte" ? 7 : 10) * 60_000 * (0.5 + rand())) {
    const busy = now.getTime() - t < 45 * 60_000;
    const [risk, , target] = pickRisk();
    const room = Math.floor(rand() * rooms);
    const triage = t + (2 + rand() * 8) * 60_000;
    const start = Math.max(triage + (5 + rand() * 10) * 60_000, free[room]);
    const end = start + (15 + rand() * 30) * 60_000 * (busy ? 1.5 : 1);
    free[room] = end;
    n += 1;
    const at = now.getTime();
    const st = end <= at ? "Finalizado" : start <= at ? "Em atendimento" : triage <= at ? "Em triagem" : "Aguardando";
    rows.push([
      `PS-${String(n).padStart(5, "0")}`, unit, `P-${String(10000 + Math.floor(rand() * 89999))}`, risk,
      start <= at ? `Consultório ${pad(room + 1)}` : "",
      st, fmt(new Date(t)), triage <= at ? fmt(new Date(triage)) : "", start <= at ? fmt(new Date(start)) : "", end <= at ? fmt(new Date(end)) : "",
      fmt(new Date(triage + target * 60_000)), plans[Math.floor(rand() * plans.length)], Math.round((120 + rand() * 600) * 100) / 100,
    ]);
  }
}
writeFileSync(join(folder, "pronto_socorro.xlsx"), makeXlsx({ Atendimentos: rows }));
const count = (u, s) => rows.filter((r) => r[1] === u && r[5] === s).length;
const expected = Object.fromEntries(Object.keys(units).map((u) => [u, { aguardando: count(u, "Aguardando"), triagem: count(u, "Em triagem"), atendimento: count(u, "Em atendimento") }]));
writeFileSync(join(folder, "esperado-hospital.json"), JSON.stringify(expected, null, 2));
console.log(`${rows.length - 1} atendimentos`, JSON.stringify(expected));
