import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html } from "@react-three/drei";
import * as THREE from "three";
import { hash, memoryOrigin, type Memory, type Origin } from "./data";
import type { SystemVitals } from "./api";

/**
 * Symbiosis: the memory constellation as one organism made of three parts —
 * you, Aurora and this PC. Each is an anchor around the map, and energy runs
 * from it to the memories that came from it, at the pace of what is really
 * happening: your pointer, Aurora thinking, the machine's load.
 */
export type Life = {
  user: number;
  think: number;
  cpu: number;
  ram: number;
  gpu: number;
  dim: number;
  mouse: THREE.Vector2;
  lastMove: number;
};
export const newLife = (): Life => ({ user: 0, think: 0, cpu: 0, ram: 0, gpu: 0, dim: 0, mouse: new THREE.Vector2(), lastMove: -10 });

export const ORIGINS: Record<Origin, { name: string; color: string }> = {
  user: { name: "Você", color: "#ffd166" },
  aurora: { name: "Aurora", color: "#b69cff" },
  pc: { name: "Este PC", color: "#4fd1e8" },
};
const ORDER: Origin[] = ["user", "aurora", "pc"];

const ease = (value: number, target: number, rate: number, delta: number) => value + (target - value) * (1 - Math.exp(-rate * Math.min(delta, 0.1)));

/** Turns pointer movement and the live vitals into smooth 0..1 signals every frame. */
export function LifeDriver({ life, vitals, dim }: { life: MutableRefObject<Life>; vitals: SystemVitals | null | undefined; dim: boolean }) {
  const vitalsRef = useRef(vitals);
  vitalsRef.current = vitals;
  useFrame((state, delta) => {
    const L = life.current;
    const t = state.clock.elapsedTime;
    if (state.pointer.x !== L.mouse.x || state.pointer.y !== L.mouse.y) {
      L.mouse.copy(state.pointer);
      L.lastMove = t;
    }
    const v = vitalsRef.current;
    L.user = ease(L.user, t - L.lastMove < 1.2 ? 1 : 0, t - L.lastMove < 1.2 ? 3 : 0.7, delta);
    L.think = ease(L.think, v?.aurora.thinking ? 1 : 0, 2, delta);
    L.cpu = ease(L.cpu, v?.cpu ?? 0, 2, delta);
    L.ram = ease(L.ram, v?.memory ?? 0, 2, delta);
    L.gpu = ease(L.gpu, v?.gpu?.load ?? 0, 2, delta);
    L.dim = ease(L.dim, dim ? 1 : 0, 4, delta);
  }, -50);
  return null;
}

