// Scenes made by the Aurora on request ("faz uma fazenda com vacas e um trator"): a small JSON the
// Aurora answers in a ```cena block, read here into a miniature the app draws (xr/scene3d.js). The
// same request also makes a draft at once from its own words (sceneFromPrompt), so something appears
// while the Aurora thinks, and a reply without a valid block still gives a scene.
// Pure (no three.js): the same functions run in the browser, in the headset and in the tests.
// Units: metres of the miniature, x to the right, y up, z toward the viewer; the plate is 0.6 x 0.45 m.

import { RING } from "./dynamics.js";

export const PLATE = { width: 0.6, depth: 0.45 };
export const BEHAVIORS = ["parado", "passear", "rodar", "girar", "flutuar", "voar", "nadar", "pular", "orbitar"];

// type: [size in metres (largest side), colour, default behaviour, flags, synonyms]
// flags: a = in the air (height), w = in the water, f = fixed (not grabbed: ground features), c = centre.
const T = {
  arvore: [0.07, "#2f9e44", "parado", "", "arvore arvores floresta mata bosque"],
  pinheiro: [0.08, "#1f6f43", "parado", "", "pinheiro pinho abeto"],
  palmeira: [0.08, "#3aa35b", "parado", "", "palmeira coqueiro"],
  arbusto: [0.025, "#3c8d3f", "parado", "", "arbusto moita planta"],
  flor: [0.015, "#e64980", "parado", "", "flor flores jardim"],
  cogumelo: [0.02, "#d9480f", "parado", "", "cogumelo"],
  pedra: [0.025, "#868e96", "parado", "", "pedra rocha"],
  montanha: [0.16, "#6b7a8f", "parado", "f", "montanha morro serra"],
  vulcao: [0.16, "#5c3d2e", "parado", "f", "vulcao"],
  lago: [0.14, "#3b82c4", "parado", "f", "lago lagoa rio piscina"],
  fogueira: [0.025, "#ff922b", "parado", "", "fogueira fogo"],
  barraca: [0.045, "#f59f00", "parado", "", "barraca acampamento tenda"],
  cerca: [0.06, "#a47148", "parado", "", "cerca"],
  poste: [0.05, "#adb5bd", "parado", "", "poste luz lampiao"],
  banco: [0.03, "#a47148", "parado", "", "banco"],
  casa: [0.07, "#f1e3c6", "parado", "", "casa casinha residencia"],
  predio: [0.14, "#7d8fa8", "parado", "", "predio edificio arranha-ceu"],
  celeiro: [0.09, "#c0392b", "parado", "", "celeiro estabulo galpao"],
  castelo: [0.16, "#b8b2a7", "parado", "", "castelo"],
  torre: [0.12, "#9c8f80", "parado", "", "torre"],
  moinho: [0.1, "#e9ecef", "parado", "", "moinho cata-vento"],
  farol: [0.12, "#f8f9fa", "parado", "", "farol"],
  ponte: [0.12, "#8d6e63", "parado", "f", "ponte"],
  carro: [0.045, "#e03131", "rodar", "", "carro carros automovel"],
  caminhao: [0.06, "#2f6fdb", "rodar", "", "caminhao carreta"],
  onibus: [0.07, "#fab005", "rodar", "", "onibus"],
  trator: [0.04, "#2b8a3e", "rodar", "", "trator"],
  trem: [0.12, "#c92a2a", "rodar", "", "trem locomotiva"],
  barco: [0.06, "#f8f9fa", "nadar", "w", "barco navio veleiro lancha"],
  aviao: [0.08, "#e9ecef", "voar", "a", "aviao avioes jato"],
  helicoptero: [0.06, "#e8590c", "voar", "a", "helicoptero"],
  foguete: [0.1, "#f1f3f5", "parado", "", "foguete"],
  nave: [0.06, "#91a7ff", "flutuar", "a", "nave disco ovni"],
  balao: [0.05, "#f03e3e", "flutuar", "a", "balao"],
  pessoa: [0.035, "#4c6ef5", "passear", "", "pessoa pessoas gente homem mulher crianca turista visitante"],
  robo: [0.04, "#adb5bd", "passear", "", "robo"],
  vaca: [0.045, "#f8f9fa", "passear", "", "vaca boi gado"],
  cavalo: [0.05, "#8d5a3b", "passear", "", "cavalo egua"],
  ovelha: [0.03, "#f1f3f5", "passear", "", "ovelha carneiro"],
  porco: [0.03, "#f7a8b8", "passear", "", "porco"],
  cachorro: [0.025, "#c08552", "passear", "", "cachorro cao"],
  gato: [0.02, "#ff922b", "passear", "", "gato"],
  galinha: [0.015, "#f8f9fa", "pular", "", "galinha pinto"],
  pato: [0.015, "#ffd43b", "nadar", "", "pato"],
  coelho: [0.015, "#e9ecef", "pular", "", "coelho"],
  leao: [0.045, "#e8a33d", "passear", "", "leao"],
  elefante: [0.07, "#868e96", "passear", "", "elefante"],
  girafa: [0.09, "#f2c14e", "passear", "", "girafa"],
  urso: [0.045, "#6f4e37", "passear", "", "urso"],
  dinossauro: [0.09, "#5c940d", "passear", "", "dinossauro dino"],
  pinguim: [0.02, "#212529", "passear", "", "pinguim"],
  passaro: [0.015, "#4dabf7", "voar", "a", "passaro ave gaivota"],
  peixe: [0.02, "#ff922b", "nadar", "w", "peixe"],
  tubarao: [0.05, "#748ffc", "nadar", "w", "tubarao"],
  baleia: [0.1, "#364fc7", "nadar", "w", "baleia"],
  planeta: [0.06, "#4dabf7", "orbitar", "a", "planeta planetas terra marte jupiter saturno"],
  estrela: [0.015, "#ffd43b", "flutuar", "a", "estrela"],
  lua: [0.04, "#ced4da", "flutuar", "a", "lua"],
  sol: [0.07, "#ffb703", "girar", "ac", "sol"],
  nuvem: [0.06, "#f8f9fa", "flutuar", "a", "nuvem"],
  bola: [0.015, "#fa5252", "pular", "", "bola"],
  caixa: [0.025, "#c8a46e", "parado", "", "caixa pacote volume"],
  objeto: [0.03, "#b04bff", "parado", "", ""],
};
export const CATALOG = Object.fromEntries(Object.entries(T).map(([type, [size, color, behavior, flags, words]]) => [type, {
  type, size, color, behavior, air: flags.includes("a"), water: flags.includes("w"), fixed: flags.includes("f"), centre: flags.includes("c"), words: words.split(" ").filter(Boolean),
}]));
export const TYPES = Object.keys(CATALOG).filter((t) => t !== "objeto");

