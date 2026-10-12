// The things a scene can have, made of simple shapes (no files to download: it runs offline and light
// on the headset). Each model is about 1 unit at its largest side, stands on y = 0 and faces +z; the
// scene scales it to its size in metres. A model may move parts of its own (blades, rotor, wings, fire)
// through userData.tick(t).
import * as THREE from "../vendor/three.module.js";

const mats = new Map();
export const mat = (hex, extra = {}) => {
  const key = hex + JSON.stringify(extra);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7, metalness: 0.05, flatShading: true, ...extra }));
  return mats.get(key);
};
const glow = (hex, i = 1) => mat(hex, { emissive: hex, emissiveIntensity: i });
const shade = (hex, f) => { const c = new THREE.Color(hex); c.multiplyScalar(f); return `#${c.getHexString()}`; };

function put(g, geo, color, x = 0, y = 0, z = 0, m = null) {
  const mesh = new THREE.Mesh(geo, typeof color === "string" ? mat(color) : color);
  mesh.position.set(x, y, z); if (m) m(mesh); g.add(mesh); return mesh;
}
const B = (g, w, h, d, c, x, y, z, m) => put(g, new THREE.BoxGeometry(w, h, d), c, x, y, z, m);
const C = (g, rt, rb, h, c, x, y, z, seg = 12, m) => put(g, new THREE.CylinderGeometry(rt, rb, h, seg), c, x, y, z, m);
const S = (g, r, c, x, y, z, m) => put(g, new THREE.SphereGeometry(r, 14, 10), c, x, y, z, m);
const K = (g, r, h, c, x, y, z, seg = 12, m) => put(g, new THREE.ConeGeometry(r, h, seg), c, x, y, z, m);
const wheel = (g, r, w, x, y, z) => C(g, r, r, w, "#16181d", x, y, z, 12, (m) => { m.rotation.z = Math.PI / 2; });

function quadruped(o) {
  const g = new THREE.Group();
  const { len = 1, h = 0.45, w = 0.38, leg = 0.32, color, legColor = shade(color, 0.7), head = 0.2, neck = 0, neckUp = 0.15 } = o;
  const by = leg + h / 2;
  o.round ? S(g, 0.5, color, 0, by, 0, (m) => m.scale.set(w, h, len)) : B(g, w, h, len * 0.85, color, 0, by, 0);
  for (const [x, z] of [[-w / 3, len * 0.3], [w / 3, len * 0.3], [-w / 3, -len * 0.3], [w / 3, -len * 0.3]]) C(g, w * 0.13, w * 0.11, leg, legColor, x, leg / 2, z, 8);
  let hy = by + h * 0.35, hz = len * 0.48;
  if (neck) { C(g, w * 0.16, w * 0.2, neck, color, 0, by + neck / 2, len * 0.42, 8, (m) => { m.rotation.x = neckUp; }); hy = by + neck; hz = len * 0.42 + Math.sin(neckUp) * neck; }
  const headMesh = o.boxHead ? B(g, head * 0.9, head * 0.85, head * 1.2, o.headColor || color, 0, hy, hz) : S(g, head / 1.6, o.headColor || color, 0, hy, hz);
  if (o.ears) for (const x of [-1, 1]) K(g, head * 0.18, head * 0.4, o.headColor || color, x * head * 0.3, hy + head * 0.45, hz - head * 0.1, 6);
  if (o.tail) C(g, w * 0.05, w * 0.03, o.tail, color, 0, by + h * 0.1, -len * 0.5, 6, (m) => { m.rotation.x = -0.9; });
  return { g, by, h, hy, hz, head: headMesh };
}

function birdlike(color, beak = "#f59f00", extra) {
  const g = new THREE.Group();
  S(g, 0.32, color, 0, 0.42, 0, (m) => m.scale.set(1, 0.95, 1.25));
  S(g, 0.2, color, 0, 0.78, 0.25);
  K(g, 0.06, 0.18, beak, 0, 0.76, 0.5, 6, (m) => { m.rotation.x = Math.PI / 2; });
  for (const x of [-0.08, 0.08]) C(g, 0.025, 0.025, 0.2, beak, x, 0.1, 0, 6);
  extra?.(g);
  return g;
}

