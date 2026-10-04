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
const DUPLICATE_MIN = 0.95;
const SPREAD = 16;

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
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
  const key = `${model}|${version.n}|${version.u}|${version.s}|${version.h}|${version.f}`;
  if (cache?.key === key) return cache.value;

  const rows = db.prepare("SELECT id, title, tags, embedding, embedding_model, uses, helped, failed, status FROM memories WHERE status != 'archived'").all();
  const embedded = [];
  const loose = [];
  for (const row of rows) {
    const vector = row.embedding && row.embedding_model === model ? decodeEmbedding(row.embedding) : null;
    (vector?.length ? embedded : loose).push({ row, vector: vector?.length ? normalize(vector) : null });
  }
  const k = Math.max(1, Math.min(12, Math.round(Math.sqrt(embedded.length / 3))));
  const assign = embedded.length ? kmeans(embedded.map((e) => e.vector), k) : [];
  const labels = embedded.length ? clusterLabels(embedded.map((e) => `${e.row.title} ${(JSON.parse(e.row.tags || "[]")).join(" ")}`), assign, k) : [];

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

  // Neighbours and duplicates, compared within each cluster (scales to thousands).
  const neighbors = embedded.map(() => []);
  for (let c = 0; c < k; c += 1) {
    const members = embedded.map((_, i) => i).filter((i) => assign[i] === c);
    for (const i of members) {
      const sims = members.filter((j) => j !== i).map((j) => ({ j, s: dot(embedded[i].vector, embedded[j].vector) })).filter((x) => x.s >= NEIGHBOR_MIN).sort((a, b) => b.s - a.s);
      neighbors[i] = sims.slice(0, NEIGHBORS).map(({ j, s }) => ({ id: embedded[j].row.id, similarity: Math.round(s * 100) / 100 }));
    }
  }

  const round = (p) => p.map((x) => Math.round(x * 100) / 100);
  const memories = [
    ...embedded.map(({ row }, i) => ({
      id: row.id, position: round(points[i]), cluster: assign[i],
      neighbors: neighbors[i],
      duplicates: neighbors[i].filter((n) => n.similarity >= DUPLICATE_MIN).map((n) => n.id),
      stats: { uses: row.uses || 0, helped: row.helped || 0, failed: row.failed || 0 },
    })),
    ...loose.map(({ row }, i) => ({ id: row.id, position: round(loosePoints[i]), cluster: -1, neighbors: [], duplicates: [], stats: { uses: row.uses || 0, helped: row.helped || 0, failed: row.failed || 0 } })),
  ];
  const clusters = labels.map((label, c) => {
    const members = memories.filter((m) => m.cluster === c);
    const center = [0, 1, 2].map((a) => members.reduce((s, m) => s + m.position[a], 0) / (members.length || 1));
    return { id: c, label, count: members.length, center: round(center) };
  });
  if (loose.length) clusters.push({ id: -1, label: "sem embedding", count: loose.length, center: [0, 0, 0] });
  const value = { model, memories, clusters };
  cache = { key, value };
  return value;
}