/** Where the three anchors sit: a triangle around the constellation, facing the default view. */
export function anchorLayout(memories: Memory[]) {
  const box = new THREE.Box3();
  memories.forEach((m) => box.expandByPoint(new THREE.Vector3(...m.position)));
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(30, 30, 30));
  const center = box.getCenter(new THREE.Vector3());
  // Just outside the farthest memory: the anchors never sit on top of a group.
  const far = memories.reduce((max, m) => Math.max(max, center.distanceTo(new THREE.Vector3(...m.position))), 0);
  const d = Math.max(16, far + 5);
  // Offsets in view space: the anchors stay around the map however the camera turns.
  const at = (angle: number) => new THREE.Vector3(Math.cos(angle) * d * 1.2, Math.sin(angle) * d * 0.72, 0);
  return {
    center,
    reach: d,
    offsets: { user: at(Math.PI / 2), aurora: at(Math.PI * 1.04), pc: at(-Math.PI * 0.04) } as Record<Origin, THREE.Vector3>,
  };
}

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, "rgba(255,255,255,0.75)");
  g.addColorStop(0.4, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

// A ring that lights up from the top, clockwise, up to `uValue` (a gauge), with a faint track.
const arcVertex = /* glsl */ `
  varying vec2 vP;
  void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const arcFragment = /* glsl */ `
  uniform float uValue;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vP;
  void main() {
    float a = atan(vP.x, vP.y);
    a = (a < 0.0 ? a + 6.28318 : a) / 6.28318;
    float lit = step(a, uValue);
    float head = smoothstep(0.035, 0.0, abs(a - uValue)) * step(0.001, uValue);
    gl_FragColor = vec4(uColor * (1.0 + head * 0.6), (0.08 + lit * 0.6 + head * 0.6) * uOpacity);
  }
`;
function arcMaterial(color: string) {
  return new THREE.ShaderMaterial({
    vertexShader: arcVertex,
    fragmentShader: arcFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uValue: { value: 0 }, uOpacity: { value: 1 }, uColor: { value: new THREE.Color(color) } },
  });
}

function Anchor({ origin, position, scale, life, texture, count, detail, motion, side }: {
  side?: "left" | "right";
  origin: Origin;
  position: THREE.Vector3;
  scale: number;
  life: MutableRefObject<Life>;
  texture: THREE.Texture;
  count: number;
  detail: string;
  motion: boolean;
}) {
  const { color, name } = ORIGINS[origin];
  const core = useRef<THREE.Sprite>(null);
  const halo = useRef<THREE.Sprite>(null);
  const rings = useRef<THREE.Group>(null);
  const gauges = useMemo(() => (origin === "pc" ? ["#4fd1e8", "#7ee0a1", "#ff9e64"] : origin === "aurora" ? [color, color] : []).map(arcMaterial), [origin, color]);
  useEffect(() => () => gauges.forEach((g) => g.dispose()), [gauges]);
  const clock = useRef(0);
  useFrame((_, delta) => {
    const L = life.current;
    if (motion) clock.current += delta;
    const t = clock.current;
    const fade = 1 - L.dim * 0.7;
    let beat = 0;
    if (origin === "aurora") {
      // A heartbeat (two close beats); it quickens while Aurora is thinking.
      const phase = (t * (0.75 + L.think * 1.25)) % 1;
      beat = Math.exp(-((phase - 0.05) ** 2) / 0.003) + 0.55 * Math.exp(-((phase - 0.22) ** 2) / 0.003);
    } else if (origin === "user") beat = L.user * 0.7 + 0.12 * (1 + Math.sin(t * 1.4));
    else beat = L.cpu * 0.8 + 0.08 * (1 + Math.sin(t * 0.9));
    core.current?.scale.setScalar(1.8 * (1 + beat * 0.3));
    if (halo.current) {
      halo.current.scale.setScalar(7 * (1 + beat * 0.25));
      (halo.current.material as THREE.SpriteMaterial).opacity = (0.1 + beat * 0.16) * fade;
    }
    (core.current?.material as THREE.SpriteMaterial | undefined)?.setValues({ opacity: 0.8 * fade });
    if (origin === "user") {
      // Ripples: you are touching the map.
      rings.current?.children.forEach((ring, i) => {
        const p = (t * 0.45 + i / 3) % 1;
        ring.scale.setScalar(2.2 + p * 4.4);
        ((ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - p) * (0.08 + L.user * 0.55) * fade;
      });
    } else if (origin === "aurora") {
      gauges[0].uniforms.uValue.value = 0.25 + L.think * 0.5;
      gauges[1].uniforms.uValue.value = 0.12 + L.think * 0.3;
      if (rings.current) {
        rings.current.children[0].rotation.z = -t * (0.35 + L.think * 2.4);
        rings.current.children[1].rotation.z = t * (0.25 + L.think * 1.6);
      }
      gauges.forEach((g) => (g.uniforms.uOpacity.value = (0.35 + L.think * 0.4) * fade));
    } else {
      // Three gauges: CPU, RAM, GPU.
      gauges[0].uniforms.uValue.value = L.cpu;
      gauges[1].uniforms.uValue.value = L.ram;
      gauges[2].uniforms.uValue.value = L.gpu;
      gauges.forEach((g) => (g.uniforms.uOpacity.value = 0.6 * fade));
    }
  });
  const below = true;
  return (
    <group position={position}>
      <Billboard scale={scale}>
        <sprite ref={halo} scale={11}>
          <spriteMaterial map={texture} color={color} transparent opacity={0.25} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
        <sprite ref={core} scale={2.4}>
          <spriteMaterial map={texture} color="#ffffff" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
        <group ref={rings}>
          {origin === "user" &&
            [0, 1, 2].map((i) => (
              <mesh key={i}>
                <ringGeometry args={[0.96, 1, 64]} />
                <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
              </mesh>
            ))}
          {origin !== "user" &&
            gauges.map((material, i) => (
              <mesh key={i} material={material}>
                <ringGeometry args={[3 + i * 0.85, 3.32 + i * 0.85, 96]} />
              </mesh>
            ))}
        </group>
      </Billboard>
      <Html position={side ? [(side === "left" ? -6.5 : 6.5) * scale, 0, 0] : [0, (below ? -7.6 : 7.6) * scale, 0]} center={!side} zIndexRange={[15, 0]} style={{ pointerEvents: "none" }}>
        <div className={`anchor-label ${origin} ${side || ""}`}>
          <strong style={{ color }}>{name}</strong>
          <span>{detail}</span>
          <small>{count} {count === 1 ? "memória" : "memórias"}</small>
        </div>
      </Html>
    </group>
  );
}

// Energy: small comets that run between each anchor and its memories.
const flowVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aSize;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
    vColor = aColor; vAlpha = aAlpha;
  }
`;
const flowFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float glow = exp(-d * d * 18.0);
    gl_FragColor = vec4(vColor * (0.6 + glow), glow * vAlpha);
  }
