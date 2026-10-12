// A scene composed by lib/compose.js, built in three.js with the object library (xr/assets.js): the
// plate in the colour of its ground (userData.grab: move, turn and scale it), the zones' surfaces
// (pasture, ploughed rows, pavement), the water with its shore, roads with their lane marks, rails with
// sleepers, fences, every thing (userData.dyn: its body for the life of the miniature, its path when
// it drives or swims) and the instanced detail (grass, flowers, pebbles).
// Light for a headset: what stands still is drawn in batches (one draw per model part for all its
// copies; its own model shows only while it is held, pushed or flying home: xr/stage.js), crops and
// furrows are instanced, and surfaces use a matte material that is cheap to shade.
import * as THREE from "../vendor/three.module.js";
import { pathLength } from "../lib/compose.js";
import { label } from "./twin3d.js";

const mats = new Map();
const mat = (color, extra = {}) => {
  const k = color + JSON.stringify(extra);
  if (!mats.has(k)) { const { roughness, metalness, ...lambert } = extra; mats.set(k, new THREE.MeshLambertMaterial({ color, ...lambert })); }
  return mats.get(k);
};
const noRay = (o) => { o.raycast = () => {}; return o; };

/** A flat ribbon along a polyline (roads, rails), at height y. */
function ribbon(points, closed, width, y, material) {
  const pts = closed ? [...points, points[0]] : points; const pos = []; const idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz * width / 2, nz = dx * width / 2;
    pos.push(pts[i][0] + nx, y, pts[i][1] + nz, pts[i][0] - nx, y, pts[i][1] - nz);
    if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return noRay(new THREE.Mesh(g, material));
}
function dashes(points, closed, y, color, dash = 0.012, gap = 0.01) {
  const pts = (closed ? [...points, points[0]] : points).map(([x, z]) => new THREE.Vector3(x, y, z));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color, dashSize: dash, gapSize: gap }));
  line.computeLineDistances(); return noRay(line);
}

/**
 * animBudget: how many people and animals move with their animations (spread over the kinds, so each
 * kind has some walking); the others stand in their resting pose, drawn in batches. A headset gets
 * fewer (xr/stage.js).
 */
