import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, PerspectiveCamera, OrthographicCamera, GizmoHelper, GizmoViewport, Html, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { groupColor, groupKey, memoryHealth, type Memory, type MemoryCluster } from "./data";
import { buildGraph, traceOrigin, type MemoryEdge } from "./graph";

export type CameraCommand = {
  serial: number;
  view: "overview" | "front" | "top" | "side" | "inspect";
  id?: string;
};
type Props = {
  memories: Memory[];
  allMemories: Memory[];
  clusters: MemoryCluster[];
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

const dummy = new THREE.Object3D();
const FAILING = new THREE.Color("#e75e78");
const SELECTED = new THREE.Color("#ffffff");

/** A memory's star: size by how much it helped, dim when never used, red when it mostly fails. */
function starStyle(m: Memory, dimUnused: boolean) {
  const health = memoryHealth(m);
  const helped = m.stats?.helped ?? 0;
  const size = 0.75 + Math.min(1.1, Math.log2(1 + helped) * 0.35);
  const color = new THREE.Color(groupColor(groupKey(m)));
  if (health.failing) color.lerp(FAILING, 0.75);
  const brightness = dimUnused && health.unused ? 0.4 : 1;
  return { size, color, brightness };
}

/**
 * The constellation: one instanced mesh of small glowing spheres (one draw
 * call for thousands of memories). Hover shows a name, click selects,
 * double-click flies to it.
 */
function Stars3D({ memories, selectedId, highlighted, wireframe, dimUnused, onSelect, onFocus, onHover }: {
  memories: Memory[];
  dimUnused: boolean;
  selectedId: string | null;
  highlighted: Set<string>;
  wireframe: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    memories.forEach((m, i) => {
      const { size, color, brightness } = starStyle(m, dimUnused);
      dummy.position.set(...m.position);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(m.id === selectedId ? size * 1.9 : highlighted.has(m.id) ? size * 1.3 : size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const c = m.id === selectedId ? color.clone().lerp(SELECTED, 0.55) : color.clone();
      const dim = selectedId && !highlighted.has(m.id) && m.id !== selectedId ? 0.2 : brightness;
      mesh.setColorAt(i, c.multiplyScalar(dim * 1.6));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [memories, selectedId, highlighted, dimUnused]);
  if (!memories.length) return null;
  return (
    <instancedMesh
      key={memories.length}
      ref={ref}
      args={[undefined, undefined, memories.length]}
      onClick={(e) => {
        if (e.instanceId !== undefined && e.delta < 5) {
          e.stopPropagation();
          onSelect(memories[e.instanceId].id);
        }
      }}
      onDoubleClick={(e) => {
        if (e.instanceId !== undefined) {
          e.stopPropagation();
          onFocus(memories[e.instanceId].id);
        }
      }}
      onPointerMove={(e) => {
        if (e.instanceId === undefined) return;
        e.stopPropagation();
        document.body.style.cursor = "pointer";
        onHover(memories[e.instanceId].id);
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
        onHover(null);
      }}
    >
      <icosahedronGeometry args={[1, 2]} />
      <meshBasicMaterial toneMapped={false} wireframe={wireframe} />
    </instancedMesh>
  );
}

/** Thin straight lines: semantic neighbours (faint) and explicit relations; the selection's are bright. */
function Links({ memories, edges, path, selectedId }: { memories: Memory[]; edges: MemoryEdge[]; path: Set<string>; selectedId: string | null }) {
  const geometry = useMemo(() => {
    const byId = new Map(memories.map((m) => [m.id, m]));
    const positions: number[] = [];
    const colors: number[] = [];
    const push = (a: Memory, b: Memory, color: THREE.Color) => {
      positions.push(...a.position, ...b.position);
      colors.push(...color.toArray(), ...color.toArray());
    };
    const seen = new Set<string>();
    for (const m of memories) {
      for (const n of (m.id === selectedId ? m.neighbors : m.neighbors?.slice(0, 2)) ?? []) {
        const other = byId.get(n.id);
        const key = [m.id, n.id].sort().join("|");
        if (!other || seen.has(key)) continue;
        seen.add(key);
        const active = m.id === selectedId || n.id === selectedId;
        const color = new THREE.Color(active ? "#7fe3d2" : groupColor(groupKey(m))).multiplyScalar(active ? 1 : selectedId ? 0.05 : 0.16 + (n.similarity - 0.72) * 0.9);
        push(m, other, color);
      }
    }
    for (const edge of edges) {
      if (!byId.has(edge.from.id) || !byId.has(edge.to.id)) continue;
      const active = path.has(edge.key) || edge.from.id === selectedId || edge.to.id === selectedId;
      push(edge.from, edge.to, new THREE.Color(active ? "#d6c7ff" : "#8b7fd6").multiplyScalar(active ? 1 : selectedId ? 0.06 : 0.3));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, [memories, edges, path, selectedId]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.9} toneMapped={false} />
    </lineSegments>
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
    const radius = inspecting ? 7 : bounds.radius;
    const aspect = size.width / size.height;
    const distance = (radius / Math.sin(Math.atan(Math.tan((48 * Math.PI) / 360) * Math.min(1, aspect)))) * 0.92;
    const direction =
      command.view === "front" ? new THREE.Vector3(0, 0, 1)
        : command.view === "top" ? new THREE.Vector3(0, 0.999, 0.001)
          : command.view === "side" ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3(0.3, 0.45, 1);
    travel.current = { target, position: target.clone().addScaledVector(direction.normalize(), distance), zoom: Math.min(size.width, size.height) / (2.2 * radius) };
    invalidate();
  }, [command, camera, bounds, allMemories, size.width, size.height, invalidate]);
  useFrame((_, delta) => {
    const next = travel.current;
    if (!next || !controls.current) return;
    const alpha = motion ? 1 - Math.exp(-Math.min(delta, 0.1) * 7) : 1;
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
      dampingFactor={0.1}
      autoRotate={drift}
      autoRotateSpeed={0.35}
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

function Metrics({ onStats }: { onStats: Props["onStats"] }) {
  const { gl } = useThree();
  useEffect(() => {
    const previous = gl.info.autoReset;
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = previous;
    };
  }, [gl]);
  const elapsed = useRef(0), frames = useRef(0);
  useFrame((_, delta) => {
    elapsed.current += delta;
    frames.current++;
    if (elapsed.current > 2) {
      onStats(`${Math.round(frames.current / elapsed.current)} fps · ${gl.info.render.calls} chamadas · ${(gl.info.render.triangles / 1000).toFixed(0)} mil triângulos`);
      elapsed.current = 0;
      frames.current = 0;
    }
    gl.info.reset();
  }, -100);
  return null;
}

function SceneContent(props: Props) {
  const { memories, allMemories, clusters, selectedId, onSelect, onFocus, onGroup, onCluster, cad, wireframe, orthographic, motion, command, onStats } = props;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const graph = useMemo(() => buildGraph(allMemories), [allMemories]);
  const visible = useMemo(() => new Set(memories.map((m) => m.id)), [memories]);
  const edges = useMemo(() => graph.edges.filter((e) => visible.has(e.from.id) && visible.has(e.to.id)), [graph, visible]);
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
  // Topic labels: the meaning clusters when the map has them; otherwise the project groups (test data).
  const labels = clusters.length
    ? clusters.filter((c) => c.id >= 0 && c.count > 0 && memories.some((m) => m.cluster === c.id)).map((c) => ({ key: `c${c.id}`, text: c.label, count: c.count, position: c.center, onClick: () => onCluster?.(c.id) }))
    : graph.groups.filter((g) => memories.some((m) => groupKey(m) === g.label)).map((g) => ({ key: g.id, text: g.label, count: g.count, position: g.position, onClick: () => onGroup(g.label) }));
  return (
    <>
      <PerspectiveCamera makeDefault={!orthographic} position={[25, 35, 90]} fov={48} near={0.1} far={100000} />
      <OrthographicCamera makeDefault={orthographic} position={[25, 35, 90]} zoom={12} near={0.1} far={100000} />
      <color attach="background" args={["#08090b"]} />
      <fog attach="fog" args={["#08090b", 90, 260]} />
      {props.quality === "high" && <Stars radius={180} depth={80} count={1600} factor={2.2} saturation={0} fade speed={0.2} />}
      {cad && (
        <>
          <Grid position={[0, floor, 0]} args={[200, 200]} cellSize={4} sectionSize={20} cellColor="#16191d" sectionColor="#262b31" cellThickness={0.4} sectionThickness={0.6} fadeDistance={170} infiniteGrid />
          <axesHelper args={[10]} />
        </>
      )}
      <group>
        <Links memories={memories} edges={edges} path={origin.edgeKeys} selectedId={selectedId} />
        <Stars3D memories={memories} selectedId={selectedId} highlighted={highlighted} wireframe={wireframe} dimUnused={dimUnused} onSelect={onSelect} onFocus={onFocus} onHover={setHoveredId} />
        {!selectedId && labels.map((l) => (
          <Html key={l.key} position={[l.position[0], l.position[1] + 4, l.position[2]]} center zIndexRange={[20, 0]}>
            <button className="topic-label" onClick={l.onClick}>
              {l.text}
              <small>{l.count}</small>
            </button>
          </Html>
        ))}
        {(hovered || selected) && (
          <Html position={(hovered || selected)!.position} zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
            <div className="star-tooltip">
              <strong>{(hovered || selected)!.title}</strong>
              {(hovered || selected)!.stats && (
                <small>
                  {(hovered || selected)!.stats!.uses}× usada · ajudou {(hovered || selected)!.stats!.helped} · falhou {(hovered || selected)!.stats!.failed}
                </small>
              )}
            </div>
          </Html>
        )}
      </group>
      <CameraRig command={command} allMemories={allMemories} motion={motion} drift={motion && !selectedId && !hoveredId} />
      <GizmoHelper alignment="bottom-right" margin={[58, 100]}>
        <GizmoViewport axisColors={["#e75e78", "#55a583", "#6aa6ff"]} labelColor="white" />
      </GizmoHelper>
      <Metrics onStats={onStats} />
      {props.quality === "high" && (
        <EffectComposer multisampling={0}>
          <Bloom intensity={1.1} luminanceThreshold={0.2} luminanceSmoothing={0.5} mipmapBlur radius={0.7} />
          <Vignette eskil={false} offset={0.2} darkness={0.55} />
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
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;
        }}
        fallback={fallback}
      >
        <ContextGuard onLost={() => setLost(true)} />
        <SceneContent {...props} />
      </Canvas>
    </SceneBoundary>
  );
}
