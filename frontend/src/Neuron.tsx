import { useEffect, useMemo } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { createMorphology, disposeMorphology } from "./morphology";

type Props = {
  id: string;
  position: [number, number, number];
  color: string;
  scale?: number;
  cad: boolean;
  wireframe: boolean;
  onSelect?: () => void;
  label?: string;
};
/** A handful of detailed cells; the overview uses instanced geometry. */
export default function Neuron({
  id,
  position,
  color,
  scale = 1,
  cad,
  wireframe,
  onSelect,
  label,
}: Props) {
  const morphology = useMemo(() => createMorphology(id, true), [id]);
  const box = useMemo(() => {
    const size = morphology.bounds.getSize(new THREE.Vector3());
    const center = morphology.bounds.getCenter(new THREE.Vector3());
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    geometry.translate(center.x, center.y, center.z);
    const edges = new THREE.EdgesGeometry(geometry);
    geometry.dispose();
    return edges;
  }, [morphology]);
  useEffect(
    () => () => {
      disposeMorphology(morphology);
      box.dispose();
    },
    [morphology, box],
  );
  const dimensions = morphology.bounds
    .getSize(new THREE.Vector3())
    .multiplyScalar(scale);
  return (
    <group
      position={position}
      scale={scale}
      onClick={
        onSelect
          ? (e) => {
              e.stopPropagation();
              onSelect();
            }
          : undefined
      }
    >
      <mesh geometry={morphology.body}>
        <meshPhysicalMaterial
          color={color}
          roughness={0.3}
          metalness={0.35}
          emissive={color}
          emissiveIntensity={0.18}
          transparent
          opacity={wireframe ? 0.55 : 0.48}
          depthWrite={false}
          wireframe={wireframe}
        />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.21, 2]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.4}
          roughness={0.28}
        />
      </mesh>
      <mesh geometry={morphology.body} scale={1.035}>
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={cad ? 0.42 : 0.12}
        />
      </mesh>
      <mesh geometry={morphology.branches}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35}
          metalness={0.45}
          roughness={0.3}
          wireframe={wireframe}
        />
      </mesh>
      <mesh geometry={morphology.axon}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.2}
          metalness={0.6}
          roughness={0.28}
          wireframe={wireframe}
        />
      </mesh>
      <mesh geometry={morphology.tips}>
        <meshBasicMaterial color={color} />
      </mesh>
      {cad && (
        <>
          <lineSegments geometry={box}>
            <lineBasicMaterial color={color} transparent opacity={0.25} />
          </lineSegments>
          {label && (
            <Html position={[0, 3.4, 0]} center className="cell-annotation">
              <span>{label}</span>
              <small>
                {dimensions.x.toFixed(1)} × {dimensions.y.toFixed(1)} ×{" "}
                {dimensions.z.toFixed(1)} u.c.
              </small>
            </Html>
          )}
        </>
      )}
    </group>
  );
}