export const GROUNDS = {
  grama: "#3d7a3a", areia: "#d9c38f", agua: "#2a6fa8", neve: "#e8eef5", asfalto: "#3a3f47", terra: "#8a6a4a", espaco: "#0b0f24", lava: "#2b1410", madeira: "#8b6b4a",
};

// Themes: the words that name them, the ground and what a scene of the kind has when nothing else is said.
const THEMES = [
  { words: "fazenda sitio roca chacara curral", title: "Fazenda", ground: "grama", items: [["celeiro", 1], ["casa", 1], ["vaca", 4], ["cavalo", 2], ["ovelha", 3], ["galinha", 4], ["trator", 1], ["arvore", 4], ["cerca", 3], ["lago", 1]] },
  { words: "cidade bairro rua urbano centro transito", title: "Cidade", ground: "asfalto", items: [["predio", 5], ["casa", 2], ["carro", 5], ["onibus", 1], ["pessoa", 6], ["poste", 4], ["arvore", 3]] },
  { words: "praia mar litoral ilha oceano", title: "Praia", ground: "areia", items: [["lago", 1], ["palmeira", 4], ["barco", 2], ["pessoa", 4], ["barraca", 2], ["bola", 1], ["peixe", 3], ["farol", 1]] },
  { words: "espaco sistema solar galaxia universo cosmos astronauta", title: "Sistema solar", ground: "espaco", items: [["sol", 1], ["planeta", 5], ["lua", 1], ["estrela", 10], ["foguete", 1], ["nave", 1]] },
  { words: "dinossauro dinossauros jurassico pre-historico", title: "Parque dos dinossauros", ground: "grama", items: [["dinossauro", 4], ["palmeira", 4], ["vulcao", 1], ["arvore", 3], ["pedra", 4], ["lago", 1]] },
  { words: "floresta selva mata bosque", title: "Floresta", ground: "grama", items: [["arvore", 8], ["pinheiro", 5], ["urso", 1], ["coelho", 3], ["passaro", 3], ["cogumelo", 4], ["lago", 1], ["pedra", 3]] },
  { words: "zoologico safari savana", title: "Zoológico", ground: "terra", items: [["leao", 2], ["elefante", 2], ["girafa", 2], ["pessoa", 4], ["arvore", 4], ["cerca", 4], ["lago", 1]] },
  { words: "porto cais doca navios", title: "Porto", ground: "terra", items: [["lago", 1], ["barco", 3], ["caminhao", 2], ["caixa", 6], ["farol", 1], ["peixe", 2], ["baleia", 1]] },
  { words: "aeroporto pista", title: "Aeroporto", ground: "asfalto", items: [["aviao", 3], ["helicoptero", 1], ["predio", 2], ["onibus", 1], ["carro", 3], ["pessoa", 5]] },
  { words: "neve natal inverno polo artico gelo", title: "Inverno", ground: "neve", items: [["pinheiro", 7], ["casa", 2], ["pinguim", 5], ["pessoa", 3], ["montanha", 1], ["nuvem", 2]] },
  { words: "acampamento camping trilha", title: "Acampamento", ground: "grama", items: [["barraca", 3], ["fogueira", 1], ["pessoa", 4], ["pinheiro", 6], ["lago", 1], ["montanha", 1]] },
  { words: "castelo reino medieval princesa", title: "Reino", ground: "grama", items: [["castelo", 1], ["torre", 2], ["cavalo", 3], ["pessoa", 5], ["arvore", 4], ["lago", 1], ["ponte", 1]] },
  { words: "parque praca", title: "Parque", ground: "grama", items: [["arvore", 6], ["banco", 3], ["pessoa", 6], ["cachorro", 2], ["lago", 1], ["pato", 3], ["flor", 6], ["balao", 1]] },
  { words: "fundo do mar aquario submarino recife", title: "Fundo do mar", ground: "agua", items: [["peixe", 10], ["tubarao", 2], ["baleia", 1], ["pedra", 5], ["arbusto", 4]] },
  { words: "vulcao lava inferno", title: "Vulcão", ground: "lava", items: [["vulcao", 1], ["pedra", 6], ["dinossauro", 2], ["fogueira", 2]] },
  { words: "robo robos futuro futurista", title: "Cidade do futuro", ground: "asfalto", items: [["predio", 5], ["robo", 5], ["nave", 3], ["carro", 3], ["poste", 4]] },
];

