// Scenes made by the Aurora on request ("faz uma fazenda com vacas e um trator"). Only for Aurora XR
// (fun and imagination): the Power BI miniatures stay faithful to the data and never use this.
// - The request goes to the Aurora with the part of the object library that matters for it (each type
//   explained: lib/compose.js relevantTypes) and she answers with a ```cena block: zones and things.
// - The same request also makes a draft at once from its own words and a recipe of its theme, so
//   something appears while she thinks, and a reply without a valid block still gives a scene.
// - lib/compose.js lays either out on the plate. Pure (no three.js).
import { RING } from "./dynamics.js";

export const norm = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const words = (text) => norm(text).replace(/[^a-z0-9\- ]+/g, " ").split(/\s+/).filter(Boolean);
/** Plural to singular, enough for the library's words: "avioes" -> "aviao", "animais" -> "animal". */
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
/** A seeded random (the same request gives the same scene). */
export function rng(seed) {
  let h = 2166136261 >>> 0;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let x = h; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
export { RING };

const NUMBERS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, varios: 4, varias: 4, muitos: 8, muitas: 8, alguns: 3, algumas: 3 };
const SKIP = new Set(["com", "uma", "que", "dos", "das", "nos", "nas", "mais", "tem", "faz", "cria", "para", "pra", "uns", "umas", "bem", "muito", "muita", "cenario", "maquete", "aurora", "monta", "quero"]);
/**
 * The library's things named in a sentence, with how many: "3 vacas e um trator" -> [["vaca",3],["trator",1]].
 * resolve(word) -> type id or null (lib/compose.js resolveType with the catalog).
 */
export function mentioned(text, resolve) {
  const ws = words(text); const out = new Map();
  ws.forEach((w, i) => {
    if (w.length < 3 || SKIP.has(w)) return;
    const t = resolve(w) || resolve(singular(w)); if (!t) return;
    const count = (x) => (x == null ? null : /^\d+$/.test(x) ? Number(x) : NUMBERS[x] ?? null);
    let n = count(ws[i - 1]) ?? count(ws[i - 2]);
    if (n == null) n = w !== singular(w) ? 3 : 1;
    out.set(t, Math.max(out.get(t) || 0, Math.min(30, n)));
  });
  return [...out];
}

/** "cria uma fazenda", "faz um cenário de praia", "monta uma maquete do sistema solar". */
export function isSceneRequest(text) {
  const t = norm(text);
  if (/(power ?bi|operacao|\bdoca|\bcd\b|dashboard|relatorio)/.test(t)) return false;
  const verb = /\b(cria|crie|criar|faz|faca|fazer|monta|monte|montar|gera|gere|gerar|desenha|desenhe|constroi|construa|construir|quero|bota|me mostra|mostra|imagina|imagine)\b/.test(t);
  const noun = /\b(cenario|maquete|cena|mundo|diorama|miniatura|mini mundo)\b/.test(t);
  return (verb && noun) || /^(um |uma )?cenario (de|do|da|com)\b/.test(t);
}

/** While a scene is shown: "adiciona 3 vacas", "coloca um foguete", "tira os carros". */
export function sceneEdit(text, resolve) {
  const t = norm(text);
  const add = /^(aurora )?(adiciona|adicione|acrescenta|acrescente|coloca|coloque|poe|ponha|bota|bote|mais)\b/.test(t);
  const remove = /^(aurora )?(tira|tire|remove|remova|apaga|apague|sem)\b/.test(t);
  if (!add && !remove) return null;
  const things = mentioned(t.replace(/^(aurora )?\S+ /, ""), resolve);
  if (!things.length) return null;
  return { op: add ? "add" : "remove", things };
}
/** A change said while the scene is shown, applied to its spec (loose things are added; any are removed). */
export function editScene(spec, edit, resolve) {
  const S = JSON.parse(JSON.stringify(spec || {})); S.itens = S.itens || [];
  if (edit.op === "add") for (const [tipo, qtd] of edit.things) S.itens.push({ tipo, qtd });
  else {
    const gone = new Set(edit.things.map(([t]) => t));
    const keep = (it) => !gone.has(resolve(typeof it === "string" ? it : it?.tipo || it?.nome || ""));
    S.itens = S.itens.filter(keep);
    for (const zz of S.zonas || []) zz.itens = (zz.itens || []).filter(keep);
  }
  return S;
}

