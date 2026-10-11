// What the data is about, read from its columns: a flow with stages (order received -> separation ->
// loading -> in transit -> delivered; ticket opened -> in progress -> solved), and the places, vehicles
// and deadlines around it. With a flow the BI gets an operations page — the scene of the place drawn from
// the data, the stage tracker, the vehicles with their progress and the selected one's detail — instead of
// starting from the generic overview. app/powerbiDesign.js calls this; the pictures are app/powerbiScene.js.
import { detailCard, progressBar, stageTowers, trackerScene, yardScene } from "./powerbiScene.js";

const STAGE_RULES = [
  ["cancelado", 0, /cancel|devolv|perdid|recusad|estornad/i],
  ["concluido", 5, /entregue|conclu|fechad|resolvid|finaliz|encerrad|^pago$|baixad|recebido pelo/i],
  ["transito", 4, /tr[âa]nsito|enviado|despachad|em rota|saiu para|expedido|a caminho|em transporte/i],
  ["carregando", 3, /carreg|expedi[çc][ãa]o|embal|produ[çc][ãa]o|em atendimento|em andamento|execu[çc]|em curso/i],
  ["separacao", 2, /separa|triagem|an[áa]lise|aprova|picking|confer|prepara/i],
  ["fila", 1, /recebid|aberto|novo|pendente|aguard|fila|solicit|criad|agendad|registrad/i],
];
const stageOf = (value) => STAGE_RULES.find(([, , re]) => re.test(String(value))) || null;

