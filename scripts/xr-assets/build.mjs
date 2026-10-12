// Builds the Aurora XR object library: app/xr/assets/catalog.json (the types the Aurora knows, from
// library.mjs) and app/xr/assets/m/*.glb (each 3D variant, optimized: deduplicated, only the useful
// animations, quantized and meshopt-compressed; three.js reads them with MeshoptDecoder).
//   node scripts/xr-assets/build.mjs [--only id,id]
// Sources are downloaded once into a cache (XR_ASSETS_CACHE, default %LOCALAPPDATA%/aurora-xr-assets):
// the Kenney packs (kenney.nl, CC0) and Quaternius models (CC0) from poly.pizza.
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, resample, weld, quantize, reorder, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { TYPES } from "./library.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "app/xr/assets");
const CACHE = process.env.XR_ASSETS_CACHE || join(process.env.LOCALAPPDATA || process.env.HOME || ".", "aurora-xr-assets");
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131" };
const only = process.argv.includes("--only") ? new Set(process.argv[process.argv.indexOf("--only") + 1].split(",")) : null;
mkdirSync(join(OUT, "m"), { recursive: true }); mkdirSync(join(CACHE, "kenney"), { recursive: true }); mkdirSync(join(CACHE, "poly"), { recursive: true });

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO(fetch).registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