/** The ```cena block of a reply (or the first JSON object with zones or items), and the rest of the text. */
export function parseSceneReply(text) {
  // A reply that repeats the request (a small model, an echo) carries the instruction and its example:
  // that part is never the scene.
  let s = String(text || ""); const echo = s.indexOf(SCENE_MARK.trim()); if (echo >= 0) s = s.slice(0, echo);
  // A block, closed or not (a long answer can be cut in the middle by the model's limit).
  const fence = s.match(/```(?:cena|json|scene)?\s*([\s\S]*?)(?:```|$)/i);
  let raw = fence && /[{[]/.test(fence[1]) ? fence[1] : null;
  if (!raw) { const i = s.search(/\{\s*"(titulo|title|chao|ground|zonas|itens|items)"/); if (i >= 0) raw = balanced(s, i); }
  let spec = null;
  if (raw) {
    const cleaned = raw.trim().replace(/,\s*([}\]])/g, "$1").replace(/[“”]/g, '"');
    for (const attempt of [() => cleaned, () => balanced(cleaned, cleaned.indexOf("{")), () => closeCut(cleaned.slice(cleaned.indexOf("{")))]) {
      try { spec = JSON.parse(attempt() || ""); break; } catch { spec = null; }
    }
  }
  if (spec && !Array.isArray(spec.zonas) && !Array.isArray(spec.itens || spec.items)) spec = null;
  // The example of an instruction copied as it is ("…", "grama|areia|…") is not a scene either.
  if (spec && (/^\s*…?\s*$/.test(String(spec.titulo ?? spec.title ?? "x")) || String(spec.chao ?? "").includes("|") || /"[a-z]+\|[a-z]+/.test(JSON.stringify(spec)))) spec = null;
  const rest = (fence ? s.replace(fence[0], "") : raw ? s.replace(raw, "") : s).replace(/\n{3,}/g, "\n\n").trim();
  return { spec, rest };
}
/**
 * JSON cut in the middle ('{"zonas":[{"tipo":"cercado","itens":[{"tipo":"vaca","qtd":8},{"tipo":"cav'):
 * kept up to the last complete value and closed, so what she did write is used.
 */
export function closeCut(s) {
  const stack = []; let inStr = false; let best = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") { stack.pop(); best = { at: i + 1, close: stack.slice().reverse().join("") }; if (!stack.length) return s.slice(0, i + 1); }
  }
  return best ? (s.slice(0, best.at) + best.close).replace(/,\s*([}\]])/g, "$1") : null;
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

