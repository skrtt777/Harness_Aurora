// The object library in the browser: the catalog (assets/catalog.json, made by scripts/xr-assets) and
// its 3D models, each file loaded once (meshopt-compressed glTF) and cloned per use. An instance is
// normalized: standing on y = 0, centred on its footprint, its largest side = the size asked; an
// animated one (people, animals) carries its mixer and its actions by role (walk, run, idle, eat, swim).
import * as THREE from "../vendor/three.module.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { MeshoptDecoder } from "../vendor/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "../vendor/SkeletonUtils.js";
import { indexCatalog } from "../lib/compose.js";
import { model as procModel } from "./models.js";

const PROC_COLOR = { aviao: "#e9ecef", helicoptero: "#e8590c", balao: "#f03e3e", onibus: "#fab005", foguete: "#f1f3f5", farol: "#f8f9fa", vulcao: "#5c3d2e", sol: "#ffb703", pato: "#ffd43b", passaro: "#4dabf7", lago: "#3b82c4", objeto: "#b04bff" };

export class Assets {
  constructor(base = "assets/") {
    this.base = base; this.files = new Map(); this.poses = new Map(); this.catalog = null;
    this.loader = new GLTFLoader(); this.loader.setMeshoptDecoder(MeshoptDecoder);
  }
  /** The catalog, indexed (lib/compose.js indexCatalog); loaded once. */
  async load() {
    if (!this.catalog) this.catalog = fetch(`${this.base}catalog.json`).then((r) => { if (!r.ok) throw new Error(`catálogo ${r.status}`); return r.json(); }).then(indexCatalog);
    return this.catalog;
  }
  file(f) {
    if (!this.files.has(f)) this.files.set(f, this.loader.loadAsync(this.base + f).then(matte).catch((e) => { this.files.delete(f); throw e; }));
    return this.files.get(f);
  }
  /** Every file a layout needs, loaded in parallel; onProgress(done, total). */
  async preload(layout, onProgress) {
    const cat = await this.load(); const want = new Set();
    for (const t of [...layout.things, ...layout.decor, ...layout.fences]) { const v = cat.byId.get(t.type)?.v[t.v || 0]; if (v?.f) want.add(v.f); }
    let done = 0; const all = [...want];
    await Promise.all(all.map((f) => this.file(f).catch(() => null).then(() => onProgress?.(++done, all.length))));
  }
  /**
   * An animated model frozen in its resting pose as plain meshes (the skinning done once, here): a
   * crowd's extra animals and people cost what a statue costs, and are drawn in batches. Cached per file.
   */
  posed(f) {
    if (!this.poses.has(f)) this.poses.set(f, this.file(f).then((gltf) => {
      const probe = cloneSkinned(gltf.scene);
      const clip = gltf.animations.find((a) => /idle/i.test(a.name)) || gltf.animations[0];
      if (clip) { const mixer = new THREE.AnimationMixer(probe); mixer.clipAction(clip).play(); mixer.update(0.05); }
      probe.updateMatrixWorld(true);
      const out = new THREE.Group(); const v = new THREE.Vector3();
      probe.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone();
        if (o.isSkinnedMesh) {
          o.skeleton.update(); const pos = g.attributes.position;
          for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); o.applyBoneTransform(i, v); pos.setXYZ(i, v.x, v.y, v.z); }
          g.deleteAttribute("skinIndex"); g.deleteAttribute("skinWeight");
        }
        g.applyMatrix4(o.matrixWorld); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
        out.add(new THREE.Mesh(g, o.material));
      });
      const box = new THREE.Box3().setFromObject(out); const size = box.getSize(new THREE.Vector3()); const mid = box.getCenter(new THREE.Vector3());
      return { group: out, d: size.toArray(), c: [mid.x, box.min.y, mid.z] };
    }));
    return this.poses.get(f);
  }
  /**
   * An instance of a type's variant at a size (metres, largest side). still: an animated one frozen
   * in its resting pose (posed), without its animations.
   */
  async instance(typeId, vi = 0, size = 0.05, { still = false } = {}) {
    const cat = await this.load(); const t = cat.byId.get(typeId);
    const v = t?.v[Math.min(vi || 0, (t?.v.length || 1) - 1)];
    const wrap = new THREE.Group(); wrap.name = typeId;
    if (!v || v.proc) {
      const m = procModel(v?.proc || "objeto", PROC_COLOR[v?.proc] || "#b04bff");
      wrap.add(m); wrap.scale.setScalar(size); wrap.userData.height = (m.userData.height || 1) * size; wrap.userData.tick = m.userData.tick || null;
      return wrap;
    }
    const gltf = await this.file(v.f);
    if (still && gltf.animations.length) {
      const P = await this.posed(v.f); const inner = P.group.clone();
      inner.position.set(-P.c[0], -P.c[1], -P.c[2]); wrap.add(inner);
      const k = size / Math.max(...P.d, 1e-6); wrap.scale.setScalar(k); wrap.userData.height = P.d[1] * k; wrap.userData.posed = true;
      return wrap;
    }
    const animated = gltf.animations.length > 0;
    const inner = animated ? cloneSkinned(gltf.scene) : gltf.scene.clone(true);
    inner.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = !o.isSkinnedMesh; } });
    // Normalize: the build measured static models (d: size, c: centre x, floor y, centre z); an animated
    // one is measured here, posed by its skeleton (the armature's own scale is not in the build's numbers).
    let d = v.d, c = v.c || [0, 0, 0];
    if (animated || !(d && Math.max(...d) > 0)) {
      if (!v.measured) {
        const probe = animated ? cloneSkinned(gltf.scene) : gltf.scene.clone(true); probe.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(probe, true); const size = box.getSize(new THREE.Vector3()); const mid = box.getCenter(new THREE.Vector3());
        v.measured = { d: size.toArray(), c: [mid.x, box.min.y, mid.z] };
      }
      ({ d, c } = v.measured);
    }
    inner.position.set(-c[0], -c[1], -c[2]);
    wrap.add(inner);
    const k = size / Math.max(...d, 1e-6); wrap.scale.setScalar(k);
    wrap.userData.height = d[1] * k;
    if (animated) {
      const mixer = new THREE.AnimationMixer(inner); const actions = {};
      for (const [role, name] of Object.entries(v.a || {})) { const clip = gltf.animations.find((a) => a.name === name); if (clip) actions[role] = mixer.clipAction(clip); }
      if (!Object.keys(actions).length) actions.idle = mixer.clipAction(gltf.animations[0]);
      wrap.userData.anim = { mixer, actions, current: null };
      play(wrap, "idle");
      mixer.update(Math.random() * 2);       // not all in step
    }
    return wrap;
  }
  /**
   * Many copies of small things (grass, flowers, pebbles, fence pieces) as instanced meshes: one draw
   * per part, whatever the count. items: [{ type, v, x, y?, z, rot, size }].
   */
  async instanced(items) {
    const group = new THREE.Group(); group.name = "decor";
    const byModel = new Map();
    for (const it of items) { const key = `${it.type}|${it.v || 0}`; if (!byModel.has(key)) byModel.set(key, []); byModel.get(key).push(it); }
    for (const [key, list] of byModel) {
      const [type, vi] = key.split("|");
      const proto = await this.instance(type, Number(vi), 1).catch(() => null); if (!proto) continue;
      proto.updateMatrixWorld(true);
      const parts = []; proto.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) parts.push(o); });
      const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const up = new THREE.Vector3(0, 1, 0);
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((it, i) => { m.compose(new THREE.Vector3(it.x, it.y || 0, it.z), q.setFromAxisAngle(up, it.rot || 0), new THREE.Vector3().setScalar(it.size)).multiply(part.matrixWorld); im.setMatrixAt(i, m); });
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.raycast = () => {};
        group.add(im);
      }
    }
    return group;
  }
}

/**
 * The models' materials made matte (Lambert: the same colours and textures, far cheaper to shade on a
 * headset than physically based ones; the miniature's look is flat colour anyway). Once per file.
 */
function matte(gltf) {
  const done = new Map();
  const swap = (m) => {
    if (!m || m.isMeshLambertMaterial || m.isMeshBasicMaterial) return m;
    if (!done.has(m)) done.set(m, Object.assign(new THREE.MeshLambertMaterial({ color: m.color, map: m.map, emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity ?? 1, vertexColors: m.vertexColors, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, side: m.side }), { name: m.name }));
    return done.get(m);
  };
  gltf.scene.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material); });
  return gltf;
}

/** Plays a role's animation (fading from the one before); falls back to idle, then to whatever exists. */
export function play(obj, role) {
  const A = obj.userData.anim; if (!A) return;
  const next = A.actions[role] || (role === "run" && A.actions.walk) || (role === "swim" && (A.actions.walk || A.actions.idle)) || (role === "eat" && A.actions.idle) || A.actions.idle || Object.values(A.actions)[0];
  if (!next || next === A.current) return;
  next.reset().fadeIn(0.25).play(); A.current?.fadeOut(0.25); A.current = next;
}