// ---- Sources ----
async function kenneyPack(pack) {
  const dir = join(CACHE, "kenney", pack);
  if (existsSync(dir)) return dir;
  const zip = join(CACHE, "kenney", `${pack}.zip`);
  if (!existsSync(zip)) {
    const page = await (await fetch(`https://kenney.nl/assets/${pack}`, { headers: UA })).text();
    const url = page.match(new RegExp(`https://kenney\\.nl/media/pages/assets/${pack}/[^'"]+\\.zip`))?.[0];
    if (!url) throw new Error(`Kenney: sem link para ${pack}`);
    writeFileSync(zip, Buffer.from(await (await fetch(url, { headers: UA })).arrayBuffer()));
  }
  mkdirSync(dir, { recursive: true });
  // Windows' own tar reads zip files; elsewhere, unzip.
  if (process.platform === "win32") execFileSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", dir]);
  else execFileSync("unzip", ["-qo", zip, "-d", dir]);
  return dir;
}
function findFile(dir, name) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (/isometric|fbx|obj/i.test(e)) continue; const f = findFile(p, name); if (f) return f; }
    else if (e === name) return p;
  }
  return null;
}
async function polyModel(key) {
  const file = join(CACHE, "poly", `${key}.glb`);
  if (existsSync(file)) return file;
  // Ids differ only by case from a listing (l / I): the cached file with the same name, any case.
  const fuzzy = (n) => n.toLowerCase().replace(/[il1|]/g, "l").replace(/[o0]/g, "o");
  const same = readdirSync(join(CACHE, "poly")).find((f) => fuzzy(f) === fuzzy(`${key}.glb`));
  if (same) return join(CACHE, "poly", same);
  const id = key.split("__")[1];
  for (let k = 0; k < 4; k++) {
    if (k) await new Promise((r) => setTimeout(r, 2500 * k));
    const page = await (await fetch(`https://poly.pizza/m/${id}`, { headers: UA })).text();
    const url = page.match(/https:\/\/static\.poly\.pizza\/[^"]+\.glb/)?.[0];
    const licence = page.match(/"licence":"([^"]+)"/)?.[1] || "";
    if (!url) continue;
    if (!/^CC0/.test(licence)) throw new Error(`${key}: licença ${licence}, não CC0`);
    writeFileSync(file, Buffer.from(await (await fetch(url, { headers: UA })).arrayBuffer()));
    return file;
  }
  throw new Error(`poly.pizza: sem arquivo para ${key}`);
}

// ---- Animations: the ones a scene uses, by role ----
const ROLES = [["walk", /(^|[|_ ])walk(ing)?($|[|_ ])/i], ["run", /(^|[|_ ])(run|gallop)($|[|_ ])/i], ["idle", /(^|[|_ ])idle($|[|_ ]|_2)/i], ["eat", /eat/i], ["swim", /swim/i], ["fly", /fly/i]];
function pickAnimations(doc) {
  const roles = {};
  const anims = doc.getRoot().listAnimations();
  for (const [role, re] of ROLES) {
    const hit = anims.filter((a) => re.test(a.getName()) && !/death|attack|hit|jump|bite|punch/i.test(a.getName()))
      .sort((a, b) => a.getName().length - b.getName().length)[0];
    if (hit && !Object.values(roles).includes(hit.getName())) roles[role] = hit.getName();
  }
  const keep = new Set(Object.values(roles));
  for (const a of anims) if (!keep.has(a.getName())) a.dispose();
  return roles;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
async function buildVariant(src) {
  if (src.startsWith("proc:")) return { proc: src.slice(5) };
  let file, name;
  if (src.startsWith("k:")) {
    const [pack, f] = src.slice(2).split("/");
    file = findFile(await kenneyPack(pack), `${f}.glb`);
    if (!file) throw new Error(`Kenney ${pack}: sem ${f}.glb`);
    name = `k-${slug(pack.replace(/-kit$/, ""))}-${slug(f)}`;
  } else {
    file = await polyModel(src.slice(2));
    name = `q-${slug(src.slice(2))}`;
  }
  const out = join(OUT, "m", `${name}.glb`);
  let doc = await io.read(file);
  const roles = pickAnimations(doc);
  // Textures: at most 256 px, WebP (a tree came with two 1 MB PNGs; the headset reads WebP).
  const small = [textureCompress({ encoder: sharp, targetFormat: "webp", resize: [256, 256] })];
  try {
    await doc.transform(prune(), dedup(), ...(Object.keys(roles).length ? [resample()] : []), ...small, weld(), reorder({ encoder: MeshoptEncoder }), quantize());
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    await io.write(out, doc);
  } catch {
    // A few models do not survive quantization: the same, uncompressed.
    doc = await io.read(file); pickAnimations(doc);
    await doc.transform(prune(), dedup(), ...small);
    await io.write(out, doc);
  }
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return { f: `m/${name}.glb`, d: [0, 1, 2].map((i) => r3(b.max[i] - b.min[i])), c: [r3((b.max[0] + b.min[0]) / 2), r3(b.min[1]), r3((b.max[2] + b.min[2]) / 2)], ...(Object.keys(roles).length ? { a: roles } : {}), kb: Math.round(statSync(out).size / 1024) };
}

const catalog = existsSync(join(OUT, "catalog.json")) ? JSON.parse(readFileSync(join(OUT, "catalog.json"), "utf8")) : { types: [] };
const old = new Map(catalog.types.map((t) => [t.id, t]));
const types = []; let errors = 0, total = 0;
for (const t of TYPES) {
  // Not rebuilt: the models already built, with the library's current words (descriptions, sizes...).
  if (only && !only.has(t.id)) { if (old.has(t.id)) { const { v, ...meta } = t; types.push({ ...meta, v: old.get(t.id).v }); } continue; }
  const variants = [];
  for (const src of t.v) {
    try { const v = await buildVariant(src); variants.push(v); total += v.kb || 0; }
    catch (e) { errors++; console.log(`  ${t.id}: ${src} -> ${e.message}`); }
  }
  if (!variants.length) { console.log(`SEM VARIANTES: ${t.id}`); continue; }
  const { v, ...meta } = t;
  types.push({ ...meta, v: variants });
  process.stdout.write(`${t.id}(${variants.length}) `);
}
writeFileSync(join(OUT, "catalog.json"), JSON.stringify({ version: 1, built: new Date().toISOString().slice(0, 10), types }));
writeFileSync(join(OUT, "CREDITS.md"), `# Modelos 3D do Aurora XR\n\nTodos em domínio público (CC0 1.0):\n\n- **Kenney** (kenney.nl): ${[...new Set(TYPES.flatMap((t) => t.v).filter((s) => s.startsWith("k:")).map((s) => s.slice(2).split("/")[0]))].sort().join(", ")}.\n- **Quaternius** (quaternius.com), obtidos em poly.pizza.\n\nGerados por \`scripts/xr-assets/build.mjs\` a partir de \`scripts/xr-assets/library.mjs\`.\n`);
console.log(`\n${types.length} tipos, ${types.reduce((n, t) => n + t.v.length, 0)} variantes, ${errors} erros, ${Math.round(total / 1024)} MB`);
