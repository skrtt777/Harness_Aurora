import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls, RoundedBox, Stars } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ACTIVITY_COLOR, reviewOf } from "./adapter";
import { hash01 } from "./layout";
import { cloudColor } from "./clouds";
import { BOOK, FLOOR_H, layoutArchive, standingSpot, type ArchiveLayout, type BookSlot, type Tower } from "./archive";
import type { SceneProps } from "./LiveMapScene";

/**
 * Memórias / Mapa Vivo em 3D — o arquivo vivo: a memory as a small city of bookshelf towers (archive.ts).
 *   - each section is a tower, each memory a book on its shelves (a proven one in its section's colour, one
 *     still in review paler, like a new paperback); the Aurora is the orb floating over the plaza;
 *   - the Zeladora is a little robot: she walks the streets to the tower she tends, flies up on her jets to the
 *     shelf, reads the book with the light of her eyes (it slides out and glows), says what she found, links two
 *     books with a thread, cuts an obsolete one (it falls to the ground), and a new section rises as a tower;
 *   - a question to the Aurora is light from the orb: thin rays to every book the search weighed, bright arcs
 *     to the ones it used (they slide out and glow), a callout at the best;
 *   - the person orbits, zooms and pans; hovering a book names it, a click opens it, a double click goes to a tower.
 * Nothing is invented: every book is a stored memory, every move of the robot and every ray a real event.
 */
const ORB: [number, number, number] = [0, 9, 0];
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
const PAPER = new THREE.Color("#efe9dc");
const GREY = new THREE.Color("#7c8494");
const ORANGE = new THREE.Color("#ff9a55");
const BLUE = new THREE.Color("#8fb8e8");
const GREEN = new THREE.Color(ACTIVITY_COLOR);
const PINK = new THREE.Color("#ff7aa8");
const WHITE = new THREE.Color("#ffffff");
const PRUNE = new THREE.Color("#ff7a4d");

/** A book's outward direction (its spine faces it). */
const normalOf = (b: BookSlot): [number, number] => [Math.sin(b.rot), Math.cos(b.rot)];

