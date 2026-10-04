import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, PerspectiveCamera, OrthographicCamera, GizmoHelper, GizmoViewport, Html, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { groupKey, hash, memoryColor, memoryHealth, clusterColor, type Memory, type MemoryCluster } from "./data";
import { buildGraph, traceOrigin } from "./graph";

export type CameraCommand = {
  serial: number;
  view: "overview" | "front" | "top" | "side" | "inspect";
  id?: string;
};
type Props = {
  memories: Memory[];
  allMemories: Memory[];
  clusters: MemoryCluster[];
  /** Memories the chat just used: their stars pulse (id → time it was noticed). */
  pulses?: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onGroup: (key: string) => void;
  onCluster?: (id: number) => void;
  cad: boolean;
  wireframe: boolean;
  orthographic: boolean;
  motion: boolean;
  quality: "low" | "high";
  command: CameraCommand;
  onFallback: () => void;
  onStats: (stats: string) => void;
};

const FAILING = new THREE.Color("#e75e78");

// ---------- Stars: one draw call, a soft core + halo per memory, drawn by a shader ----------
const starVertex = /* glsl */ `
  attribute float aSize;
  attribute float aBright;
  attribute float aPhase;
  attribute float aVisible;
  attribute float aPulse;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vPulse;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float twinkle = 1.0 + 0.12 * sin(uTime * 1.7 + aPhase);
    float pulse = 1.0 + aPulse * 1.6;
    gl_PointSize = aSize * twinkle * pulse * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vAlpha = aBright * aVisible;
    vPulse = aPulse;
  }
`;
const starFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vPulse;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5) discard;
    float core = smoothstep(0.16, 0.0, d);
    float halo = exp(-d * d * 22.0);
    float ring = vPulse * smoothstep(0.06, 0.0, abs(d - (0.5 - vPulse * 0.35)));
    vec3 color = vColor * (0.55 + halo * 0.9) + vec3(1.0) * core * 0.85 + vColor * ring * 1.5;
    gl_FragColor = vec4(color, (core + halo * 0.75 + ring) * vAlpha);
  }
