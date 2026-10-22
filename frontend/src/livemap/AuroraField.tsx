import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AuroraLayout } from "./aurora";

/**
 * Memórias / Mapa Vivo — the aurora (aurora.ts has the layout): the memory as the Aurora's own sky.
 *   - a night sky over a dark lake; each section a curtain of light hanging over it (its veil: a bright hem,
 *     fine striations, a ragged top fading to lavender), swaying slowly, brighter while something happens there;
 *   - each memory one ray standing on its curtain's hem: as tall as it is relevant, steady when proven, broken in
 *     dashes while in review, flaring white when read, used, created, hovered or selected;
 *   - the lake mirrors all of it, rippling.
 * The memories' state comes each frame from the scene (AuroraDrive); nothing here is decoration standing in for
 * data: a ray is always a memory, a curtain always a section.
 */
export type AuroraDrive = {
  /** Per memory: x, y, z, height | r, g, b, energy | review (0/1), relevance, seed, 0. */
  memA: Float32Array; memB: Float32Array; memC: Float32Array; side: number;
  /** Per curtain: r, g, b, energy. */
  curt: Float32Array; curtains: number;
  light: number; motion: boolean;
};
export function makeAuroraDrive(memories: number, curtains: number): AuroraDrive {
  const side = Math.max(1, Math.ceil(Math.sqrt(memories)));
  const F = () => new Float32Array(side * side * 4);
  return { memA: F(), memB: F(), memC: F(), side, curt: new Float32Array(Math.max(1, curtains) * 4), curtains: Math.max(1, curtains), light: 1, motion: true };
}

const NOISE = /* glsl */ `
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y); }
`;
const LAVENDER = "vec3(0.66, 0.56, 1.0)";

const VEIL_VERTEX = /* glsl */ `
uniform float uTime; uniform float uMirror; uniform float uGround;
attribute vec2 aUV; attribute float aCurt; attribute vec2 aNrm; attribute float aLen; attribute float aPh; attribute float aH;
varying vec2 vUV; varying float vCurt; varying float vLen; varying float vPh;
void main(){
  vec3 p = position;
  float u = aUV.x, v = aUV.y;
  // The hem sways (the same function as swayAt in aurora.ts, so the rays stay on it); the top flutters more.
  float sway = aLen * (0.016 * sin(u * 9.0 + uTime * 0.45 + aPh) + 0.009 * sin(u * 23.0 - uTime * 0.7 + aPh * 2.0));
  sway += v * aLen * 0.012 * sin(u * 5.0 + uTime * 0.8 + aPh);
  p.xz += aNrm * sway;
  if (uMirror > 0.5) { p.y = 2.0 * uGround - p.y; p.x += sin(p.z * 0.04 + uTime * 0.8) * 3.0; }
  vUV = aUV; vCurt = aCurt; vLen = aLen; vPh = aPh;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const VEIL_FRAGMENT = /* glsl */ `