function ArchiveWorld(props: SceneProps) {
  const { graph, layout, settings, selectedId, hoveredId, focusClusterId, highlights, agent, keeper, onHover, onSelect, onCluster } = props;
  const motion = !settings.paused && !settings.reducedMotion;
  const A = useMemo<ArchiveLayout>(() => layoutArchive(layout), [layout]);
  const ids = useMemo(() => [...A.books.keys()], [A]);
  const nodeOf = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const clusterOf = useMemo(() => new Map(graph.clusters.map((c) => [c.id, c])), [graph.clusters]);
  const flagged = useMemo(() => { const s = new Set<string>(); for (const f of keeper?.flags || []) { s.add(f.id); if (f.otherId) s.add(f.otherId); } return s; }, [keeper?.flags]);
  const keeperOn = Boolean(keeper?.enabled && keeper.running);

  // ---------- what was where (a pruned book falls from its last place; a new tower rises; a new book flies in) ----------
  const seenBooks = useRef(new Map<string, BookSlot & { color: string }>());
  const seenTowers = useRef(new Map<string, Tower>());
  const bornAt = useRef(new Map<string, number>());
  const arrivedAt = useRef(new Map<string, number>());
  const first = useRef(true);
  useMemo(() => {
    const now = performance.now();
    for (const t of A.towers) { if (!first.current && !seenTowers.current.has(t.id)) bornAt.current.set(t.id, now); seenTowers.current.set(t.id, t); }
    for (const [id, b] of A.books) { if (!first.current && !seenBooks.current.has(id)) arrivedAt.current.set(id, now); seenBooks.current.set(id, { ...b, color: cloudColor(A.towers[b.tower].index) }); }
    first.current = false;
  }, [A]);
  const towerGrow = (t: Tower, now: number) => { const at = bornAt.current.get(t.id); return at === undefined ? 1 : easeOut(Math.min(1, (now - at) / 1400)); };

  // ---------- books: one instanced mesh, plus a glow shell for the ones that light up ----------
  const bookGeo = useMemo(() => new THREE.BoxGeometry(BOOK.w, BOOK.h, BOOK.d), []);
  const bookMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.05 }), []);
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  useEffect(() => () => { bookGeo.dispose(); bookMat.dispose(); glowMat.dispose(); }, [bookGeo, bookMat, glowMat]);
  const books = useRef<THREE.InstancedMesh>(null);
  const glows = useRef<THREE.InstancedMesh>(null);
  const out = useMemo(() => new Float32Array(ids.length), [ids]);
  const glow = useMemo(() => new Float32Array(ids.length), [ids]);
  const base = useMemo(() => ids.map((id) => {
    const b = A.books.get(id)!; const n = nodeOf.get(id);
    const c = new THREE.Color(cloudColor(A.towers[b.tower].index));
    // Each book a slightly different shade, like real ones; one still in review is a pale paperback.
    c.offsetHSL((hash01(id, 3) - 0.5) * 0.04, (hash01(id, 4) - 0.5) * 0.15, (hash01(id, 5) - 0.5) * 0.14);
    if (n && reviewOf(n.memory, flagged.has(id)) === "revisar") c.lerp(PAPER, 0.55);
    return c;
  }), [ids, A, nodeOf, flagged]);
  useEffect(() => {
    const m = books.current; if (!m) return;
    base.forEach((c, i) => m.setColorAt(i, c));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [base]);

  // ---------- the turn: which books the question reached ----------
  const reach = useMemo(() => {
    const m = new Map<string, { kind: string; strength: number }>();
    if (agent) for (const t of agent.tentacles) m.set(t.id, { kind: t.kind, strength: t.strength });
    return m;
  }, [agent]);
  const used = useMemo(() => (agent ? agent.tentacles.filter((t) => t.kind === "recalled" || t.kind === "used" || t.kind === "created").map((t) => t.id).filter((id) => A.books.has(id)).slice(0, 12) : []), [agent, A]);
  const scanned = useMemo(() => (agent ? agent.tentacles.filter((t) => t.kind === "scanned").map((t) => t.id).filter((id) => A.books.has(id)).slice(0, 24) : []), [agent, A]);

  // ---------- the robot ----------
  const robot = useRef({ x: 0, z: 5.5, y: 0, heading: Math.PI, speed: 0, step: 0, arrived: false, tower: -1 });
  const robotRef = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Mesh>(null), legR = useRef<THREE.Mesh>(null), armL = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null);
  const jet = useRef<THREE.Mesh>(null);
  const eyeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#7fdcc0", toneMapped: false }), []);
  const [beam, setBeam] = useState<[THREE.Vector3, THREE.Vector3] | null>(null);
  const currentBook = keeperOn && keeper!.current ? A.books.get(keeper!.current) : undefined;
  const keeperColor = currentBook ? cloudColor(A.towers[currentBook.tower].index) : "#7fdcc0";

  // ---------- the camera: follows what happens (unless the person moved it a moment ago) ----------
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const goal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);
  const userAt = useRef(0);
  const placed = useRef(false);
  const lookAt = (tx: number, ty: number, tz: number, dist: number, height = 0.55) => {
    // From the side the camera already looks from, at `dist`, a little from above.
    const dir = new THREE.Vector3().subVectors(camera.position, controls ? controls.target : new THREE.Vector3()).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0.6, 0, 1);
    dir.normalize();
    goal.current = { target: new THREE.Vector3(tx, ty, tz), position: new THREE.Vector3(tx + dir.x * dist, ty + dist * height, tz + dir.z * dist) };
  };
  const overview = () => {
    // The whole city, a little to the left so the chat beside the map hides none of it.
    const pos = new THREE.Vector3(A.extent * 0.5, A.extent * 0.56, A.extent * 0.86);
    const right = new THREE.Vector3().crossVectors(pos.clone().negate().normalize(), new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(A.extent * 0.22);
    goal.current = { target: new THREE.Vector3(0, 2, 0).add(right), position: pos.add(right) };
  };
  useEffect(() => {
    if (!controls || placed.current) return;
    placed.current = true;
    controls.target.set(0, 2, 0); camera.position.set(A.extent * 0.55, A.extent * 0.62, A.extent * 0.95); controls.update();
  }, [controls, camera, A.extent]);
  useEffect(() => {
    if (!controls) return undefined;
    const start = () => { userAt.current = Date.now(); goal.current = null; props.onUserMove(); };
    controls.addEventListener("start", start);
    return () => controls.removeEventListener("start", start);
  }, [controls]); // eslint-disable-line react-hooks/exhaustive-deps
  // The view's own commands: a memory (its book), a section (its tower) or the whole archive ("ajustar").
  useEffect(() => {
    if (!props.camera) return;
    const b = selectedId ? A.books.get(selectedId) : undefined;
    const t = focusClusterId ? A.towers.find((x) => x.id === focusClusterId) : undefined;
    if (b) { const [nx, nz] = normalOf(b); goal.current = { target: new THREE.Vector3(b.x, b.y, b.z), position: new THREE.Vector3(b.x + nx * 7, b.y + 2.5, b.z + nz * 7) }; }
    else if (t) lookAt(t.x, t.height * 0.5, t.z, Math.max(14, t.height * 1.6));
    else overview();
  }, [props.camera]); // eslint-disable-line react-hooks/exhaustive-deps
  const autoOk = () => settings.autoFocus && Date.now() - userAt.current > 10_000;
  const followed = useRef("");
  useEffect(() => {
    if (!autoOk()) return;
    if (agent && !agent.ended && used.length) {
      const key = `q:${agent.key}:${used.length}`;
      if (followed.current === key) return;
      followed.current = key;
      const pts = used.map((id) => A.books.get(id)!);
      const cx = pts.reduce((s, b) => s + b.x, 0) / pts.length, cz = pts.reduce((s, b) => s + b.z, 0) / pts.length;
      const spread = Math.max(6, ...pts.map((b) => Math.hypot(b.x - cx, b.z - cz)));
      lookAt(cx * 0.7, 4, cz * 0.7, Math.min(A.extent * 2, 14 + spread * 2.2), 0.7);
      return;
    }
    if (currentBook) {
      const key = `k:${currentBook.tower}`;
      if (followed.current === key) return;
      followed.current = key;
      const t = A.towers[currentBook.tower];
      lookAt(t.x, Math.min(t.height * 0.5, 6), t.z, Math.max(15, t.height * 1.5));
    }
  }, [agent, used, currentBook?.tower]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- every frame ----------
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  const lastBeam = useRef("");
  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const now = performance.now(), nowMs = Date.now();
    const t = state.clock.elapsedTime;
    if (goal.current && controls) {
      const k = settings.reducedMotion ? 1 : 1 - Math.pow(0.03, dt);
      controls.target.lerp(goal.current.target, k); camera.position.lerp(goal.current.position, k); controls.update();
      if (camera.position.distanceTo(goal.current.position) < 0.05) goal.current = null;
    }

    // ---- the robot walks to where she reads, flies up to the shelf, faces the book ----
    const r = robot.current;
    let tx = 0, tz = 5.5, lift = 0, face: number | null = null;
    if (currentBook) {
      const tw = A.towers[currentBook.tower];
      [tx, tz] = standingSpot(tw, currentBook, 1.5);
      lift = Math.max(0, currentBook.y - 1.55);
      face = Math.atan2(currentBook.x - tx, currentBook.z - tz);
      r.tower = currentBook.tower;
    }
    const dx = tx - r.x, dz = tz - r.z, dist = Math.hypot(dx, dz);
    let vx = 0, vz = 0;
    if (dist > 0.05) {
      const sp = Math.min(dist * 3, 6.5);
      vx = (dx / dist) * sp; vz = (dz / dist) * sp;
      // Around the towers, not through them.
      for (const tw of A.towers) {
        const ox = r.x - tw.x, oz = r.z - tw.z, od = Math.hypot(ox, oz), keep = tw.half * 1.45 + 0.6;
        if (od < keep && od > 1e-3 && dist > 1.2) { const push = (keep - od) / keep * 9; vx += (ox / od) * push; vz += (oz / od) * push; }
      }
    }
    const step = motion ? dt : 1;
    r.x += vx * step; r.z += vz * step;
    r.speed = Math.hypot(vx, vz);
    r.arrived = dist < 0.35;
    // On the ground while walking; up on her jets once she is under the book.
    const wantY = r.arrived ? lift : 0;
    r.y += (wantY - r.y) * (motion ? 1 - Math.exp(-dt * (wantY > r.y ? 2.2 : 4)) : 1);
    const wantHeading = r.speed > 0.4 ? Math.atan2(vx, vz) : face ?? r.heading;
    let dh = wantHeading - r.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    r.heading += dh * (motion ? 1 - Math.exp(-dt * 8) : 1);
    r.step += r.speed * dt * 2.4;
    const g = robotRef.current;
    if (g) {
      const bob = motion ? (r.y > 0.1 ? Math.sin(t * 3) * 0.06 : Math.abs(Math.sin(r.step * Math.PI)) * 0.08 * Math.min(1, r.speed)) : 0;
      g.position.set(r.x, r.y + bob, r.z); g.rotation.y = r.heading;
      const swing = Math.sin(r.step * Math.PI) * 0.6 * Math.min(1, r.speed / 3) * (r.y > 0.1 ? 0 : 1);
      if (legL.current) legL.current.rotation.x = swing; if (legR.current) legR.current.rotation.x = -swing;
      const reading = Boolean(currentBook && r.arrived);
      if (armL.current) armL.current.rotation.x = reading ? -1.2 + (motion ? Math.sin(t * 4) * 0.08 : 0) : -swing * 0.8;
      if (armR.current) armR.current.rotation.x = reading ? -0.9 : swing * 0.8;
      if (jet.current) { jet.current.visible = r.y > 0.08; jet.current.scale.setScalar(0.7 + (motion ? Math.sin(t * 30) * 0.15 : 0)); }
      eyeMat.color.set(keeperOn ? keeperColor : "#3a4250");
    }
    // The light of her eyes on the book she reads.
    const beamKey = currentBook && r.arrived ? `${keeper!.current}` : "";
    if (beamKey !== lastBeam.current) {
      lastBeam.current = beamKey;
      if (beamKey && currentBook) { const [nx, nz] = normalOf(currentBook); setBeam([new THREE.Vector3(r.x, r.y + 1.55, r.z), new THREE.Vector3(currentBook.x + nx * 0.5, currentBook.y, currentBook.z + nz * 0.5)]); }
      else setBeam(null);
    }

    // ---- the books: slide out and glow for what happens to them ----
    const m = books.current, gm = glows.current;
    if (!m || !gm) return;
    let gi = 0;
    const trailAt = keeper?.trailAt || {};
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i]; const b = A.books.get(id)!;
      const tw = A.towers[b.tower]; const grow = towerGrow(tw, now);
      let wantOut = 0, wantGlow = 0; let gc = WHITE;
      const rc = reach.get(id);
      if (rc) { if (rc.kind === "scanned") { wantGlow = 0.25 * rc.strength; gc = BLUE; } else { wantOut = 0.3; wantGlow = agent?.ended ? 0.6 : 1; gc = rc.kind === "created" ? GREEN : ORANGE; } }
      const read = trailAt[id];
      if (read && nowMs - read < 4000 && wantGlow < 0.5) { wantGlow = Math.max(wantGlow, 0.7 * (1 - (nowMs - read) / 4000)); gc = tmp.set(cloudColor(tw.index)); }
      if (id === keeper?.current && keeperOn) { wantOut = r.arrived ? 0.42 : 0.2; wantGlow = 1; gc = tmp.set(keeperColor); }
      const hl = highlights.get(id);
      if (hl && now - hl.at < 6000 && hl.kind === "created") { wantGlow = Math.max(wantGlow, 1 - (now - hl.at) / 6000); gc = GREEN; }
      if (hl && now - hl.at < 6000 && hl.kind === "search") { wantGlow = Math.max(wantGlow, 0.7); gc = BLUE; }
      if (id === hoveredId) { wantOut = Math.max(wantOut, 0.15); wantGlow = Math.max(wantGlow, 0.5); if (!rc) gc = WHITE; }
      if (id === selectedId) { wantOut = Math.max(wantOut, 0.32); wantGlow = Math.max(wantGlow, 0.8); gc = PINK; }
      const e = motion ? 1 - Math.exp(-dt * 7) : 1;
      out[i] += (wantOut - out[i]) * e; glow[i] += (wantGlow - glow[i]) * e;
      // A new book flies in from the Aurora.
      const arrived = arrivedAt.current.get(id);
      const fly = arrived === undefined ? 1 : easeOut(Math.min(1, (now - arrived) / 1300));
      const [nx, nz] = normalOf(b);
      const bx = b.x + nx * out[i], bz = b.z + nz * out[i], by = b.y * grow;
      dummy.position.set(ORB[0] + (bx - ORB[0]) * fly, ORB[1] + (by - ORB[1]) * fly + Math.sin(fly * Math.PI) * 2, ORB[2] + (bz - ORB[2]) * fly);
      dummy.rotation.set(0, b.rot + (1 - fly) * 6, 0);
      dummy.scale.set(1, Math.max(0.001, grow), 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      if (glow[i] > 0.03 && gi < gm.count) {
        dummy.scale.set(1.12, 1.06 * Math.max(0.001, grow), 1.06); dummy.updateMatrix();
        gm.setMatrixAt(gi, dummy.matrix);
        gm.setColorAt(gi, new THREE.Color().copy(gc).multiplyScalar(glow[i] * 1.6));
        gi += 1;
      }
    }
    m.instanceMatrix.needsUpdate = true;
    gm.count = gi;
    gm.instanceMatrix.needsUpdate = true;
    if (gm.instanceColor) gm.instanceColor.needsUpdate = true;
  });

  // ---------- the person: hover a book, click opens it, double click goes to its tower ----------
  const onMove = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); const id = e.instanceId !== undefined ? ids[e.instanceId] : null; if (id !== hoveredId) onHover(id); };
  const onOut = () => onHover(null);
  const onClick = (e: ThreeEvent<MouseEvent>) => { if (e.delta > 4) return; e.stopPropagation(); const id = e.instanceId !== undefined ? ids[e.instanceId] : null; if (id) onSelect(id); };
  const onDouble = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); const id = e.instanceId !== undefined ? ids[e.instanceId] : null; const b = id ? A.books.get(id) : undefined; if (b) onCluster(A.towers[b.tower].id, true); };

  // ---------- the towers' lit state ----------
  const here = currentBook ? currentBook.tower : -1;
  const turnTowers = useMemo(() => new Set(used.map((id) => A.books.get(id)!.tower)), [used, A]);
  const now = performance.now();

  return (
    <>
      <color attach="background" args={["#11131b"]} />
      <fog attach="fog" args={["#11131b", A.extent * 1.6, A.extent * 4.5]} />
      <hemisphereLight args={["#9fb4e8", "#1a1622", 0.55]} />
      <ambientLight intensity={0.12} />
      <directionalLight position={[A.extent * 0.6, A.extent * 1.4, A.extent * 0.5]} intensity={1.7} color="#ffe2bf" castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-A.extent * 1.2} shadow-camera-right={A.extent * 1.2} shadow-camera-top={A.extent * 1.2} shadow-camera-bottom={-A.extent * 1.2} shadow-camera-far={A.extent * 4} shadow-bias={-0.0004} />
      <Stars radius={A.extent * 5} depth={40} count={1800} factor={4} saturation={0} fade speed={motion ? 0.4 : 0} />

      {/* the plaza */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow onPointerMove={() => hoveredId && onHover(null)} onClick={(e) => { if (e.delta < 4) onSelect(null); }}>
        <circleGeometry args={[A.extent * 3, 96]} />
        <meshStandardMaterial color="#1b1f2c" roughness={0.95} />
      </mesh>
      <gridHelper args={[A.extent * 4, Math.round(A.extent * 4 / 2), "#262b3b", "#20253a"]} position={[0, 0.01, 0]} />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} receiveShadow>
        <ringGeometry args={[3.2, 3.5, 64]} />
        <meshBasicMaterial color="#3a4256" />
      </mesh>

      {/* the Aurora */}
      <AuroraOrb motion={motion} busy={Boolean(agent && !agent.ended)} />

      {/* the towers */}
      {A.towers.map((tw, ti) => (
        <TowerMesh key={tw.id} tower={tw} color={cloudColor(tw.index)} lit={ti === here || turnTowers.has(ti) || tw.id === focusClusterId} grow={towerGrow(tw, now)} bornAt={bornAt.current.get(tw.id)} onDouble={() => onCluster(tw.id, true)} />
      ))}

      {/* the books */}
      <instancedMesh ref={books} args={[bookGeo, bookMat, Math.max(1, ids.length)]} castShadow receiveShadow onPointerMove={onMove} onPointerOut={onOut} onClick={onClick} onDoubleClick={onDouble} />
      <instancedMesh ref={glows} args={[bookGeo, glowMat, Math.max(1, ids.length)]} frustumCulled={false} raycast={() => null} />

      {/* the robot (the Zeladora) */}
      <group ref={robotRef} visible={Boolean(keeper)}>
        <group>
          <mesh ref={legL} position={[-0.2, 0.32, 0]} castShadow><capsuleGeometry args={[0.1, 0.32, 4, 8]} /><meshStandardMaterial color="#c9d0db" roughness={0.5} /></mesh>
          <mesh ref={legR} position={[0.2, 0.32, 0]} castShadow><capsuleGeometry args={[0.1, 0.32, 4, 8]} /><meshStandardMaterial color="#c9d0db" roughness={0.5} /></mesh>
          <RoundedBox args={[0.78, 0.72, 0.56]} radius={0.16} position={[0, 0.95, 0]} castShadow><meshStandardMaterial color="#eef1f6" roughness={0.35} /></RoundedBox>
          <mesh position={[0, 0.95, 0.29]}><circleGeometry args={[0.13, 24]} /><primitive object={eyeMat} attach="material" /></mesh>
          <group ref={armL} position={[-0.47, 1.18, 0]}><mesh position={[0, -0.22, 0]} castShadow><capsuleGeometry args={[0.07, 0.3, 4, 8]} /><meshStandardMaterial color="#c9d0db" /></mesh></group>
          <group ref={armR} position={[0.47, 1.18, 0]}><mesh position={[0, -0.22, 0]} castShadow><capsuleGeometry args={[0.07, 0.3, 4, 8]} /><meshStandardMaterial color="#c9d0db" /></mesh></group>
          <RoundedBox args={[0.62, 0.46, 0.5]} radius={0.14} position={[0, 1.55, 0]} castShadow><meshStandardMaterial color="#eef1f6" roughness={0.35} /></RoundedBox>
          <mesh position={[0, 1.56, 0.25]}><planeGeometry args={[0.48, 0.24]} /><meshStandardMaterial color="#141822" roughness={0.2} /></mesh>
          <mesh position={[-0.11, 1.57, 0.26]}><circleGeometry args={[0.055, 16]} /><primitive object={eyeMat} attach="material" /></mesh>
          <mesh position={[0.11, 1.57, 0.26]}><circleGeometry args={[0.055, 16]} /><primitive object={eyeMat} attach="material" /></mesh>
          <mesh position={[0, 1.9, 0]}><cylinderGeometry args={[0.015, 0.015, 0.25]} /><meshStandardMaterial color="#9aa3b2" /></mesh>
          <mesh position={[0, 2.05, 0]}><sphereGeometry args={[0.06, 12, 12]} /><primitive object={eyeMat} attach="material" /></mesh>
          <mesh ref={jet} position={[0, 0.05, -0.05]} rotation-x={Math.PI}><coneGeometry args={[0.18, 0.6, 16, 1, true]} /><meshBasicMaterial color="#ffb27a" transparent opacity={0.75} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
        </group>
        <KeeperSay keeper={keeper} />
      </group>
      {beam && <Line points={[beam[0], beam[1]]} color={keeperColor} lineWidth={2.2} transparent opacity={0.85} toneMapped={false} />}

      {/* the question: rays from the Aurora to the books */}
      {scanned.map((id) => { const b = A.books.get(id)!; return <Line key={`s:${id}`} points={arc(ORB, [b.x, b.y, b.z], 0.15)} color="#8fb8e8" lineWidth={0.8} transparent opacity={0.35} toneMapped={false} />; })}
      {used.map((id, k) => { const b = A.books.get(id)!; return <Line key={`u:${id}`} points={arc(ORB, [b.x, b.y, b.z], 0.3)} color={reach.get(id)?.kind === "created" ? ACTIVITY_COLOR : "#ff9a55"} lineWidth={k === 0 ? 3 : 2} transparent opacity={agent?.ended ? 0.55 : 0.95} toneMapped={false} />; })}

      {/* her threads between two books */}
      {(keeper?.links || []).filter((l) => Date.now() - l.at < 8000).slice(-6).map((l) => {
        const a = A.books.get(l.from), b = A.books.get(l.to); if (!a || !b) return null;
        return <Line key={`l:${l.from}:${l.to}:${l.at}`} points={arc([a.x, a.y, a.z], [b.x, b.y, b.z], 0.35)} color={cloudColor(A.towers[a.tower].index)} lineWidth={1.6} transparent opacity={0.85} toneMapped={false} />;
      })}

      <FallingBooks keeper={keeper} seen={seenBooks.current} motion={motion} />
      <GroundRings keeper={keeper} towers={seenTowers.current} />
      <Labels {...props} A={A} clusterOf={clusterOf} nodeOf={nodeOf} used={used} here={here} />
    </>
  );
}