export const norm = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const words = (text) => norm(text).replace(/[^a-z0-9\- ]+/g, " ").split(/\s+/).filter(Boolean);
/** Plural to singular, enough for the catalogue: "avioes" -> "aviao", "animais" -> "animal". */
export function singular(w) {
  if (w.length < 4) return w;
  if (w.endsWith("oes") || w.endsWith("aes")) return `${w.slice(0, -3)}ao`;
  if (w.endsWith("ns")) return `${w.slice(0, -2)}m`;
  if (w.endsWith("ais")) return `${w.slice(0, -3)}al`;
  if (w.endsWith("eis")) return `${w.slice(0, -3)}el`;
  if (/(r|z)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}
const SYN = new Map();
for (const c of Object.values(CATALOG)) for (const w of [c.type, ...c.words]) { SYN.set(w, c.type); SYN.set(singular(w), c.type); }
/** A word (or a name the Aurora wrote) to a type of the catalogue; null when unknown. */
export function typeOf(name) {
  const ws = words(name);
  for (const w of ws) { const t = SYN.get(w) || SYN.get(singular(w)); if (t) return t; }
  return null;
}

const NUMBERS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, varios: 4, varias: 4, muitos: 8, muitas: 8, alguns: 3, algumas: 3, mais: 2 };
/** The things named in a sentence with how many: "3 vacas e um trator" -> [["vaca",3],["trator",1]]. */
export function mentioned(text) {
  const ws = words(text); const out = new Map();
  ws.forEach((w, i) => {
    const t = SYN.get(w) || SYN.get(singular(w)); if (!t) return;
    const prev = ws[i - 1]; const prev2 = ws[i - 2];
    const count = (x) => (x == null ? null : /^\d+$/.test(x) ? Number(x) : NUMBERS[x] ?? null);
    let n = count(prev) ?? count(prev2);
    if (n == null) n = w !== singular(w) ? 3 : 1;
    out.set(t, Math.max(out.get(t) || 0, Math.min(30, n)));
  });
  return [...out];
}

