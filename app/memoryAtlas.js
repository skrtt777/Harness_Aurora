import { getDb } from "./db.js";
import { decodeEmbedding, resolveEmbeddingModel } from "./embeddings.js";
import { contentWords } from "./knowledge.js";

/**
 * The Atlas 3D as a map of meaning: memories that say similar things sit
 * close together (their embeddings, projected to 3D), fall into topic
 * clusters labelled by their most distinctive words, and carry what the
 * teaching loop measured about them — used, helped, failed — so the map
 * shows which memories actually help. Pure computation over the stored
 * vectors: no model call, cached until a memory changes.
 */

/** Stable 32-bit FNV-1a hash: deterministic seeds and jitter for the layout. */
export function hashString(value) {
  let h = 2166136261;
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const NEIGHBORS = 4;
const NEIGHBOR_MIN = 0.72;
/** A memory with no neighbour that close keeps its best match down to this (nomic-embed-text: p10 of best matches ≈ 0.72). */
const NEIGHBOR_FLOOR = 0.62;
const DUPLICATE_MIN = 0.95;
const SPREAD = 16;

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}
/**
 * A memory's fingerprint: the signs of the first SIG_BITS values of its real embedding (1 where the value is
 * positive), as hex. The Mapa Vivo's chip shows it as the memory's bits and its charge pattern.
 */
export const SIG_BITS = 192;
export function signature(vector, bits = SIG_BITS) {
  let hex = "";
  for (let i = 0; i < bits; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b += 1) if ((vector[i + b] ?? 0) > 0) nibble |= 8 >> b;
    hex += nibble.toString(16);
  }
  return hex;
}
/**
 * How alike two memories really are: the cosine of their stored embeddings (same model), or null when one of
 * them has none. The Mapa Vivo's chip compares two memories with it.
 */
export async function memorySimilarity(a, b, { env = process.env } = {}) {
  const db = await getDb();
  const model = resolveEmbeddingModel(env);
  const row = (id) => db.prepare("SELECT embedding, embedding_model FROM memories WHERE id = ?").get(id);
  const ra = row(a), rb = row(b);
  const va = ra?.embedding && ra.embedding_model === model ? decodeEmbedding(ra.embedding) : null;
  const vb = rb?.embedding && rb.embedding_model === model ? decodeEmbedding(rb.embedding) : null;
  if (!va?.length || !vb?.length || va.length !== vb.length) return { similarity: null, model };
  return { similarity: Math.round(dot(normalize(va), normalize(vb)) * 1000) / 1000, model };
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return s; };

/** Top principal components by power iteration with deflation (no covariance matrix). */
export function principalComponents(rows, count = 3, iterations = 60) {
  const n = rows.length;
  const dim = rows[0]?.length || 0;
  const mean = new Float64Array(dim);
  for (const r of rows) for (let i = 0; i < dim; i += 1) mean[i] += r[i] / n;
  const centered = rows.map((r) => Float64Array.from(r, (x, i) => x - mean[i]));
  const components = [];
  for (let c = 0; c < count; c += 1) {
    let v = Float64Array.from({ length: dim }, (_, i) => Math.sin((i + 1) * (c + 1.618)));
    for (let it = 0; it < iterations; it += 1) {
      const projected = centered.map((r) => dot(r, v));
      const next = new Float64Array(dim);
      centered.forEach((r, j) => { const p = projected[j]; for (let i = 0; i < dim; i += 1) next[i] += r[i] * p; });
      for (const prev of components) { const d = dot(next, prev); for (let i = 0; i < dim; i += 1) next[i] -= d * prev[i]; }
      let norm = 0; for (const x of next) norm += x * x; norm = Math.sqrt(norm) || 1;
      v = next.map((x) => x / norm);
    }
    components.push(v);
  }
  return centered.map((r) => components.map((comp) => dot(r, comp)));
}

/** Spherical k-means on unit vectors, k-means++ seeding from a fixed hash (deterministic). */
export function kmeans(vectors, k, iterations = 25) {
  if (vectors.length <= k) return vectors.map((_, i) => i);
  const centers = [vectors[hashString("aurora") % vectors.length]];
  while (centers.length < k) {
    const far = vectors.map((v) => 1 - Math.max(...centers.map((c) => dot(v, c))));
    const total = far.reduce((a, b) => a + b, 0) || 1;
    let pick = ((hashString(`seed-${centers.length}`) % 10000) / 10000) * total;
    let index = 0;
    for (; index < far.length - 1 && pick > far[index]; index += 1) pick -= far[index];
    centers.push(vectors[index]);
  }
  let assign = new Array(vectors.length).fill(0);
  for (let it = 0; it < iterations; it += 1) {
    const next = vectors.map((v) => { let best = 0, bestSim = -2; centers.forEach((c, i) => { const s = dot(v, c); if (s > bestSim) { bestSim = s; best = i; } }); return best; });
    const changed = next.some((a, i) => a !== assign[i]);
    assign = next;
    for (let c = 0; c < k; c += 1) {
      const members = vectors.filter((_, i) => assign[i] === c);
      if (!members.length) continue;
      const sum = new Float32Array(vectors[0].length);
      for (const m of members) for (let i = 0; i < sum.length; i += 1) sum[i] += m[i];
      centers[c] = normalize(sum);
    }
    if (!changed && it > 0) break;
  }
  return assign;
}

