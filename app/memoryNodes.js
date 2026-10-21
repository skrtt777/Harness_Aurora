// Os nódulos da memória: the sections of the Mapa Vivo (one "thought" each), owned by the Zeladora instead of
// being recomputed from scratch every time a memory comes or goes. The book of nodes is kept in the setting
// memory_keeper_nodes, and she tends it as the memory changes:
//   - plant: with no nodes yet, she plants the first ones from a semantic clustering of what exists;
//   - adopt: a new memory goes into the node whose centre means the closest thing;
//   - sprout (a new node is born): memories about something no node holds, alike among themselves, get a
//     node of their own; a lone one waits a few days for others like it, then goes to the closest node;
//   - split (a new node is born): a node grown too big for one thought splits in two along its own meaning,
//     the bigger part keeps the node, the other is a new node with its own name;
//   - fold (a node is gone): a node left with almost nothing (its memories archived as obsolete, compacted or
//     deleted) gives what is left to the nearest node and disappears; an empty one simply goes.
// Pure: no database, no events — memoryKeeper.js loads, saves and tells the map. Tested in test/memoryNodes.test.js.
import { clusterLabels, kmeans } from "./memoryAtlas.js";

export const NODE_MIN = 3;
export const MAX_NODES = 16;
// A node's edge: how far from its centre most of its own memories go (the 25th percentile of their similarity to it,
// a little looser). A memory farther than that from even the closest node is about something new. Relative on
// purpose: with a real embedding model, unrelated texts still reach ~0.75 against a node's centre.
const EDGE_QUANTILE = 0.25;
const EDGE_SLACK = 0.01;
const WAIT_MS = 7 * 86_400_000;
/** How many memories a node holds before it splits: grows with the memory (~2× the size of a typical node). */
export const splitSize = (total) => Math.max(16, Math.round(2 * Math.sqrt(3 * Math.max(1, total))));

const normalize = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return s; };
const docOf = (m) => { let tags = []; try { tags = JSON.parse(m.tags || "[]"); } catch { /* none */ } return `${m.title || ""} ${tags.join(" ")}`; };
function centroid(ids, byId) {
  let sum = null;
  for (const id of ids) { const v = byId.get(id)?.unit; if (!v) continue; sum ||= new Float32Array(v.length); for (let i = 0; i < v.length; i += 1) sum[i] += v[i]; }
  return sum ? normalize(sum) : null;
}
export const emptyBook = () => ({ next: 1, nodes: [] });

/**
 * One tending of the nodes over the active memories that have a vector ([{id, title, tags, vector}]).
 * Returns the new book and what happened, in order: {action: "plant"|"adopt"|"split"|"fold", ...}.
 */