// ---------------- Recipes: what a scene of each kind has, laid out by zones ----------------
const z = (tipo, onde, itens, tam = "") => ({ tipo, onde, tam, itens: itens.map(([t, q]) => ({ tipo: t, qtd: q })) });
export const RECIPES = [
  { words: "fazenda sitio roca chacara curral rancho", titulo: "Fazenda", chao: "grama", estrada: "anel", zonas: [
    z("cercado", "esquerda", [["vaca", 5], ["touro", 1], ["cavalo", 2]], "g"), z("lavoura", "direita", [["milho", 1], ["trigo", 1], ["hortalica", 1]], "m"),
    z("livre", "centro", [["celeiro", 1], ["silo", 1], ["moinho", 1], ["feno", 5], ["fazendeiro", 2], ["galinheiro", 1], ["galinha", 6], ["pintinho", 4], ["cachorro", 1], ["poco", 1], ["carroca", 1]]),
    z("cercado", "frente", [["ovelha", 6], ["porco", 3]], "p"), z("lago", "", [["pato", 3], ["peixe", 4], ["vitoria_regia", 4], ["sapo", 2]], "p"), z("bosque", "fundo", [["arvore", 7], ["arvore_outono", 2]], "m")],
    itens: [["trator", 1], ["picape", 1], ["montanha", 2], ["nuvem", 3], ["passaro", 3]] },
  { words: "cidade bairro rua urbano centro transito metropole predios", titulo: "Cidade", chao: "asfalto", estrada: "grade", zonas: [
    z("quadra", "noroeste", [["arranha_ceu", 2], ["predio", 3]], "p"), z("quadra", "nordeste", [["predio", 4], ["mercado", 1]], "p"), z("quadra", "sudoeste", [["casa", 5], ["arvore", 3]], "p"),
    z("praca", "centro", [["praca_fonte", 1], ["banco", 4], ["poste", 4], ["pessoa", 6], ["cachorro", 1], ["arvore", 3]], "m"), z("quadra", "sudeste", [["sobrado", 3], ["executivo", 3]], "p"), z("estacionamento", "direita", [["carro", 6]], "p")],
    itens: [["carro", 7], ["taxi", 2], ["onibus", 1], ["viatura", 1], ["caminhao", 1], ["poste", 6], ["semaforo", 4], ["hidrante", 3], ["pessoa", 5], ["helicoptero", 1], ["nuvem", 2]] },
  { words: "praia mar litoral ilha oceano verao", titulo: "Praia", chao: "areia", zonas: [
    z("porto", "fundo", [["veleiro", 2], ["barco", 2], ["golfinho", 2], ["peixe", 5], ["boia", 3], ["cais", 1]], "g"),
    z("livre", "frente", [["banhista", 6], ["guarda_sol", 5], ["palmeira", 6], ["caranguejo", 3], ["barraca_comida", 2], ["cachorro", 1]], "g"), z("bosque", "direita", [["palmeira", 5], ["arbusto", 4]], "p")],
    itens: [["farol", 1], ["nuvem", 3], ["passaro", 4], ["sol", 1]] },
  { words: "espaco sistema solar galaxia universo cosmos planeta planetas", titulo: "Sistema solar", chao: "espaco", zonas: [], itens: [["sol", 1], ["planeta", 6], ["lua", 2], ["estrela", 12], ["nave", 3], ["disco_voador", 1]] },
  { words: "lua marte base espacial astronauta colonia", titulo: "Base em Marte", chao: "terra", estrada: "anel", zonas: [
    z("livre", "centro", [["cupula", 3], ["hangar", 1], ["antena", 2], ["painel_solar", 4], ["astronauta", 5], ["robo", 2], ["mesa_holografica", 1], ["computador", 2], ["conteiner_base", 4]], "g"), z("livre", "esquerda", [["foguete", 2], ["cratera", 3]], "p"), z("livre", "direita", [["meteoro", 5], ["cratera", 4]], "p")],
    itens: [["jipe_lunar", 3], ["nave", 2], ["planeta", 1], ["montanha", 2]] },
  { words: "dinossauro dinossauros jurassico pre-historico dino", titulo: "Parque dos dinossauros", chao: "grama", zonas: [
    z("bosque", "esquerda", [["palmeira", 6], ["samambaia", 8], ["arvore", 3]], "m"), z("livre", "centro", [["tiranossauro", 1], ["triceratops", 2], ["estegossauro", 1], ["velociraptor", 4]], "g"),
    z("lago", "direita", [["parassaurolofo", 2], ["peixe", 3]], "m"), z("livre", "frente", [["apatossauro", 1], ["pedra", 5]], "m")],
    itens: [["vulcao", 1], ["montanha", 1], ["nuvem", 2]] },
  { words: "floresta selva mata bosque natureza trilha", titulo: "Floresta", chao: "grama", zonas: [
    z("bosque", "esquerda", [["pinheiro", 8], ["arvore", 5], ["cervo", 2], ["raposa", 1]], "g"), z("bosque", "direita", [["arvore", 6], ["arvore_outono", 4], ["alce", 1], ["lobo", 2]], "g"),
    z("lago", "centro", [["peixe", 4], ["vitoria_regia", 5], ["sapo", 3], ["castor", 1], ["canoa", 1], ["ponte", 1]], "m"), z("acampamento", "frente", [["barraca", 3], ["fogueira", 1], ["aventureiro", 3]], "p")],
    itens: [["montanha", 3], ["passaro", 4], ["nuvem", 2]] },
  { words: "zoologico zoo safari savana africa", titulo: "Zoológico", chao: "terra", estrada: "anel", zonas: [
    z("cercado", "noroeste", [["leao", 2], ["arvore", 1]], "p"), z("cercado", "nordeste", [["girafa", 2], ["zebra", 3]], "m"), z("cercado", "sudoeste", [["elefante", 2]], "p"),
    z("cercado", "sudeste", [["panda", 2], ["bambu", 3]], "p"), z("lago", "centro", [["pinguim", 4], ["urso_polar", 1]], "p"), z("praca", "frente", [["pessoa", 8], ["barraca_comida", 2], ["banco", 3]], "p")],
    itens: [["macaco", 3], ["papagaio", 3], ["nuvem", 2]] },
  { words: "porto cais navio navios container conteiner logistica", titulo: "Porto", chao: "pedra", estrada: "anel", zonas: [
    z("porto", "fundo", [["navio", 2], ["cruzeiro", 1], ["barco", 3], ["boia", 3], ["cais", 2], ["baleia", 1]], "g"), z("livre", "frente", [["conteiner", 10], ["fabrica", 1], ["operario", 5], ["caixa", 10], ["barril", 6]], "g")],
    itens: [["caminhao", 3], ["van", 1], ["farol", 1], ["passaro", 4]] },
  { words: "inverno neve natal polo artico gelo frio", titulo: "Vila de inverno", chao: "neve", zonas: [
    z("bosque", "esquerda", [["pinheiro_neve", 9], ["alce", 1], ["lobo", 2]], "g"), z("livre", "centro", [["casa", 3], ["arvore_natal", 1], ["presente", 6], ["boneco_neve", 3], ["pessoa", 5], ["treno", 2], ["rena", 3], ["quebra_nozes", 2], ["boneco_gengibre", 3], ["bengala_doce", 4], ["lampiao", 3], ["monte_neve", 4]], "g"),
    z("lago", "direita", [["pinguim", 5], ["urso_polar", 1]], "m")],
    itens: [["montanha", 3], ["husky", 3], ["nuvem", 3]] },
  { words: "acampamento camping fogueira barraca", titulo: "Acampamento", chao: "grama", zonas: [
    z("acampamento", "centro", [["barraca", 4], ["fogueira", 1], ["aventureiro", 4], ["cachorro", 1], ["saco_dormir", 3], ["lenha", 2], ["ferramenta", 2], ["placa_caminho", 1]], "m"), z("bosque", "esquerda", [["pinheiro", 8], ["cervo", 1]], "g"),
    z("lago", "direita", [["canoa", 2], ["peixe", 4], ["cais", 1]], "m")],
    itens: [["montanha", 3], ["nuvem", 2], ["passaro", 3]] },
  { words: "castelo reino medieval princesa rei cavaleiro feudal", titulo: "Reino", chao: "grama", estrada: "anel", zonas: [
    z("livre", "fundo", [["castelo", 1], ["torre", 2], ["bandeira", 3]], "g"), z("quadra", "frente", [["casa_medieval", 5], ["estalagem", 1], ["ferreiro", 1]], "m"),
    z("feira", "esquerda", [["barraca_feira", 4], ["banca_frutas", 2], ["pessoa", 6], ["carroca", 2], ["lampiao", 3]], "p"), z("cercado", "direita", [["cavalo_branco", 2], ["cavalo", 2]], "p"), z("lago", "", [["moinho_agua", 1], ["pato", 3]], "p")],
    itens: [["rei", 1], ["soldado", 4], ["portao_castelo", 1], ["muralha", 2], ["bancada", 1], ["dragao", 1], ["catapulta", 2], ["torre_cerco", 1], ["poco", 1], ["nuvem", 2]] },
  { words: "parque praca jardim piquenique", titulo: "Parque", chao: "grama", zonas: [
    z("praca", "centro", [["coreto", 1], ["banco", 6], ["poste", 4], ["pessoa", 6], ["pessoa_cadeirante", 1]], "m"), z("lago", "direita", [["pato", 4], ["peixe", 3], ["salgueiro", 2], ["ponte", 1]], "m"),
    z("bosque", "esquerda", [["arvore", 6], ["arbusto_florido", 3], ["coelho", 3]], "m"), z("livre", "frente", [["flor", 12], ["cerca_viva", 4], ["floreira", 3], ["cachorro", 2], ["barraca_comida", 1], ["balao", 1]], "m")],
    itens: [["passaro", 4], ["nuvem", 2], ["abelha", 3]] },
  { words: "fundo mar aquario submarino recife", titulo: "Fundo do mar", chao: "agua", zonas: [
    z("livre", "centro", [["peixe", 14], ["tubarao", 2], ["arraia", 2], ["golfinho", 2], ["pedra", 8], ["bau", 1], ["navio_pirata", 1]], "g"), z("livre", "esquerda", [["baleia", 1], ["peixe", 6]], "m")], itens: [] },
  { words: "pirata piratas tesouro", titulo: "Ilha pirata", chao: "areia", zonas: [
    z("porto", "fundo", [["navio_pirata", 1], ["barco", 2], ["cais", 1], ["tubarao", 1]], "g"), z("livre", "frente", [["pirata", 4], ["bau", 2], ["barril", 5], ["canhao", 2], ["palmeira", 7], ["caranguejo", 3], ["fogueira", 1]], "g")],
    itens: [["papagaio", 3], ["nuvem", 2]] },
  { words: "cemiterio halloween terror assombrado fantasma", titulo: "Cemitério assombrado", chao: "terra", zonas: [
    z("cemiterio", "centro", [["lapide", 18], ["cripta", 2], ["esqueleto", 2], ["zumbi", 2]], "g"), z("bosque", "esquerda", [["arvore_retorcida", 4], ["arvore_outono", 2]], "p"), z("livre", "direita", [["abobora", 8], ["fantasma", 3], ["lampiao", 2]], "p")],
    itens: [["lua", 1]] },
  { words: "trem ferrovia estacao trilho ferroviaria", titulo: "Ferrovia", chao: "grama", zonas: [
    z("quadra", "centro", [["casa", 4], ["sobrado", 2]], "m"), z("bosque", "esquerda", [["pinheiro", 6]], "p"), z("lavoura", "direita", [["trigo", 1]], "p")],
    itens: [["trem", 1], ["vagao", 3], ["carro", 3], ["montanha", 2], ["nuvem", 2]] },
  { words: "ruinas ruina grecia grego roma romano antiguidade coliseu arena", titulo: "Ruínas antigas", chao: "terra", zonas: [
    z("livre", "centro", [["coluna", 8], ["estatua", 2], ["trofeu", 1], ["soldado", 3]], "g"), z("bosque", "esquerda", [["arvore_outono", 3], ["arbusto", 4], ["pedra", 6]], "m"), z("livre", "direita", [["coluna", 4], ["pedra", 5], ["cobra", 2]], "m")],
    itens: [["montanha", 2], ["passaro", 3], ["nuvem", 2], ["sol", 1]] },
  { words: "fortaleza forte muralha cerco batalha guerra", titulo: "Fortaleza", chao: "grama", estrada: "anel", zonas: [
    z("livre", "fundo", [["castelo", 1], ["torre", 3], ["muralha", 4], ["portao_castelo", 1], ["bandeira", 4]], "g"), z("livre", "frente", [["soldado", 6], ["catapulta", 2], ["torre_cerco", 2], ["fogueira", 1], ["barraca", 3]], "g"),
    z("cercado", "direita", [["cavalo", 3], ["cavalo_branco", 1]], "p"), z("bosque", "esquerda", [["pinheiro", 6]], "p")],
    itens: [["dragao", 1], ["nuvem", 2], ["montanha", 2]] },
  { words: "japao japones templo oriental", titulo: "Jardim japonês", chao: "grama", zonas: [
    z("lago", "centro", [["peixe", 6], ["vitoria_regia", 6], ["ponte", 1]], "m"), z("bosque", "esquerda", [["bambu", 6], ["arvore_outono", 3]], "m"), z("livre", "direita", [["torii", 2], ["igreja", 1], ["pessoa", 3], ["pedra", 6]], "m")],
    itens: [["montanha", 2], ["passaro", 3]] },
];

