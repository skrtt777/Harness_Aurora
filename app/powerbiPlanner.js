// The plan of a BI, written by the local model for this request and these data: the pages (each one the
// answer to a question of the request), their layout, their numbers, their scene and their charts, and
// the style. The model chooses only among what exists (a JSON schema with the catalog's names), the code
// checks it and fills what is missing; without the model, a plan made from the data and the request
// (autoPlan), varied by the subject. app/powerbiDesign.js makes the catalog; app/powerbiLayout.js draws.
import { LAYOUTS } from "./powerbiLayout.js";

export const CHARTS = {
  barras: "barras deitadas: ranking de itens",
  colunas: "colunas: comparar poucos itens ou meses",
  linha: "linha: evolução no tempo",
  area: "área: volume acumulando no tempo",
  rosca: "rosca: participação de poucas partes (até 6)",
  arvore: "mapa de árvore: participação de muitas partes",
  tabela: "tabela: os números de cada item",
  cascata: "cascata: como cada parte soma ou tira do total",
  funil: "funil: etapas que vão afunilando",
  medidor: "medidor: um número contra o máximo",
};
export const COLORS = { azul: "#2F6FDB", verde: "#1E9E62", teal: "#0F9AA0", roxo: "#7A4FD6", laranja: "#E8772E", vermelho: "#D94B4B", dourado: "#C99A2E", grafite: "#4A5568", rosa: "#D6457E" };
export const TONES = { sobrio: "sóbrio, poucas cores", vibrante: "cores fortes", executivo: "elegante, para diretoria", tecnico: "denso, para quem opera", acolhedor: "leve, cantos arredondados" };

const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const pick = (list, seed) => list[Math.abs(seed) % list.length];

/** The plan's JSON schema: every name is one the catalog has. */
export function planSchema(cat) {
  const block = { type: "object", properties: {
    tipo: { type: "string", enum: [...Object.keys(CHARTS), ...Object.keys(cat.specials)] },
    medida: { type: "string", enum: ["", ...cat.numbers] },
    por: { type: "string", enum: ["", ...cat.dims.map((d) => d.name), ...cat.time] },
    titulo: { type: "string" },
  }, required: ["tipo", "medida", "por", "titulo"] };
  return { type: "object", properties: {
    titulo: { type: "string" },
    estilo: { type: "object", properties: { tema: { type: "string", enum: ["claro", "escuro"] }, cor: { type: "string", enum: Object.keys(COLORS) }, tom: { type: "string", enum: Object.keys(TONES) } }, required: ["tema", "cor", "tom"] },
    paginas: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", properties: {
      nome: { type: "string" },
      pergunta: { type: "string" },
      layout: { type: "string", enum: Object.keys(LAYOUTS) },
      cena: { type: "string", enum: ["nenhuma", ...Object.keys(cat.scenes)] },
      numeros: { type: "array", maxItems: 5, items: { type: "string", enum: cat.cardable || cat.numbers } },
      blocos: { type: "array", maxItems: 4, items: block },
    }, required: ["nome", "pergunta", "layout", "cena", "numeros", "blocos"] } },
  }, required: ["titulo", "estilo", "paginas"] };
}

