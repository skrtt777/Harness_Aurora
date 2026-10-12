// What the data is about, read from its columns: a flow with stages (order received -> separation ->
// loading -> in transit -> delivered; ticket opened -> in progress -> solved), and the places, vehicles
// and deadlines around it. With a flow the BI gets an operations page — the scene of the place drawn from
// the data, the stage tracker, the vehicles with their progress and the selected one's detail — instead of
// starting from the generic overview. app/powerbiDesign.js calls this; the pictures are app/powerbiScene.js.
import { detailCard, progressBar, stageTowers, trackerScene, vehicleMeasures, yardScene } from "./powerbiScene.js";

const STAGE_RULES = [
  ["cancelado", 0, /cancel|devolv|perdid|recusad|estornad/i],
  ["concluido", 5, /entregue|conclu|fechad|resolvid|finaliz|encerrad|^pago$|baixad|recebido pelo/i],
  ["transito", 4, /tr[âa]nsito|enviado|despachad|em rota|saiu para|expedido|a caminho|em transporte/i],
  ["carregando", 3, /carreg|expedi[çc][ãa]o|embal|produ[çc][ãa]o|em atendimento|em andamento|execu[çc]|em curso|coletad|em processamento/i],
  ["separacao", 2, /separa|triagem|an[áa]lise|aprova|picking|confer|prepara/i],
  ["fila", 1, /recebid|aberto|novo|pendente|aguard|fila|solicit|criad|agendad|registrad/i],
];
const stageOf = (value) => STAGE_RULES.find(([, , re]) => re.test(String(value))) || null;

// Where something is served: a dock, a checkout, a counter, a bed, a machine…
const PLACE = /doca|^box\b|port[ãa]o|baia|plataforma|\bdock|^caixa\b|^pdv\b|checkout|guich[êe]|balc[ãa]o|^mesa\b|leito|m[áa]quina|^linha\b|esta[çc][ãa]o|^posto\b|consult[óo]rio|cabine|^bomba\b/i;
const ASSET = /placa|caminh[ãa]o|ve[íi]culo|carreta|frota|cavalo|^moto\b|^van\b/i;
// What moves through it: a person (a ticket, a customer, a patient) or a load (an order, a cargo…).
const PERSON = /senha|cliente|paciente|pessoa|visitante|h[óo]spede|aluno|atendimento|consulta/i;
const PEOPLE_PLACE = /^caixa\b|^pdv\b|checkout|guich[êe]|balc[ãa]o|^mesa\b|leito|consult[óo]rio|cabine/i;
// When each stage began: "Hora de chegada", "Início do atendimento", "Saída", "Entrega"…
const STAGE_TIME = [
  [1, /chegada|entrada|abertura|recebimento|registro|cria[çc][ãa]o|emiss[ãa]o|pedido/i],
  [2, /separa|triagem|confer/i],
  [3, /in[íi]cio|carregamento|atendimento|produ[çc][ãa]o/i],
  [4, /sa[íi]da|despacho|coleta|embarque|expedi/i],
  [5, /fim|entrega|conclus|fechamento|finaliz|t[ée]rmino|baixa/i],
];
const DRIVER = /motorista|condutor/i;
const singularWord = (w) => (/ões$/.test(w) ? w.replace(/ões$/, "ão") : /ns$/.test(w) ? w.replace(/ns$/, "m") : /(r|z)es$/.test(w) ? w.replace(/es$/, "") : /is$/.test(w) ? w.replace(/is$/, "l") : w.replace(/s$/, ""));
const singular = (phrase) => { const m = /^(\S+)(\s+.*)?$/.exec(String(phrase)); return `${singularWord(m[1])}${m[2] || ""}`; };
const pluralWord = (w) => (/s$/.test(w) ? w : /ão$/.test(w) ? w.replace(/ão$/, "ões") : /m$/.test(w) ? w.replace(/m$/, "ns") : /[rz]$/.test(w) ? `${w}es` : /l$/.test(w) ? w.replace(/l$/, "is") : `${w}s`);
// The kind of place, which decides the room the scene draws (not a warehouse with another name):
// a dock wall, a shop floor with checkouts, a clinic with rooms and a waiting room, a hall with counters,
// a factory floor with machines, a forecourt with pumps.
const ENVIRONMENTS = [
  ["armazem", /doca|^box\b|port[ãa]o|baia|plataforma|\bdock/i],
  ["loja", /^caixa\b|^pdv\b|checkout/i],
  ["clinica", /consult[óo]rio|leito|^sala\b|cabine|^box de/i],
  ["salao", /guich[êe]|balc[ãa]o|^mesa\b|^posto\b|atendente/i],
  ["fabrica", /m[áa]quina|^linha\b|esta[çc][ãa]o|c[ée]lula|equipamento/i],
  ["patio", /^bomba\b|vaga/i],
];
// A column that says how serious each one is: the colour the entities wear (risk in a hospital, priority
// in a help desk), instead of the stage colour, which their position already shows.
const COLOR_SETS = [
  { name: "risco", values: { vermelho: "#E53935", laranja: "#FB8C00", amarelo: "#FDD835", verde: "#43A047", azul: "#1E88E5", branco: "#ECEFF1" } },
  { name: "prioridade", values: { "crítica": "#E53935", critica: "#E53935", urgente: "#E53935", emergência: "#E53935", alta: "#FB8C00", "média": "#FDD835", media: "#FDD835", preferencial: "#FB8C00", prioritário: "#FB8C00", normal: "#43A047", baixa: "#43A047" } },
];
const DUE = /previs|prazo|promet|agend|vencim|\bsla\b|limite/i;
const DONE_AT = /entrega|conclus|fechament|baixa|finaliz|chegada|resolu|atendid/i;
const STOCK = /estoque|saldo/i;
const SITE = /^(cd|centro de distribui|unidade|filial|loja|armaz[ée]m|dep[óo]sito|planta|site|hub|base|galp[ãa]o|ag[êe]ncia|hospital|cl[íi]nica|escola|campus|f[áa]brica)\b/i;