/** A scene from the request's own words: the recipe of its theme plus the things it counts. */
export function sceneFromPrompt(prompt, resolve) {
  const recipe = recipeFor(prompt);
  const asked = mentioned(prompt, resolve);
  const spec = recipe ? JSON.parse(JSON.stringify({ titulo: recipe.titulo, chao: recipe.chao, estrada: recipe.estrada, zonas: recipe.zonas, itens: recipe.itens.map(([tipo, qtd]) => ({ tipo, qtd })) })) : { titulo: "", chao: "grama", zonas: [], itens: [] };
  // What the person counts wins over the recipe ("fazenda com 10 vacas").
  const inRecipe = (id) => spec.zonas.flatMap((zz) => zz.itens).concat(spec.itens).filter((i) => (resolve(i.tipo) || i.tipo) === id);
  for (const [id, n] of asked) { const found = inRecipe(id); if (found.length) { found[0].qtd = n; for (const f of found.slice(1)) f.qtd = 0; } else spec.itens.push({ tipo: id, qtd: n }); }
  for (const zz of spec.zonas) zz.itens = zz.itens.filter((i) => i.qtd > 0);
  spec.itens = spec.itens.filter((i) => i.qtd > 0);
  if (!recipe && !asked.length) return sceneFromPrompt("parque", resolve);
  if (!spec.titulo) spec.titulo = asked.slice(0, 3).map(([id]) => id.replace(/_/g, " ")).join(", ").replace(/^./, (c) => c.toUpperCase());
  return spec;
}

