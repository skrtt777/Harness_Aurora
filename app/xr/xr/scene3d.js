// A scene made by the Aurora (lib/scene.js normalizeScene) as a miniature: the plate in the colour of
// its ground (userData.grab, to move, turn and scale it like the operation), a ring road when something
// drives, and each thing as a model with its body (userData.dyn) for the life of the miniature.
import * as THREE from "../vendor/three.module.js";
import { GROUNDS } from "../lib/scene.js";
import { RING } from "../lib/dynamics.js";
import { model, mat } from "./models.js";
import { label } from "./twin3d.js";

export function buildScene(S) {
  const root = new THREE.Group(); root.name = "scene";
  const ground = GROUNDS[S.ground] || GROUNDS.grama;
  const extra = S.ground === "lava" ? { emissive: "#ff4500", emissiveIntensity: 0.25 } : S.ground === "agua" ? { transparent: true, opacity: 0.9, roughness: 0.2 } : {};
  const plate = new THREE.Mesh(new THREE.BoxGeometry(S.width, 0.012, S.depth), mat(ground, { flatShading: false, ...extra }));
  plate.position.y = -0.006; plate.userData.grab = true; root.add(plate);
  const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(S.width, 0.012, S.depth)), new THREE.LineBasicMaterial({ color: "#b04bff" }));
  rim.position.y = -0.006; rim.raycast = () => {}; root.add(rim);
  if (S.ground === "espaco") {
    // Stars in the space above the plate.
    const pts = []; for (let i = 0; i < 160; i++) pts.push((Math.random() - 0.5) * S.width, 0.02 + Math.random() * 0.3, (Math.random() - 0.5) * S.depth);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: "#ffffff", size: 0.003 })); stars.raycast = () => {}; root.add(stars);
  }
  if (S.items.some((i) => i.behavior === "rodar")) {
    // The ring road the vehicles drive around (dynamics.js RING).
    const shape = new THREE.Shape(); shape.absellipse(0, 0, RING.ax + 0.018, RING.az + 0.018, 0, Math.PI * 2);
    const hole = new THREE.Path(); hole.absellipse(0, 0, RING.ax - 0.018, RING.az - 0.018, 0, Math.PI * 2); shape.holes.push(hole);
    const road = new THREE.Mesh(new THREE.ShapeGeometry(shape, 64).rotateX(-Math.PI / 2), mat("#2b2f36", { flatShading: false }));
    road.position.y = 0.0008; road.raycast = () => {}; root.add(road);
    const dash = new THREE.LineDashedMaterial({ color: "#f8f9fa", dashSize: 0.012, gapSize: 0.01 });
    const pts = new THREE.EllipseCurve(0, 0, RING.ax, RING.az).getPoints(96).map((p) => new THREE.Vector3(p.x, 0.0016, p.y));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dash); line.computeLineDistances(); line.raycast = () => {}; root.add(line);
  }
  for (const it of S.items) {
    const m = model(it.type, it.color);
    const size = it.size * it.scale; m.scale.setScalar(size);
    m.position.set(it.x, it.y, it.z); m.rotation.y = it.rot;
    const info = { name: it.label, kind: it.type, scene: true };
    m.traverse((o) => { o.userData.entity = info; });
    m.userData.dyn = { radius: Math.max(0.008, size * 0.42), height: (m.userData.height || 1) * size, behavior: it.behavior, seed: it.seed, fixed: it.fixed, label: it.label };
    root.add(m);
  }
  const title = label(S.title, { height: 0.026, bg: null }); title.position.set(0, 0.12, -S.depth / 2 + 0.02); root.add(title);
  return root;
}