export async function buildScene(L, assets, onProgress, { animBudget = 40 } = {}) {
  const root = new THREE.Group(); root.name = "scene";
  const W = L.width, D = L.depth;
  // The plate: the ground, a little thick, with the violet rim of the Aurora's miniatures.
  const extra = L.ground === "lava" ? { emissive: "#ff4500", emissiveIntensity: 0.18 } : L.ground === "agua" ? { roughness: 0.25, metalness: 0.1 } : {};
  const plate = new THREE.Mesh(new THREE.BoxGeometry(W, 0.014, D), mat(L.groundColor, extra));
  plate.position.y = -0.007; plate.userData.grab = true; root.add(plate); root.userData.plate = plate;
  const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, 0.014, D)), new THREE.LineBasicMaterial({ color: "#b04bff" }));
  rim.position.y = -0.007; root.add(noRay(rim));
  if (L.ground === "espaco") {
    const p = []; for (let i = 0; i < 260; i++) p.push((Math.random() - 0.5) * W, 0.02 + Math.random() * 0.34, (Math.random() - 0.5) * D);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    root.add(noRay(new THREE.Points(g, new THREE.PointsMaterial({ color: "#ffffff", size: 0.0028 }))));
  }
  // Zone surfaces; ploughed rows on crops.
  for (const p of L.patches) {
    const geo = p.shape === "ellipse" ? new THREE.CircleGeometry(0.5, 40).rotateX(-Math.PI / 2).scale(p.w, 1, p.d) : new THREE.PlaneGeometry(p.w, p.d).rotateX(-Math.PI / 2);
    const m = noRay(new THREE.Mesh(geo, mat(p.color))); m.position.set(p.x, 0.0006, p.z); root.add(m);
    if (p.rows) {
      const zs = []; for (let z = p.z - p.d / 2 + 0.008; z < p.z + p.d / 2; z += 0.015) zs.push(z);
      const rows = noRay(new THREE.InstancedMesh(new THREE.PlaneGeometry(p.w * 0.97, 0.006).rotateX(-Math.PI / 2), mat("#5c4128"), zs.length));
      zs.forEach((z, i) => rows.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, 0.0009, z))); root.add(rows);
    }
  }
  // Water: a sandy shore and the water a little below the plate's top, glossy.
  for (const e of L.water) {
    const shore = noRay(new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), mat("#cdb98a"))); shore.scale.set(e.rx * 1.07, 1, e.rz * 1.07); shore.position.set(e.x, 0.0008, e.z); root.add(shore);
    const water = noRay(new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#2f78b5", roughness: 0.15, metalness: 0.15, transparent: true, opacity: 0.92, emissive: "#0b2a4a", emissiveIntensity: 0.4 })));
    water.scale.set(e.rx, 1, e.rz); water.position.set(e.x, 0.0014, e.z); water.userData.water = true; root.add(water);
  }
  // Roads, dirt tracks and rails (the swimming loops are paths only, not drawn).
  for (const r of L.roads) {
    if (r.kind === "agua") continue;
    if (r.kind === "trilho") {
      root.add(ribbon(r.points, r.closed, r.width, 0.0012, mat("#7d6b5a")));
      const n = Math.round(pathLength(r.points, r.closed) / 0.012);
      const sleeper = new THREE.InstancedMesh(new THREE.BoxGeometry(r.width * 1.1, 0.002, 0.004), mat("#5a4030"), n); noRay(sleeper);
      const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const up = new THREE.Vector3(0, 1, 0);
      const pts = r.closed ? [...r.points, r.points[0]] : r.points; let k = 0; const total = pathLength(r.points, r.closed);
      for (let i = 0; i < n; i++) {
        let d = (i / n) * total, j = 0; while (j < pts.length - 2 && d > Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1])) { d -= Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]); j++; }
        const a = pts[j], b = pts[j + 1]; const L2 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const t = Math.min(1, d / L2);
        m.compose(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, 0.002, a[1] + (b[1] - a[1]) * t), q.setFromAxisAngle(up, Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2), new THREE.Vector3(1, 1, 1));
        sleeper.setMatrixAt(k++, m);
      }
      root.add(sleeper);
      for (const off of [-0.3, 0.3]) { const shifted = r.points.map((p, i, arr) => { const a = arr[(i - 1 + arr.length) % arr.length], b = arr[(i + 1) % arr.length]; const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [p[0] - dz / l * r.width * off, p[1] + dx / l * r.width * off]; }); root.add(ribbon(shifted, r.closed, 0.0016, 0.0035, mat("#c9ccd1", { metalness: 0.6, roughness: 0.4 }))); }
      continue;
    }
    const rua = r.kind === "rua";
    root.add(ribbon(r.points, r.closed, r.width, 0.0011, mat(rua ? "#2e3238" : "#8c6d4a")));
    if (rua) { root.add(ribbon(r.points, r.closed, r.width * 1.25, 0.0009, mat("#a9adb3"))); root.add(dashes(r.points, r.closed, 0.0016, "#f1f3f5")); }
  }
  // Things, fences and detail, from the library.
  await assets.preload(L, onProgress);
  const batches = new Map();          // "type|variant|part" -> { geometry, material, slots: [{ matrix, obj }] }
  const batch = (t, m, own) => {
    m.updateMatrixWorld(true); let n = 0;
    m.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh) return;
      const key = `${t.type}|${t.v || 0}|${m.userData.posed ? "p" : ""}|${n++}`; if (!batches.has(key)) batches.set(key, { geometry: o.geometry, material: o.material, slots: [] });
      batches.get(key).slots.push({ matrix: o.matrixWorld.clone(), obj: own ? m : null });
    });
  };
  const crops = L.things.filter((t) => t.crop);
  for (const t of crops) { const m = await assets.instance(t.type, t.v, t.size).catch(() => null); if (!m) continue; m.position.set(t.x, 0, t.z); m.rotation.y = t.rot || 0; batch(t, m, false); }
  // Who moves with animations: round the kinds (a cow, a horse, a sheep, then a second cow...), the
  // ones on a road or a swim loop first (they cross the scene), up to the budget.
  const cat = await assets.load(); const lives = new Set();
  const animal = L.things.filter((t) => !t.crop && cat.byId.get(t.type)?.v[t.v || 0]?.a);
  const kinds = new Map(); for (const t of animal.sort((a, b) => (b.path != null) - (a.path != null))) { if (!kinds.has(t.type)) kinds.set(t.type, []); kinds.get(t.type).push(t); }
  for (let round = 0; lives.size < animBudget && lives.size < animal.length; round++) for (const list of kinds.values()) if (list[round] && lives.size < animBudget) lives.add(list[round]);
  for (const t of L.things) {
    if (t.crop) continue;
    const resting = animal.includes(t) && !lives.has(t);
    const m = await assets.instance(t.type, t.v, t.size, { still: resting }).catch(() => null); if (!m) continue;
    const behavior = resting && t.path == null ? "parado" : t.behavior;
    m.position.set(t.x, t.y || 0, t.z); m.rotation.y = t.rot || 0;
    const info = { name: t.label, kind: t.type, scene: true };
    m.traverse((o) => { o.userData.entity = info; });
    const path = t.path != null ? L.roads[t.path] : null;
    m.userData.dyn = { radius: Math.max(0.006, t.size * (t.crop ? 0.3 : 0.38)), height: m.userData.height || t.size, behavior, seed: L.things.indexOf(t) + 1, fixed: t.fixed, label: t.label,
      roam: t.roam ?? null, path: path ? { pts: path.points, closed: path.closed, len: pathLength(path.points, path.closed), s: t.s || 0, speed: path.kind === "agua" ? 0.018 : path.kind === "trilho" ? 0.04 : 0.035 } : null, area: t.area || null };
    root.add(m);
    // Standing still and made of plain meshes: drawn with its batch until it is moved.
    const still = !m.userData.anim && !m.userData.tick && (behavior === "parado" || !behavior) && t.path == null && !t.y;
    if (still) { batch(t, m, true); m.userData.batched = []; m.children.forEach((c) => (c.visible = false)); }
  }
  for (const [, b] of batches) {
    const im = noRay(new THREE.InstancedMesh(b.geometry, b.material, b.slots.length));
    b.slots.forEach((sl, i) => { im.setMatrixAt(i, sl.matrix); if (sl.obj) sl.obj.userData.batched.push({ im, i, home: sl.matrix }); });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); root.add(im);
  }
  const fences = await assets.instanced(L.fences); root.add(fences);
  const decor = await assets.instanced(L.decor); root.add(decor);
  const title = label(L.title, { height: 0.03, bg: null }); title.position.set(0, 0.16, -D / 2 + 0.02); root.add(title);
  return root;
}