/** Points of an arc from a to b, raised in the middle by `lift` of its length. */
function arc(a: readonly number[], b: readonly number[], lift: number): [number, number, number][] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + len * lift, (a[2] + b[2]) / 2];
  const pts: [number, number, number][] = [];
  for (let s = 0; s <= 24; s += 1) { const u = s / 24, v = 1 - u; pts.push([v * v * a[0] + 2 * v * u * mid[0] + u * u * b[0], v * v * a[1] + 2 * v * u * mid[1] + u * u * b[1], v * v * a[2] + 2 * v * u * mid[2] + u * u * b[2]]); }
  return pts;
}

/** The Aurora over the plaza: a glowing core with two slow rings, a light on the city; faster while she answers. */
function AuroraOrb({ motion, busy }: { motion: boolean; busy: boolean }) {
  const a = useRef<THREE.Mesh>(null), b = useRef<THREE.Mesh>(null), core = useRef<THREE.Mesh>(null);
  useFrame((s, dt) => {
    const k = motion ? dt * (busy ? 2.4 : 0.6) : 0;
    if (a.current) { a.current.rotation.x += k; a.current.rotation.y += k * 0.7; }
    if (b.current) { b.current.rotation.y -= k * 0.9; b.current.rotation.z += k * 0.5; }
    if (core.current) core.current.scale.setScalar(1 + (motion ? Math.sin(s.clock.elapsedTime * (busy ? 6 : 1.6)) * 0.06 : 0));
  });
  return (
    <group position={ORB}>
      <mesh ref={core}><sphereGeometry args={[0.7, 32, 32]} /><meshBasicMaterial color={busy ? "#ffd2ad" : "#cfe9ff"} toneMapped={false} /></mesh>
      <mesh ref={a}><torusGeometry args={[1.3, 0.025, 8, 96]} /><meshBasicMaterial color="#9fd8ff" toneMapped={false} /></mesh>
      <mesh ref={b}><torusGeometry args={[1.65, 0.02, 8, 96]} /><meshBasicMaterial color={busy ? "#ff9a55" : "#7fdcc0"} toneMapped={false} /></mesh>
      <pointLight color={busy ? "#ffb27a" : "#9fd8ff"} intensity={busy ? 60 : 30} distance={30} decay={1.6} />
      <mesh position={[0, -ORB[1] / 2, 0]}><cylinderGeometry args={[0.02, 0.02, ORB[1] - 1]} /><meshBasicMaterial color="#3a4256" /></mesh>
    </group>
  );
}