/** What the local model reads to plan: the request, the data, what can go on a page. */
export function planPrompt(cat, goal) {
  const list = (o) => Object.entries(o).map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : v.desc}`).join("\n");
  return [
    "Você é um designer de BI brasileiro. Planeje o painel do Power BI para ESTE pedido e ESTES dados, em português do Brasil. Cada BI é único como qualquer projeto: as páginas, os nomes, o layout e o estilo saem do que a pessoa quer ver e de quem vai usar — não repita uma estrutura padrão.",
    "",
    `Pedido: ${goal || "(sem detalhes: decida pelo que os dados contam)"}`,
    `Dados: ${cat.sources} (${cat.rows} linhas). ${cat.stories.join(" ")}`,
    `Colunas para agrupar (por): ${cat.dims.map((d) => `${d.name} (${d.distinct} valores)`).join(", ")}${cat.time.length ? `; tempo: ${cat.time.join(", ")}` : ""}.`,
    `Números principais destes dados: ${(cat.principal || []).join(", ")}.`,
    `Outros números: ${cat.numbers.filter((n) => !(cat.principal || []).includes(n)).join(", ")}.`,
    "",
    "Cenas (desenhos feitos dos dados, ocupam um espaço grande):",
    list(Object.fromEntries(Object.entries(cat.scenes).map(([k, v]) => [k, v.desc]))) || "- nenhuma",
    "Blocos especiais:",
    list(Object.fromEntries(Object.entries(cat.specials).map(([k, v]) => [k, v.desc]))) || "- nenhum",
    "Gráficos (tipo + medida + por):",
    list(CHARTS),
    "Layouts:",
    list(LAYOUTS),
    "",
    "Regras:",
    "- Quantas páginas o pedido precisa (de 1 a 4): um painel simples tem 1 ou 2; não invente páginas que o pedido não pede.",
    "- Cada página responde UMA pergunta do pedido. O nome da página é um título curto, com espaços e acentos, feito das palavras do pedido e dos dados (não copie nomes de outros painéis).",
    "- Cada página mostra coisas diferentes das outras: não repita os mesmos números nem os mesmos gráficos.",
    "- Comece pelos números principais; cada número e cada gráfico precisa ajudar a responder a pergunta da página.",
    "- Cena só onde ela ajuda a entender (no máximo uma por página e duas no painel); blocos especiais só no assunto deles.",
    "- Quando os dados descrevem um lugar ou processo (pátio, planta, etapas), a página principal pode ser um gêmeo digital (layout gemeo_digital): a cena é a tela, viva e clicável.",
    "- No máximo 5 números e 4 blocos por página; layouts diferentes entre as páginas quando fizer sentido.",
    "- O estilo combina com o assunto e com quem vai ler (diretoria: executivo e sóbrio; operação: escuro e técnico; dono de pequeno negócio: claro e acolhedor).",
    "Responda só o JSON.",
  ].join("\n");
}

/** A title from the plan, with only the words the person or the files said (an invented word is dropped). */
export function groundedName(name, said) {
  const words = [...new Set(fold(said).split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
  const kept = String(name || "").replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean).filter((w) => {
    const p = fold(w).replace(/[^\p{L}\p{N}]/gu, "");
    // Singular or plural ("salas" said as "sala"), or the same first five letters.
    const stem = (w) => w.replace(/(oes|aes|es|s)$/, "");
    return p.length <= 3 || words.includes(p) || words.some((x) => stem(x) === stem(p) || (x.length >= 5 && p.length >= 5 && x.slice(0, 5) === p.slice(0, 5)));
  });
  // No dangling connector at the end ("Painel de").
  while (kept.length && /^(de|do|da|dos|das|e|em|para|por)$/i.test(kept[kept.length - 1])) kept.pop();
  const title = kept.join(" ").trim();
  return title.split(" ").some((w) => w.length > 3) ? title : undefined;
}

const ACCENTS = Object.fromEntries(["visão", "evolução", "orçamento", "orçado", "execução", "análise", "período", "previsão", "média", "série", "histórico", "operação", "produção", "região", "regiões", "situação", "distribuição", "participação", "comparação", "variação", "tendência", "gestão", "finanças", "início", "último", "mês", "saída", "saídas", "líquido", "número", "números", "crédito", "débito", "serviço", "serviços", "logística", "estratégia", "visões", "áreas", "área", "rápido", "diário", "mensal", "trimestral", "pátio", "caminhões", "veículos", "depósito", "relatório", "indicadores", "câmbio", "preço", "preços", "lançamentos", "lançamento"].map((w) => [w.normalize("NFD").replace(/\p{M}/gu, "").replace(/ç/g, "c"), w]).concat([["evoluçao", "evolução"], ["orçamentacao", "orçamentação"], ["execuçao", "execução"], ["operaçao", "operação"], ["situaçao", "situação"], ["variaçao", "variação"], ["financieira", "financeira"], ["financieiro", "financeiro"]]).filter(([a, b]) => a !== b));

/** "VisaoGeralFinanceira", "caixa_padaria" -> "Visao geral financeira", "Caixa padaria": a title, not an identifier. */
export function humanTitle(text) {
  const t = String(text || "").replace(/[_]+/g, " ").replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const words = t.split(" ").map((w, i) => (i > 0 && /^\p{Lu}\p{Ll}+$/u.test(w) ? w.toLowerCase() : w));
  const titled = words.join(" ").replace(/^./, (c) => c.toUpperCase()).replace(/\s*\(([^)]*)\)\s*$/, " ($1)");
  // The accents a small model drops in the words of a BI ("Visao geral", "Evoluçao mensal").
  return titled.replace(/\p{L}+/gu, (w) => { const fixed = ACCENTS[w.toLowerCase()]; return fixed ? (w[0] === w[0].toUpperCase() ? fixed[0].toUpperCase() + fixed.slice(1) : fixed) : w; });
}

/** The model's plan made safe: known names only, limits kept, an empty page filled; null if unusable. */
export function normalizePlan(raw, cat, goal = "") {
  let plan = raw;
  if (typeof plan === "string") { try { plan = JSON.parse(plan.match(/\{[\s\S]*\}/)?.[0] || ""); } catch { return null; } }
  if (!plan || !Array.isArray(plan.paginas) || !plan.paginas.length) return null;
  const numbers = new Set(cat.numbers);
  const dims = new Set([...cat.dims.map((d) => d.name), ...cat.time]);
  const estilo = plan.estilo || {};
  const pages = [];
  const seen = new Set();
  const cardable = new Set(cat.cardable || cat.numbers);
  let scenesUsed = 0;
  for (const p of plan.paginas.slice(0, 4)) {
    const nome = humanTitle(p?.nome).slice(0, 40) || `Página ${pages.length + 1}`;
    if (seen.has(fold(nome))) continue;
    seen.add(fold(nome));
    const blocos = (Array.isArray(p.blocos) ? p.blocos : []).map((b) => ({
      tipo: String(b?.tipo || ""), medida: numbers.has(b?.medida) ? b.medida : "", por: dims.has(b?.por) ? b.por : "", titulo: String(b?.titulo || "").trim().slice(0, 70),
    })).filter((b) => cat.specials[b.tipo] || (CHARTS[b.tipo] && b.medida && !(cat.foreign?.has(b.medida) && b.tipo !== "medidor"))).slice(0, 4);
    const page = {
      nome, pergunta: String(p.pergunta || "").trim().slice(0, 120),
      layout: LAYOUTS[p.layout] ? p.layout : "grade",
      cena: cat.scenes[p.cena] ? p.cena : "nenhuma",
      // A card already on an earlier page is not repeated (the same five cards on every page, 11/10).
      numeros: [...new Set((Array.isArray(p.numeros) ? p.numeros : []).filter((n) => cardable.has(n) && !pages.some((x) => x.numeros.includes(n))))].slice(0, 5),
      blocos,
    };
    // At most two scenes in a BI (a scene on every page was filler, 11/10).
    if (page.cena !== "nenhuma" && (scenesUsed >= 2 || pages.some((x) => x.cena === page.cena))) page.cena = "nenhuma";
    if (page.cena !== "nenhuma") scenesUsed += 1;
    if (page.cena === "nenhuma" && !page.blocos.length && !page.numeros.length) continue;
    // Numbers only: a chart of the first one, so the page shows more than cards.
    if (page.cena === "nenhuma" && !page.blocos.length) {
      const by = cat.time.includes("mês") ? "mês" : cat.dims.find((d) => d.distinct >= 3 && d.distinct <= 30)?.name || "";
      page.blocos.push({ tipo: by === "mês" ? "linha" : "barras", medida: page.numeros[0], por: by, titulo: "" });
    }
    // A layout made for a scene, without one: the closest without.
    if (page.cena === "nenhuma" && /^cena_/.test(page.layout)) page.layout = page.blocos.length > 2 ? "grade" : "narrativa";
    // The page asks about a column no chart shows ("Qual loja é a melhor?" with only the months, 11/10):
    // its ranking joins the page.
    const words = fold(`${page.nome} ${page.pergunta}`);
    for (const d of cat.dims) {
      const stem = fold(d.name).slice(0, Math.max(4, fold(d.name).length - 1));
      if (page.blocos.length >= 4 || !words.includes(stem) || page.blocos.some((b) => b.por === d.name) || cat.scenes[page.cena]?.covers?.includes(d.name)) continue;
      const measure = page.numeros.find((x) => !cat.foreign?.has(x)) || (cat.principal || cat.numbers).find((x) => !cat.foreign?.has(x));
      if (measure) page.blocos.push({ tipo: "barras", medida: measure, por: d.name, titulo: "" });
    }
    // A twin of an earlier page (same scene and charts) is dropped.
    const sign = (x) => `${x.cena}|${x.blocos.map((b) => `${b.tipo}:${b.medida}:${b.por}`).sort().join(",")}`;
    if (pages.some((x) => sign(x) === sign(page))) continue;
    pages.push(page);
  }
  if (!pages.length) return null;
  return {
    // The model's title keeps only words that were said; the design's own title is kept as it is.
    titulo: plan.titulo === cat.title ? cat.title : groundedName(plan.titulo, `${goal} ${cat.sources} ${cat.stories.join(" ")}`) || cat.title,
    estilo: { tema: estilo.tema === "claro" ? "claro" : "escuro", cor: COLORS[estilo.cor] ? estilo.cor : "azul", tom: TONES[estilo.tom] ? estilo.tom : "sobrio" },
    paginas: pages,
    planner: "modelo",
  };
}

/** A plan without the model: from what the data are about and the words of the request, varied by both. */
export function autoPlan(cat, goal = "") {
  const seed = hash(`${goal}|${cat.title}|${cat.rows}`);
  const n = cat.numbers;
  const has = (k) => Boolean(cat.specials[k]);
  const byTime = cat.time.includes("mês") ? "mês" : "";
  const dim = (re) => cat.dims.find((d) => re.test(d.name))?.name || "";
  const firstDim = cat.dims.find((d) => d.distinct >= 3 && d.distinct <= 40)?.name || cat.dims[0]?.name || "";
  const chart = (tipo, medida, por, titulo) => (medida ? { tipo, medida, por, titulo } : null);
  const pages = [];
  let estilo;
  if (cat.kind === "financas") {
    const k = cat.keys;
    pages.push({ nome: pick(["Para onde vai o dinheiro", "Dinheiro do período", "Entradas e saídas"], seed), pergunta: "De onde vem e para onde vai o dinheiro?", layout: pick(["cena_e_lateral", "narrativa", "cena_inteira"], seed), cena: "dinheiro", numeros: [k.income, k.outgo, k.balance, k.margin, k.execution].filter(Boolean), blocos: [has("orcamento_por_categoria") ? { tipo: "orcamento_por_categoria" } : null, has("saldo_acumulado") ? { tipo: "saldo_acumulado" } : null].filter(Boolean) });
    if (byTime) pages.push({ nome: pick(["Mês a mês", "Ritmo do caixa", "Evolução"], seed >>> 3), pergunta: "Como o caixa andou ao longo dos meses?", layout: pick(["comparacao", "grade", "foco_unico"], seed >>> 2), cena: "nenhuma", numeros: [k.balance], blocos: [has("entradas_e_saidas") ? { tipo: "entradas_e_saidas" } : null, chart("barras", k.outgo, dim(/centro|setor|departamento|[áa]rea/i) || firstDim, ""), chart("linha", k.balance, byTime, "")].filter(Boolean) });
    estilo = { tema: pick(["claro", "escuro"], seed >>> 4), cor: pick(["teal", "dourado", "azul", "verde"], seed >>> 1), tom: "executivo" };
  } else if (cat.kind === "logistica" || cat.kind === "fluxo") {
    const k = cat.keys;
    const scene = cat.scenes.patio ? "patio" : cat.scenes.operacao ? "operacao" : "etapas";
    pages.push({ nome: cat.kind === "logistica" ? pick(["Pátio agora", "Operação ao vivo", "Docas e caminhões"], seed) : pick(["Onde está cada um", "Andamento agora", "Fila de trabalho"], seed), pergunta: "O que está acontecendo agora e onde está cada um?", layout: scene !== "etapas" ? pick(["gemeo_digital", "gemeo_digital", "cena_e_lateral"], seed) : pick(["cena_e_lateral", "cena_inteira", "cartoes_laterais"], seed), cena: scene, numeros: k.kpis.slice(0, 5), blocos: [has("detalhe_selecionado") ? { tipo: "detalhe_selecionado" } : null, has("tabela_andamento") ? { tipo: "tabela_andamento" } : null, has("rastreamento") ? { tipo: "rastreamento" } : null].filter(Boolean).slice(0, 3) });
    const second = [chart("barras", k.onTime || k.count, dim(/transportadora|empresa|parceiro|equipe|respons|t[ée]cnico/i) || firstDim, ""), chart("barras", k.lateDone || k.count, dim(/cidade|destino|cliente|categoria|prioridade/i) || firstDim, ""), byTime ? chart("colunas", k.count, byTime, "") : null].filter(Boolean);
    if (second.length) pages.push({ nome: cat.kind === "logistica" ? pick(["Prazos e atrasos", "Quem entrega no prazo", "Entregas"], seed >>> 2) : pick(["Volume e prazos", "Quem resolve", "Ritmo"], seed >>> 2), pergunta: "Quem cumpre o prazo e onde estão os atrasos?", layout: pick(["grade", "narrativa", "comparacao"], seed >>> 3), cena: "nenhuma", numeros: [k.count, k.onTime, k.lateDone].filter(Boolean), blocos: second });
    estilo = { tema: "escuro", cor: pick(["azul", "teal", "laranja"], seed), tom: "tecnico" };
  } else if (cat.kind === "espacos") {
    const k = cat.keys;
    const kindDim = cat.dims.find((d) => /tipo|uso|departamento|setor|categoria/i.test(d.name))?.name || firstDim;
    pages.push({ nome: pick(["Planta", "O prédio", "Espaços"], seed), pergunta: "Como os espaços estão distribuídos e usados?", layout: pick(["gemeo_digital", "cena_e_lateral"], seed), cena: "planta", numeros: k.kpis.slice(0, 4), blocos: [chart("barras", k.headline, kindDim, ""), chart("rosca", k.headline, kindDim, "")].filter(Boolean).slice(0, 1) });
    pages.push({ nome: pick(["Uso por tipo", "Ocupação", "Custos dos espaços"], seed >>> 2), pergunta: "Qual tipo de espaço custa e ocupa mais?", layout: pick(["comparacao", "grade"], seed >>> 3), cena: "nenhuma", numeros: [], blocos: [chart("barras", k.headline, kindDim, ""), chart("tabela", k.headline, firstDim, "")].filter(Boolean) });
    estilo = { tema: pick(["claro", "escuro"], seed), cor: pick(["azul", "teal", "grafite"], seed >>> 1), tom: "tecnico" };
  } else {
    const k = cat.keys;
    const cityKey = Object.keys(cat.scenes).find((s) => goal && fold(goal).includes(fold(s.replace(/^cidade de /, "")))) || Object.keys(cat.scenes)[0];
    const other = cat.dims.find((d) => `cidade de ${d.name}` !== cityKey && d.distinct >= 2 && d.distinct <= 30)?.name || firstDim;
    pages.push({ nome: pick(["Panorama", "Visão do negócio", "Onde estão os resultados"], seed), pergunta: "Quais itens puxam o resultado?", layout: pick(["cena_e_lateral", "foco_unico", "cartoes_laterais"], seed), cena: cityKey || "nenhuma", numeros: k.kpis.slice(0, 4), blocos: [byTime ? chart("linha", k.headline, byTime, "") : null, chart("barras", k.headline, other, "")].filter(Boolean) });
    pages.push({ nome: pick(["Detalhe", "Item a item", "Composição"], seed >>> 2), pergunta: "Como cada parte contribui?", layout: pick(["grade", "comparacao", "narrativa"], seed >>> 3), cena: "nenhuma", numeros: [], blocos: [chart("tabela", k.headline, firstDim, ""), chart("arvore", k.headline, other, ""), byTime ? chart("colunas", k.headline, byTime, "") : null].filter(Boolean) });
    estilo = { tema: pick(["escuro", "claro"], seed), cor: pick(["azul", "roxo", "verde", "laranja", "teal"], seed >>> 1), tom: pick(["vibrante", "sobrio", "acolhedor"], seed >>> 2) };
  }
  // "sem a tendência"/"só uma página": the request still has the last word.
  let kept = pages;
  if (/(?<!\p{L})(s[óo]|apenas|somente)(?!\p{L}).{0,20}(uma )?p[áa]gina|uma (s[óo] )?(p[áa]gina|tela)/iu.test(goal)) kept = pages.slice(0, 1);
  const plan = normalizePlan({ titulo: cat.title, estilo, paginas: kept }, cat, goal);
  return plan ? { ...plan, planner: "automático" } : null;
}

/** The visuals of one planned page, without positions, for app/powerbiLayout.js. */
export function materialize(page, cat, look = "noite") {
  const m = (name) => `[${name}]`;
  const timeRef = { mês: "'Calendário'[Mês/ano]", trimestre: "'Calendário'[Trimestre]", ano: "'Calendário'[Ano]", "dia da semana": "'Calendário'[Dia da semana]" };
  const refOf = (por) => timeRef[por] || cat.dims.find((d) => d.name === por)?.ref || null;
  const isTime = (por) => Boolean(timeRef[por]);
  const defaultBy = (tipo) => (["linha", "area"].includes(tipo) && cat.time.length ? "mês" : cat.dims.find((d) => d.distinct >= 2 && d.distinct <= 30)?.name || cat.dims[0]?.name || "");
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const blocks = page.blocos.map((b) => {
    if (cat.specials[b.tipo]) return { ...cat.specials[b.tipo].make(), ...(b.titulo ? { title: b.titulo } : {}) };
    // A line by year with two or three years is a straight segment: month by month says more.
    const por = (["linha", "area"].includes(b.tipo) && b.por === "ano" && cat.months >= 6) ? "mês" : b.por || defaultBy(b.tipo);
    const ref = refOf(por);
    const title = b.titulo || `${b.medida}${por ? ` por ${lower(por)}` : ""}`;
    const sort = ref ? (isTime(por) ? { by: ref, desc: false } : { by: m(b.medida) }) : undefined;
    switch (b.tipo) {
      case "barras": return { type: "clusteredBarChart", title, category: ref, values: m(b.medida), labels: true, sort };
      case "colunas": return { type: "clusteredColumnChart", title, category: ref, values: m(b.medida), labels: !isTime(por) || cat.months <= 14, sort };
      case "linha": return { type: "lineChart", title, category: ref, values: m(b.medida), sort };
      case "area": return { type: "areaChart", title, category: ref, values: m(b.medida), sort };
      case "rosca": return { type: "donutChart", title, category: ref, values: m(b.medida), labels: true };
      case "arvore": return { type: "treemap", title, category: ref, values: m(b.medida) };
      case "cascata": return { type: "waterfallChart", title, category: ref, values: m(b.medida), sort };
      case "funil": return { type: "funnel", title, category: ref, values: m(b.medida) };
      case "medidor": return { type: "gauge", title, values: m(b.medida) };
      default: { // tabela
        const extra = cat.numbers.filter((x) => x !== b.medida && cat.related(b.medida, x)).slice(0, 2);
        return { type: "tableEx", title, values: [ref, m(b.medida), ...extra.map(m)].filter(Boolean), totals: false, sort };
      }
    }
  }).filter((v) => v && (v.type === "gauge" || v.type === "tableEx" || v.category || v.url || v.values));
  const scene = page.cena !== "nenhuma" ? cat.scenes[page.cena]?.make({ look }) : null;
  // The filters of the page: the year, and what its charts group by.
  const used = page.blocos.map((b) => b.por).filter((p) => p && !timeRef[p]);
  const slicerRefs = [cat.time.length ? "'Calendário'[Ano]" : null, ...used.map(refOf), ...cat.slicerRefs].filter(Boolean);
  // The moment and the unit (the filters with a default) come first: they decide what the page shows.
  const first = cat.slicerRefs.filter((r) => cat.slicerDefaults?.[r]);
  const slicers = [...new Set([...first, ...slicerRefs])].slice(0, 3).map((values) => ({ type: "slicer", values, dropdown: true, ...(cat.slicerDefaults?.[values] ? { select: [cat.slicerDefaults[values]], single: true } : {}) }));
  const cards = page.numeros.map((name) => ({ type: "card", values: m(name), title: name, ...(cat.money.has(name) ? { precision: 0 } : {}) }));
  return { name: page.nome, question: page.pergunta, layout: page.layout, cards, scene, blocks, slicers };
}

/**
 * How to ask the local model for the plan: the llama-server the chat already runs on (no second copy of
 * the model in memory), or Ollama when there is none. Answers like runLocal (honours LOCAL_OUTPUT_SCHEMA).
 */
export async function localPlanAsk(env = process.env) {
  const [{ runLocal, ollamaContextTokens }, { runLlama }, { ensureLlamaServer }, { resolveLocalModel }] = await Promise.all([import("./local.js"), import("./localLlama.js"), import("./llamaServer.js"), import("./ollamaSetup.js")]);
  const model = await resolveLocalModel(env).catch(() => null);
  // In a chat turn the agent's own server comes as LOCAL_CHAT_BASE_URL (11/10: without it the planner went
  // to an Ollama that was not running and every BI fell back to the automatic plan).
  const base = env.LOCAL_CHAT_BASE_URL || (!env.LOCAL_BASE_URL && model ? await ensureLlamaServer({ model, contextTokens: ollamaContextTokens(env), env }).catch(() => null) : null);
  if (!base) return (prompt, e) => runLocal(prompt, e);
  return (prompt, e) => runLlama(prompt, { ...e, LOCAL_ENGINE: "llama.cpp", LOCAL_BASE_URL: base, LOCAL_MODEL: model, LOCAL_CONTEXT_TOKENS: String(ollamaContextTokens(env)), LOCAL_TIMEOUT_MS: "180000" });
}

/**
 * Plans with the local model (ask = runLocal-like, with a JSON schema); null when it gives nothing usable
 * (the caller then uses autoPlan).
 */
export async function planWithModel(cat, goal, ask, env = {}, onError = () => {}) {
  if (!ask) return null;
  const answer = await ask(planPrompt(cat, goal), { ...env, LOCAL_OUTPUT_SCHEMA: JSON.stringify(planSchema(cat)), LOCAL_MAX_OUTPUT_TOKENS: "2048" }).catch((error) => ({ ok: false, error: error.message }));
  if (!answer?.ok) { onError(answer?.error || "sem resposta"); return null; }
  const plan = normalizePlan(answer.text, cat, goal);
  if (!plan) onError("plano inválido");
  return plan;
}
