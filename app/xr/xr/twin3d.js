// The miniature of the open Power BI, built from twinLayout (lib/twinLayout.js): a plate the size of a
// table top with each place in the shape of its area and each entity where it is. Every entity mesh
// carries userData.entity (for picking); the plate carries userData.grab (to move, turn and scale it).
import * as THREE from "../vendor/three.module.js";
import { COLORS, waitText } from "../lib/twinLayout.js";

const mats = new Map();
const mat = (hex, extra = {}) => {
  const key = hex + JSON.stringify(extra);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.65, metalness: 0.05, ...extra }));
  return mats.get(key);
};
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** A text that always faces the viewer (sprite), height in metres. */
export function label(text, { height = 0.012, color = "#e8ecff", bg = "rgba(11,15,30,0.82)", bold = true } = {}) {
  const c = document.createElement("canvas"); const g = c.getContext("2d");
  const font = `${bold ? 700 : 500} 44px "Segoe UI", system-ui, sans-serif`;
  g.font = font; const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w; c.height = 64; g.font = font;
  if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, 64, 32); g.fill(); }
  g.fillStyle = color; g.textBaseline = "middle"; g.fillText(text, 18, 34);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(height * w / 64, height, 1);
  s.renderOrder = 2;
  // Labels are read, not pointed at: rays pass through them (a sprite's hit test needs the eye's camera,
  // which in a headset is two).
  s.raycast = () => {};
  return s;
}

function truck(color, [w, h, d]) {
  const g = new THREE.Group();
  const cargo = new THREE.Mesh(box(w, h, d * 0.72), mat(color)); cargo.position.set(0, h / 2 + 0.003, -d * 0.12); g.add(cargo);
  const cab = new THREE.Mesh(box(w * 0.95, h * 0.78, d * 0.24), mat("#e8edf5")); cab.position.set(0, h * 0.39 + 0.003, d * 0.38); g.add(cab);
  const glass = new THREE.Mesh(box(w * 0.8, h * 0.28, 0.001), mat("#1e2a3f")); glass.position.set(0, h * 0.58, d * 0.5 + 0.0005); g.add(glass);
  const wheel = new THREE.CylinderGeometry(h * 0.18, h * 0.18, w * 1.06, 12); wheel.rotateZ(Math.PI / 2);
  for (const z of [-d * 0.38, d * 0.08, d * 0.38]) { const m = new THREE.Mesh(wheel, mat("#0b0f16")); m.position.set(0, h * 0.18, z); g.add(m); }
  return g;
}
function person(color, [w, h]) {
  const g = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.36, h * 0.4, 10), mat("#2c3a52")); legs.position.y = h * 0.2; g.add(legs);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.38, h * 0.36, 12), mat(color)); body.position.y = h * 0.58; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(w * 0.3, 14, 10), mat("#c99a73")); head.position.y = h * 0.88; g.add(head);
  return g;
}
function parcel(color, [w, h, d]) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(box(w, h, d), mat(color)); m.position.y = h / 2; g.add(m);
  const tape = new THREE.Mesh(box(w * 1.01, h * 0.12, d * 1.01), mat("#f2e6c9")); tape.position.y = h * 0.75; g.add(tape);
  return g;
}

/** The miniature as a group (origin: the plate's centre, on the table). */
export function buildTwin(L) {
  const root = new THREE.Group(); root.name = "twin";
  const plate = new THREE.Mesh(box(L.width, 0.008, L.depth), mat(COLORS.piso, { transparent: true, opacity: 0.92 }));
  plate.position.y = -0.004; plate.userData.grab = true; root.add(plate);
  const rim = new THREE.LineSegments(new THREE.EdgesGeometry(box(L.width, 0.008, L.depth)), new THREE.LineBasicMaterial({ color: "#b04bff" }));
  rim.position.y = -0.004; rim.raycast = () => {}; root.add(rim);
  if (!L.operation) {
    const t = label(L.title || "Nenhum Power BI aberto pela Aurora", { height: 0.03 }); t.position.set(0, 0.08, 0); root.add(t);
    return root;
  }
  // The places, each in the shape of its area; a green light on a free one.
  for (const p of L.places) {
    const m = new THREE.Mesh(box(p.w, p.h, p.d), mat(p.color)); m.position.set(p.x, p.h / 2, p.z); m.userData.place = p; root.add(m);
    if (p.free && p.color !== COLORS.livre) { const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 8), mat(COLORS.livre, { emissive: COLORS.livre, emissiveIntensity: 0.8 })); lamp.position.set(p.x, p.h + 0.006, p.z); root.add(lamp); }
    const tag = label(p.short, { height: 0.016, color: p.highlight ? "#d9b3ff" : "#e8ecff" }); tag.position.set(p.x, p.h + 0.02, p.z); root.add(tag);
    if (p.highlight) root.add(ring(p.x, p.z, Math.max(p.w, p.d) * 0.7));
  }
  // The entities: one object each.
  for (const e of L.items) {
    const m = e.kind === "veiculo" ? truck(e.color, e.size) : e.kind === "pessoa" ? person(e.color, e.size) : parcel(e.color, e.size);
    m.position.set(e.x, 0, e.z); m.rotation.y = e.rot || 0;
    m.traverse((o) => { o.userData.entity = e; });
    root.add(m);
    if (e.highlight) root.add(ring(e.x, e.z, 0.02));
    if (e.waited != null && e.kind === "pessoa") { const t = label(waitText(e.waited), { height: 0.008, bold: false }); t.position.set(e.x, e.size[1] + 0.012, e.z); root.add(t); }
  }
  const unit = label(L.unit ? L.unit.toUpperCase() : L.title, { height: 0.026, bg: null }); unit.position.set(0, 0.11, -L.depth / 2 + 0.02); root.add(unit);
  const seal = label(L.seal.text + (L.extra ? ` · ${L.extra}` : ""), { height: 0.016, color: L.seal.ok ? "#3ddc97" : "#f6b93b" });
  seal.position.set(L.width / 2 - 0.09, 0.02, L.depth / 2 - 0.02); root.add(seal);
  return root;
}

function ring(x, z, r) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0018, 6, 36), mat(COLORS.destaque, { emissive: COLORS.destaque, emissiveIntensity: 0.9 }));
  m.rotation.x = Math.PI / 2; m.position.set(x, 0.002, z); return m;
}

/** The legend of the colours (what each colour means), for the panel. */
export function legend(state) {
  if (state?.colorBy?.values?.length) return state.colorBy.values.map(([v, c], i) => ({ color: c, text: `${i + 1} · ${v}` }));
  const out = (state?.stages || []).map((s) => ({ color: COLORS[s.key] || COLORS.carregando, text: s.label }));
  return [...out, { color: COLORS.atraso, text: "Atrasado" }, { color: COLORS.livre, text: "Livre" }];
}