/** The column values of a profiled table. */
const valuesOf = (table, column) => table.rows.map((r) => String(r[table.columns.indexOf(column)] ?? "").trim()).filter(Boolean);

/** The flow in the fact table, or null when it has none. */
export function readFlow(fact, tables = []) {
  let best = null;
  for (const c of fact.columns) {
    if (c.type !== "texto" || c.distinct < 3 || c.distinct > 14) continue;
    const distinct = [...new Set(valuesOf(fact, c))];
    const matched = distinct.map((v) => [v, stageOf(v)]).filter(([, s]) => s);
    const ranks = new Set(matched.map(([, s]) => s[1]).filter((r) => r > 0));
    if (matched.length < distinct.length * 0.8 || ranks.size < 3 || ![...ranks].some((r) => r < 5)) continue;
    const score = ranks.size * 10 + (/status|situa|etapa|fase|est[áa]gio/i.test(c.name) ? 5 : 0);
    if (!best || score > best.score) best = { column: c, matched, score };
  }
  if (!best) return null;
  const counts = new Map();
  for (const v of valuesOf(fact, best.column)) counts.set(v, (counts.get(v) || 0) + 1);
  const stages = [];
  for (const [key, rank] of STAGE_RULES.filter(([, r]) => r > 0).map(([k, r]) => [k, r]).sort((a, b) => a[1] - b[1])) {
    const values = best.matched.filter(([, s]) => s[1] === rank).map(([v]) => v).sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
    if (values.length) stages.push({ key, rank, values });
  }
  const done = best.matched.filter(([, s]) => s[1] === 5 || s[1] === 0).map(([v]) => v);
  const find = (re, test = () => true) => fact.columns.find((c) => re.test(c.name) && c !== best.column && test(c));
  const place = find(PLACE, (c) => c.type === "texto" && c.distinct >= 2 && c.distinct <= 40);
  // A unit (CD, filial): the yard shows one at a time, chosen in a switcher.
  const site = find(SITE, (c) => c.type === "texto" && c.distinct >= 2 && c.distinct <= 12 && c !== place);
  const siteValues = site ? [...new Set(valuesOf(fact, site))].sort((a, b) => a.localeCompare(b, "pt-BR")) : [];
  const asset = find(ASSET, (c) => c.type === "texto");
  const driver = find(DRIVER, (c) => c.type === "texto");
  const id = fact.columns.find((c) => c.role === "id");
  const isDate = (c) => c.type === "data" || c.type === "datahora";
  const due = find(DUE, isDate);
  const doneAt = find(DONE_AT, (c) => isDate(c) && c !== due);
  const date = fact.columns.find((c) => isDate(c) && c !== due && c !== doneAt) || fact.columns.find((c) => isDate(c) && c !== due);
  // The time each stage began, when the data has it: the timeline can replay any moment.
  const times = {};
  for (const c of fact.columns.filter((x) => isDate(x) && x !== due)) {
    const rule = STAGE_TIME.find(([rank, re]) => re.test(c.name) && stages.some((st) => st.rank === rank) && !times[rank]);
    if (rule) times[rule[0]] = c.name;
  }
  // Only when every stage has its time: a replay with a missing stage would put everyone in the wrong one.
  const timeline = stages.every((st) => times[st.rank]) ? times : null;
  // With a timeline, the start is the first stage's time and the end the last one's ("Hora de chegada"
  // is an arrival here, not a delivery).
  const startCol = timeline ? fact.columns.find((c) => c.name === times[Math.min(...Object.keys(times).map(Number))]) : date;
  const endCol = timeline && times[5] ? fact.columns.find((c) => c.name === times[5]) : doneAt;
  const by = (re) => fact.columns.find((c) => re.test(c.name) && c.type === "texto" && c !== best.column);
  const details = [
    driver && { label: driver.name, column: driver.name },
    by(/cliente/i) && { label: "Cliente", column: by(/cliente/i).name },
    by(/cidade|destino/i) && { label: "Destino", column: by(/cidade|destino/i).name },
    by(/transportadora|empresa|parceiro/i) && { label: "Transportadora", column: by(/transportadora|empresa|parceiro/i).name },
    due && { label: due.name, column: due.name, date: true },
    !driver && asset && id && { label: id.name, column: id.name },
  ].filter(Boolean);
  // Beyond the logistics words: the few-valued columns that say what each one is (priority, category).
  for (const c of fact.columns) {
    if (details.length >= 5) break;
    if (c.role === "dimension" && c !== best.column && c !== place && c !== asset && c.distinct <= 12 && /prioridade|categoria|tipo|setor|respons|t[ée]cnico|canal|equipe/i.test(c.name) && !details.some((d) => d.column === c.name)) details.push({ label: c.name, column: c.name });
  }
  // What is drawn and how it is called: vehicles (a plate), people (a ticket at a checkout) or loads.
  const entity = asset || id;
  const glyph = asset ? "veiculo" : (entity && PERSON.test(entity.name)) || (place && PEOPLE_PLACE.test(place.name)) ? "pessoa" : "volume";
  const nounOf = () => {
    if (asset) return /placa|caminh/i.test(asset.name) ? "caminhões" : "veículos";
    if (glyph === "pessoa") {
      // Who they are, from any column of the data: a patient, a student, a guest…
      const names = fact.columns.map((c) => c.name).join(" ");
      return /paciente/i.test(names) ? "pacientes" : /aluno/i.test(names) ? "alunos" : /h[óo]spede/i.test(names) ? "hóspedes" : /visitante/i.test(names) ? "visitantes" : /cidad[ãa]o/i.test(names) ? "cidadãos" : "clientes";
    }
    const word = String(entity?.name || "item").toLowerCase().replace(/^(n[ºo°]|n[uú]mero|c[óo]digo|id)\s*(d[oa]s?\s+)?/i, "").trim() || "item";
    const compound = /^(\S+)(\s+(de|do|da|dos|das)\s+.+)$/.exec(word);
    if (compound) return `${pluralWord(compound[1])}${compound[2]}`;
    return /s$/.test(word) ? word : /[aeiou]$/.test(word) ? `${word}s` : /m$/.test(word) ? word.replace(/m$/, "ns") : /[rz]$/.test(word) ? `${word}es` : /ão$/.test(word) ? word.replace(/ão$/, "ões") : `${word}s`;
  };
  const vehicles = entity ? nounOf() : null;
  const environment = place ? (ENVIRONMENTS.find(([, re]) => re.test(place.name))?.[0] || (asset ? "armazem" : glyph === "pessoa" ? "salao" : "fabrica")) : null;
  // The colour column: almost all its values are in one of the sets.
  let colorBy = null;
  for (const c of fact.columns) {
    if (c.type !== "texto" || c.distinct < 2 || c.distinct > 8 || c === best.column) continue;
    const distinct = [...new Set(valuesOf(fact, c).map((v) => v.toLowerCase()))];
    const set = COLOR_SETS.find((cs) => distinct.filter((v) => cs.values[v]).length >= Math.max(2, distinct.length * 0.8));
    if (set) { colorBy = { column: c.name, kind: set.name, values: Object.keys(set.values).filter((v) => distinct.includes(v)).map((v) => [valuesOf(fact, c).find((x) => x.toLowerCase() === v), set.values[v]]) }; break; }
  }
  // "nas docas", "nos caixas": the place's gender (o caixa, a doca, a estação).
  const placeWord = place ? place.name.toLowerCase().replace(/\s+\d+$/, "") : null;
  const placeMasc = placeWord ? /^(caixa|pdv|checkout|guich[êe]|balc[ãa]o|leito|consult[óo]rio|posto|box|port[ãa]o)/.test(placeWord) : false;
  const placePlural = placeWord ? (placeWord.endsWith("ão") ? placeWord.replace(/ão$/, "ões") : /[ê]$/.test(placeWord) ? `${placeWord}s` : /[rz]$/.test(placeWord) ? `${placeWord}es` : /s$/.test(placeWord) ? placeWord : `${placeWord}s`) : null;
  const stock = tables.filter((t) => t !== fact).map((t) => ({ table: t, column: t.columns.find((c) => STOCK.test(c.name) && /quantity|value|money/.test(c.role) && !/m[íi]nimo/i.test(c.name)), minimum: t.columns.find((c) => /m[íi]nimo/i.test(c.name) && c.type !== "texto") })).find((s) => s.column) || null;
  return {
    fact: fact.name, status: best.column.name, stages, done,
    place: place?.name || null, placeCount: place?.distinct || 0, site: site?.name || null, siteValues, asset: asset?.name || null, driver: driver?.name || null,
    id: id?.name || null, date: startCol?.name || null, due: due?.name || null, doneAt: endCol?.name || null,
    details, vehicles, stock, glyph, timeline, placePlural, placeMasc, environment, colorBy,
    queueLabel: (stages.find((st) => st.key === "fila")?.values[0] || "na fila").toLowerCase().replace(/^(pedido |chamado )/, "").replace(/^recebid[oa]$/, "na fila"),
    transitLabel: (stages.find((st) => st.key === "transito")?.values[0] || "em trânsito").toLowerCase(),
    logistics: Boolean(place || asset || stages.some((s) => s.key === "transito")),
  };
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const col = (table, column) => `${q(table)}[${String(column).replace(/]/g, "]]")}]`;
// An empty list is not DAX ("IN {}"): a value no status has stands in.
const list = (values) => (values.length ? `{${values.map((v) => `"${String(v).replace(/"/g, "\"\"")}"`).join(", ")}}` : "{\"(nenhum)\"}");
const INT = "#,0";
// The moment chosen in the timeline ("Agora", "há 2 h", "daqui 1 h"): the cards and the scene follow it.
export const MOMENT = "NOW() + SELECTEDVALUE('Momento'[Minutos], 0) / 1440";
/** The timeline's table: from 12 h ago to 3 h ahead, every 15 min, with words people read. */
export function momentTable() {
  const rows = [];
  for (let m = -720; m <= 180; m += 15) {
    const hhmm = (x) => { const a = Math.abs(x); const hh = Math.floor(a / 60); const mm = a % 60; return hh ? `${hh} h${mm ? ` ${mm}` : ""}` : `${mm} min`; };
    rows.push([m, m === 0 ? "Agora" : m < 0 ? `há ${hhmm(m)}` : `daqui ${hhmm(m)} (previsão)`]);
  }
  return `DATATABLE("Minutos", INTEGER, "Quando", STRING, {${rows.map(([m, q2]) => `{${m}, "${q2}"}`).join(", ")}})`;
}
const PCT = "0.0%";