/** What the Aurora is asked (after the person's own words, so the conversation reads naturally). */
export const SCENE_MARK = "\n\n[Aurora XR]";
export const ZONE_HELP = "cercado (pasto com cerca e porteira), lavoura (fileiras de plantação), bosque (mata densa), lago (água com margem; barcos e peixes dentro), porto (mar com cais), quadra (casas/prédios virados para a rua), praca (centro + bancos e postes em roda), feira (barracas em fileira), acampamento (barracas em volta da fogueira), estacionamento, cemiterio, livre";
/** A recipe as compact JSON (the reference shown to the Aurora for her theme). */
export function recipeJson(r) {
  if (!r) return "";
  const it = (l) => l.map((x) => (Array.isArray(x) ? { tipo: x[0], qtd: x[1] } : x));
  return JSON.stringify({ titulo: r.titulo, chao: r.chao, ...(r.estrada ? { estrada: r.estrada } : {}), zonas: r.zonas.map((zz) => ({ tipo: zz.tipo, ...(zz.onde ? { onde: zz.onde } : {}), ...(zz.tam ? { tam: zz.tam } : {}), itens: it(zz.itens) })), itens: it(r.itens) });
}
/**
 * The recipe closest to a request: the one whose theme words it uses most ("cidade medieval com
 * castelos" is the kingdom, two words, not the city, one), or null.
 */