/** Two words that set this cluster apart from the rest (tf-idf over titles and tags). */
export function clusterLabels(docs, assign, k) {
  const df = new Map();
  const words = docs.map((d) => { const w = contentWords(d); for (const x of w) df.set(x, (df.get(x) || 0) + 1); return w; });
  // Biggest clusters pick first; a word already naming another cluster is skipped.
  const size = (c) => assign.filter((a) => a === c).length;
  const order = Array.from({ length: k }, (_, c) => c).sort((a, b) => size(b) - size(a));
  const used = new Set();
  const labels = new Array(k);
  for (const c of order) {
    const tf = new Map();
    words.forEach((w, i) => { if (assign[i] === c) for (const x of w) tf.set(x, (tf.get(x) || 0) + 1); });
    // Numbers ("2026") name nothing; a lone memory still gets its own words.
    const rank = (min) => [...tf].filter(([w, n]) => !used.has(w) && !/^\d+$/.test(w) && n >= min).map(([w, n]) => [w, n * Math.log((docs.length + 1) / (df.get(w) || 1))]).sort((a, b) => b[1] - a[1]);
    const scored = rank(2).length ? rank(2) : rank(1);
    const pick = scored.slice(0, 2).map(([w]) => w);
    pick.forEach((w) => used.add(w));
    labels[c] = pick.join(" · ") || `grupo ${c + 1}`;
  }
  return labels;
}

/** Push apart points closer than `min` (a few cheap rounds) so the map has no blobs. */
function relax(points, min = 1.6, rounds = 12) {
  for (let r = 0; r < rounds; r += 1) {
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const d = [0, 1, 2].map((a) => points[j][a] - points[i][a]);
        const dist = Math.hypot(...d) || 0.001;
        if (dist >= min) continue;
        const push = (min - dist) / 2 / dist;
        for (let a = 0; a < 3; a += 1) { points[i][a] -= d[a] * push; points[j][a] += d[a] * push; }
      }
    }
  }
  return points;
}

let cache = null;

