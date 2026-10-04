import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Html } from "@react-three/drei";
import * as THREE from "three";
import { groupKey, hash, memoryOrigin, type Memory, type MemoryCluster, type Origin } from "./data";
import { ORIGINS, type Life } from "./Symbiosis";

/**
 * "Neural network" view of the memory: layers from left to right —
 *   origin (you · Aurora · this PC) → topics → memories → outcome
 * — joined by bundles of glowing fibres whose colour runs from layer to
 * layer. Light pulses travel along them at the live pace of each origin.
 */
type Outcome = "helped" | "used" | "never" | "failed";
export const OUTCOMES: Record<Outcome, { label: string; color: string }> = {
  helped: { label: "Ajudou", color: "#f5e663" },
  used: { label: "Usada", color: "#7ee0a1" },
  never: { label: "Nunca usada", color: "#5b7cfa" },
  failed: { label: "Falhou", color: "#ff5d73" },
};
const OUTCOME_ORDER: Outcome[] = ["helped", "used", "never", "failed"];
const TOPIC_COLOR = "#c04bff";
export const MEMORY_COLOR = "#2ff5c0";
const ORIGIN_ORDER: Origin[] = ["user", "aurora", "pc"];
const CHANNEL: Record<Origin, number> = { user: 0, aurora: 1, pc: 2 };

export function outcomeOf(m: Memory): Outcome {
  const s = m.stats;
  if (!s) return "never";
  if (s.failed >= 2 && s.failed > s.helped) return "failed";
  if (s.helped > 0) return "helped";
  if (s.uses > 0) return "used";
  return "never";
}

type Hub = { key: string; label: string; count: number; color: string; position: THREE.Vector3; side: "left" | "right" | "top" };
type Fiber = { from: THREE.Vector3; to: THREE.Vector3; c0: THREE.Color; c1: THREE.Color; channel: number; strands: number; spread: number; ids: string[]; dim: number };
export type NetLayout = {
  positions: Map<string, [number, number, number]>;
  origins: Record<Origin, THREE.Vector3>;
  topics: Hub[];
  outcomes: Hub[];
  fibers: Fiber[];
  extent: THREE.Vector3[];
};

const COLUMNS = 4;
const X = { origin: -96, topic: -50, memory: -8, outcome: 74 };