`;
const TRAIL = 7;

function EnergyFlows({ memories, visible, layout, life, motion }: {
  memories: Memory[];
  visible: Set<string>;
  layout: ReturnType<typeof anchorLayout>;
  life: MutableRefObject<Life>;
  motion: boolean;
}) {
  const { gl, size, camera } = useThree();
  const flows = useMemo(() => {
    const list: { origin: Origin; swirl: THREE.Vector3; to: THREE.Vector3; phase: number; speed: number }[] = [];
    for (const origin of ORDER) {
      const targets = memories.filter((m) => visible.has(m.id) && memoryOrigin(m) === origin);
      if (!targets.length) continue;
      const count = Math.min(36, Math.max(8, targets.length));
      for (let i = 0; i < count; i += 1) {
        const m = targets[i % targets.length];
        const to = new THREE.Vector3(...m.position);
        const swirl = new THREE.Vector3(hash(m.id + i) - 0.5, hash(i + m.id) - 0.5, hash(`${i}z${m.id}`) - 0.5).multiplyScalar(layout.reach * 0.4);
        list.push({ origin, swirl, to, phase: hash(`${m.id}:${i}`), speed: 0.7 + hash(`${i}${m.id}s`) * 0.6 });
      }
    }
    return list;
  }, [memories, visible, layout]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = flows.length * TRAIL;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(n), 1));
    const colors = new Float32Array(n * 3), sizes = new Float32Array(n);
    flows.forEach((f, i) => {
      const c = new THREE.Color(ORIGINS[f.origin].color);
      for (let k = 0; k < TRAIL; k += 1) {
        c.toArray(colors, (i * TRAIL + k) * 3);
        sizes[i * TRAIL + k] = 1.3 * (1 - k / TRAIL) + 0.35;
      }
    });
    g.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    return g;
  }, [flows]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => new THREE.ShaderMaterial({ vertexShader: flowVertex, fragmentShader: flowFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 300 } } }), []);
  useEffect(() => () => material.dispose(), [material]);
  const point = useMemo(() => new THREE.Vector3(), []);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(), []);
  useFrame((_, delta) => {
    const L = life.current;
    material.uniforms.uScale.value = size.height * gl.getPixelRatio() * 0.62;
    const activity: Record<Origin, number> = { user: 0.12 + L.user * 0.9, aurora: 0.2 + L.think * 1.1, pc: 0.08 + Math.max(L.cpu, L.gpu) * 1.2 };
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const alpha = geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const fade = 1 - L.dim * 0.8;
    const from = Object.fromEntries(ORDER.map((o) => [o, layout.offsets[o].clone().applyQuaternion(camera.quaternion).add(layout.center)])) as Record<Origin, THREE.Vector3>;
    flows.forEach((f, i) => {
      const a = activity[f.origin];
      if (motion) f.phase = (f.phase + delta * f.speed * (0.06 + a * 0.32)) % 1;
      // While Aurora thinks, her energy runs back: she is pulling memories in.
      const inward = f.origin === "aurora" && L.think > 0.5;
      curve.v0.copy(from[f.origin]);
      curve.v1.copy(from[f.origin]).lerp(f.to, 0.5).lerp(layout.center, 0.3).add(f.swirl);
      curve.v2.copy(f.to);
      for (let k = 0; k < TRAIL; k += 1) {
        const tk = f.phase - k * 0.016;
        const idx = i * TRAIL + k;
        if (tk < 0) { alpha.setX(idx, 0); continue; }
        curve.getPoint(inward ? 1 - tk : tk, point);
        pos.setXYZ(idx, point.x, point.y, point.z);
        const ends = Math.min(1, tk / 0.08) * Math.min(1, (1 - tk) / 0.1);
        alpha.setX(idx, (1 - k / TRAIL) * ends * (0.16 + Math.min(1, a) * 0.5) * fade);
      }
    });
    pos.needsUpdate = alpha.needsUpdate = true;
    geometry.computeBoundingSphere();
  });
  if (!flows.length) return null;
  return <points geometry={geometry} material={material} raycast={() => null} />;
}

/** A group centred on the map that always faces the camera. */
function ViewRig({ center, children }: { center: THREE.Vector3; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    group.current?.position.copy(center);
    group.current?.quaternion.copy(camera.quaternion);
  });
  return <group ref={group}>{children}</group>;
}

const percent = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`);