export function recipeFor(prompt) {
  const t = ` ${words(prompt).map(singular).join(" ")} `;
  let best = null, most = 0;
  for (const r of RECIPES) {
    const n = r.words.split(" ").filter((w) => t.includes(` ${singular(w)} `)).length;
    if (n > most) { best = r; most = n; }
  }
  return best;
}
/**
 * The instruction for the Aurora: what a good miniature is (the rules a model maker follows), the
 * format, the library's types that matter for this request (types: [{ id, desc, tam }] from
 * lib/compose.js relevantTypes) and, when the theme has one, a good scene of it as a reference.
 * JSON first and on one line: a small model's answer has a length limit, and a cut JSON is lost.
 */
export function scenePrompt(types, reference = null) {
  const lib = types.map((t) => `${t.id} (${Math.round(t.tam * 100)} cm): ${t.desc}`).join("\n");
  return `${SCENE_MARK} Monte isso como uma maquete 3D bonita e que faça sentido, sobre uma base de 90 x 60 cm.
Responda PRIMEIRO com um bloco \`\`\`cena com o JSON numa linha só (sem espaços nem quebras), e DEPOIS uma frase curta (até 20 palavras) dizendo o que montou. Nada de descrição longa.
Regras de um bom maquetista:
- 4 a 7 zonas, cada uma com um assunto (pasto, plantação, mata, lago, quarteirão, praça...), com 3 a 10 itens que combinam com ela.
- qtd de 1 a 12 por item; 40 a 90 itens no total.
- Animais dentro de cercado, bosque ou lago; peixes, barcos e patos no lago ou porto; construções em quadra ou livre.
- Carros, ônibus, trens, nuvens, pássaros, sol, montanhas: só em "itens" (o motor põe na estrada, no céu e ao fundo, sem atravessar nada).
- Use só tipos da lista abaixo; não invente tipos.
Formato: {"titulo":"…","chao":"grama","estrada":"anel","zonas":[{"tipo":"cercado","onde":"esquerda","tam":"g","itens":[{"tipo":"…","qtd":6}]}],"itens":[{"tipo":"…","qtd":2}]}
chao: grama, areia, terra, neve, asfalto, pedra, agua, espaco ou lava. estrada: nenhuma, anel, grade (cidade) ou cruz. onde: esquerda, direita, fundo, frente, centro. tam: p, m ou g.
Zonas: ${ZONE_HELP}.${reference ? `
Exemplo de uma boa maquete deste tema (faça a sua, com o que a pessoa pediu): ${recipeJson(reference)}` : ""}
Tipos da biblioteca (id (tamanho): descrição):
${lib}
Não use ferramentas.`;
}
const PLACES = ["esquerda", "direita", "fundo", "frente", "centro"];
export const GROUND_IDS = ["grama", "areia", "terra", "neve", "asfalto", "pedra", "agua", "espaco", "lava"];
const ZONE_IDS = ["cercado", "lavoura", "bosque", "lago", "porto", "quadra", "praca", "feira", "acampamento", "estacionamento", "cemiterio", "livre"];
/**
 * The JSON schema a scene answer is held to (the local model can write nothing else): zones that exist,
 * only the library's types told for this request, counts a miniature holds, a short sentence to say.
 */
