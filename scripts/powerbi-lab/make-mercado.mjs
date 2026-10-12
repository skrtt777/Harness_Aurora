// Dados de teste de um mercado: um dia de clientes nos caixas de 2 lojas (senha, caixa, hora de chegada,
// início e fim do atendimento, compra), até agora — há clientes sendo atendidos, na fila de cada caixa e já
// atendidos. O gabarito de cada loja (quem está onde) sai daqui, pela mesma regra do BI, em qualquer
// momento. node scripts/powerbi-lab/make-mercado.mjs <pasta>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeXlsx } from "../../app/sampleDocs.js";

const folder = process.argv[2];
mkdirSync(folder, { recursive: true });
let seed = 41;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const now = new Date(); now.setSeconds(0, 0);
const stores = { "Loja Centro": 8, "Loja Bairro": 6 };
const pay = ["Pix", "Débito", "Crédito", "Dinheiro"];
const rows = [["Senha", "Loja", "Caixa", "Status", "Hora de chegada", "Início do atendimento", "Fim do atendimento", "Itens", "Valor da compra", "Forma de pagamento"]];
const people = [];
let n = 0;
for (const [store, tills] of Object.entries(stores)) {
  // Each till's own clock: the next customer starts when the previous one ends.
  const free = Array.from({ length: tills }, () => now.getTime() - 10 * 3600_000);
  for (let t = now.getTime() - 10 * 3600_000; t < now.getTime() + 0; t += (store === "Loja Centro" ? 55 : 80) * 1000 * (0.6 + rand() * 0.8)) {
    // The last half hour is busier (more arrive than the tills serve): lines form.
    const busy = now.getTime() - t < 30 * 60_000;
    const till = Math.floor(rand() * tills);
    const arrive = t;
    const start = Math.max(arrive + (1 + rand() * 2) * 60_000, free[till]);
    const service = (3 + rand() * 6) * 60_000 * (busy ? 1.6 : 1);
    const end = start + service;
    free[till] = end;
    n += 1;
    people.push({ senha: `S-${String(n).padStart(4, "0")}`, store, till: `Caixa ${pad(till + 1)}`, arrive, start, end });
  }
}
const status = (p, at) => (p.end <= at ? "Finalizado" : p.start <= at ? "Em atendimento" : "Na fila");
for (const p of people) {
  const items = 1 + Math.floor(rand() * 40);
  const st = status(p, now.getTime());
  rows.push([p.senha, p.store, p.till, st, fmt(new Date(p.arrive)), p.start <= now.getTime() ? fmt(new Date(p.start)) : "", p.end <= now.getTime() ? fmt(new Date(p.end)) : "", items, Math.round(items * (6 + rand() * 18) * 100) / 100, pay[Math.floor(rand() * pay.length)]]);
}
writeFileSync(join(folder, "caixas_mercado.xlsx"), makeXlsx({ Atendimentos: rows }));
// The answer at any moment (minutes from now; only the past — the file knows nothing of the future):
// who is being served and who waits, per store and per till, by the times written in the file (to the minute).
const minute = (ms) => Math.floor(ms / 60_000) * 60_000;
const answer = (offset) => {
  const at = now.getTime() + offset * 60_000;
  const out = {};
  for (const store of Object.keys(stores)) {
    const here = people.filter((p) => p.store === store && minute(p.arrive) <= at && p.start <= now.getTime() + 1e15);
    const st = (p) => (p.end <= now.getTime() && minute(p.end) <= at ? "fim" : p.start <= now.getTime() && minute(p.start) <= at ? "atendimento" : "fila");
    const serving = here.filter((p) => st(p) === "atendimento");
    const waiting = here.filter((p) => st(p) === "fila");
    const perTill = {};
    for (const p of serving) (perTill[p.till] ||= { n: 0, f: 0 }).n += 1;
    for (const p of waiting) (perTill[p.till] ||= { n: 0, f: 0 }).f += 1;
    out[store] = { atendimento: serving.length, fila: waiting.length, perTill };
  }
  return out;
};
const expected = { generatedAt: now.toISOString(), people: people.length, at: { "0": answer(0), "-120": answer(-120) } };
writeFileSync(join(folder, "esperado-mercado.json"), JSON.stringify(expected, null, 2));
console.log(JSON.stringify({ pessoas: people.length, agora: Object.fromEntries(Object.entries(expected.at["0"]).map(([k, v]) => [k, { atendimento: v.atendimento, fila: v.fila }])), "há 2 h": Object.fromEntries(Object.entries(expected.at["-120"]).map(([k, v]) => [k, { atendimento: v.atendimento, fila: v.fila }])) }));