export default function Symbiosis({ memories, visible, life, vitals, motion, fixed }: {
  /** Neural view: anchors sit at these places (the input layer) and the fibres carry the energy. */
  fixed?: Record<Origin, THREE.Vector3>;
  memories: Memory[];
  visible: Set<string>;
  life: MutableRefObject<Life>;
  vitals: SystemVitals | null | undefined;
  motion: boolean;
}) {
  const texture = useMemo(glowTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const layout = useMemo(() => anchorLayout(memories), [memories]);
  const counts = useMemo(() => {
    const c: Record<Origin, number> = { user: 0, aurora: 0, pc: 0 };
    memories.forEach((m) => { c[memoryOrigin(m)] += 1; });
    return c;
  }, [memories]);
  const detail: Record<Origin, string> = {
    user: "suas decisões e notas",
    aurora: vitals?.aurora.thinking ? (vitals.aurora.stage || "pensando…") : vitals ? "em repouso · aprendeu" : "aprendeu",
    pc: vitals ? `CPU ${percent(vitals.cpu)} · RAM ${percent(vitals.memory)}${vitals.gpu ? ` · GPU ${percent(vitals.gpu.load)}` : ""}` : "material local",
  };
  if (fixed)
    return (
      <>
        {ORDER.map((origin) => (
          <Anchor key={origin} origin={origin} position={fixed[origin]} scale={1.15} side="left" life={life} texture={texture} count={counts[origin]} detail={detail[origin]} motion={motion} />
        ))}
      </>
    );
  return (
    <>
      <EnergyFlows memories={memories} visible={visible} layout={layout} life={life} motion={motion} />
      <ViewRig center={layout.center}>
        {ORDER.map((origin) => (
          <Anchor key={origin} origin={origin} side={origin === "user" ? "right" : undefined} position={layout.offsets[origin]} scale={Math.min(1.6, layout.reach / 30)} life={life} texture={texture} count={counts[origin]} detail={detail[origin]} motion={motion} />
        ))}
      </ViewRig>
    </>
  );
}