`;

type Target = { position: THREE.Vector3; size: number; bright: number; visible: number; color: THREE.Color };

function StarField({ memories, visible, selectedId, highlighted, hoveredId, dimUnused, pulses, motion, onSelect, onFocus, onHover }: {
  memories: Memory[];
  visible: Set<string>;
  selectedId: string | null;
  highlighted: Set<string>;
  hoveredId: string | null;
  dimUnused: boolean;
  pulses?: Map<string, number>;
  motion: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const { gl, size, invalidate } = useThree();
  const n = memories.length;
  // Buffers live as long as the set of memories; animation only rewrites their contents.
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const attr = (name: string, itemSize: number) => g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n * itemSize), itemSize));
    attr("position", 3); attr("aColor", 3); attr("aSize", 1); attr("aBright", 1); attr("aVisible", 1); attr("aPulse", 1); attr("aPhase", 1);
    memories.forEach((m, i) => { (g.getAttribute("aPhase") as THREE.BufferAttribute).setX(i, hash(m.id) * 6.28); });
    return g;
  }, [n, memories]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: starVertex, fragmentShader: starFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 300 } },
  }), []);
  useEffect(() => () => material.dispose(), [material]);

  // Where every star should be and how it should look; the frame loop eases toward it.
  const targets = useMemo<Target[]>(() => memories.map((m) => {
    const health = memoryHealth(m);
    const helped = m.stats?.helped ?? 0;
    const color = new THREE.Color(memoryColor(m));
    if (health.failing) color.lerp(FAILING, 0.8);
    const isSelected = m.id === selectedId;
    const near = highlighted.has(m.id);
    return {
      position: new THREE.Vector3(...m.position),
      size: (2.6 + Math.min(3, Math.log2(1 + helped) * 1)) * (isSelected ? 2.2 : near || m.id === hoveredId ? 1.45 : 1),
      bright: (dimUnused && health.unused ? 0.45 : 1) * (selectedId && !isSelected && !near ? 0.28 : 1),
      visible: visible.has(m.id) ? 1 : 0.07,
      color: isSelected ? color.clone().lerp(new THREE.Color("#ffffff"), 0.4) : color,
    };
  }), [memories, selectedId, highlighted, hoveredId, visible, dimUnused]);

  // With the render loop on demand (animation paused), changes still need a frame.
  useEffect(() => { invalidate(); }, [targets, invalidate]);

  // Entrance: stars start near the centre and fly out to their place.
  useEffect(() => {
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < n; i += 1) position.setXYZ(i, targets[i].position.x * 0.02, targets[i].position.y * 0.02, targets[i].position.z * 0.02);
    position.needsUpdate = true;
    // Only when the buffers are new (a new set of memories), not on every highlight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry]);

  useFrame((_, delta) => {
    material.uniforms.uTime.value += motion ? delta : 0;
    material.uniforms.uScale.value = size.height * gl.getPixelRatio() * 0.62;
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * (motion ? 4.5 : 60));
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const sz = geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const br = geometry.getAttribute("aBright") as THREE.BufferAttribute;
    const vis = geometry.getAttribute("aVisible") as THREE.BufferAttribute;
    const pul = geometry.getAttribute("aPulse") as THREE.BufferAttribute;
    const now = performance.now();
    for (let i = 0; i < n; i += 1) {
      const t = targets[i];
      pos.setXYZ(i, pos.getX(i) + (t.position.x - pos.getX(i)) * k, pos.getY(i) + (t.position.y - pos.getY(i)) * k, pos.getZ(i) + (t.position.z - pos.getZ(i)) * k);
      col.setXYZ(i, col.getX(i) + (t.color.r - col.getX(i)) * k, col.getY(i) + (t.color.g - col.getY(i)) * k, col.getZ(i) + (t.color.b - col.getZ(i)) * k);
      sz.setX(i, sz.getX(i) + (t.size - sz.getX(i)) * k);
      br.setX(i, br.getX(i) + (t.bright - br.getX(i)) * k);
      vis.setX(i, vis.getX(i) + (t.visible - vis.getX(i)) * k);
      const pulsedAt = pulses?.get(memories[i].id);
      const age = pulsedAt ? (now - pulsedAt) / 2600 : 1;
      pul.setX(i, age < 1 ? (1 - age) * (0.6 + 0.4 * Math.sin(age * 18)) : 0);
    }
    pos.needsUpdate = col.needsUpdate = sz.needsUpdate = br.needsUpdate = vis.needsUpdate = pul.needsUpdate = true;
    geometry.computeBoundingSphere();
  });

  if (!n) return null;
  return (
    <points
      geometry={geometry}
      material={material}
      onClick={(e) => {
        if (e.index === undefined || e.delta > 5 || !visible.has(memories[e.index].id)) return;
        e.stopPropagation();
        onSelect(memories[e.index].id);
      }}
      onDoubleClick={(e) => {
        if (e.index === undefined) return;
        e.stopPropagation();
        onFocus(memories[e.index].id);
      }}
      onPointerMove={(e) => {
        if (e.index === undefined || !visible.has(memories[e.index].id)) return;
        e.stopPropagation();
        document.body.style.cursor = "pointer";
        onHover(memories[e.index].id);
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
        onHover(null);
      }}
    />
  );
}

// ---------- Links: faint between similar memories; light pulses run along the selection's ----------
const linkVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aT;
  attribute float aActive;
  varying vec3 vColor;
  varying float vT;
  varying float vActive;
  void main() {
    vColor = aColor; vT = aT; vActive = aActive;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const linkFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vT;
  varying float vActive;
  void main() {
    float flow = pow(fract(vT * 3.0 - uTime * 0.9), 6.0);
    float a = mix(0.22, 0.55 + flow * 1.6, vActive);
    gl_FragColor = vec4(vColor * (1.0 + flow * vActive * 1.4), a);
  }
`;