export function neuralLayout(memories: Memory[], clusters: MemoryCluster[]): NetLayout {
  const topicKey = (m: Memory) => (m.cluster !== undefined ? `c${m.cluster}` : `g:${groupKey(m)}`);
  const topicLabel = (key: string) => (key.startsWith("c") ? clusters.find((c) => `c${c.id}` === key)?.label || "sem assunto" : key.slice(2));
  const byTopic = new Map<string, Memory[]>();
  memories.forEach((m) => byTopic.set(topicKey(m), [...(byTopic.get(topicKey(m)) || []), m]));
  const topicOrder = [...byTopic.keys()].sort((a, b) => byTopic.get(b)!.length - byTopic.get(a)!.length);
  // Big topic in the middle, smaller ones alternating above and below: fans stay short.
  const arranged: string[] = [];
  topicOrder.forEach((k, i) => (i % 2 ? arranged.push(k) : arranged.unshift(k)));

  // Memories: a block of columns, topic by topic, most used first.
  const ordered = arranged.flatMap((k) => [...byTopic.get(k)!].sort((a, b) => (b.stats?.uses ?? 0) - (a.stats?.uses ?? 0)));
  const rows = Math.ceil(ordered.length / COLUMNS);
  const rowStep = Math.min(3.4, 92 / Math.max(rows, 1));
  const positions = new Map<string, [number, number, number]>();
  ordered.forEach((m, i) => {
    const row = Math.floor(i / COLUMNS), col = i % COLUMNS;
    positions.set(m.id, [X.memory + col * 11 + (row % 2) * 2, ((rows - 1) / 2 - row) * rowStep, (hash(m.id) - 0.5) * 6]);
  });

  // Topic hubs sit at the height of their memories, pushed apart so labels breathe.
  const topicY = arranged.map((k) => byTopic.get(k)!.reduce((s, m) => s + positions.get(m.id)![1], 0) / byTopic.get(k)!.length);
  for (let i = 1; i < topicY.length; i += 1) if (topicY[i - 1] - topicY[i] < 11) topicY[i] = topicY[i - 1] - 11;
  const shift = (topicY[0] + topicY[topicY.length - 1]) / 2;
  const topics: Hub[] = arranged.map((k, i) => ({ key: k, label: topicLabel(k), count: byTopic.get(k)!.length, color: TOPIC_COLOR, position: new THREE.Vector3(X.topic, topicY[i] - shift, 0), side: "top" }));
  const topicPos = new Map(topics.map((t) => [t.key, t.position]));

  const origins = { user: new THREE.Vector3(X.origin, 34, 0), aurora: new THREE.Vector3(X.origin, 0, 0), pc: new THREE.Vector3(X.origin, -34, 0) } as Record<Origin, THREE.Vector3>;
  const outcomeCount: Record<Outcome, number> = { helped: 0, used: 0, never: 0, failed: 0 };
  memories.forEach((m) => (outcomeCount[outcomeOf(m)] += 1));
  const outcomes: Hub[] = OUTCOME_ORDER.map((o, i) => ({ key: o, label: OUTCOMES[o].label, count: outcomeCount[o], color: OUTCOMES[o].color, position: new THREE.Vector3(X.outcome, 36 - i * 24, 0), side: "right" }));
  const outcomePos = new Map(outcomes.map((o) => [o.key, o.position]));

  const fibers: Fiber[] = [];
  const topicColor = new THREE.Color(TOPIC_COLOR), memoryColor = new THREE.Color(MEMORY_COLOR);
  // Origin → topic: one bundle per pair, thicker the more memories it carries.
  for (const origin of ORIGIN_ORDER) {
    for (const k of arranged) {
      const members = byTopic.get(k)!.filter((m) => memoryOrigin(m) === origin);
      if (!members.length) continue;
      fibers.push({ from: origins[origin], to: topicPos.get(k)!, c0: new THREE.Color(ORIGINS[origin].color), c1: topicColor, channel: CHANNEL[origin], strands: Math.min(9, 2 + Math.ceil(Math.sqrt(members.length) * 1.4)), spread: 2.2, ids: members.map((m) => m.id), dim: 1 });
    }
  }
  for (const m of ordered) {
    const p = new THREE.Vector3(...positions.get(m.id)!);
    const channel = CHANNEL[memoryOrigin(m)];
    const outcome = outcomeOf(m);
    fibers.push({ from: topicPos.get(topicKey(m))!, to: p, c0: topicColor, c1: memoryColor, channel, strands: 2, spread: 0.9, ids: [m.id], dim: 1 });
    fibers.push({ from: p, to: outcomePos.get(outcome)!, c0: memoryColor, c1: new THREE.Color(OUTCOMES[outcome].color), channel, strands: 1, spread: 0, ids: [m.id], dim: outcome === "never" ? 0.55 : 1 });
  }
  const extent = [...Object.values(origins), ...outcomes.map((o) => o.position), ...topics.map((t) => t.position), ...[...positions.values()].map((p) => new THREE.Vector3(...p))];
  extent.push(new THREE.Vector3(X.outcome + 30, 0, 0), new THREE.Vector3(X.origin - 36, 0, 0));
  return { positions, origins, topics, outcomes, fibers, extent };
}