export function tendNodes(memories, book = emptyBook(), { now = new Date().toISOString() } = {}) {
  const live = memories.filter((m) => m.vector?.length).map((m) => ({ ...m, unit: normalize(m.vector) }));
  const byId = new Map(live.map((m) => [m.id, m]));
  const events = [];
  let next = Math.max(1, book.next || 1);
  let nodes = (book.nodes || []).map((n) => ({ ...n, members: n.members.filter((id) => byId.has(id)) }));

  // ---- plant: the first nodes, from a clustering of what exists ----
  if (!nodes.length) {
    if (live.length < 2) return { book: { next, nodes: [] }, events };
    const k = Math.max(1, Math.min(12, Math.round(Math.sqrt(live.length / 3))));
    const assign = kmeans(live.map((m) => m.unit), k);
    const labels = clusterLabels(live.map(docOf), assign, k);
    for (let c = 0; c < k; c += 1) {
      const members = live.filter((_, i) => assign[i] === c).map((m) => m.id);
      if (members.length) nodes.push({ id: next++, label: labels[c], members, born: now, parent: null });
    }
    events.push({ action: "plant", nodes: nodes.map((n) => ({ node: n.id, label: n.label, members: n.members.length })) });
    return { book: { next, nodes }, events };
  }

  const centers = () => new Map(nodes.map((n) => [n.id, centroid(n.members, byId)]));
  const nearest = (unit, cs, except = null) => {
    let best = null, bestSim = -2;
    for (const n of nodes) { if (n.id === except) continue; const c = cs.get(n.id); if (!c) continue; const s = dot(unit, c); if (s > bestSim) { bestSim = s; best = n; } }
    return best ? { node: best, similarity: bestSim } : null;
  };

  // ---- fold: a node left with almost nothing gives it to the nearest one and goes ----
  for (let changed = true; changed && nodes.length > 1;) {
    changed = false;
    const small = [...nodes].filter((n) => n.members.length < NODE_MIN).sort((a, b) => a.members.length - b.members.length)[0];
    if (!small) break;
    const cs = centers();
    let into = null;
    if (small.members.length) {
      const c = cs.get(small.id);
      into = c ? nearest(c, cs, small.id)?.node : null;
      // No centre to compare (should not happen): the biggest node takes them.
      into ||= [...nodes].filter((n) => n.id !== small.id).sort((a, b) => b.members.length - a.members.length)[0];
      into.members.push(...small.members);
    }
    nodes = nodes.filter((n) => n.id !== small.id);
    events.push({ action: "fold", node: small.id, label: small.label, members: small.members.length, into: into?.id ?? null, intoLabel: into?.label ?? null });
    changed = true;
  }

  // ---- adopt: each memory no node holds goes to the closest one — unless it is about something new ----
  const held = new Set(nodes.flatMap((n) => n.members));
  const homeless = live.filter((m) => !held.has(m.id));
  if (homeless.length) {
    const cs = centers();
    const adopt = (m, near) => {
      near.node.members.push(m.id);
      events.push({ action: "adopt", id: m.id, title: m.title, node: near.node.id, label: near.node.label, similarity: Math.round(near.similarity * 1000) / 1000 });
    };
    const edge = new Map();
    for (const n of nodes) {
      const c = cs.get(n.id); if (!c) continue;
      const sims = n.members.map((id) => dot(byId.get(id).unit, c)).sort((a, b) => a - b);
      edge.set(n.id, sims[Math.floor(sims.length * EDGE_QUANTILE)] - EDGE_SLACK);
    }
    const strangers = [];
    for (const m of homeless) {
      const near = nearest(m.unit, cs);
      if (!near) continue;
      if (near.similarity >= (edge.get(near.node.id) ?? -1)) adopt(m, near); else strangers.push({ m, near });
    }
    // Memories about something no node holds, grouped among themselves (as the first nodes were planted): a
    // group whose members are each closer to the group's centre than to their closest node sprouts a new node.
    // (Measured on a real base: with 3-4 memories no embedding statistic tells a new subject from a known
    // subject's outskirts for sure; the worst case is a small node for a sub-subject, which is harmless.)
    const waiting = new Set(strangers);
    if (strangers.length >= NODE_MIN) {
      const k = Math.max(1, Math.round(Math.sqrt(strangers.length / 3)));
      const assign = kmeans(strangers.map((o) => o.m.unit), k);
      for (let c = 0; c < k && nodes.length < MAX_NODES; c += 1) {
        const group = strangers.filter((_, i) => assign[i] === c);
        if (group.length < NODE_MIN) continue;
        const centre = normalize(group.reduce((sum, o) => { for (let i = 0; i < sum.length; i += 1) sum[i] += o.m.unit[i]; return sum; }, new Float32Array(group[0].m.unit.length)));
        const kin = group.filter((o) => dot(o.m.unit, centre) >= o.near.similarity);
        if (kin.length < NODE_MIN) continue;
        for (const o of kin) waiting.delete(o);
        const [name] = clusterLabels(kin.map((o) => docOf(o.m)), kin.map(() => 0), 1);
        const taken = new Set(nodes.map((n) => n.label));
        const node = { id: next++, label: taken.has(name) ? `${name} · ${next - 1}` : name, members: kin.map((o) => o.m.id), born: now, parent: null };
        nodes.push(node);
        events.push({ action: "sprout", node: node.id, label: node.label, members: node.members.length });
      }
    }
    // A lone one waits a few days for others like it; then it goes to the closest node.
    for (const s of waiting) { const age = Date.parse(now) - Date.parse(s.m.created_at || ""); if (!(age < WAIT_MS)) adopt(s.m, s.near); }
  }

  // ---- split: a node too big for one thought becomes two (the new one is born with its own name) ----
  const limit = splitSize(live.length);
  for (let guard = 0; guard < MAX_NODES && nodes.length < MAX_NODES; guard += 1) {
    const big = [...nodes].filter((n) => n.members.length > limit && !n.unsplittable).sort((a, b) => b.members.length - a.members.length)[0];
    if (!big) break;
    const members = big.members.map((id) => byId.get(id));
    const assign = kmeans(members.map((m) => m.unit), 2);
    const parts = [0, 1].map((c) => members.filter((_, i) => assign[i] === c));
    const [keep, leave] = parts[0].length >= parts[1].length ? [0, 1] : [1, 0];
    if (parts[leave].length < Math.max(NODE_MIN + 1, Math.round(limit * 0.2))) { big.unsplittable = true; continue; }
    const labels = clusterLabels(members.map(docOf), assign, 2);
    const taken = new Set(nodes.map((n) => n.label));
    const label = taken.has(labels[leave]) ? `${labels[leave]} · ${next}` : labels[leave];
    big.members = parts[keep].map((m) => m.id);
    const born = { id: next++, label, members: parts[leave].map((m) => m.id), born: now, parent: big.id };
    nodes.push(born);
    events.push({ action: "split", node: born.id, label: born.label, members: born.members.length, parent: big.id, parentLabel: big.label, kept: big.members.length });
  }
  for (const n of nodes) delete n.unsplittable;
  return { book: { next, nodes }, events };
}

/** The node each memory is in, by id (for the atlas). */
export function nodeOfMemory(book) {
  const out = new Map();
  for (const n of book?.nodes || []) for (const id of n.members) out.set(id, n.id);
  return out;
}