function FlowLinks({ memories, visible, selectedId, origin, motion }: { memories: Memory[]; visible: Set<string>; selectedId: string | null; origin: Set<string>; motion: boolean }) {
  const material = useMemo(() => new THREE.ShaderMaterial({ vertexShader: linkVertex, fragmentShader: linkFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 } } }), []);
  useEffect(() => () => material.dispose(), [material]);
  const geometry = useMemo(() => {
    const byId = new Map(memories.map((m) => [m.id, m]));
    const positions: number[] = [], colors: number[] = [], ts: number[] = [], actives: number[] = [];
    const SEG = 10;
    const add = (a: Memory, b: Memory, color: THREE.Color, active: boolean, strength: number) => {
      const from = new THREE.Vector3(...a.position), to = new THREE.Vector3(...b.position);
      const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, from.distanceTo(to) * 0.12, 0));
      const pts = new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(SEG);
      const c = color.clone().multiplyScalar(active ? 1 : strength);
      for (let i = 0; i < SEG; i += 1) {
        positions.push(...pts[i].toArray(), ...pts[i + 1].toArray());
        colors.push(...c.toArray(), ...c.toArray());
        ts.push(i / SEG, (i + 1) / SEG);
        actives.push(active ? 1 : 0, active ? 1 : 0);
      }
    };
    const seen = new Set<string>();
    for (const m of memories) {
      if (!visible.has(m.id)) continue;
      const list = m.id === selectedId ? m.neighbors : m.neighbors?.slice(0, 1);
      for (const nb of list ?? []) {
        const other = byId.get(nb.id);
        const key = [m.id, nb.id].sort().join("|");
        if (!other || seen.has(key) || !visible.has(other.id)) continue;
        seen.add(key);
        const active = m.id === selectedId || nb.id === selectedId;
        if (selectedId && !active) continue;
        add(m, other, new THREE.Color(memoryColor(m)), active, 0.12 + (nb.similarity - 0.72) * 0.9);
      }
      for (const id of m.relations) {
        const other = byId.get(id);
        if (!other || !visible.has(id)) continue;
        const active = m.id === selectedId || id === selectedId || (origin.has(m.id) && origin.has(id));
        if (selectedId && !active) continue;
        add(m, other, new THREE.Color("#c9b8ff"), active, 0.09);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(ts, 1));
    g.setAttribute("aActive", new THREE.Float32BufferAttribute(actives, 1));
    return g;
  }, [memories, visible, selectedId, origin]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, delta) => { if (motion) material.uniforms.uTime.value += delta; });
  return <lineSegments geometry={geometry} material={material} />;
}