/** A bookshelf tower: a core, a shelf per floor, posts at the corners, a roof that glows in its colour when lit. */
function TowerMesh({ tower: t, color, lit, grow, bornAt, onDouble }: { tower: Tower; color: string; lit: boolean; grow: number; bornAt?: number; onDouble: () => void }) {
  const roof = useRef<THREE.MeshStandardMaterial>(null);
  const group = useRef<THREE.Group>(null);
  const heat = useRef(0);
  useFrame((_, dt) => {
    heat.current += ((lit ? 1 : 0) - heat.current) * (1 - Math.exp(-dt * 3));
    if (roof.current) roof.current.emissiveIntensity = 0.12 + heat.current * 0.75;
    if (group.current && bornAt !== undefined) group.current.scale.y = Math.max(0.001, easeOut(Math.min(1, (performance.now() - bornAt) / 1400)));
  });
  const core = t.half - BOOK.d - 0.02;
  const side = t.half * 2;
  return (
    <group ref={group} scale={[1, Math.max(0.001, grow), 1]} position={[t.x, 0, t.z]} onDoubleClick={(e) => { e.stopPropagation(); onDouble(); }}>
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow><boxGeometry args={[side + 0.5, 0.3, side + 0.5]} /><meshStandardMaterial color="#2b3040" roughness={0.9} /></mesh>
      <mesh position={[0, t.height / 2, 0]} castShadow receiveShadow><boxGeometry args={[core * 2, t.height, core * 2]} /><meshStandardMaterial color="#2a2e3a" roughness={0.85} /></mesh>
      {Array.from({ length: t.floors + 1 }, (_, f) => (
        <mesh key={f} position={[0, 0.3 + f * FLOOR_H, 0]} castShadow receiveShadow><boxGeometry args={[side + 0.08, 0.07, side + 0.08]} /><meshStandardMaterial color="#454b5c" roughness={0.7} /></mesh>
      ))}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} position={[sx * (t.half + 0.02), t.height / 2, sz * (t.half + 0.02)]} castShadow><boxGeometry args={[0.12, t.height, 0.12]} /><meshStandardMaterial color="#3a4050" roughness={0.6} /></mesh>
      ))}
      <mesh position={[0, t.height + 0.12, 0]} castShadow><boxGeometry args={[side + 0.35, 0.24, side + 0.35]} /><meshStandardMaterial ref={roof} color="#323848" emissive={color} emissiveIntensity={0.15} roughness={0.5} /></mesh>
    </group>
  );
}