/**
 * The flow's measures (added to the design's list) and its operations page. add(name, expression,
 * format, folder, description, extra) is the design's own; returns { kpis, page, palette }.
 */
export function flowDesign(flow, { add, title, count, stamp = null }) {
  const F = flow.fact;
  const status = col(F, flow.status);
  const active = `FILTER(${q(F)}, NOT ISBLANK(${status}) && NOT ${status} IN ${list(flow.done)})`;
  const m = (n) => `[${n}]`;
  const order = [flow.date ? `${col(F, flow.date)}, DESC` : null, flow.id ? `${col(F, flow.id)}, DESC` : null].filter(Boolean).join(", ");
  const latestActive = order ? `TOPN(1, ${active}, ${order})` : active;
  const kpis = [];
  let onTime = null; let lateDone = null;
  const inProgress = add("Em andamento", `COUNTROWS(${active}) + 0`, INT, "Operação", "Quantos ainda não terminaram (nem foram cancelados)");
  kpis.push(inProgress);
  if (flow.asset || flow.place) {
    // Counted vehicle by vehicle, where each one is now (its latest active record) — the same DAX the
    // yard draws with, so a card and the scene never disagree.
    const V = (flow.vehicles || "itens").replace(/^./, (c) => c.toUpperCase());
    const vm = vehicleMeasures(flow, flow.timeline ? MOMENT : null);
    kpis.push(add(!flow.place ? `${V} aguardando` : flow.glyph === "veiculo" ? `${V} no pátio` : `${V} no local`, vm.patio, INT, "Operação", "Sendo atendidos ou na fila agora (cada um conta uma vez, onde está)"));
    if (flow.place) add(`${V} ${flow.placeMasc ? "nos" : "nas"} ${flow.placePlural}`, vm.docas, INT, "Operação", `Em atendimento num(a) ${flow.place.toLowerCase()} agora`);
    add(`${V} na fila`, vm.fila, INT, "Operação", "Esperando agora");
    if (flow.stages.some((st) => st.key === "transito")) add(`${V} em trânsito`, vm.estrada, INT, "Operação", "A caminho agora");
  }
  if (flow.due && flow.doneAt) {
    // Deliveries only where something is delivered (a vehicle, a way out); people are served on time.
    const delivers = Boolean(flow.asset) || flow.stages.some((st) => st.key === "transito");
    kpis.push(onTime = add(delivers ? "Entregas no prazo %" : flow.glyph === "pessoa" ? "Atendidos no prazo %" : "No prazo %", `VAR Feitos = FILTER(${q(F)}, NOT ISBLANK(${col(F, flow.doneAt)}) && NOT ISBLANK(${col(F, flow.due)}))\nRETURN DIVIDE(COUNTROWS(FILTER(Feitos, ${col(F, flow.doneAt)} <= ${col(F, flow.due)})), COUNTROWS(Feitos))`, PCT, "Operação", `${flow.doneAt} até ${flow.due}`));
    lateDone = add(delivers ? "Entregas atrasadas" : flow.glyph === "pessoa" ? "Atendidos com atraso" : "Concluídos com atraso", `COUNTROWS(FILTER(${q(F)}, NOT ISBLANK(${col(F, flow.doneAt)}) && ${col(F, flow.doneAt)} > ${col(F, flow.due)})) + 0`, INT, "Operação");
  }
  if (flow.due) kpis.push(add("Atrasados agora", `COUNTROWS(FILTER(${active}, ${col(F, flow.due)} < TODAY())) + 0`, INT, "Operação", `Em andamento com ${flow.due} já vencida`));
  if (flow.stock) {
    const s = flow.stock;
    kpis.push(add(flow.logistics ? "Estoque no CD" : `${s.column.name} total`, `SUM(${col(s.table.name, s.column.name)})`, INT, "Estoque", `Soma de ${s.column.name}`, { table: s.table.name }));
    if (s.minimum) add("Itens abaixo do mínimo", `COUNTROWS(FILTER(${q(s.table.name)}, ${col(s.table.name, s.column.name)} < ${col(s.table.name, s.minimum.name)})) + 0`, INT, "Estoque", "", { table: s.table.name });
  }
  if (kpis.length < 4 && count) kpis.splice(1, 0, count);
  // Text of the latest active record, for the table of the vehicles (or orders) in progress.
  const stage = add("Etapa atual", `MAXX(${latestActive}, ${status})`, null, "Operação", "A etapa do registro em andamento mais recente");
  const place = flow.place ? add(`${flow.place} atual`, `MAXX(${latestActive}, ${col(F, flow.place)})`, null, "Operação") : null;
  const driver = flow.driver && flow.asset ? add(`${flow.driver} atual`, `MAXX(${latestActive}, ${col(F, flow.driver)})`, null, "Operação") : null;
  // Pictures.
  const picture = (name, expression, description) => add(name, expression, null, "Cenas", description, { category: "ImageUrl" });
  // The yard is made when a plan places it, in the plan's look (by night or by day), with the position of
  // each bay for the scatter laid over it (a click on a bay filters the page).
  const yards = new Map();
  const yard = (look) => {
    if (!yards.has(look)) {
      const made = yardScene(flow, { title: title || "Operação", look, stamp, at: flow.timeline ? MOMENT : null });
      const suffix = look === "dia" ? " (dia)" : "";
      yards.set(look, {
        url: picture(`${flow.glyph === "veiculo" ? "Cena do pátio" : "Cena da operação"}${suffix}`, made.dax, `As ${flow.place.toLowerCase()}s e os ${flow.vehicles || "itens"} desenhados a partir dos dados`),
        x: add(`${flow.glyph === "veiculo" ? "Pátio" : "Operação"} X${suffix}`, made.points.x, "0", "Cenas", `Posição de cada ${flow.place.toLowerCase()} na cena (para o clique)`),
        y: add(`${flow.glyph === "veiculo" ? "Pátio" : "Operação"} Y${suffix}`, made.points.y, "0", "Cenas", `Posição de cada ${flow.place.toLowerCase()} na cena (para o clique)`),
        // One point on each one drawn: a click on a truck (a patient, an order) selects it.
        ex: made.entities ? add(`Posição X na cena${suffix}`, made.entities.x, "0", "Cenas", `Onde cada um dos ${flow.vehicles || "itens"} está desenhado (para o clique)`) : null,
        ey: made.entities ? add(`Posição Y na cena${suffix}`, made.entities.y, "0", "Cenas", `Onde cada um dos ${flow.vehicles || "itens"} está desenhado (para o clique)`) : null,
        made,
      });
    }
    return yards.get(look);
  };
  const scene = flow.place ? true : null;
  const tracker = picture("Rastreamento", trackerScene(flow), "As etapas e quantos estão em cada uma");
  const progress = picture("Progresso", progressBar(flow), "Quanto falta para concluir");
  const key = flow.asset || flow.id;
  // "Clique num caminhão na cena", "Clique numa ordem de produção na cena".
  const one = singular(flow.vehicles || "item");
  const article = /^(ordem|senha|carga|nota|ficha|solicita|requisi|entrega|encomenda|pessoa|consulta)/.test(one) ? "numa" : "num";
  const detail = key ? picture("Detalhe selecionado", detailCard(flow, { pick: `Clique ${article} ${one} na cena ou na tabela` }), "O item escolhido e a etapa dele") : null;

  // The blocks a plan can place: the scene (the yard, or the stages as towers), the tracker, the selected
  // item and the table of what is in progress with its progress bars.
  const towers = scene ? null : picture("Cena das etapas", stageTowers(flow), "Quantos estão em cada etapa, os atrasados em vermelho");
  const rowsBy = key ? col(F, key) : status;
  // The table says who they are ("Pacientes em andamento", "Ordens de produção em andamento").
  const things = flow.asset ? (flow.vehicles === "caminhões" ? "Caminhões" : "Veículos") : flow.vehicles ? flow.vehicles.charAt(0).toUpperCase() + flow.vehicles.slice(1) : "Itens";
  const scenes = {};
  // The scene's name for the planner: "patio" for vehicles at docks, "operacao" for any other place.
  const sceneId = flow.glyph === "veiculo" ? "patio" : "operacao";
  const who = flow.vehicles || "itens";
  if (scene) scenes[sceneId] = { covers: [flow.place, flow.site, flow.asset, flow.id].filter(Boolean), desc: `a operação desenhada e viva: ${flow.placeMasc ? "cada" : "cada"} ${flow.place.toLowerCase()} com os ${who} sendo atendidos e a fila de cada um, ${flow.placeMasc ? "livres" : "livres"} em verde${flow.stages.some((st) => st.key === "transito") ? ", os que estão a caminho na estrada" : ""}; cada um desenhado onde está${flow.timeline ? "; dá para voltar no tempo e ver a previsão das próximas horas" : ""}; clicar filtra a página${flow.site ? `; uma ${flow.site.toLowerCase()} por vez` : ""}`, make: ({ look = "noite" } = {}) => { const y = yard(look); return { type: "image", scene: true, look, url: m(y.url), title: `${flow.place}s e ${who} ${flow.timeline ? "no momento escolhido" : "agora"}`, overlay: { category: y.made.points.category, x: m(y.x), y: m(y.y), w: Number(y.made.points.w), h: Number(y.made.points.h), ...(y.ex ? { entities: { category: y.made.entities.category, x: m(y.ex), y: m(y.ey) } } : {}) } }; } };
  else scenes.etapas = { desc: "as etapas como torres: quantos em cada uma, os atrasados em vermelho", make: () => ({ type: "image", url: m(towers), title: "Onde está cada um agora" }) };
  const specials = {
    rastreamento: { desc: "as etapas em sequência com quantos em cada (ou o caminho do item escolhido)", make: () => ({ type: "image", url: m(tracker), title: "Rastreamento" }) },
    tabela_andamento: { desc: `${things.toLowerCase()} em andamento com a etapa e a barra de progresso (clicar acende na cena)`, make: () => ({ type: "tableEx", title: `${things} em andamento`, values: [rowsBy, ...[place, driver && !place ? driver : null, stage].filter(Boolean).map(m), m(progress)], image: { height: 22, width: 128 }, totals: false, sort: { by: rowsBy, desc: false } }) },
  };
  if (detail) specials.detalhe_selecionado = { desc: "o item escolhido: seus dados e a etapa", make: () => ({ type: "image", float: true, url: m(detail), title: flow.asset ? `${things.slice(0, -1).replace(/õe$/, "ão")} selecionado` : "Selecionado" }) };
  return { kpis, onTime, lateDone, scenes, specials, site: flow.site ? col(F, flow.site) : null, siteFirst: flow.siteValues?.[0] || null, picture: { tracker, progress, detail, towers } };
}