export function sceneSchema(typeIds) {
  const item = { type: "object", additionalProperties: false, required: ["tipo", "qtd"], properties: { tipo: { type: "string", enum: [...new Set(typeIds)] }, qtd: { type: "integer", minimum: 1, maximum: 12 } } };
  return {
    type: "object", additionalProperties: false, required: ["titulo", "chao", "estrada", "zonas", "itens", "frase"],
    properties: {
      titulo: { type: "string", minLength: 3, maxLength: 40 },
      chao: { type: "string", enum: GROUND_IDS },
      estrada: { type: "string", enum: ["nenhuma", "anel", "grade", "cruz"] },
      zonas: { type: "array", minItems: 3, maxItems: 7, items: { type: "object", additionalProperties: false, required: ["tipo", "onde", "tam", "itens"],
        properties: { tipo: { type: "string", enum: ZONE_IDS }, onde: { type: "string", enum: PLACES }, tam: { type: "string", enum: ["p", "m", "g"] }, itens: { type: "array", minItems: 2, maxItems: 8, items: item } } } },
      itens: { type: "array", minItems: 1, maxItems: 10, items: item },
      frase: { type: "string", minLength: 5, maxLength: 140 },
    },
  };
}
/** The instruction for the structured request: what a good miniature is, a reference, the library. */
export function sceneSystem(types, reference = null) {
  const lib = types.map((t) => `${t.id} (${Math.round(t.tam * 100)} cm): ${t.desc}`).join("\n");
  return `Você é a Aurora montando uma maquete 3D bonita e que faça sentido, numa base de 90 x 60 cm, para a pessoa ver no óculos de realidade virtual.
Pense como um maquetista: entenda o tema pedido e escolha os objetos que combinam com ele; atenda tudo o que a pessoa citou.
Regras:
- 4 a 6 zonas, cada uma com um assunto (pasto, plantação, mata, lago, quarteirão, praça, feira, acampamento...), com 3 a 8 tipos de itens que combinam com ela.
- Animais em cercado, bosque ou lago; peixes, barcos e patos em lago ou porto; casas, prédios e castelos em quadra ou livre.
- Veículos, nuvens, pássaros, sol, lua e montanhas vão em "itens" (o motor põe na estrada, no céu e ao fundo).
- Use estrada "anel" quando houver veículos; "grade" para cidade com quarteirões; "nenhuma" para natureza.
- "frase": uma frase curta e simpática dizendo o que você montou.
Zonas: ${ZONE_HELP}.${reference ? `
Exemplo de uma boa maquete de tema parecido (faça a sua, atendendo ao pedido): ${recipeJson(reference)}` : ""}
Objetos que você pode usar (id (tamanho): descrição):
${lib}`;
}