/** "cria uma fazenda", "faz um cenário de praia", "monta uma maquete do sistema solar". */
export function isSceneRequest(text) {
  const t = norm(text);
  if (/(power ?bi|operacao|\bdoca|\bcd\b)/.test(t)) return false;
  const verb = /\b(cria|crie|criar|faz|faca|fazer|monta|monte|montar|gera|gere|gerar|desenha|desenhe|constroi|construa|construir|quero|bota|me mostra|mostra)\b/.test(t);
  const noun = /\b(cenario|maquete|cena|mundo|diorama|miniatura|mini mundo)\b/.test(t);
  return (verb && noun) || /^(um |uma )?cenario (de|do|da|com)\b/.test(t);
}

/** While a scene is shown: "adiciona 3 vacas", "coloca um foguete", "tira os carros". */
export function sceneEdit(text) {
  const t = norm(text);
  const add = /^(aurora )?(adiciona|adicione|acrescenta|acrescente|coloca|coloque|poe|ponha|bota|bote|mais)\b/.test(t);
  const remove = /^(aurora )?(tira|tire|remove|remova|apaga|apague|sem)\b/.test(t);
  if (!add && !remove) return null;
  const things = mentioned(t.replace(/^(aurora )?\S+ /, ""));
  if (!things.length) return null;
  return { op: add ? "add" : "remove", things };
}