const BUILD = {
  arvore(c) { const g = new THREE.Group(); C(g, 0.06, 0.09, 0.45, "#7b4a2a", 0, 0.22, 0, 8); S(g, 0.32, c, 0, 0.62, 0); S(g, 0.22, shade(c, 1.15), 0.14, 0.78, 0.06); return g; },
  pinheiro(c) { const g = new THREE.Group(); C(g, 0.05, 0.07, 0.25, "#6b4226", 0, 0.12, 0, 8); K(g, 0.32, 0.45, c, 0, 0.42, 0, 9); K(g, 0.25, 0.38, shade(c, 1.1), 0, 0.64, 0, 9); K(g, 0.16, 0.3, shade(c, 1.2), 0, 0.85, 0, 9); return g; },
  palmeira(c) {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) C(g, 0.045, 0.055, 0.16, "#9c6b3c", Math.sin(i * 0.25) * 0.08, 0.08 + i * 0.15, 0, 7, (m) => { m.rotation.z = -0.12; });
    for (let i = 0; i < 6; i++) B(g, 0.08, 0.02, 0.5, c, 0.1, 0.9, 0, (m) => { m.rotation.y = (i / 6) * Math.PI * 2; m.rotation.x = 0.35; m.translateZ(0.22); });
    return g;
  },
  arbusto(c) { const g = new THREE.Group(); S(g, 0.35, c, 0, 0.3, 0); S(g, 0.28, shade(c, 1.15), 0.25, 0.25, 0.1); S(g, 0.25, shade(c, 0.9), -0.25, 0.22, -0.05); return g; },
  flor(c) { const g = new THREE.Group(); C(g, 0.03, 0.03, 0.6, "#2f9e44", 0, 0.3, 0, 6); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; S(g, 0.13, c, Math.cos(a) * 0.14, 0.66, Math.sin(a) * 0.14); } S(g, 0.1, "#ffd43b", 0, 0.67, 0); return g; },
  cogumelo(c) { const g = new THREE.Group(); C(g, 0.15, 0.2, 0.45, "#f8f0e3", 0, 0.22, 0); put(g, new THREE.SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), c, 0, 0.42, 0); for (const [x, z] of [[0.15, 0.2], [-0.2, 0.05], [0.05, -0.25]]) S(g, 0.06, "#ffffff", x, 0.72, z); return g; },
  pedra(c) { const g = new THREE.Group(); put(g, new THREE.DodecahedronGeometry(0.45), c, 0, 0.3, 0, (m) => m.scale.set(1, 0.65, 0.85)); return g; },
  montanha(c) { const g = new THREE.Group(); K(g, 0.5, 0.75, c, 0, 0.375, 0, 7); K(g, 0.17, 0.25, "#f8f9fa", 0, 0.63, 0, 7); K(g, 0.3, 0.45, shade(c, 0.85), 0.32, 0.22, 0.12, 7); return g; },
  vulcao(c) {
    const g = new THREE.Group(); C(g, 0.16, 0.5, 0.6, c, 0, 0.3, 0, 10); const lava = C(g, 0.15, 0.15, 0.03, glow("#ff6b00", 1.4), 0, 0.6, 0, 10);
    const smoke = [0, 1, 2].map((i) => S(g, 0.08 + i * 0.03, "#5c5f66", 0, 0.7 + i * 0.12, 0));
    g.userData.tick = (t) => { lava.material.emissiveIntensity = 1.1 + 0.4 * Math.sin(t * 3); smoke.forEach((s, i) => { s.position.y = 0.68 + ((t * 0.08 + i * 0.12) % 0.4); s.scale.setScalar(0.6 + ((t * 0.2 + i * 0.3) % 1)); }); };
    return g;
  },
  lago(c) { const g = new THREE.Group(); C(g, 0.5, 0.5, 0.02, mat(c, { transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.2 }), 0, 0.01, 0, 28); C(g, 0.52, 0.52, 0.012, "#c2b280", 0, 0.004, 0, 28); return g; },
  fogueira() {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) C(g, 0.05, 0.05, 0.7, "#6b4226", 0, 0.06, 0, 6, (m) => { m.rotation.z = Math.PI / 2; m.rotation.y = (i / 4) * Math.PI; });
    const f1 = K(g, 0.2, 0.55, glow("#ff922b", 1.5), 0, 0.35, 0, 7); const f2 = K(g, 0.12, 0.4, glow("#ffe066", 1.6), 0, 0.3, 0, 7);
    g.userData.tick = (t) => { f1.scale.y = 0.85 + 0.25 * Math.sin(t * 9); f2.scale.y = 0.85 + 0.3 * Math.sin(t * 11 + 1); f1.rotation.y = t * 2; };
    return g;
  },
  barraca(c) { const g = new THREE.Group(); K(g, 0.5, 0.6, c, 0, 0.3, 0, 4, (m) => { m.rotation.y = Math.PI / 4; }); B(g, 0.2, 0.3, 0.02, "#3b2a1a", 0, 0.15, 0.33); return g; },
  cerca(c) { const g = new THREE.Group(); for (const x of [-0.45, -0.15, 0.15, 0.45]) B(g, 0.06, 0.4, 0.06, c, x, 0.2, 0); for (const y of [0.15, 0.3]) B(g, 1, 0.05, 0.03, c, 0, y, 0); return g; },
  poste(c) { const g = new THREE.Group(); C(g, 0.03, 0.04, 0.95, c, 0, 0.475, 0, 8); B(g, 0.25, 0.03, 0.05, c, 0.1, 0.95, 0); S(g, 0.07, glow("#fff3bf", 1.2), 0.2, 0.9, 0); return g; },
  banco(c) { const g = new THREE.Group(); B(g, 1, 0.06, 0.35, c, 0, 0.35, 0); B(g, 1, 0.3, 0.05, c, 0, 0.55, -0.16); for (const x of [-0.4, 0.4]) B(g, 0.06, 0.35, 0.3, "#495057", x, 0.17, 0); return g; },
  casa(c) {
    const g = new THREE.Group(); B(g, 0.8, 0.5, 0.7, c, 0, 0.25, 0);
    K(g, 0.65, 0.4, "#c0392b", 0, 0.7, 0, 4, (m) => { m.rotation.y = Math.PI / 4; m.scale.set(1.05, 1, 0.92); });
    B(g, 0.16, 0.28, 0.02, "#6b4226", 0, 0.14, 0.36); for (const x of [-0.25, 0.25]) B(g, 0.14, 0.14, 0.02, glow("#fff3bf", 0.5), x, 0.32, 0.36); return g;
  },
  predio(c) {
    const g = new THREE.Group(); B(g, 0.42, 1, 0.42, c, 0, 0.5, 0);
    for (let y = 0; y < 8; y++) for (const x of [-0.12, 0, 0.12]) B(g, 0.07, 0.06, 0.01, glow(y % 3 === (x > 0 ? 1 : 0) ? "#ffe8a3" : "#334155", 0.6), x, 0.1 + y * 0.11, 0.215);
    B(g, 0.3, 0.05, 0.3, shade(c, 0.8), 0, 1.02, 0); return g;
  },
  celeiro(c) {
    const g = new THREE.Group(); B(g, 0.9, 0.55, 0.7, c, 0, 0.275, 0);
    put(g, new THREE.CylinderGeometry(0.46, 0.46, 0.7, 3, 1), shade(c, 0.75), 0, 0.62, 0, (m) => { m.rotation.x = Math.PI / 2; m.rotation.z = Math.PI / 2; m.scale.set(1, 1, 0.55); });
    B(g, 0.32, 0.36, 0.02, "#f8f9fa", 0, 0.18, 0.36); B(g, 0.3, 0.03, 0.025, "#f8f9fa", 0, 0.18, 0.37, (m) => { m.rotation.z = 0.85; }); return g;
  },
  castelo(c) {
    const g = new THREE.Group(); B(g, 0.8, 0.4, 0.8, c, 0, 0.2, 0);
    for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) { C(g, 0.11, 0.12, 0.6, shade(c, 0.95), x, 0.3, z, 10); K(g, 0.14, 0.25, "#5c3d99", x, 0.72, z, 10); }
    C(g, 0.16, 0.18, 0.8, c, 0, 0.4, 0, 10); K(g, 0.2, 0.3, "#5c3d99", 0, 0.95, 0, 10); B(g, 0.2, 0.25, 0.02, "#3b2a1a", 0, 0.12, 0.41); return g;
  },
  torre(c) { const g = new THREE.Group(); C(g, 0.2, 0.24, 0.85, c, 0, 0.425, 0, 10); K(g, 0.26, 0.3, "#7d3c98", 0, 1, 0, 10); B(g, 0.1, 0.14, 0.02, glow("#ffe8a3", 0.6), 0, 0.65, 0.21); return g; },
  moinho(c) {
    const g = new THREE.Group(); C(g, 0.16, 0.28, 0.8, c, 0, 0.4, 0, 8); K(g, 0.2, 0.2, "#c0392b", 0, 0.9, 0, 8);
    const hub = new THREE.Group(); hub.position.set(0, 0.75, 0.22); g.add(hub);
    for (let i = 0; i < 4; i++) B(hub, 0.08, 0.5, 0.02, "#f1f3f5", 0, 0, 0, (m) => { m.rotation.z = (i / 4) * Math.PI * 2; m.translateY(0.25); });
    g.userData.tick = (t) => { hub.rotation.z = t * 1.4; }; return g;
  },
  farol(c) {
    const g = new THREE.Group(); for (let i = 0; i < 4; i++) C(g, 0.15 - i * 0.012, 0.16 - i * 0.012, 0.22, i % 2 ? "#e03131" : c, 0, 0.11 + i * 0.22, 0, 12);
    const lamp = S(g, 0.1, glow("#fff3bf", 1.5), 0, 0.98, 0); K(g, 0.14, 0.12, "#343a40", 0, 1.09, 0, 12);
    const beam = put(g, new THREE.ConeGeometry(0.08, 0.6, 8, 1, true), new THREE.MeshBasicMaterial({ color: "#fff3bf", transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }), 0, 0.98, 0, (m) => { m.geometry.translate(0, -0.3, 0); m.rotation.z = Math.PI / 2; });
    g.userData.tick = (t) => { beam.rotation.y = t * 1.2; lamp.material.emissiveIntensity = 1.2 + 0.3 * Math.sin(t * 2.4); }; return g;
  },
  ponte(c) { const g = new THREE.Group(); B(g, 0.25, 0.04, 1, c, 0, 0.22, 0); for (const z of [-0.35, 0.35]) B(g, 0.22, 0.22, 0.06, shade(c, 0.8), 0, 0.11, z); for (const x of [-0.12, 0.12]) B(g, 0.02, 0.08, 1, c, x, 0.28, 0); return g; },
  carro(c) {
    const g = new THREE.Group(); B(g, 0.45, 0.2, 1, c, 0, 0.2, 0); B(g, 0.4, 0.17, 0.5, shade(c, 0.85), 0, 0.38, -0.05);
    B(g, 0.36, 0.12, 0.01, "#223", 0, 0.38, 0.2); for (const z of [-0.32, 0.32]) for (const x of [-0.22, 0.22]) wheel(g, 0.1, 0.06, x, 0.1, z);
    for (const x of [-0.15, 0.15]) B(g, 0.08, 0.05, 0.01, glow("#fff3bf", 0.8), x, 0.22, 0.5); return g;
  },
  caminhao(c) {
    const g = new THREE.Group(); B(g, 0.4, 0.45, 0.68, c, 0, 0.31, -0.14); B(g, 0.38, 0.35, 0.25, "#e8edf5", 0, 0.26, 0.36); B(g, 0.3, 0.12, 0.01, "#223", 0, 0.33, 0.49);
    for (const z of [-0.36, 0, 0.36]) for (const x of [-0.2, 0.2]) wheel(g, 0.08, 0.06, x, 0.08, z); return g;
  },
  onibus(c) {
    const g = new THREE.Group(); B(g, 0.32, 0.36, 1, c, 0, 0.24, 0);
    for (let i = 0; i < 6; i++) for (const x of [-0.161, 0.161]) B(g, 0.01, 0.1, 0.11, "#223", x, 0.32, -0.38 + i * 0.14);
    B(g, 0.26, 0.14, 0.01, "#223", 0, 0.32, 0.5); for (const z of [-0.33, 0.33]) for (const x of [-0.16, 0.16]) wheel(g, 0.07, 0.05, x, 0.07, z); return g;
  },
  trator(c) {
    const g = new THREE.Group(); B(g, 0.4, 0.3, 0.7, c, 0, 0.35, 0.05); B(g, 0.36, 0.35, 0.3, shade(c, 0.85), 0, 0.65, -0.12); C(g, 0.03, 0.03, 0.3, "#343a40", 0.1, 0.6, 0.3, 6);
    for (const x of [-0.24, 0.24]) { wheel(g, 0.25, 0.12, x, 0.25, -0.18); wheel(g, 0.14, 0.09, x, 0.14, 0.3); } return g;
  },
  trem(c) {
    const g = new THREE.Group(); B(g, 0.2, 0.22, 0.32, c, 0, 0.16, 0.32); C(g, 0.09, 0.09, 0.2, "#343a40", 0, 0.16, 0.42, 10, (m) => { m.rotation.x = Math.PI / 2; }); C(g, 0.03, 0.04, 0.1, "#343a40", 0, 0.32, 0.45, 8);
    for (const [z, col] of [[-0.02, "#1c7ed6"], [-0.36, "#2f9e44"]]) B(g, 0.2, 0.2, 0.3, col, 0, 0.15, z);
    for (const z of [0.42, 0.22, 0.05, -0.1, -0.28, -0.44]) for (const x of [-0.1, 0.1]) wheel(g, 0.045, 0.03, x, 0.045, z); return g;
  },
  barco(c) {
    const g = new THREE.Group(); put(g, new THREE.CylinderGeometry(0.22, 0.12, 0.2, 4, 1), c, 0, 0.12, 0, (m) => { m.rotation.y = Math.PI / 4; m.scale.set(1, 1, 2.5); });
    B(g, 0.2, 0.18, 0.3, "#1c7ed6", 0, 0.3, -0.08); C(g, 0.015, 0.015, 0.6, "#6b4226", 0, 0.5, 0.12, 6); put(g, new THREE.ConeGeometry(0.2, 0.45, 3), "#f8f9fa", 0, 0.52, 0.2, (m) => { m.scale.set(0.1, 1, 1); }); return g;
  },
  aviao(c) {
    const g = new THREE.Group(); C(g, 0.08, 0.06, 0.95, c, 0, 0.12, 0, 12, (m) => { m.rotation.x = Math.PI / 2; }); K(g, 0.08, 0.15, c, 0, 0.12, 0.55, 12, (m) => { m.rotation.x = Math.PI / 2; });
    B(g, 1, 0.02, 0.2, shade(c, 0.9), 0, 0.12, 0.05); B(g, 0.35, 0.02, 0.1, shade(c, 0.9), 0, 0.14, -0.42); B(g, 0.02, 0.18, 0.12, "#e03131", 0, 0.22, -0.42); return g;
  },
  helicoptero(c) {
    const g = new THREE.Group(); S(g, 0.22, c, 0, 0.25, 0.1, (m) => m.scale.set(0.9, 0.9, 1.3)); B(g, 0.06, 0.06, 0.5, c, 0, 0.3, -0.3); B(g, 0.02, 0.14, 0.1, c, 0, 0.36, -0.55);
    S(g, 0.12, "#223", 0, 0.3, 0.3, (m) => m.scale.set(0.9, 0.7, 0.5)); for (const x of [-0.14, 0.14]) B(g, 0.02, 0.02, 0.5, "#495057", x, 0.04, 0.08);
    const rotor = new THREE.Group(); rotor.position.set(0, 0.5, 0.08); g.add(rotor); B(rotor, 1, 0.01, 0.05, "#343a40"); B(rotor, 0.05, 0.01, 1, "#343a40");
    g.userData.tick = (t) => { rotor.rotation.y = t * 18; }; return g;
  },
  foguete(c) {
    const g = new THREE.Group(); C(g, 0.13, 0.13, 0.65, c, 0, 0.42, 0, 14); K(g, 0.13, 0.28, "#e03131", 0, 0.88, 0, 14); S(g, 0.06, "#4dabf7", 0, 0.58, 0.12);
    for (let i = 0; i < 3; i++) B(g, 0.02, 0.22, 0.16, "#e03131", 0, 0.16, 0, (m) => { m.rotation.y = (i / 3) * Math.PI * 2; m.translateZ(0.15); });
    const flame = K(g, 0.08, 0.2, glow("#ff922b", 1.6), 0, 0.02, 0, 8, (m) => { m.rotation.x = Math.PI; }); g.userData.tick = (t) => { flame.scale.y = 0.7 + 0.4 * Math.abs(Math.sin(t * 13)); }; return g;
  },
  nave(c) {
    const g = new THREE.Group(); S(g, 0.5, c, 0, 0.12, 0, (m) => m.scale.set(1, 0.18, 1)); S(g, 0.2, mat("#a5d8ff", { transparent: true, opacity: 0.8 }), 0, 0.22, 0);
    const lights = [...Array(8)].map((_, i) => S(g, 0.035, glow("#ffd43b", 1.3), Math.cos((i / 8) * Math.PI * 2) * 0.42, 0.1, Math.sin((i / 8) * Math.PI * 2) * 0.42));
    g.userData.tick = (t) => lights.forEach((l, i) => { l.material = glow(Math.floor(t * 4 + i) % 2 ? "#ffd43b" : "#ff6b6b", 1.3); }); return g;
  },
  balao(c) {
    const g = new THREE.Group(); S(g, 0.32, c, 0, 0.62, 0, (m) => m.scale.set(1, 1.15, 1)); B(g, 0.14, 0.1, 0.14, "#8d5a3b", 0, 0.06, 0);
    for (const [x, z] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]]) C(g, 0.005, 0.005, 0.3, "#495057", x, 0.25, z, 4); return g;
  },
  pessoa(c) { const g = new THREE.Group(); C(g, 0.1, 0.11, 0.4, "#2c3a52", 0, 0.2, 0, 10); C(g, 0.14, 0.12, 0.34, c, 0, 0.57, 0, 12); S(g, 0.11, "#c99a73", 0, 0.86, 0); return g; },
  robo(c) {
    const g = new THREE.Group(); B(g, 0.32, 0.36, 0.22, c, 0, 0.48, 0); B(g, 0.24, 0.2, 0.2, shade(c, 1.1), 0, 0.78, 0); for (const x of [-0.06, 0.06]) S(g, 0.03, glow("#4bd9c4", 1.4), x, 0.8, 0.1);
    C(g, 0.01, 0.01, 0.12, "#495057", 0, 0.94, 0, 6); S(g, 0.03, glow("#ff6b6b", 1.4), 0, 1, 0); for (const x of [-0.09, 0.09]) B(g, 0.1, 0.3, 0.12, shade(c, 0.7), x, 0.15, 0); for (const x of [-0.21, 0.21]) B(g, 0.07, 0.28, 0.08, shade(c, 0.8), x, 0.48, 0); return g;
  },
  vaca(c) { const q = quadruped({ color: c, legColor: "#f1f3f5", head: 0.22, boxHead: true, tail: 0.3 }); for (const [x, y, z] of [[0.2, 0.62, 0.1], [-0.2, 0.55, -0.15], [0.2, 0.5, -0.25]]) B(q.g, 0.02, 0.16, 0.2, "#212529", x, y, z); B(q.g, 0.14, 0.08, 0.06, "#f7a8b8", 0, q.hy - 0.06, q.hz + 0.13); for (const x of [-1, 1]) K(q.g, 0.025, 0.1, "#f1f3f5", x * 0.08, q.hy + 0.13, q.hz - 0.05, 6); return q.g; },
  cavalo(c) { const q = quadruped({ color: c, h: 0.38, w: 0.3, leg: 0.42, head: 0.2, boxHead: true, neck: 0.32, neckUp: 0.5, tail: 0.35, ears: true }); B(q.g, 0.04, 0.3, 0.18, "#2b1d14", 0, q.by + 0.28, 0.4, (m) => { m.rotation.x = 0.5; }); return q.g; },
  ovelha(c) { const q = quadruped({ color: c, legColor: "#212529", round: true, h: 0.55, w: 0.6, leg: 0.22, head: 0.22, headColor: "#212529", ears: true }); return q.g; },
  porco(c) { const q = quadruped({ color: c, round: true, h: 0.5, w: 0.5, leg: 0.16, head: 0.28 }); C(q.g, 0.06, 0.06, 0.05, shade(c, 0.85), 0, q.hy, q.hz + 0.16, 10, (m) => { m.rotation.x = Math.PI / 2; }); for (const x of [-1, 1]) K(q.g, 0.04, 0.08, c, x * 0.08, q.hy + 0.15, q.hz, 6); return q.g; },
  cachorro(c) { const q = quadruped({ color: c, h: 0.32, w: 0.28, leg: 0.28, head: 0.3, ears: true, tail: 0.25 }); B(q.g, 0.1, 0.08, 0.14, shade(c, 0.85), 0, q.hy - 0.04, q.hz + 0.14); return q.g; },
  gato(c) { const q = quadruped({ color: c, h: 0.26, w: 0.22, leg: 0.26, head: 0.28, ears: true, tail: 0.5 }); return q.g; },
  leao(c) { const q = quadruped({ color: c, h: 0.4, w: 0.34, leg: 0.32, head: 0.26, tail: 0.4 }); S(q.g, 0.2, "#a0522d", 0, q.hy, q.hz - 0.04, (m) => m.scale.set(1.2, 1.2, 0.7)); S(q.g, 0.14, c, 0, q.hy, q.hz + 0.06); return q.g; },
  elefante(c) { const q = quadruped({ color: c, round: true, h: 0.55, w: 0.55, leg: 0.32, head: 0.4 }); C(q.g, 0.06, 0.04, 0.4, c, 0, q.hy - 0.2, q.hz + 0.18, 8, (m) => { m.rotation.x = 0.25; }); for (const x of [-1, 1]) B(q.g, 0.02, 0.28, 0.24, shade(c, 0.9), x * 0.2, q.hy, q.hz - 0.06, (m) => { m.rotation.y = x * 0.5; }); for (const x of [-1, 1]) K(q.g, 0.02, 0.15, "#f8f9fa", x * 0.08, q.hy - 0.12, q.hz + 0.16, 6, (m) => { m.rotation.x = 1.9; }); return q.g; },
  girafa(c) { const q = quadruped({ color: c, h: 0.25, w: 0.2, len: 0.5, leg: 0.4, head: 0.14, boxHead: true, neck: 0.5, neckUp: 0.2, ears: true, tail: 0.2 }); for (const [x, y, z] of [[0.1, 0.55, 0.05], [-0.1, 0.5, -0.1], [0.1, 0.48, -0.15]]) B(q.g, 0.01, 0.06, 0.06, "#8d5a3b", x, y, z); return q.g; },
  urso(c) { const q = quadruped({ color: c, round: true, h: 0.5, w: 0.48, leg: 0.24, head: 0.32, ears: true }); B(q.g, 0.1, 0.08, 0.1, shade(c, 0.7), 0, q.hy - 0.03, q.hz + 0.15); return q.g; },
  dinossauro(c) {
    const q = quadruped({ color: c, round: true, h: 0.4, w: 0.36, len: 0.6, leg: 0.28, head: 0.18, neck: 0.45, neckUp: 0.6 });
    K(q.g, 0.1, 0.55, c, 0, q.by, -0.48, 8, (m) => { m.rotation.x = -Math.PI / 2 + 0.25; });
    for (let i = 0; i < 5; i++) K(q.g, 0.04, 0.09, shade(c, 0.7), 0, q.by + 0.22 - Math.abs(i - 2) * 0.02, -0.18 + i * 0.09, 4); return q.g;
  },
  pinguim(c) { const g = new THREE.Group(); S(g, 0.3, c, 0, 0.4, 0, (m) => m.scale.set(0.9, 1.35, 0.85)); S(g, 0.22, "#f8f9fa", 0, 0.38, 0.08, (m) => m.scale.set(0.9, 1.4, 0.7)); S(g, 0.18, c, 0, 0.85, 0); K(g, 0.04, 0.12, "#f59f00", 0, 0.84, 0.2, 6, (m) => { m.rotation.x = Math.PI / 2; }); for (const x of [-0.1, 0.1]) B(g, 0.1, 0.03, 0.14, "#f59f00", x, 0.02, 0.05); return g; },
  galinha(c) { return birdlike(c, "#f59f00", (g) => { K(g, 0.06, 0.12, "#e03131", 0, 0.98, 0.25, 6); }); },
  pato(c) { return birdlike(c, "#f76707"); },
  coelho(c) { const g = new THREE.Group(); S(g, 0.3, c, 0, 0.32, 0, (m) => m.scale.set(0.9, 0.9, 1.2)); S(g, 0.2, c, 0, 0.6, 0.25); for (const x of [-0.07, 0.07]) C(g, 0.04, 0.05, 0.35, c, x, 0.9, 0.22, 6); S(g, 0.08, "#ffffff", 0, 0.35, -0.35); return g; },
  passaro(c) {
    const g = birdlike(c, "#f59f00"); const wings = [-1, 1].map((x) => B(g, 0.4, 0.03, 0.22, shade(c, 0.85), x * 0.25, 0.48, 0, (m) => { m.geometry.translate(x * 0.2, 0, 0); m.position.x = x * 0.05; }));
    g.userData.tick = (t) => { wings[0].rotation.z = 0.6 * Math.sin(t * 12); wings[1].rotation.z = -0.6 * Math.sin(t * 12); }; return g;
  },
  peixe(c) { const g = new THREE.Group(); S(g, 0.3, c, 0, 0.3, 0, (m) => m.scale.set(0.55, 0.9, 1.4)); const tail = K(g, 0.18, 0.3, shade(c, 0.85), 0, 0.3, -0.5, 4, (m) => { m.rotation.x = Math.PI / 2; m.scale.set(0.3, 1, 1); }); g.userData.tick = (t) => { tail.rotation.y = 0.5 * Math.sin(t * 7); }; return g; },
  tubarao(c) { const g = new THREE.Group(); S(g, 0.3, c, 0, 0.25, 0, (m) => m.scale.set(0.7, 0.7, 1.7)); K(g, 0.12, 0.3, c, 0, 0.55, -0.05, 4, (m) => { m.scale.set(0.3, 1, 1); }); K(g, 0.15, 0.3, c, 0, 0.3, -0.6, 4, (m) => { m.rotation.x = Math.PI / 2; m.scale.set(0.3, 1, 1); }); return g; },
  baleia(c) { const g = new THREE.Group(); S(g, 0.32, c, 0, 0.25, 0, (m) => m.scale.set(0.9, 0.7, 1.6)); B(g, 0.6, 0.03, 0.2, c, 0, 0.25, -0.62); S(g, 0.26, "#e7f5ff", 0, 0.16, 0.05, (m) => m.scale.set(0.8, 0.4, 1.4)); return g; },
  planeta(c) { const g = new THREE.Group(); S(g, 0.35, c, 0, 0.5, 0); if (c !== "#4dabf7") put(g, new THREE.TorusGeometry(0.52, 0.04, 6, 40), shade(c, 1.2), 0, 0.5, 0, (m) => { m.rotation.x = 1.2; }); else S(g, 0.12, "#2f9e44", 0.2, 0.6, 0.2); return g; },
  estrela(c) { const g = new THREE.Group(); const s = put(g, new THREE.OctahedronGeometry(0.4), glow(c, 1.4), 0, 0.4, 0); g.userData.tick = (t) => { s.rotation.y = t; s.scale.setScalar(0.85 + 0.15 * Math.sin(t * 3)); }; return g; },
  lua(c) { const g = new THREE.Group(); S(g, 0.45, glow(c, 0.25), 0, 0.45, 0); for (const [x, y, z] of [[0.2, 0.6, 0.35], [-0.15, 0.35, 0.4], [0.05, 0.75, 0.3]]) S(g, 0.07, shade(c, 0.8), x, y, z); return g; },
  sol(c) { const g = new THREE.Group(); const core = S(g, 0.4, glow(c, 1.6), 0, 0.5, 0); const halo = S(g, 0.48, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.25, depthWrite: false }), 0, 0.5, 0); g.userData.tick = (t) => { halo.scale.setScalar(1 + 0.06 * Math.sin(t * 2)); core.rotation.y = t * 0.3; }; return g; },
  nuvem(c) { const g = new THREE.Group(); for (const [x, y, r] of [[0, 0.3, 0.28], [0.28, 0.25, 0.22], [-0.28, 0.24, 0.2], [0.1, 0.42, 0.2]]) S(g, r, mat(c, { transparent: true, opacity: 0.92 }), x, y, 0, (m) => m.scale.set(1, 0.8, 0.8)); return g; },
  bola(c) { const g = new THREE.Group(); S(g, 0.5, c, 0, 0.5, 0); put(g, new THREE.TorusGeometry(0.5, 0.03, 6, 30), "#f8f9fa", 0, 0.5, 0); return g; },
  caixa(c) { const g = new THREE.Group(); B(g, 0.9, 0.7, 0.9, c, 0, 0.35, 0); B(g, 0.92, 0.1, 0.92, "#f2e6c9", 0, 0.55, 0); return g; },
  objeto(c) { const g = new THREE.Group(); B(g, 0.8, 0.8, 0.8, c, 0, 0.4, 0); return g; },
};

/** The model of a type (unknown types: a coloured box), as a group about 1 unit at its largest side. */
export function model(type, color) {
  const g = (BUILD[type] || BUILD.objeto)(color);
  // Normalise: largest side 1 (the builders are close, this makes the sizes in the catalogue exact).
  const box = new THREE.Box3().setFromObject(g); const size = box.getSize(new THREE.Vector3());
  const k = 1 / Math.max(size.x, size.y, size.z, 1e-3);
  const wrap = new THREE.Group(); g.scale.setScalar(k); g.position.y = -box.min.y * k; wrap.add(g);
  wrap.userData.tick = g.userData.tick || null;
  wrap.userData.height = size.y * k;
  return wrap;
}
export const MODEL_TYPES = Object.keys(BUILD);