// ---------- Nebulae: a soft glow of each topic's colour behind its stars ----------
function nebulaTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.35, "rgba(255,255,255,0.28)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function Nebulae({ clusters, memories, visible, dim, motion }: { clusters: MemoryCluster[]; memories: Memory[]; visible: Set<string>; dim: boolean; motion: boolean }) {
  const texture = useMemo(nebulaTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const group = useRef<THREE.Group>(null);
  const clouds = useMemo(() => clusters.filter((c) => c.id >= 0).map((c) => {
    const members = memories.filter((m) => m.cluster === c.id);
    const center = new THREE.Vector3(...c.center);
    const spread = Math.sqrt(members.reduce((s, m) => s + center.distanceToSquared(new THREE.Vector3(...m.position)), 0) / Math.max(members.length, 1));
    return { id: c.id, center, scale: Math.max(10, spread * 2.6), color: new THREE.Color(clusterColor(c.id, "#5fd4c0")), shown: members.some((m) => visible.has(m.id)) };
  }), [clusters, memories, visible]);
  useFrame((state) => {
    if (!group.current) return;
    group.current.children.forEach((sprite, i) => {
      const cloud = clouds[i];
      if (!cloud) return;
      const breathe = motion ? 1 + Math.sin(state.clock.elapsedTime * 0.4 + i) * 0.05 : 1;
      sprite.scale.setScalar(cloud.scale * breathe);
      const material = (sprite as THREE.Sprite).material as THREE.SpriteMaterial;
      const target = cloud.shown ? (dim ? 0.05 : 0.16) : 0.02;
      material.opacity += (target - material.opacity) * 0.08;
    });
  });
  return (
    <group ref={group}>
      {clouds.map((c) => (
        <sprite key={c.id} position={c.center} scale={c.scale}>
          <spriteMaterial map={texture} color={c.color} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
    </group>
  );
}

function CameraRig({ command, allMemories, motion, drift }: { command: CameraCommand; allMemories: Memory[]; motion: boolean; drift: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size, invalidate } = useThree();
  const travel = useRef<{ position: THREE.Vector3; target: THREE.Vector3; zoom: number } | null>(null);
  const bounds = useMemo(() => {
    const box = new THREE.Box3();
    allMemories.forEach((m) => box.expandByPoint(new THREE.Vector3(...m.position)));
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(30, 30, 30));
    const extent = box.getSize(new THREE.Vector3());
    return { center: box.getCenter(new THREE.Vector3()), radius: Math.max(10, Math.max(extent.x, extent.y, extent.z) * 0.62) };
  }, [allMemories]);
  useEffect(() => {
    const selected = allMemories.find((m) => m.id === command.id);
    const inspecting = command.view !== "overview" && selected;
    const target = inspecting ? new THREE.Vector3(...selected.position) : bounds.center.clone();
    const radius = inspecting ? 9 : bounds.radius;
    const aspect = size.width / size.height;
    const distance = (radius / Math.sin(Math.atan(Math.tan((48 * Math.PI) / 360) * Math.min(1, aspect)))) * 0.92;
    const direction =
      command.view === "front" ? new THREE.Vector3(0, 0, 1)
        : command.view === "top" ? new THREE.Vector3(0, 0.999, 0.001)
          : command.view === "side" ? new THREE.Vector3(1, 0, 0)
            : inspecting ? camera.position.clone().sub(target).normalize()
              : new THREE.Vector3(0.3, 0.45, 1);
    travel.current = { target, position: target.clone().addScaledVector(direction.normalize(), distance), zoom: Math.min(size.width, size.height) / (2.2 * radius) };
    invalidate();
    // The camera position is read once per command (fly from where it is), not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, bounds, size.width, size.height, invalidate]);
  useFrame((_, delta) => {
    const next = travel.current;
    if (!next || !controls.current) return;
    const alpha = motion ? 1 - Math.exp(-Math.min(delta, 0.1) * 5) : 1;
    camera.position.lerp(next.position, alpha);
    controls.current.target.lerp(next.target, alpha);
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = THREE.MathUtils.lerp(camera.zoom, next.zoom, alpha);
      camera.updateProjectionMatrix();
    }
    controls.current.update();
    if (camera.position.distanceTo(next.position) < 0.015 && controls.current.target.distanceTo(next.target) < 0.015) travel.current = null;
    else invalidate();
  });
  // A slow orbit makes the constellation read as 3D; it stops on hover or selection.
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={motion}
      dampingFactor={0.08}
      autoRotate={drift}
      autoRotateSpeed={0.3}
      minDistance={2}
      maxDistance={Math.max(bounds.radius * 12, 200)}
      minZoom={0.05}
      maxZoom={250}
      onStart={() => {
        travel.current = null;
      }}
    />
  );
}

/**
 * fps meter + automatic quality: when the scene runs slow for a few seconds
 * the canvas resolution steps down (responsive on weak machines), and back up
 * when there is room.
 */
function Metrics({ onStats }: { onStats: Props["onStats"] }) {
  const { gl, setDpr } = useThree();
  const dpr = useRef(Math.min(window.devicePixelRatio, 1.5));
  useEffect(() => {
    const previous = gl.info.autoReset;
    gl.info.autoReset = false;
    return () => { gl.info.autoReset = previous; };
  }, [gl]);
  const elapsed = useRef(0), frames = useRef(0);
  useFrame((_, delta) => {
    elapsed.current += delta;
    frames.current++;
    if (elapsed.current > 2) {
      const fps = frames.current / elapsed.current;
      if (fps < 32 && dpr.current > 0.75) { dpr.current = Math.max(0.75, dpr.current - 0.25); setDpr(dpr.current); }
      else if (fps > 55 && dpr.current < Math.min(window.devicePixelRatio, 1.5)) { dpr.current = Math.min(dpr.current + 0.25, 1.5); setDpr(dpr.current); }
      onStats(`${Math.round(fps)} fps · ${gl.info.render.calls} chamadas · resolução ${dpr.current.toFixed(2)}×`);
      elapsed.current = 0;
      frames.current = 0;
    }
    gl.info.reset();
  }, -100);
  return null;
}

function SceneContent(props: Props) {
  const { memories, allMemories, clusters, pulses, selectedId, onSelect, onFocus, onGroup, onCluster, cad, orthographic, motion, command, onStats } = props;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const graph = useMemo(() => buildGraph(allMemories), [allMemories]);
  const visible = useMemo(() => new Set(memories.map((m) => m.id)), [memories]);
  const origin = useMemo(() => traceOrigin(allMemories, selectedId), [allMemories, selectedId]);
  const selected = graph.byId.get(selectedId || "");
  const hovered = graph.byId.get(hoveredId || "");
  const highlighted = useMemo(() => {
    const set = new Set(origin.nodeIds);
    if (selected) {
      selected.relations.forEach((id) => set.add(id));
      selected.neighbors?.forEach((n) => set.add(n.id));
      graph.incoming.get(selected.id)?.forEach((e) => set.add(e.from.id));
      allMemories.forEach((m) => { if (m.neighbors?.some((n) => n.id === selected.id)) set.add(m.id); });
    }
    return set;
  }, [origin, selected, graph, allMemories]);
  useEffect(() => () => { document.body.style.cursor = "auto"; }, []);
  // Dimming "never used" only means something once usage data exists for a fair share.
  const dimUnused = useMemo(() => {
    const tracked = allMemories.filter((m) => m.stats);
    return tracked.length > 0 && tracked.filter((m) => (m.stats?.uses ?? 0) > 0).length >= tracked.length * 0.2;
  }, [allMemories]);
  const floor = useMemo(() => Math.min(-14, ...allMemories.map((m) => m.position[1])) - 4, [allMemories]);
  const labels = clusters.length
    ? clusters.filter((c) => c.id >= 0 && c.count > 0 && memories.some((m) => m.cluster === c.id)).map((c) => ({ key: `c${c.id}`, text: c.label, count: c.count, color: clusterColor(c.id, "#5fd4c0"), position: c.center, onClick: () => onCluster?.(c.id) }))
    : graph.groups.filter((g) => memories.some((m) => groupKey(m) === g.label)).map((g) => ({ key: g.id, text: g.label, count: g.count, color: g.color, position: g.position, onClick: () => onGroup(g.label) }));
  const focusMemory = hovered || selected;
  return (
    <>
      <PerspectiveCamera makeDefault={!orthographic} position={[25, 35, 90]} fov={48} near={0.1} far={100000} />
      <OrthographicCamera makeDefault={orthographic} position={[25, 35, 90]} zoom={12} near={0.1} far={100000} />
      <color attach="background" args={["#060709"]} />
      <fog attach="fog" args={["#060709", 110, 300]} />
      {props.quality === "high" && <Stars radius={200} depth={90} count={2200} factor={2.4} saturation={0} fade speed={motion ? 0.3 : 0} />}
      {cad && (
        <>
          <Grid position={[0, floor, 0]} args={[200, 200]} cellSize={4} sectionSize={20} cellColor="#14171b" sectionColor="#22272d" cellThickness={0.4} sectionThickness={0.6} fadeDistance={170} infiniteGrid />
          <axesHelper args={[10]} />
        </>
      )}
      <Nebulae clusters={clusters} memories={allMemories} visible={visible} dim={!!selectedId} motion={motion} />
      <FlowLinks memories={allMemories} visible={visible} selectedId={selectedId} origin={origin.nodeIds} motion={motion} />
      <StarField
        memories={allMemories}
        visible={visible}
        selectedId={selectedId}
        highlighted={highlighted}
        hoveredId={hoveredId}
        dimUnused={dimUnused}
        pulses={pulses}
        motion={motion}
        onSelect={onSelect}
        onFocus={onFocus}
        onHover={setHoveredId}
      />
      {!selectedId && labels.map((l) => (
        <Html key={l.key} position={[l.position[0], l.position[1] + 5, l.position[2]]} center zIndexRange={[20, 0]}>
          <button className="topic-label" onClick={l.onClick}>
            <i style={{ background: l.color }} />
            {l.text}
            <small>{l.count}</small>
          </button>
        </Html>
      ))}
      {focusMemory && visible.has(focusMemory.id) && (
        <Html position={focusMemory.position} zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
          <div className="star-tooltip">
            <strong>{focusMemory.title}</strong>
            {focusMemory.stats && (
              <small>
                {focusMemory.stats.uses}× usada · ajudou {focusMemory.stats.helped} · falhou {focusMemory.stats.failed}
              </small>
            )}
          </div>
        </Html>
      )}
      <CameraRig command={command} allMemories={allMemories} motion={motion} drift={motion && !selectedId && !hoveredId} />
      <GizmoHelper alignment="bottom-right" margin={[58, 100]}>
        <GizmoViewport axisColors={["#e75e78", "#55a583", "#6aa6ff"]} labelColor="white" />
      </GizmoHelper>
      <Metrics onStats={onStats} />
      {props.quality === "high" && (
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.9} luminanceThreshold={0.25} luminanceSmoothing={0.6} mipmapBlur radius={0.75} />
          <Vignette eskil={false} offset={0.22} darkness={0.6} />
        </EffectComposer>
      )}
    </>
  );
}

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ContextGuard({ onLost }: { onLost: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const lost = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => gl.domElement.removeEventListener("webglcontextlost", lost);
  }, [gl, onLost]);
  return null;
}

export default function MemoryScene(props: Props) {
  const [lost, setLost] = useState(false);
  const fallback = (
    <div className="scene-fallback">
      <h2>Visualização 3D indisponível</h2>
      <p>Suas memórias continuam disponíveis na lista.</p>
      <button onClick={props.onFallback}>Abrir lista de memórias</button>
    </div>
  );
  if (lost) return fallback;
  return (
    <SceneBoundary fallback={fallback}>
      <Canvas
        frameloop={props.motion ? "always" : "demand"}
        dpr={props.quality === "low" ? 1 : [1, 1.5]}
        gl={{ antialias: props.quality === "high", powerPreference: "high-performance" }}
        raycaster={{ params: { Points: { threshold: 1.1 }, Mesh: {}, Line: { threshold: 0.2 }, LOD: {}, Sprite: {} } }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
        fallback={fallback}
      >
        <ContextGuard onLost={() => setLost(true)} />
        <SceneContent {...props} />
      </Canvas>
    </SceneBoundary>
  );
}