/** The ```cena block of a reply (or the first JSON object with items), and the rest of the text. */
export function parseSceneReply(text) {
  const s = String(text || "");
  const fence = s.match(/```(?:cena|json|scene)?\s*([\s\S]*?)```/i);
  let raw = fence ? fence[1] : null;
  if (!raw) { const i = s.search(/\{\s*"(titulo|title|chao|ground|itens|items)"/); if (i >= 0) raw = balanced(s, i); }
  let spec = null;
  if (raw) {
    const cleaned = raw.trim().replace(/,\s*([}\]])/g, "$1").replace(/[“”]/g, '"');
    try { spec = JSON.parse(cleaned); } catch { try { spec = JSON.parse(balanced(cleaned, cleaned.indexOf("{")) || ""); } catch { spec = null; } }
  }
  if (spec && !Array.isArray(spec.itens || spec.items)) spec = null;
  const rest = (fence ? s.replace(fence[0], "") : raw ? s.replace(raw, "") : s).replace(/\n{3,}/g, "\n\n").trim();
  return { spec, rest };
}
function balanced(s, start) {
  if (start < 0) return null; let depth = 0; let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/** A scene from the request's own words: the theme it names and the things it counts. */
export function sceneFromPrompt(prompt) {
  const t = ` ${words(prompt).join(" ")} `;
  const theme = THEMES.find((th) => th.words.split(" ").some((w) => t.includes(` ${w} `) || t.includes(` ${w}s `)));
  const asked = mentioned(prompt);
  const items = new Map(theme ? theme.items : []);
  for (const [type, n] of asked) items.set(type, n);
  if (!items.size) for (const [type, n] of THEMES.find((th) => th.title === "Parque").items) items.set(type, n);
  const title = theme ? theme.title : asked.length ? asked.slice(0, 3).map(([type]) => type).join(", ") : "Parque";
  return { titulo: title.charAt(0).toUpperCase() + title.slice(1), chao: theme?.ground || (asked.some(([ty]) => CATALOG[ty].water) ? "agua" : asked.some(([ty]) => ["planeta", "estrela", "nave"].includes(ty)) ? "espaco" : "grama"), itens: [...items].map(([tipo, qtd]) => ({ tipo, qtd })) };
}

/** A seeded random (the same request gives the same scene). */
export function rng(seed) {
  let h = 2166136261 >>> 0;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let x = h; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? String(c).toLowerCase() : null);
const COLOR_WORDS = { vermelho: "#e03131", vermelha: "#e03131", azul: "#1c7ed6", verde: "#2f9e44", amarelo: "#fab005", amarela: "#fab005", rosa: "#e64980", roxo: "#7048e8", roxa: "#7048e8", laranja: "#fd7e14", preto: "#212529", preta: "#212529", branco: "#f8f9fa", branca: "#f8f9fa", cinza: "#868e96", marrom: "#8d5a3b", dourado: "#e8b923", dourada: "#e8b923" };
const colorOf = (c) => hex(c) || COLOR_WORDS[norm(c).trim()] || null;

/**
 * A scene (from the Aurora's JSON or from sceneFromPrompt) checked and laid out: known types, at most
 * 60 things, each with its place on the plate (x, z in metres; y above it), turn, size and behaviour.
 */
export function normalizeScene(raw, seed = "") {
  const W = PLATE.width, D = PLATE.depth;
  const spec = raw && typeof raw === "object" ? raw : {};
  const ground = GROUNDS[norm(spec.chao || spec.ground)] ? norm(spec.chao || spec.ground) : "grama";
  const title = String(spec.titulo || spec.title || "Cenário").slice(0, 60);
  const random = rng(`${seed}|${title}`);
  const wanted = [];
  for (const it of (spec.itens || spec.items || []).slice(0, 80)) {
    if (!it || typeof it !== "object") continue;
    const name = String(it.tipo || it.type || it.nome || it.name || "").slice(0, 40);
    const type = (CATALOG[norm(name)] ? norm(name) : typeOf(name)) || typeOf(it.nome || it.name) || "objeto";
    const n = Math.max(1, Math.min(20, Math.round(Number(it.qtd ?? it.quantidade ?? it.count ?? 1)) || 1));
    for (let k = 0; k < n && wanted.length < 60; k++) wanted.push({ it, type, label: String(it.nome || it.name || (type === "objeto" ? name : "")).slice(0, 40), k });
  }
  // Something that swims and nowhere to swim: a lake comes with it.
  if (ground !== "agua" && !wanted.some((w) => w.type === "lago") && wanted.some((w) => CATALOG[w.type].water)) wanted.unshift({ it: {}, type: "lago", label: "", k: 0 });
  if (wanted.length > 60) wanted.length = 60;
  const water = wanted.find((w) => w.type === "lago");
  // A big swimmer gets a bigger lake.
  const lakeScale = wanted.some((w) => w.type === "baleia" || w.type === "tubarao") ? 1.7 : 1;
  const lake = water ? { x: (random() - 0.5) * W * 0.4, z: (random() - 0.5) * D * 0.3, r: (CATALOG.lago.size * (Number(water.it.tamanho) || lakeScale)) / 2 } : null;
  const placed = [];
  // When something drives, the ring road stays clear (dynamics.js RING): how far a point is from it.
  const road = wanted.some((w) => (BEHAVIORS.includes(norm(w.it.comportamento || w.it.behavior)) ? norm(w.it.comportamento || w.it.behavior) : CATALOG[w.type].behavior) === "rodar");
  const offRoad = (x, z) => Math.abs(Math.hypot(x / RING.ax, z / RING.az) - 1) * ((RING.ax + RING.az) / 2) - 0.022;
  if (lake && road) { const e = Math.hypot(lake.x / RING.ax, lake.z / RING.az); const room = 1 - (lake.r + 0.03) / RING.az; if (e > room) { lake.x *= room / e; lake.z *= room / e; } }
  const items = wanted.map(({ it, type, label, k }, idx) => {
    const c = CATALOG[type];
    const scale = Math.max(0.4, Math.min(3, Number(it.tamanho ?? it.escala ?? it.scale ?? (type === "lago" ? lakeScale : 1)) || 1));
    const r = (c.size * scale) / 2;
    let behavior = BEHAVIORS.includes(norm(it.comportamento || it.behavior)) ? norm(it.comportamento || it.behavior) : c.behavior;
    if (behavior === "nadar" && !c.water && type !== "pato" && !lake && ground !== "agua") behavior = "passear";
    if (behavior === "orbitar" && !wanted.some((w) => w.type === "sol")) behavior = "girar";
    let x = Number(it.x), z = Number(it.z);
    const given = Number.isFinite(x) && Number.isFinite(z) && k === 0;
    if (given) { x = Math.max(-1, Math.min(1, x)) * (W / 2 - r); z = Math.max(-1, Math.min(1, z)) * (D / 2 - r); }
    else if (type === "lago" && lake) { x = lake.x; z = lake.z; }
    else if (c.centre && ground === "espaco") { x = 0; z = 0; }
    else {
      const inWater = (c.water || type === "pato") && lake && ground !== "agua";
      let best = null;
      for (let a = 0; a < 40; a++) {
        const a = random() * Math.PI * 2, far = Math.sqrt(random()) * Math.max(0, lake?.r - r * 0.7 || 0);
        const px = inWater ? lake.x + Math.cos(a) * far : (random() - 0.5) * (W - 2 * r);
        const pz = inWater ? lake.z + Math.sin(a) * far : (random() - 0.5) * (D - 2 * r);
        const clash = placed.reduce((m, p) => (p.air !== c.air ? m : Math.min(m, Math.hypot(p.x - px, p.z - pz) - p.r - r)), 1);
        const wet = !inWater && !c.air && lake && type !== "lago" ? Math.hypot(lake.x - px, lake.z - pz) - lake.r - r : 1;
        const clear = road && !c.air && behavior !== "rodar" && !inWater ? offRoad(px, pz) - r : 1;
        const score = Math.min(clash, wet, clear);
        if (!best || score > best.score) best = { x: px, z: pz, score };
        if (score > 0.01) break;
      }
      x = best.x; z = best.z;
    }
    placed.push({ x, z, r, air: c.air });
    const air = c.air ? (type === "nuvem" ? 0.22 : type === "sol" ? (ground === "espaco" ? 0.12 : 0.26) : type === "estrela" ? 0.1 + random() * 0.14 : type === "planeta" ? 0.1 : type === "balao" ? 0.16 : type === "lua" ? 0.18 : 0.12) : 0;
    const y = Number.isFinite(Number(it.y)) && k === 0 ? Math.max(0, Math.min(0.4, Number(it.y))) : air;
    const color = colorOf(it.cor || it.color) || (type === "planeta" ? ["#4dabf7", "#e8590c", "#fab005", "#82c91e", "#cc5de8", "#f783ac"][idx % 6] : c.color);
    return { id: `${type}-${idx}`, type, label: label || NAME[type] || type.charAt(0).toUpperCase() + type.slice(1), x: round(x), y: round(y), z: round(z), rot: round(Number(it.rot) || random() * Math.PI * 2), scale: round(scale), size: c.size, color, behavior, fixed: c.fixed, seed: idx + 1 };
  });
  return { title, ground, width: W, depth: D, items };
}
const round = (v) => Math.round(v * 1000) / 1000;
const NAME = { arvore: "Árvore", aviao: "Avião", balao: "Balão", caminhao: "Caminhão", helicoptero: "Helicóptero", leao: "Leão", onibus: "Ônibus", passaro: "Pássaro", predio: "Prédio", robo: "Robô", tubarao: "Tubarão", vulcao: "Vulcão", trator: "Trator", dinossauro: "Dinossauro", pinguim: "Pinguim" };

/** A change said while the scene is shown (sceneEdit), applied to the Aurora's spec. */
export function editScene(spec, edit) {
  const items = [...(spec.itens || spec.items || [])];
  if (edit.op === "add") for (const [tipo, qtd] of edit.things) items.push({ tipo, qtd });
  else for (const [tipo] of edit.things) for (let i = items.length - 1; i >= 0; i--) if (((CATALOG[norm(items[i].tipo)] && norm(items[i].tipo)) || typeOf(items[i].tipo || items[i].nome)) === tipo) items.splice(i, 1);
  return { ...spec, itens: items };
}

/** What the Aurora is asked (after the person's own words, so the conversation reads naturally). */
export const SCENE_MARK = "\n\n[Aurora XR]";
export const SCENE_PROMPT = `${SCENE_MARK} Monte isso como uma maquete 3D para o óculos. Responda com uma frase curta e um bloco \`\`\`cena com JSON: {"titulo":"…","chao":"${Object.keys(GROUNDS).join("|")}","itens":[{"tipo":"vaca","qtd":3,"x":-0.5,"z":0.2,"cor":"#hex","comportamento":"${BEHAVIORS.join("|")}","nome":"…"}]}. x e z vão de -1 a 1 e são opcionais. Tipos: ${TYPES.join(", ")}. Até 40 itens no total. Não use ferramentas.`;
/** The person's own words (the instruction added by the app is not shown back). */
export const ownWords = (text) => { const s = String(text || ""); const i = s.indexOf(SCENE_MARK.trim()); return i >= 0 ? s.slice(0, i).trim() : s; };