// ---------- Fibres ----------
const fiberVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aT;
  attribute float aChannel;
  attribute float aSeed;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vT;
  varying float vChannel;
  varying float vSeed;
  varying float vAlpha;
  void main() {
    vColor = aColor; vT = aT; vChannel = aChannel; vSeed = aSeed; vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const fiberFragment = /* glsl */ `
  uniform vec3 uPhase;
  uniform vec3 uEnergy;
  varying vec3 vColor;
  varying float vT;
  varying float vChannel;
  varying float vSeed;
  varying float vAlpha;
  void main() {
    float phase = vChannel < 0.5 ? uPhase.x : vChannel < 1.5 ? uPhase.y : uPhase.z;
    float energy = vChannel < 0.5 ? uEnergy.x : vChannel < 1.5 ? uEnergy.y : uEnergy.z;
    float pulse = pow(fract(vT * 1.5 - phase + vSeed), 14.0);
    vec3 color = vColor * (0.85 + pulse * (1.2 + energy));
    gl_FragColor = vec4(color, vAlpha * (0.16 + pulse * (0.55 + energy * 0.45)));
  }
`;
const SEGMENTS = 28;

export function NeuralFibers({ net, visible, selectedId, life, motion }: { net: NetLayout; visible: Set<string>; selectedId: string | null; life: MutableRefObject<Life>; motion: boolean }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: fiberVertex, fragmentShader: fiberFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPhase: { value: new THREE.Vector3() }, uEnergy: { value: new THREE.Vector3() } },
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  const geometry = useMemo(() => {
    const positions: number[] = [], colors: number[] = [], ts: number[] = [], channels: number[] = [], seeds: number[] = [], alphas: number[] = [];
    const curve = new THREE.CubicBezierCurve3();
    const color = new THREE.Color();
    net.fibers.forEach((f, fi) => {
      const shown = f.ids.filter((id) => visible.has(id)).length;
      if (!shown) return;
      const touched = selectedId ? f.ids.includes(selectedId) : false;
      const alpha = f.dim * (selectedId ? (touched ? 2.4 : 0.25) : 1) * Math.min(1, 0.4 + shown / f.ids.length);
      for (let s = 0; s < f.strands; s += 1) {
        const off = (s - (f.strands - 1) / 2) * f.spread;
        const zOff = (hash(`${fi}:${s}`) - 0.5) * f.spread * 2;
        const dx = (f.to.x - f.from.x) * 0.5;
        curve.v0.copy(f.from);
        curve.v1.set(f.from.x + dx, f.from.y + off, f.from.z + zOff);
        curve.v2.set(f.to.x - dx, f.to.y + off * 0.4, f.to.z + zOff * 0.5);
        curve.v3.copy(f.to);
        const pts = curve.getPoints(SEGMENTS);
        const seed = hash(`${fi}-${s}`);
        for (let i = 0; i < SEGMENTS; i += 1) {
          for (const j of [i, i + 1]) {
            const t = j / SEGMENTS;
            positions.push(pts[j].x, pts[j].y, pts[j].z);
            color.copy(f.c0).lerp(f.c1, t);
            colors.push(color.r, color.g, color.b);
            ts.push(t);
            channels.push(f.channel);
            seeds.push(seed);
            alphas.push(alpha);
          }
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(ts, 1));
    g.setAttribute("aChannel", new THREE.Float32BufferAttribute(channels, 1));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
    g.setAttribute("aAlpha", new THREE.Float32BufferAttribute(alphas, 1));
    return g;
  }, [net, visible, selectedId]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, delta) => {
    const L = life.current;
    const energy = material.uniforms.uEnergy.value as THREE.Vector3;
    energy.set(L.user, L.think, Math.max(L.cpu, L.gpu));
    if (!motion) return;
    const phase = material.uniforms.uPhase.value as THREE.Vector3;
    // Each origin's light runs at its own live pace.
    phase.x = (phase.x + delta * (0.12 + L.user * 0.6)) % 1;
    phase.y = (phase.y + delta * (0.15 + L.think * 0.9)) % 1;
    phase.z = (phase.z + delta * (0.08 + Math.max(L.cpu, L.gpu) * 0.8)) % 1;
  });
  return <lineSegments geometry={geometry} material={material} raycast={() => null} />;
}

// ---------- Hubs (topics, outcomes) ----------
function hubTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.85)");
  g.addColorStop(0.32, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function HubNode({ hub, texture, onClick }: { hub: Hub; texture: THREE.Texture; onClick?: () => void }) {
  const size = 2.6 + Math.min(3, Math.sqrt(hub.count) * 0.45);
  const ring = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ring.current) ring.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 1.3 + hub.position.y) * 0.04);
  });
  return (
    <group position={hub.position}>
      <Billboard>
        <sprite scale={size * 3}>
          <spriteMaterial map={texture} color={hub.color} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
        <sprite scale={size * 0.9}>
          <spriteMaterial map={texture} color="#ffffff" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
        <mesh ref={ring}>
          <ringGeometry args={[size * 0.62, size * 0.7, 48]} />
          <meshBasicMaterial color={hub.color} transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </Billboard>
      <Html position={hub.side === "right" ? [size + 1.5, 0, 0] : hub.side === "left" ? [-size - 1.5, 0, 0] : [0, size + 2.2, 0]} center={hub.side === "top"} zIndexRange={[18, 0]}>
        <button className={`net-label ${hub.side}`} style={{ color: hub.color }} onClick={onClick} disabled={!onClick}>
          {hub.label}
          <small>{hub.count}</small>
        </button>
      </Html>
    </group>
  );
}

export function NetHubs({ net, onTopic }: { net: NetLayout; onTopic: (key: string) => void }) {
  const texture = useMemo(hubTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <>
      {net.topics.map((t) => <HubNode key={t.key} hub={t} texture={texture} onClick={() => onTopic(t.key)} />)}
      {net.outcomes.filter((o) => o.count > 0).map((o) => <HubNode key={o.key} hub={o} texture={texture} />)}
    </>
  );
}
