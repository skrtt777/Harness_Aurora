import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { seededRandom } from "./data.js";
export type Morphology = {
  body: THREE.BufferGeometry;
  branches: THREE.BufferGeometry;
  axon: THREE.BufferGeometry;
  tips: THREE.BufferGeometry;
  bounds: THREE.Box3;
};
const Y = new THREE.Vector3(0, 1, 0);
function tapered(
  curve: THREE.CatmullRomCurve3,
  radius: number,
  segments: number,
  radial: number,
) {
  const geo = new THREE.TubeGeometry(curve, segments, radius, radial, false);
  const attr = geo.attributes.position;
  for (let i = 0; i <= segments; i++) {
    const center = curve.getPointAt(i / segments);
    const taper = 1 - (0.9 * i) / segments;
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      const v = new THREE.Vector3()
        .fromBufferAttribute(attr, idx)
        .sub(center)
        .multiplyScalar(taper)
        .add(center);
      attr.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}
function merge(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(
    parts.map((p) => (p.index ? p.toNonIndexed() : p)),
  );
  for (const p of parts) p.dispose();
  return geometry!;
}
export function createMorphology(seed: string, detailed: boolean): Morphology {
  const random = seededRandom(seed);
  const phase = random() * Math.PI * 2;
  const body = new THREE.IcosahedronGeometry(0.42, detailed ? 3 : 1);
  const vertices = body.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i),
      y = vertices.getY(i),
      z = vertices.getZ(i);
    const wobble =
      1 +
      0.12 * Math.sin(x * 9 + phase) * Math.cos(y * 7 - phase) +
      0.08 * Math.sin(z * 12 + y * 5);
    vertices.setXYZ(i, x * wobble * 1.12, y * wobble * 0.9, z * wobble);
  }
  body.computeVertexNormals();
  const branches: THREE.BufferGeometry[] = [],
    axons: THREE.BufferGeometry[] = [],
    tips: THREE.BufferGeometry[] = [];
  function curve(start: THREE.Vector3, dir: THREE.Vector3, length: number) {
    const side = new THREE.Vector3(
      random() - 0.5,
      random() - 0.5,
      random() - 0.5,
    )
      .cross(dir)
      .normalize();
    return new THREE.CatmullRomCurve3([
      start,
      start
        .clone()
        .addScaledVector(dir, length * 0.3)
        .addScaledVector(side, length * 0.16),
      start
        .clone()
        .addScaledVector(dir, length * 0.7)
        .addScaledVector(side, -length * 0.08),
      start.clone().addScaledVector(dir, length),
    ]);
  }
  function tip(point: THREE.Vector3, size = 0.045) {
    const geo = new THREE.IcosahedronGeometry(size, 0);
    geo.translate(point.x, point.y, point.z);
    tips.push(geo);
  }
  function branch(
    start: THREE.Vector3,
    dir: THREE.Vector3,
    length: number,
    radius: number,
    depth: number,
  ) {
    const path = curve(start, dir, length);
    branches.push(tapered(path, radius, detailed ? 12 : 5, detailed ? 6 : 3));
    if (depth > 0) {
      for (let j = 0; j < 2; j++) {
        const t = 0.43 + j * 0.3;
        const child = dir
          .clone()
          .multiplyScalar(0.48)
          .add(
            new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5),
          )
          .normalize();
        branch(
          path.getPointAt(t),
          child,
          length * (0.42 + random() * 0.12),
          radius * 0.48,
          depth - 1,
        );
      }
    }
    if (detailed) {
      tip(path.getPointAt(1));
      if (depth > 0)
        for (let j = 0; j < 3; j++) {
          const anchor = path.getPointAt(0.3 + j * 0.22);
          const end = anchor
            .clone()
            .add(
              new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5)
                .normalize()
                .multiplyScalar(0.14),
            );
          branches.push(
            tapered(
              new THREE.CatmullRomCurve3([
                anchor,
                anchor.clone().lerp(end, 0.5),
                end,
              ]),
              0.014,
              3,
              3,
            ),
          );
          tip(end, 0.032);
        }
    }
  }
  const count = detailed ? 7 : 4;
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const angle = i * 2.399963 + phase;
    const dir = new THREE.Vector3(
      Math.cos(angle) * Math.sqrt(1 - y * y),
      y,
      Math.sin(angle) * Math.sqrt(1 - y * y),
    );
    branch(
      dir.clone().multiplyScalar(0.27),
      dir,
      1.65 + random() * 0.9,
      detailed ? 0.115 : 0.09,
      detailed ? 2 : 1,
    );
  }
  const direction = new THREE.Vector3(0.28, -0.9, -0.15)
    .applyAxisAngle(Y, phase)
    .normalize();
  const axon = curve(direction.clone().multiplyScalar(0.27), direction, 3.8);
  axons.push(tapered(axon, 0.085, detailed ? 24 : 8, detailed ? 7 : 4));
  if (detailed) {
    for (let i = 0; i < 6; i++) {
      const t = 0.22 + i * 0.1;
      const sleeve = new THREE.SphereGeometry(0.12, 8, 5);
      sleeve.scale(1, 2.2, 1);
      sleeve.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(Y, axon.getTangentAt(t)),
      );
      const center = axon.getPointAt(t);
      sleeve.translate(center.x, center.y, center.z);
      axons.push(sleeve);
    }
    for (let i = 0; i < 3; i++) {
      const end = axon.getPointAt(0.85);
      branch(
        end,
        direction
          .clone()
          .add(
            new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5),
          )
          .normalize(),
        0.9,
        0.04,
        1,
      );
    }
  }
  if (!tips.length) tip(axon.getPointAt(1));
  const result = {
    body,
    branches: merge(branches),
    axon: merge(axons),
    tips: merge(tips),
    bounds: new THREE.Box3(),
  };
  for (const geo of [result.body, result.branches, result.axon, result.tips]) {
    geo.computeBoundingBox();
    result.bounds.union(geo.boundingBox!);
  }
  return result;
}
export function disposeMorphology(m: Morphology) {
  m.body.dispose();
  m.branches.dispose();
  m.axon.dispose();
  m.tips.dispose();
}
export function overviewGeometry(seed: string) {
  const m = createMorphology(seed, false);
  const result = mergeGeometries([m.body, m.branches, m.axon, m.tips]);
  disposeMorphology(m);
  return result!;
}