/** The person's own words (the instruction added by the app is not shown back). */
export const ownWords = (text) => { const s = String(text || ""); const i = s.indexOf(SCENE_MARK.trim()); return i >= 0 ? s.slice(0, i).trim() : s; };

const typesOf = (spec, resolve) => new Set([...(spec?.zonas || []).flatMap((zz) => zz.itens || []), ...(spec?.itens || spec?.items || [])].map((i) => resolve(typeof i === "string" ? i : i?.tipo || i?.nome || "")).filter(Boolean));
const count = (spec) => [...(spec?.zonas || []).flatMap((zz) => zz.itens || []), ...(spec?.itens || [])].reduce((n, i) => n + (Number(i?.qtd) || 1), 0);
/**
 * The Aurora's scene, checked against the request: what she used must be about it (the types she was
 * told for this request, or the draft's): a copied example or another subject keeps the draft. A thin
 * one gets the draft's zones it lacks.
 * told: ids of the types sent to her (relevantTypes); without it, the draft alone decides.
 */
export function mergeWithDraft(aurora, draft, resolve, told = null) {
  if (!aurora) return { spec: draft, used: false };
  const a = typesOf(aurora, resolve), d = typesOf(draft, resolve);
  const topic = new Set([...d, ...(told || [])]);
  // Most of what she used must be what the request is about (a farm for "a city" shares a tree and a
  // car, not most), and at least one thing of the draft's theme.
  const onTopic = [...a].filter((t) => topic.has(t)).length, shared = [...a].filter((t) => d.has(t)).length;
  if (!a.size || (d.size && ((shared === 0 && !told) || onTopic / a.size < (told ? 0.7 : 0.5)))) return { spec: draft, used: false };
  const spec = JSON.parse(JSON.stringify(aurora)); spec.zonas = spec.zonas || []; spec.itens = spec.itens || spec.items || [];
  if (count(spec) < 25) {
    const have = new Set(spec.zonas.map((zz) => zz.tipo));
    for (const zz of draft.zonas || []) if (!have.has(zz.tipo)) spec.zonas.push(zz);
    for (const it of draft.itens || []) if (!a.has(resolve(it.tipo))) spec.itens.push(it);
  }
  if (!spec.chao && draft.chao) spec.chao = draft.chao;
  if (!spec.estrada && draft.estrada) spec.estrada = draft.estrada;
  return { spec, used: true };
}