export async function memoryAtlas({ env = process.env } = {}) {
  const db = await getDb();
  const model = resolveEmbeddingModel(env);
  const version = db.prepare("SELECT count(*) n, max(updated_at) u, sum(uses) s, sum(helped) h, sum(failed) f FROM memories").get();
  // The Zeladora's nodes (memoryNodes.js), when she has planted them: the sections are hers, not k-means'.
  const nodesRow = db.prepare("SELECT value, updated_at FROM settings WHERE key = 'memory_keeper_nodes'").get();
  let book = null;
  try { book = nodesRow ? JSON.parse(nodesRow.value) : null; } catch { book = null; }
  const key = `${model}|${version.n}|${version.u}|${version.s}|${version.h}|${version.f}|${nodesRow?.updated_at || ""}|${nodesRow?.value.length || 0}`;
  if (cache?.key === key) return cache.value;

  const rows = db.prepare("SELECT id, title, tags, embedding, embedding_model, uses, helped, failed, status FROM memories WHERE status != 'archived'").all();
  const embedded = [];
  const loose = [];
  for (const row of rows) {
    const vector = row.embedding && row.embedding_model === model ? decodeEmbedding(row.embedding) : null;
    (vector?.length ? embedded : loose).push({ row, vector: vector?.length ? normalize(vector) : null });
  }
  let assign, groups;
  if (book?.nodes?.length && embedded.length) {
    // Each memory in the node that holds it; one she has not adopted yet, in the node closest in meaning.
    const memberOf = new Map();
    for (const n of book.nodes) for (const id of n.members) memberOf.set(id, n.id);
    const centers = new Map();
    for (const [i, e] of embedded.entries()) {
      const c = memberOf.get(e.row.id); if (c === undefined) continue;
      let sum = centers.get(c); if (!sum) centers.set(c, (sum = new Float32Array(e.vector.length)));
      for (let d = 0; d < sum.length; d += 1) sum[d] += embedded[i].vector[d];
    }
    for (const [c, sum] of centers) centers.set(c, normalize(sum));
    assign = embedded.map((e) => {
      const own = memberOf.get(e.row.id);
      if (own !== undefined) return own;
      let best = book.nodes[0].id, bestSim = -2;
      for (const [c, center] of centers) { const s = dot(e.vector, center); if (s > bestSim) { bestSim = s; best = c; } }
      return best;
    });
    groups = book.nodes.map((n) => ({ id: n.id, label: n.label }));
  } else {
    const k = Math.max(1, Math.min(12, Math.round(Math.sqrt(embedded.length / 3))));
    assign = embedded.length ? kmeans(embedded.map((e) => e.vector), k) : [];
    const labels = embedded.length ? clusterLabels(embedded.map((e) => `${e.row.title} ${(JSON.parse(e.row.tags || "[]")).join(" ")}`), assign, k) : [];
    groups = labels.map((label, id) => ({ id, label }));
  }

  // 3D: principal components, each axis scaled to the same spread, then relaxed.
  let points = [];
  if (embedded.length >= 3) {
    const coords = principalComponents(embedded.map((e) => e.vector));
    const scale = [0, 1, 2].map((a) => { const values = coords.map((c) => c[a]); const mean = values.reduce((s, x) => s + x, 0) / values.length; const sd = Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length) || 1; return { mean, sd }; });
    // Weaker axes shrink by sqrt(sd/sd0): stretching them to the main axis's
    // spread would blow noise up and smear the clusters; keeping raw variance
    // would flatten the map onto one line.
    points = relax(coords.map((c) => c.map((x, a) => ((x - scale[a].mean) / Math.sqrt(scale[a].sd * scale[0].sd)) * SPREAD * (a === 1 ? 0.8 : 1))));
  } else {
    points = embedded.map((_, i) => [i * 4, 0, 0]);
  }
  // Without a vector (embeddings off, other model): an outer ring, clearly apart.
  const ringRadius = SPREAD * 3.2;
  const loosePoints = loose.map(({ row }, i) => { const angle = (i / Math.max(loose.length, 1)) * Math.PI * 2 + (hashString(row.id) % 100) / 400; return [Math.cos(angle) * ringRadius, ((hashString(`${row.id}y`) % 100) / 100 - 0.5) * 6, Math.sin(angle) * ringRadius]; });

  // Neighbours and duplicates: each memory against its own cluster and the clusters closest to it in meaning
  // (measured on the real data: a third of the best matches sat in another node), scaling to thousands.
  const neighbors = embedded.map(() => []);
  const centerOf = new Map();
  for (const { id: c } of groups) {
    const sum = new Float32Array(embedded[0]?.vector.length || 0);
    let n = 0;
    embedded.forEach((e, i) => { if (assign[i] === c) { n += 1; for (let d = 0; d < sum.length; d += 1) sum[d] += e.vector[d]; } });
    if (n) centerOf.set(c, normalize(sum));
  }
  const membersOf = new Map(groups.map(({ id: c }) => [c, embedded.map((_, i) => i).filter((i) => assign[i] === c)]));
  const near = embedded.length > 3000 ? 1 : 2;
  for (const { id: c } of groups) {
    const members = membersOf.get(c) || [];
    if (!members.length) continue;
    const others = [...centerOf].filter(([o]) => o !== c).map(([o, v]) => ({ o, s: dot(v, centerOf.get(c)) })).sort((a, b) => b.s - a.s).slice(0, near).map((x) => x.o);
    const pool = [...members, ...others.flatMap((o) => membersOf.get(o) || [])];
    for (const i of members) {
      const sims = pool.filter((j) => j !== i).map((j) => ({ j, s: dot(embedded[i].vector, embedded[j].vector) })).sort((a, b) => b.s - a.s);
      const close = sims.filter((x) => x.s >= NEIGHBOR_MIN);
      // Nobody that close: its single best match, when it is still a real kinship (≥ NEIGHBOR_FLOOR).
      const kept = close.length ? close.slice(0, NEIGHBORS) : sims.slice(0, 1).filter((x) => x.s >= NEIGHBOR_FLOOR);
      neighbors[i] = kept.map(({ j, s }) => ({ id: embedded[j].row.id, similarity: Math.round(s * 100) / 100, ...(assign[j] !== c ? { across: true } : {}) }));
    }
  }

  const round = (p) => p.map((x) => Math.round(x * 100) / 100);
  const memories = [
    ...embedded.map(({ row }, i) => ({
      id: row.id, position: round(points[i]), cluster: assign[i],
      neighbors: neighbors[i], sig: signature(embedded[i].vector),
      duplicates: neighbors[i].filter((n) => n.similarity >= DUPLICATE_MIN).map((n) => n.id),
      stats: { uses: row.uses || 0, helped: row.helped || 0, failed: row.failed || 0 },
    })),
    ...loose.map(({ row }, i) => ({ id: row.id, position: round(loosePoints[i]), cluster: -1, neighbors: [], duplicates: [], stats: { uses: row.uses || 0, helped: row.helped || 0, failed: row.failed || 0 } })),
  ];
  const clusters = groups.map(({ id: c, label }) => {
    const members = memories.filter((m) => m.cluster === c);
    const center = [0, 1, 2].map((a) => members.reduce((s, m) => s + m.position[a], 0) / (members.length || 1));
    return { id: c, label, count: members.length, center: round(center) };
  }).filter((c) => c.count > 0);
  if (loose.length) clusters.push({ id: -1, label: "sem embedding", count: loose.length, center: [0, 0, 0] });
  // nodes: the sections are the Zeladora's and stay put (the map may trust them across reloads).
  const value = { model, memories, clusters, nodes: Boolean(book?.nodes?.length && embedded.length) };
  cache = { key, value };
  return value;
}
