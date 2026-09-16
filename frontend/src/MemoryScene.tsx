import {
  Component,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Grid,
  OrbitControls,
  PerspectiveCamera,
  OrthographicCamera,
  GizmoHelper,
  GizmoViewport,
  Html,
} from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import Neuron from "./Neuron";
import { groupColor, groupKey, hash, type Memory } from "./data";
import { buildGraph, traceOrigin, type MemoryEdge } from "./graph";
import { overviewGeometry } from "./morphology";
export type CameraCommand = {
  serial: number;
  view: "overview" | "front" | "top" | "side" | "inspect";
  id?: string;
};
type Props = {
  memories: Memory[];
  allMemories: Memory[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onGroup: (key: string) => void;
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
function Instances({
  memories,
  selectedId,
  highlighted,
  wireframe,
  onSelect,
  onFocus,
}: {
  memories: Memory[];
  selectedId: string | null;
  highlighted: Set<string>;
  wireframe: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  const geometries = useMemo(
    () => Array.from({ length: 6 }, (_, i) => overviewGeometry(`variant-${i}`)),
    [],
  );
  const buckets = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) =>
        memories.filter((m) => Math.floor(hash(m.id) * 6) === i),
      ),
    [memories],
  );
  const refs = useRef<Array<THREE.InstancedMesh | null>>([]);
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);
  useLayoutEffect(() => {
    buckets.forEach((nodes, bucket) => {
      const mesh = refs.current[bucket];
      if (!mesh) return;
      nodes.forEach((m, i) => {
        dummy.position.set(...m.position);
        dummy.rotation.set(
          hash(m.id + "x") * 6,
          hash(m.id + "y") * 6,
          hash(m.id + "z") * 6,
        );
        dummy.scale.setScalar(
          m.id === selectedId ? 0 : 0.19 + hash(m.id + "size") * 0.12,
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const color = new THREE.Color(groupColor(groupKey(m)));
        if (selectedId && !highlighted.has(m.id)) color.multiplyScalar(0.22);
        if (highlighted.has(m.id)) color.lerp(new THREE.Color("#ffe5b9"), 0.5);
        mesh.setColorAt(i, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [buckets, selectedId, highlighted]);
  return (
    <>
      {buckets.map(
        (nodes, i) =>
          nodes.length > 0 && (
            <instancedMesh
              key={`${i}:${nodes.length}`}
              ref={(mesh) => {
                refs.current[i] = mesh;
              }}
              args={[geometries[i], undefined, nodes.length]}
              onClick={(e) => {
                if (e.instanceId !== undefined && e.delta < 5) {
                  e.stopPropagation();
                  onSelect(nodes[e.instanceId].id);
                }
              }}
              onDoubleClick={(e) => {
                if (e.instanceId !== undefined) {
                  e.stopPropagation();
                  onFocus(nodes[e.instanceId].id);
                }
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "auto";
              }}
            >
              <meshStandardMaterial
                color="white"
                roughness={0.5}
                metalness={0.25}
                emissive="white"
                emissiveIntensity={0.12}
                wireframe={wireframe}
              />
            </instancedMesh>
          ),
      )}
    </>
  );
}
function connection(edge: MemoryEdge) {
  const a = new THREE.Vector3(...edge.from.position),
    b = new THREE.Vector3(...edge.to.position);
  const mid = a.clone().lerp(b, 0.5);
  const length = a.distanceTo(b);
  mid.y += Math.min(3, length * 0.16);
  mid.z += (hash(edge.key) - 0.5) * Math.min(length, 0.9);
  return new THREE.CatmullRomCurve3([a, mid, b]);
}
function Connections({
  edges,
  path,
  selectedId,
  motion,
}: {
  edges: MemoryEdge[];
  path: Set<string>;
  selectedId: string | null;
  motion: boolean;
}) {
  const data = useMemo(
    () =>
      edges.map((edge) => ({
        edge,
        curve: connection(edge),
        active:
          path.has(edge.key) ||
          edge.from.id === selectedId ||
          edge.to.id === selectedId,
      })),
    [edges, path, selectedId],
  );
  const geometry = useMemo(() => {
    const positions: number[] = [],
      colors: number[] = [];
    for (const { edge, curve, active } of data) {
      const points = curve.getPoints(12);
      const color = new THREE.Color(
        active ? "#ffcf94" : groupColor(groupKey(edge.from)),
      ).multiplyScalar(active ? 1 : selectedId ? 0.09 : 0.3);
      for (let i = 0; i < points.length - 1; i++) {
        positions.push(...points[i].toArray(), ...points[i + 1].toArray());
        colors.push(...color.toArray(), ...color.toArray());
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, [data, selectedId]);
  const pulses = useMemo(
    () =>
      data
        .filter((d, i) => d.active || (!selectedId && i % 17 === 0))
        .slice(0, 120),
    [data, selectedId],
  );
  const ref = useRef<THREE.InstancedMesh>(null);
  const elapsed = useRef(0);
  const point = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, delta) => {
    if (!motion || !ref.current) return;
    elapsed.current += Math.min(delta, 0.08);
    pulses.forEach((d, i) => {
      d.curve.getPointAt((elapsed.current * 0.17 + i * 0.137) % 1, point);
      dummy.position.copy(point);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(d.active ? 0.085 : 0.045);
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial vertexColors transparent opacity={0.65} />
      </lineSegments>
      {motion && pulses.length > 0 && (
        <instancedMesh
          ref={ref}
          args={[undefined, undefined, pulses.length]}
          frustumCulled={false}
        >
          <icosahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color="#ffe6bf" toneMapped={false} />
        </instancedMesh>
      )}
    </>
  );
}
function CollectionStructure({
  groups,
  wireframe,
  cad,
}: {
  groups: ReturnType<typeof buildGraph>["groups"];
  wireframe: boolean;
  cad: boolean;
}) {
  const center = useMemo(() => {
    const point = new THREE.Vector3();
    groups.forEach((g) => point.add(new THREE.Vector3(...g.position)));
    return point.divideScalar(Math.max(groups.length, 1));
  }, [groups]);
  const geometry = useMemo(() => {
    const positions: number[] = [],
      colors: number[] = [];
    groups.forEach((g) => {
      const end = new THREE.Vector3(...g.position);
      const mid = center
        .clone()
        .lerp(end, 0.5)
        .add(new THREE.Vector3(0, 3, 0));
      const points = new THREE.CatmullRomCurve3([center, mid, end]).getPoints(
        24,
      );
      const color = new THREE.Color(g.color);
      for (let i = 0; i < points.length - 1; i++) {
        positions.push(...points[i].toArray(), ...points[i + 1].toArray());
        colors.push(...color.toArray(), ...color.toArray());
      }
    });
    const result = new THREE.BufferGeometry();
    result.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    result.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return result;
  }, [groups, center]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (groups.length < 2) return null;
  return (
    <>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial vertexColors transparent opacity={0.35} />
      </lineSegments>
      <Neuron
        id="aurora-collection"
        position={center.toArray() as [number, number, number]}
        scale={3.3}
        color="#65e2d4"
        cad={cad}
        wireframe={wireframe}
      />
      <Html position={center.toArray()} center zIndexRange={[15, 0]}>
        <div className="collection-label">
          AURORA<small>Núcleo da coleção</small>
        </div>
      </Html>
    </>
  );
}
function CameraRig({
  command,
  allMemories,
  orthographic,
  motion,
}: {
  command: CameraCommand;
  allMemories: Memory[];
  orthographic: boolean;
  motion: boolean;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size, invalidate } = useThree();
  const travel = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
    zoom: number;
  } | null>(null);
  const bounds = useMemo(() => {
    const box = new THREE.Box3();
    allMemories.forEach((m) =>
      box.expandByPoint(new THREE.Vector3(...m.position)),
    );
    if (box.isEmpty())
      box.setFromCenterAndSize(
        new THREE.Vector3(),
        new THREE.Vector3(30, 30, 30),
      );
    return {
      center: box.getCenter(new THREE.Vector3()),
      radius: Math.max(10, box.getSize(new THREE.Vector3()).length() / 2 + 5),
    };
  }, [allMemories]);
  useEffect(() => {
    const selected = allMemories.find((m) => m.id === command.id);
    const inspecting = command.view !== "overview" && selected;
    const target = inspecting
      ? new THREE.Vector3(...selected.position)
      : bounds.center.clone();
    const radius = inspecting ? 5 : bounds.radius;
    const aspect = size.width / size.height;
    const distance =
      (radius /
        Math.sin(
          Math.atan(Math.tan((48 * Math.PI) / 360) * Math.min(1, aspect)),
        )) *
      1.02;
    const direction =
      command.view === "front"
        ? new THREE.Vector3(0, 0, 1)
        : command.view === "top"
          ? new THREE.Vector3(0, 0.999, 0.001)
          : command.view === "side"
            ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3(0.3, 0.62, 1);
    travel.current = {
      target,
      position: target.clone().addScaledVector(direction.normalize(), distance),
      zoom: Math.min(size.width, size.height) / (2.2 * radius),
    };
    invalidate();
  }, [
    command,
    camera,
    orthographic,
    bounds,
    allMemories,
    size.width,
    size.height,
    invalidate,
  ]);
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
    if (
      camera.position.distanceTo(next.position) < 0.015 &&
      controls.current.target.distanceTo(next.target) < 0.015
    )
      travel.current = null;
    else invalidate();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={motion}
      dampingFactor={0.1}
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
  const elapsed = useRef(0),
    frames = useRef(0);
  useFrame((_, delta) => {
    elapsed.current += delta;
    frames.current++;
    if (elapsed.current > 2) {
      onStats(
        `${Math.round(frames.current / elapsed.current)} fps · ${gl.info.render.calls} chamadas · ${(gl.info.render.triangles / 1000).toFixed(0)} mil triângulos`,
      );
      elapsed.current = 0;
      frames.current = 0;
    }
    gl.info.reset();
  }, -100);
  return null;
}
function SceneContent(props: Props) {
  const {
    memories,
    allMemories,
    selectedId,
    onSelect,
    onFocus,
    onGroup,
    cad,
    wireframe,
    orthographic,
    motion,
    command,
    onStats,
  } = props;
  const graph = useMemo(() => buildGraph(allMemories), [allMemories]);
  const visible = useMemo(() => new Set(memories.map((m) => m.id)), [memories]);
  const edges = useMemo(
    () =>
      graph.edges.filter((e) => visible.has(e.from.id) && visible.has(e.to.id)),
    [graph, visible],
  );
  const origin = useMemo(
    () => traceOrigin(allMemories, selectedId),
    [allMemories, selectedId],
  );
  const selected = graph.byId.get(selectedId || "");
  const highlighted = useMemo(() => {
    const set = new Set(origin.nodeIds);
    if (selected) {
      selected.relations.forEach((id) => set.add(id));
      graph.incoming.get(selected.id)?.forEach((e) => set.add(e.from.id));
    }
    return set;
  }, [origin, selected, graph]);
  useEffect(
    () => () => {
      document.body.style.cursor = "auto";
    },
    [],
  );
  const floor = useMemo(
    () => Math.min(-14, ...allMemories.map((m) => m.position[1])) - 3,
    [allMemories],
  );
  return (
    <>
      <PerspectiveCamera
        makeDefault={!orthographic}
        position={[25, 45, 80]}
        fov={48}
        near={0.1}
        far={100000}
      />
      <OrthographicCamera
        makeDefault={orthographic}
        position={[25, 45, 80]}
        zoom={12}
        near={0.1}
        far={100000}
      />
      <color attach="background" args={["#070d15"]} />
      <ambientLight intensity={1} />
      <directionalLight
        position={[15, 30, 20]}
        intensity={2.5}
        color="#d0edff"
      />
      <directionalLight
        position={[-15, -5, -15]}
        intensity={1.2}
        color="#7b8bdd"
      />
      {cad && (
        <>
          <Grid
            position={[0, floor, 0]}
            args={[160, 160]}
            cellSize={2}
            sectionSize={10}
            cellColor="#193743"
            sectionColor="#315665"
            cellThickness={0.45}
            sectionThickness={0.65}
            fadeDistance={150}
            infiniteGrid
          />
          <axesHelper args={[12]} />
        </>
      )}
      <Connections
        edges={edges}
        path={origin.edgeKeys}
        selectedId={selectedId}
        motion={motion}
      />
      <Instances
        memories={memories}
        selectedId={selectedId}
        highlighted={highlighted}
        wireframe={wireframe}
        onSelect={onSelect}
        onFocus={onFocus}
      />
      {!selectedId && memories.length === allMemories.length && (
        <CollectionStructure
          groups={graph.groups}
          cad={cad}
          wireframe={wireframe}
        />
      )}
      {!selectedId &&
        graph.groups
          .filter((g) => memories.some((m) => groupKey(m) === g.label))
          .map((g) => (
            <group key={g.id}>
              <Neuron
                id={g.id}
                position={g.position}
                scale={1.25}
                color={g.color}
                cad={cad}
                wireframe={wireframe}
                onSelect={() => onGroup(g.label)}
              />
              <Html
                position={[g.position[0] + 1, g.position[1] + 3, g.position[2]]}
                zIndexRange={[20, 0]}
              >
                <button
                  className="cluster-label"
                  style={{ borderColor: g.color }}
                  onClick={() => onGroup(g.label)}
                >
                  <i style={{ background: g.color }} />
                  {g.label}
                  <small>{g.count} memórias · grupo</small>
                </button>
              </Html>
            </group>
          ))}
      {selected && visible.has(selected.id) && (
        <Neuron
          id={selected.id}
          position={selected.position}
          color={groupColor(groupKey(selected))}
          cad={cad}
          wireframe={wireframe}
          onSelect={() => onSelect(selected.id)}
          label="NEURÔNIO / GEOMETRIA"
        />
      )}
      <CameraRig
        command={command}
        allMemories={allMemories}
        orthographic={orthographic}
        motion={motion}
      />
      <GizmoHelper alignment="bottom-right" margin={[58, 100]}>
        <GizmoViewport
          axisColors={["#ef7b7b", "#79dbac", "#8aabff"]}
          labelColor="white"
        />
      </GizmoHelper>
      <Metrics onStats={onStats} />
    </>
  );
}
class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
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
        gl={{
          antialias: props.quality === "high",
          powerPreference: "high-performance",
        }}
        fallback={fallback}
      >
        <ContextGuard onLost={() => setLost(true)} />
        <SceneContent {...props} />
      </Canvas>
    </SceneBoundary>
  );
}
