// Dados grandes para medir o tempo das cenas: um CD com 100 mil embarques (2 anos, poucos ativos agora)
// e um mercado com 60 mil atendimentos com horário (90 dias). node make-grande.mjs <pasta>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeXlsx } from "../../app/sampleDocs.js";

const folder = process.argv[2];
mkdirSync(folder, { recursive: true });
let seed = 11;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pad = (n) => String(n).padStart(2, "0");
const day = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const stamp = (d) => `${day(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const now = new Date(); now.setSeconds(0, 0);

// The CD: delivered history, and today a few at the docks, in line and on the road.
const cd = [["Pedido", "CD", "Data do pedido", "Placa", "Doca", "Status", "Previsão de entrega", "Data de entrega", "Transportadora", "Cliente", "Volumes", "Valor do frete"]];
const plates = Array.from({ length: 400 }, (_, i) => `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 7) % 26))}${String.fromCharCode(65 + ((i * 3) % 26))}-${1000 + i}`);
for (let i = 0; i < 100_000; i += 1) {
  const active = i >= 99_970;
  const d = new Date(now.getTime() - (active ? rand() * 2 : 2 + rand() * 728) * 86_400_000);
  const due = new Date(d.getTime() + (2 + rand() * 5) * 86_400_000);
  const status = active ? ["Pedido recebido", "Em separação", "Carregando", "Em trânsito"][i % 4] : "Entregue";
  const delivered = status === "Entregue" ? new Date(d.getTime() + (1 + rand() * 7) * 86_400_000) : null;
  cd.push([`PED-${100000 + i}`, i % 2 ? "CD Contagem" : "CD Betim", day(d), plates[i % plates.length], ["Em separação", "Carregando"].includes(status) ? `Doca ${pad(1 + (i % 8))}` : "", status, day(due), delivered ? day(delivered) : "", ["Rodoviário Rápido", "Sul Cargas", "TransNorte"][i % 3], `Cliente ${i % 300}`, 1 + Math.floor(rand() * 40), Math.round((200 + rand() * 3000) * 100) / 100]);
}
writeFileSync(join(folder, "cd_grande.xlsx"), makeXlsx({ Embarques: cd }));

// The market: 90 days of customers at 2 stores, with the time of each stage.
const mk = [["Senha", "Loja", "Caixa", "Status", "Hora de chegada", "Início do atendimento", "Fim do atendimento", "Itens", "Valor da compra"]];
let n = 0;
for (const [store, tills] of [["Loja Centro", 8], ["Loja Bairro", 6]]) {
  const free = Array.from({ length: tills }, () => now.getTime() - 90 * 86_400_000);
  for (let t = now.getTime() - 90 * 86_400_000; t < now.getTime(); t += (store === "Loja Centro" ? 230 : 330) * 1000 * (0.5 + rand())) {
    const till = Math.floor(rand() * tills);
    const start = Math.max(t + (1 + rand() * 3) * 60_000, free[till]);
    const end = start + (3 + rand() * 6) * 60_000;
    free[till] = end;
    n += 1;
    const st = end <= now.getTime() ? "Finalizado" : start <= now.getTime() ? "Em atendimento" : "Na fila";
    mk.push([`S-${String(n).padStart(6, "0")}`, store, `Caixa ${pad(till + 1)}`, st, stamp(new Date(t)), start <= now.getTime() ? stamp(new Date(start)) : "", end <= now.getTime() ? stamp(new Date(end)) : "", 1 + Math.floor(rand() * 40), Math.round((5 + rand() * 300) * 100) / 100]);
  }
}
writeFileSync(join(folder, "mercado_grande.xlsx"), makeXlsx({ Atendimentos: mk }));
console.log(`CD ${cd.length - 1} embarques; mercado ${mk.length - 1} atendimentos`);