const PLACE = /doca|^box\b|port[ãa]o|baia|plataforma|\bdock/i;
const ASSET = /placa|caminh[ãa]o|ve[íi]culo|carreta|frota|cavalo/i;
const DRIVER = /motorista|condutor/i;
const DUE = /previs|prazo|promet|agend|vencim|\bsla\b|limite/i;
const DONE_AT = /entrega|conclus|fechament|baixa|finaliz|chegada|resolu|atendid/i;
const STOCK = /estoque|saldo/i;
const SITE = /^(cd|centro de distribui|unidade|filial|armaz[ée]m|dep[óo]sito|planta|site|hub|base|galp[ãa]o)\b/i;

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
  const asset = find(ASSET, (c) => c.type === "texto");
  const driver = find(DRIVER, (c) => c.type === "texto");
  const id = fact.columns.find((c) => c.role === "id");
  const due = find(DUE, (c) => c.type === "data");
  const doneAt = find(DONE_AT, (c) => c.type === "data" && c !== due);
  const date = fact.columns.find((c) => c.type === "data" && c !== due && c !== doneAt);
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
  const vehicles = asset ? (/placa|caminh/i.test(asset.name) ? "caminhões" : "veículos") : null;
  const stock = tables.filter((t) => t !== fact).map((t) => ({ table: t, column: t.columns.find((c) => STOCK.test(c.name) && /quantity|value|money/.test(c.role) && !/m[íi]nimo/i.test(c.name)), minimum: t.columns.find((c) => /m[íi]nimo/i.test(c.name) && c.type !== "texto") })).find((s) => s.column) || null;
  return {
    fact: fact.name, status: best.column.name, stages, done,
    place: place?.name || null, placeCount: place?.distinct || 0, site: site?.name || null, asset: asset?.name || null, driver: driver?.name || null,
    id: id?.name || null, date: date?.name || null, due: due?.name || null, doneAt: doneAt?.name || null,
    details, vehicles, stock,
    logistics: Boolean(place || asset || stages.some((s) => s.key === "transito")),
  };
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const col = (table, column) => `${q(table)}[${String(column).replace(/]/g, "]]")}]`;
const list = (values) => `{${values.map((v) => `"${String(v).replace(/"/g, "\"\"")}"`).join(", ")}}`;
const INT = "#,0";
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
  if (flow.asset) {
    const yardValues = flow.stages.filter((s) => ["fila", "separacao", "carregando"].includes(s.key)).flatMap((s) => s.values);
    if (yardValues.length) kpis.push(add(`${flow.vehicles === "caminhões" ? "Caminhões" : "Veículos"} no pátio`, `CALCULATE(DISTINCTCOUNT(${col(F, flow.asset)}), KEEPFILTERS(${status} IN ${list(yardValues)})) + 0`, INT, "Operação", "Na fila ou nas docas agora"));
  }
  if (flow.due && flow.doneAt) {
    kpis.push(onTime = add(flow.logistics ? "Entregas no prazo %" : "No prazo %", `VAR Feitos = FILTER(${q(F)}, NOT ISBLANK(${col(F, flow.doneAt)}) && NOT ISBLANK(${col(F, flow.due)}))\nRETURN DIVIDE(COUNTROWS(FILTER(Feitos, ${col(F, flow.doneAt)} <= ${col(F, flow.due)})), COUNTROWS(Feitos))`, PCT, "Operação", `${flow.doneAt} até ${flow.due}`));
    lateDone = add(flow.logistics ? "Entregas atrasadas" : "Concluídos com atraso", `COUNTROWS(FILTER(${q(F)}, NOT ISBLANK(${col(F, flow.doneAt)}) && ${col(F, flow.doneAt)} > ${col(F, flow.due)})) + 0`, INT, "Operação");
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
      const made = yardScene(flow, { title: title || "Centro de distribuição", look, stamp });
      const suffix = look === "dia" ? " (dia)" : "";
      yards.set(look, {
        url: picture(`Cena do pátio${suffix}`, made.dax, `As ${flow.place.toLowerCase()}s e os ${flow.vehicles || "itens"} desenhados a partir dos dados`),
        x: add(`Pátio X${suffix}`, made.points.x, "0", "Cenas", "Posição de cada doca na cena (para o clique)"),
        y: add(`Pátio Y${suffix}`, made.points.y, "0", "Cenas", "Posição de cada doca na cena (para o clique)"),
        made,
      });
    }
    return yards.get(look);
  };
  const scene = flow.place ? true : null;
  const tracker = picture("Rastreamento", trackerScene(flow), "As etapas e quantos estão em cada uma");
  const progress = picture("Progresso", progressBar(flow), "Quanto falta para concluir");
  const key = flow.asset || flow.id;
  const detail = key ? picture("Detalhe selecionado", detailCard(flow, { pick: `Escolha ${flow.asset ? (flow.vehicles === "caminhões" ? "um caminhão" : "um veículo") : "um item"} na tabela` }), "O item escolhido e a etapa dele") : null;

  // The blocks a plan can place: the scene (the yard, or the stages as towers), the tracker, the selected
  // item and the table of what is in progress with its progress bars.
  const towers = scene ? null : picture("Cena das etapas", stageTowers(flow), "Quantos estão em cada etapa, os atrasados em vermelho");
  const rowsBy = key ? col(F, key) : status;
  const things = flow.asset ? (flow.vehicles === "caminhões" ? "Caminhões" : "Veículos") : "Itens";
  const scenes = {};
  if (scene) scenes.patio = { covers: [flow.place, flow.site, flow.asset].filter(Boolean), desc: `o lugar desenhado e vivo: cada ${flow.place.toLowerCase()} com o ${flow.asset ? (flow.vehicles === "caminhões" ? "caminhão" : "veículo") : "item"} dela colorido pela etapa, livres em verde, fila, caminhões andando na estrada; clicar numa ${flow.place.toLowerCase()} filtra a página${flow.site ? `; uma ${flow.site.toLowerCase()} por vez` : ""}`, make: ({ look = "noite" } = {}) => { const y = yard(look); return { type: "image", scene: true, look, url: m(y.url), title: `${flow.place}s e ${things.toLowerCase()} agora`, overlay: { category: y.made.points.category, x: m(y.x), y: m(y.y), w: Number(y.made.points.w), h: Number(y.made.points.h) } }; } };
  else scenes.etapas = { desc: "as etapas como torres: quantos em cada uma, os atrasados em vermelho", make: () => ({ type: "image", url: m(towers), title: "Onde está cada um agora" }) };
  const specials = {
    rastreamento: { desc: "as etapas em sequência com quantos em cada (ou o caminho do item escolhido)", make: () => ({ type: "image", url: m(tracker), title: "Rastreamento" }) },
    tabela_andamento: { desc: `${things.toLowerCase()} em andamento com a etapa e a barra de progresso (clicar acende na cena)`, make: () => ({ type: "tableEx", title: `${things} em andamento`, values: [rowsBy, ...[place, driver && !place ? driver : null, stage].filter(Boolean).map(m), m(progress)], image: { height: 22, width: 128 }, totals: false, sort: { by: rowsBy, desc: false } }) },
  };
  if (detail) specials.detalhe_selecionado = { desc: "o item escolhido: seus dados e a etapa", make: () => ({ type: "image", float: true, url: m(detail), title: flow.asset ? `${things.slice(0, -1).replace(/õe$/, "ão")} selecionado` : "Selecionado" }) };
  return { kpis, onTime, lateDone, scenes, specials, site: flow.site ? col(F, flow.site) : null, picture: { tracker, progress, detail, towers } };
}