/** A book she pruned falls from its shelf, tumbling, and fades on the ground. */
function FallingBooks({ keeper, seen, motion }: { keeper: SceneProps["keeper"]; seen: Map<string, BookSlot & { color: string }>; motion: boolean }) {
  const falls = (keeper?.growth || []).filter((g) => g.kind === "prune" && g.id && seen.has(g.id) && Date.now() - g.at < 3600).slice(0, 6);
  return <>{falls.map((g) => <FallingBook key={`${g.id}:${g.at}`} slot={seen.get(g.id!)!} at={g.at} motion={motion} />)}</>;
}
function FallingBook({ slot, at, motion }: { slot: BookSlot & { color: string }; at: number; motion: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const [nx, nz] = normalOf(slot);
  useFrame(() => {
    const u = Math.min(1, (Date.now() - at) / 3400);
    if (!ref.current) return;
    const fall = motion ? Math.min(1, u * 1.6) : 1;
    const y = Math.max(BOOK.d / 2, slot.y - slot.y * fall * fall);
    ref.current.position.set(slot.x + nx * (0.5 + fall * 1.4), y, slot.z + nz * (0.5 + fall * 1.4));
    ref.current.rotation.set(fall * 1.5, slot.rot, fall * 0.6);
    if (mat.current) { mat.current.opacity = 1 - smooth(0.65, 1, u); mat.current.emissiveIntensity = (1 - u) * 1.5; }
  });
  return <mesh ref={ref} castShadow><boxGeometry args={[BOOK.w, BOOK.h, BOOK.d]} /><meshStandardMaterial ref={mat} color={slot.color} emissive={PRUNE} emissiveIntensity={1.5} transparent /></mesh>;
}

/** A ring on the ground where a tower was born (opening) or folded (closing). */
function GroundRings({ keeper, towers }: { keeper: SceneProps["keeper"]; towers: Map<string, Tower> }) {
  const rings = (keeper?.growth || []).filter((g) => (g.kind === "born" || g.kind === "gone") && g.section && towers.has(g.section) && Date.now() - g.at < 4000).slice(0, 4);
  return <>{rings.map((g) => <GroundRing key={`${g.kind}:${g.section}:${g.at}`} tower={towers.get(g.section!)!} at={g.at} opening={g.kind === "born"} />)}</>;
}
function GroundRing({ tower, at, opening }: { tower: Tower; at: number; opening: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const u = Math.min(1, (Date.now() - at) / 4000);
    const s = opening ? 0.3 + easeOut(u) * 2.2 : 2.2 * (1 - easeOut(u)) + 0.05;
    if (ref.current) ref.current.scale.setScalar(s * tower.half);
    if (mat.current) mat.current.opacity = (1 - u) * 0.9;
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[tower.x, 0.05, tower.z]}>
      <ringGeometry args={[0.92, 1, 64]} />
      <meshBasicMaterial ref={mat} color={opening ? cloudColor(tower.index) : "#b9a2ff"} transparent toneMapped={false} />
    </mesh>
  );
}

