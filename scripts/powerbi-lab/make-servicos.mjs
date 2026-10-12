// Dados de teste de mais dois ambientes, até agora: uma agência (senhas nos guichês, 2 agências) e uma
// fábrica (ordens de produção nas máquinas, 2 plantas). Só códigos, nenhuma pessoa real. O gabarito
// (quantos em atendimento e esperando em cada unidade) sai junto.
// node scripts/powerbi-lab/make-servicos.mjs <pasta>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeXlsx } from "../../app/sampleDocs.js";

const folder = process.argv[2];
mkdirSync(folder, { recursive: true });
let seed = 97;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const now = new Date(); now.setSeconds(0, 0);
const expected = {};

function make({ file, sheet, header, units, placeWord, every, stages, extra, id, hours }) {
  const rows = [header];
  let n = 0;
  for (const [unit, places] of Object.entries(units)) {
    const free = Array.from({ length: places }, () => now.getTime() - hours * 3600_000);
    for (let t = now.getTime() - hours * 3600_000; t < now.getTime(); t += every * 60_000 * (0.5 + rand())) {
      const busy = now.getTime() - t < 40 * 60_000;
      const p = Math.floor(rand() * places);
      const mid = t + (2 + rand() * 6) * 60_000;
      const start = Math.max(mid + (2 + rand() * 6) * 60_000, free[p]);
      const end = start + stages.service * 60_000 * (0.6 + rand()) * (busy ? 1.6 : 1);
      free[p] = end;
      n += 1;
      const at = now.getTime();
      const st = end <= at ? stages.names[3] : start <= at ? stages.names[2] : mid <= at ? stages.names[1] : stages.names[0];
      rows.push([id(n), unit, start <= at ? `${placeWord} ${pad(p + 1)}` : "", st, fmt(new Date(t)), start <= at ? fmt(new Date(start)) : "", end <= at ? fmt(new Date(end)) : "", ...extra()]);
      (expected[file] ||= {})[unit] ||= { atendimento: 0, esperando: 0 };
      if (st === stages.names[2]) expected[file][unit].atendimento += 1;
      if (st === stages.names[0] || st === stages.names[1]) expected[file][unit].esperando += 1;
    }
  }
  writeFileSync(join(folder, file), makeXlsx({ [sheet]: rows }));
  console.log(file, rows.length - 1, JSON.stringify(expected[file]));
}

make({
  file: "agencia_atendimento.xlsx", sheet: "Atendimentos", hours: 6, every: 3, placeWord: "Guichê",
  header: ["Senha", "Agência", "Guichê", "Status", "Hora de chegada", "Início do atendimento", "Fim do atendimento", "Prioridade", "Serviço"],
  units: { "Agência Centro": 7, "Agência Savassi": 5 }, id: (n) => `A${String(n).padStart(3, "0")}`,
  stages: { names: ["Aguardando", "Em análise", "Em atendimento", "Finalizado"], service: 9 },
  extra: () => [rand() < 0.25 ? "Preferencial" : "Normal", ["Abertura de conta", "Empréstimo", "Cartões", "Investimentos", "Saque/Depósito"][Math.floor(rand() * 5)]],
});
make({
  file: "producao_fabrica.xlsx", sheet: "Ordens", hours: 16, every: 9, placeWord: "Máquina",
  header: ["Ordem de produção", "Planta", "Máquina", "Status", "Data de abertura", "Início da produção", "Fim da produção", "Prioridade", "Produto", "Quantidade"],
  units: { "Planta Contagem": 8, "Planta Betim": 6 }, id: (n) => `OP-${String(4000 + n)}`,
  stages: { names: ["Na fila", "Em preparação", "Em produção", "Concluído"], service: 50 },
  extra: () => [["Alta", "Média", "Baixa"][Math.floor(rand() * 3)], ["Eixo 40mm", "Flange A2", "Bucha 12", "Suporte L"][Math.floor(rand() * 4)], 100 + Math.floor(rand() * 900)],
});
writeFileSync(join(folder, "esperado-servicos.json"), JSON.stringify(expected, null, 2));