uniform float uTime; uniform sampler2D tCurt; uniform float uCurtains; uniform float uLight; uniform float uMirror;
varying vec2 vUV; varying float vCurt; varying float vLen; varying float vPh;
${NOISE}
void main(){
  vec4 cs = texture2D(tCurt, vec2((vCurt + 0.5) / uCurtains, 0.5));
  float u = vUV.x, x = vUV.x * vLen;
  // Taller and shorter along the hem (an envelope), so the curtain is no box.
  float env = 0.62 + 0.38 * sin(u * 3.3 + vPh) * sin(u * 1.7 + vPh * 2.3 + 1.0);
  float v = vUV.y / max(0.3, env);
  // A ragged top (where the veil ends changes along the hem and slowly in time).
  float topN = 0.55 + 0.45 * noise(vec2(x * 0.01 + vPh * 3.0, uTime * 0.05));
  float top = 1.0 - smoothstep(topN * 0.45, topN, v);
  float hem = smoothstep(0.0, 0.015, v);
  float body = exp(-v * 2.4) * 0.8 + 0.2;
  // Fine vertical striations drifting along it, and a slow pulse travelling the hem.
  float stri = 0.55 + 0.45 * noise(vec2(x * 0.16, uTime * 0.1 + vPh));
  float pulse = 0.7 + 0.3 * sin(x * 0.012 - uTime * 0.5 + vPh);
  float edge = smoothstep(0.0, 0.22, u) * smoothstep(1.0, 0.78, u);
  float line = exp(-v * 45.0);
  vec3 c = mix(cs.rgb, mix(cs.rgb, ${LAVENDER}, 0.7), smoothstep(0.1, 0.8, v));
  float a = hem * top * edge * (body * stri * pulse * (0.26 + 0.5 * cs.a) + line * (0.45 + 0.7 * cs.a));
  // In the lake: fainter, darker higher up, broken by ripples.
  a *= mix(1.0, 0.17 * exp(-v * 1.8) * (0.6 + 0.4 * sin(v * 60.0 + uTime * 1.3 + u * 7.0)), uMirror);
  gl_FragColor = vec4(c * a * uLight, 1.0);
}
`;
const RAY_VERTEX = /* glsl */ `
uniform sampler2D tA; uniform sampler2D tB; uniform sampler2D tC;
uniform float uSide; uniform float uWidth; uniform float uTime; uniform float uMirror; uniform float uGround;
attribute float aMem; attribute vec2 aCorner;
varying vec2 vC; varying vec3 vCol; varying float vE; varying float vReview; varying float vSeed;
void main(){
  vec2 uv = vec2((mod(aMem, uSide) + 0.5) / uSide, (floor(aMem / uSide) + 0.5) / uSide);
  vec4 A = texture2D(tA, uv), B = texture2D(tB, uv), C = texture2D(tC, uv);
  vec3 base = A.xyz; float h = A.w;
  // Upright, turned to the eye around the vertical (a ray reads as a line of light from any side).
  vec3 toEye = cameraPosition - base; toEye.y = 0.0;
  vec3 side = length(toEye) > 1e-3 ? normalize(vec3(toEye.z, 0.0, -toEye.x)) : vec3(1.0, 0.0, 0.0);
  float w = uWidth * (0.6 + 0.8 * C.y) * (1.0 + B.a * 1.2);
  vec3 p = base + side * aCorner.x * w + vec3(0.0, mix(-h * 0.03, h, aCorner.y), 0.0);
  if (uMirror > 0.5) { p.y = 2.0 * uGround - p.y; p.x += sin(p.z * 0.04 + uTime * 0.8) * 3.0; }
  vC = aCorner; vCol = B.rgb; vE = B.a; vReview = C.x; vSeed = C.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const RAY_FRAGMENT = /* glsl */ `
uniform float uTime; uniform float uLight; uniform float uMirror;
varying vec2 vC; varying vec3 vCol; varying float vE; varying float vReview; varying float vSeed;
void main(){
  float x = vC.x, v = vC.y;
  float halo = exp(-x * x * 5.0), core = exp(-x * x * 70.0);
  float foot = smoothstep(0.0, 0.05, v);
  float fall = exp(-v * 1.5) * (1.0 - smoothstep(0.72, 1.0, v));
  float flick = 0.85 + 0.15 * sin(uTime * (2.0 + vSeed * 3.0) + vSeed * 40.0 + v * 6.0);
  // In review: broken in dashes running up the ray; proven: steady.
  float dash = mix(1.0, 0.4 + 0.6 * step(0.45, fract(v * 10.0 - uTime * 0.6 + vSeed * 7.0)), vReview);
  vec3 col = mix(vCol, ${LAVENDER}, smoothstep(0.35, 1.0, v) * 0.5);
  col = mix(col, vec3(1.0), core * 0.5 * (0.35 + vE));
  float a = (halo * 0.42 + core * 1.05) * foot * fall * flick * dash * (0.5 + 1.5 * vE);
  a *= mix(1.0, 0.2 * exp(-v * 2.2) * (0.6 + 0.4 * sin(v * 50.0 + uTime * 1.3 + vSeed * 9.0)), uMirror);
  gl_FragColor = vec4(col * a * uLight, 1.0);
}
`;
const SKY_VERTEX = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAGMENT = /* glsl */ `
varying vec3 vDir;
void main(){
  float h = vDir.y;
  vec3 horizon = vec3(0.016, 0.04, 0.065), zenith = vec3(0.002, 0.004, 0.009);
  vec3 c = mix(horizon, zenith, smoothstep(-0.02, 0.55, h));
  c = mix(c, vec3(0.012, 0.02, 0.03), smoothstep(0.0, -0.2, h));
  gl_FragColor = vec4(c, 1.0);
}
`;
const LAKE_VERTEX = /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const LAKE_FRAGMENT = /* glsl */ `
uniform float uExtent;
varying vec3 vW;
void main(){
  float d = length(vW.xz) / uExtent;
  vec3 c = mix(vec3(0.004, 0.008, 0.013), vec3(0.014, 0.034, 0.055), smoothstep(0.25, 1.0, d));
  gl_FragColor = vec4(c, 1.0);
}
`;

const SEGMENTS = 120;
function veilGeometry(layout: AuroraLayout) {
  const cs = layout.aurora.curtains.filter(Boolean);
  const per = (SEGMENTS + 1) * 2;
  const n = cs.length * per;
  const pos = new Float32Array(n * 3), uvs = new Float32Array(n * 2), curt = new Float32Array(n), nrm = new Float32Array(n * 2), len = new Float32Array(n), ph = new Float32Array(n), hh = new Float32Array(n);
  const index: number[] = [];
  cs.forEach((c, k) => {
    for (let s = 0; s <= SEGMENTS; s += 1) {
      const u = s / SEGMENTS;
      const sx = (u - 0.5) * c.length;
      const fold = Math.sin(u * c.folds * Math.PI * 2 + c.phase) * c.length * 0.06 + Math.sin(u * 2.3 * Math.PI + c.phase * 1.7) * c.length * 0.04;
      const x = c.x + c.dx * sx + c.nx * fold, z = c.z + c.dz * sx + c.nz * fold;
      for (let r = 0; r < 2; r += 1) {
        const i = k * per + s * 2 + r;
        pos[i * 3] = x; pos[i * 3 + 1] = c.y + r * c.height; pos[i * 3 + 2] = z;
        uvs[i * 2] = u; uvs[i * 2 + 1] = r;
        curt[i] = c.index; nrm[i * 2] = c.nx; nrm[i * 2 + 1] = c.nz; len[i] = c.length; ph[i] = c.phase; hh[i] = c.height;
      }
      if (s < SEGMENTS) { const a = k * per + s * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aUV", new THREE.BufferAttribute(uvs, 2));
  g.setAttribute("aCurt", new THREE.BufferAttribute(curt, 1));
  g.setAttribute("aNrm", new THREE.BufferAttribute(nrm, 2));
  g.setAttribute("aLen", new THREE.BufferAttribute(len, 1));
  g.setAttribute("aPh", new THREE.BufferAttribute(ph, 1));
  g.setAttribute("aH", new THREE.BufferAttribute(hh, 1));
  g.setIndex(index);
  return g;
}
function rayGeometry(count: number) {
  const mem = new Float32Array(count * 4), corner = new Float32Array(count * 8), pos = new Float32Array(count * 12);
  const index: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const cs = [[-1, 0], [1, 0], [-1, 1], [1, 1]];
    cs.forEach(([x, y], k) => { mem[i * 4 + k] = i; corner[(i * 4 + k) * 2] = x; corner[(i * 4 + k) * 2 + 1] = y; });
    const a = i * 4; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aMem", new THREE.BufferAttribute(mem, 1));
  g.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  return g;
}
const dataTexture = (data: Float32Array, w: number, h: number) => {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
};
const additive = (vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

export default function AuroraField({ layout, drive, count }: { layout: AuroraLayout; drive: AuroraDrive; count: number }) {
  const R = layout.R, ground = layout.aurora.ground;
  const g = useMemo(() => {
    const tA = dataTexture(drive.memA, drive.side, drive.side), tB = dataTexture(drive.memB, drive.side, drive.side), tC = dataTexture(drive.memC, drive.side, drive.side);
    const tCurt = dataTexture(drive.curt, drive.curtains, 1);
    const veil = veilGeometry(layout), rays = rayGeometry(count);
    const veilU = () => ({ uTime: { value: 0 }, uMirror: { value: 0 }, uGround: { value: ground }, tCurt: { value: tCurt }, uCurtains: { value: drive.curtains }, uLight: { value: 1 } });
    const rayU = () => ({ tA: { value: tA }, tB: { value: tB }, tC: { value: tC }, uSide: { value: drive.side }, uWidth: { value: 7 }, uTime: { value: 0 }, uMirror: { value: 0 }, uGround: { value: ground }, uLight: { value: 1 } });
    const veilMat = additive(VEIL_VERTEX, VEIL_FRAGMENT, veilU()), veilMirror = additive(VEIL_VERTEX, VEIL_FRAGMENT, veilU());
    const rayMat = additive(RAY_VERTEX, RAY_FRAGMENT, rayU()), rayMirror = additive(RAY_VERTEX, RAY_FRAGMENT, rayU());
    veilMirror.uniforms.uMirror.value = 1; rayMirror.uniforms.uMirror.value = 1;
    const sky = new THREE.ShaderMaterial({ vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false });
    const lake = new THREE.ShaderMaterial({ vertexShader: LAKE_VERTEX, fragmentShader: LAKE_FRAGMENT, depthWrite: false, side: THREE.DoubleSide, uniforms: { uExtent: { value: R * 5 } } });
    const skyGeo = new THREE.SphereGeometry(1, 32, 16), lakeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    return { tA, tB, tC, tCurt, veil, rays, veilMat, veilMirror, rayMat, rayMirror, sky, lake, skyGeo, lakeGeo };
  }, [layout, drive, count, ground, R]);
  useEffect(() => () => { Object.values(g).forEach((x) => (x as { dispose?: () => void }).dispose?.()); }, [g]);

  useFrame((state) => {
    const t = drive.motion ? state.clock.elapsedTime : 0;
    g.tA.needsUpdate = true; g.tB.needsUpdate = true; g.tC.needsUpdate = true; g.tCurt.needsUpdate = true;
    for (const m of [g.veilMat, g.veilMirror, g.rayMat, g.rayMirror]) { m.uniforms.uTime.value = t; m.uniforms.uLight.value = drive.light; }
  });

  const big = R * 10;
  return (
    <>
      <mesh geometry={g.skyGeo} material={g.sky} scale={[big, big, big]} renderOrder={-3} frustumCulled={false} />
      <mesh geometry={g.lakeGeo} material={g.lake} position={[0, ground, 0]} scale={[R * 10, 1, R * 10]} renderOrder={-2} />
      <mesh geometry={g.veil} material={g.veilMirror} renderOrder={-1} frustumCulled={false} />
      <mesh geometry={g.rays} material={g.rayMirror} renderOrder={-1} frustumCulled={false} />
      <mesh geometry={g.veil} material={g.veilMat} frustumCulled={false} />
      <mesh geometry={g.rays} material={g.rayMat} frustumCulled={false} />
    </>
  );
}