/** What she is doing, over her head (her speech bubble). */
function KeeperSay({ keeper }: { keeper: SceneProps["keeper"] }) {
  if (!keeper?.enabled || !keeper.running || !keeper.saying) return null;
  const resting = keeper.phase === "descansando";
  return (
    <Html position={[0, 2.5, 0]} center zIndexRange={[24, 14]} style={{ pointerEvents: "none" }}>
      <div className={`ar-say ${resting ? "rest" : ""}`}>{resting ? "zzz · descansando" : keeper.saying.text}</div>
    </Html>
  );
}

/** Each tower's name and how far she is in it; the callout at the best book of a question; a hovered book's title. */
function Labels({ settings, sections, keeper, agent, highlights, hoveredId, selectedId, A, clusterOf, nodeOf, used, here }: SceneProps & { A: ArchiveLayout; clusterOf: Map<string, { label: string; nodeIds: string[] }>; nodeOf: Map<string, SceneProps["graph"]["nodes"][number]>; used: string[]; here: number }) {
  if (!settings.labels) return null;
  const main = used[0] ? A.books.get(used[0]) : undefined;
  const mainNode = used[0] ? nodeOf.get(used[0]) : undefined;
  const score = used[0] ? highlights.get(used[0])?.score : undefined;
  const hover = hoveredId && hoveredId !== selectedId ? A.books.get(hoveredId) : undefined;
  return (
    <>
      {A.towers.map((t, i) => {
        const c = clusterOf.get(t.id); if (!c) return null;
        const st = sections.get(t.id);
        return (
          <Html key={t.id} position={[t.x, t.height + 1.1, t.z]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className={`ar-tower ${i === here ? "on" : ""}`} style={{ ["--c" as string]: cloudColor(t.index) }}>
              <b>{c.label}</b><span>{st ? `${st.read}/${st.total} · ${st.state}` : `${c.nodeIds.length} livros`}</span>
            </div>
          </Html>
        );
      })}
      {main && mainNode && agent && (
        <Html position={[main.x, main.y + 0.9, main.z]} zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
          <div className="lm-callout" style={{ ["--c" as string]: "#ff9a55" }}>
            <b>{agent.ended ? "usada na resposta" : "consultada"}{score != null ? ` · pontuação ${score.toFixed(2).replace(".", ",")}` : ""}</b>
            <span>{mainNode.memory.title}</span>
            <small>{clusterOf.get(mainNode.clusterId)?.label || "—"}{used.length > 1 ? ` · +${used.length - 1} livros` : ""}</small>
          </div>
        </Html>
      )}
      {hover && nodeOf.get(hoveredId!) && (
        <Html position={[hover.x, hover.y + 0.8, hover.z]} zIndexRange={[28, 18]} style={{ pointerEvents: "none" }}>
          <div className="ar-book">{nodeOf.get(hoveredId!)!.memory.title}</div>
        </Html>
      )}
    </>
  );
}

export default function ArchiveScene(props: SceneProps) {
  const high = props.settings.quality === "alta";
  // Leaving this scene drops its context on purpose: only a loss while it is shown is the graphics card's.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return (
    <Canvas
      className="lm-canvas"
      shadows={props.settings.quality !== "baixa"}
      dpr={high ? [1, 2] : 1}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ position: [30, 30, 45], fov: 42, near: 0.1, far: 2000 }}
      onCreated={({ gl }) => { gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); if (alive.current) props.onContextLost(); }, { once: true }); }}
    >
      <ArchiveWorld {...props} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI * 0.47} minDistance={4} maxDistance={400} target={[0, 2, 0]} />
      {props.settings.quality !== "baixa" && (
        <EffectComposer multisampling={high ? 4 : 0}>
          <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.85} luminanceSmoothing={0.2} radius={0.6} />
          <Vignette eskil={false} offset={0.25} darkness={0.6} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
