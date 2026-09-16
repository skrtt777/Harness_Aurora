import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, PerspectiveCamera, OrthographicCamera, Line, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import Neuron from './Neuron';
import type { Memory } from './data';

type Props = { memories:Memory[]; selectedId:string|null; onSelect:(id:string)=>void; onFocus?:(id:string)=>void; cad:boolean; wireframe:boolean; orthographic:boolean; focus:boolean; focusTarget?:string|null; accessed:string[] };
type Edge = { key:string; from:Memory; to:Memory; active:boolean; pulse:boolean };

function edgeCurve(from:THREE.Vector3,to:THREE.Vector3,index:number){
  const mid=from.clone().lerp(to,.5); const offset=new THREE.Vector3(Math.sin(index*1.7)*.7,Math.cos(index*1.1)*.65,Math.sin(index*.8)*.55); return new THREE.CatmullRomCurve3([from,mid.add(offset),to]);
}

function SynapseLink({edge,index}:{edge:Edge;index:number}){
  const pulse=useRef<THREE.Mesh>(null); const curve=useMemo(()=>edgeCurve(new THREE.Vector3(...edge.from.position),new THREE.Vector3(...edge.to.position),index),[edge.from.position,edge.to.position,index]);
  useFrame(({clock})=>{ if(pulse.current&&edge.pulse){ const t=(clock.getElapsedTime()*.16+index*.037)%1; const point=curve.getPointAt(t); pulse.current.position.copy(point); const wave=Math.sin((t* Math.PI*2)); pulse.current.scale.setScalar(.72+Math.max(0,wave)*.38); }});
  return <group><Line points={curve.getPoints(10)} color={edge.active?'#ffae69':'#26528d'} lineWidth={edge.active?1.5:.45} transparent opacity={edge.active?.82:.23}/>{edge.pulse&&<mesh ref={pulse}><sphereGeometry args={[edge.active?.075:.045,6,4]}/><meshBasicMaterial color={edge.active?'#ffd49c':'#4e9dff'} toneMapped={false}/></mesh>}</group>;
}

function SceneContent({ memories, selectedId, onSelect, onFocus, cad, wireframe, orthographic, focus, focusTarget, accessed }:Props) {
  const group=useRef<THREE.Group>(null); const {camera}=useThree(); const selected=memories.find(m=>m.id===selectedId); const ids=useMemo(()=>new Set(memories.map(m=>m.id)),[memories]);
  const edges=useMemo<Edge[]>(()=>{ const seen=new Set<string>(); const output:Edge[]=[]; memories.forEach(from=>from.relations.forEach(id=>{const to=memories.find(m=>m.id===id);if(!to||!ids.has(id))return;const key=[from.id,to.id].sort().join('::');if(seen.has(key))return;seen.add(key);const active=from.id===selectedId||to.id===selectedId||accessed.includes(from.id)||accessed.includes(to.id);output.push({key,from,to,active,pulse:active||output.length%19===0});})); return output;},[memories,ids,selectedId,accessed]);
  useFrame((_,delta)=>{ if(group.current&&!focus) group.current.rotation.y+=delta*.012; const target=memories.find(m=>m.id===(focusTarget||selectedId)); if(target){const next=new THREE.Vector3(...target.position).add(new THREE.Vector3(4,3,4));camera.position.lerp(next,Math.min(1,delta*2.4));camera.lookAt(...target.position);}});
  return <><PerspectiveCamera makeDefault={!orthographic} position={[25,18,25]} fov={48}/><OrthographicCamera makeDefault={orthographic} position={[25,18,25]} zoom={22}/><color attach="background" args={['#050912']}/><fog attach="fog" args={['#050912',25,78]}/><ambientLight intensity={.5}/><directionalLight position={[10,18,8]} intensity={2.2} color="#b8d7ff"/><pointLight position={[-15,4,-15]} intensity={30} distance={35} color="#224b99"/>
    {cad&&<><Grid args={[80,80]} position={[0,-9,0]} cellSize={1} cellThickness={.4} cellColor="#1b4350" sectionSize={5} sectionThickness={.75} sectionColor="#27616d" fadeDistance={55} infiniteGrid/><Line points={[[-22,0,0],[22,0,0]]} color="#e16a6a" lineWidth={1}/><Line points={[[0,-12,0],[0,12,0]]} color="#6be09b" lineWidth={1}/><Line points={[[0,0,-22],[0,0,22]]} color="#6a9dff" lineWidth={1}/></>}
    <group ref={group}>{edges.map((edge,index)=><SynapseLink key={edge.key} edge={edge} index={index}/>)}{memories.slice(0,1000).map(m=><Neuron key={m.id} memory={m} selected={m.id===selectedId} dimmed={Boolean(selectedId&&m.id!==selectedId&&!selected?.relations.includes(m.id)&&!m.relations.includes(selectedId)&&!accessed.includes(m.id))} onSelect={()=>onSelect(m.id)} onFocus={()=>onFocus?.(m.id)} inspect={m.id===selectedId} cad={cad||m.id===selectedId} wireframe={wireframe} accessed={accessed.includes(m.id)}/> )}</group><OrbitControls makeDefault enableDamping dampingFactor={.08} minDistance={4} maxDistance={65}/><GizmoHelper alignment="bottom-right" margin={[70,70]}><GizmoViewport axisColors={['#ef6b6b','#69d698','#6f9cff']} labelColor="white"/></GizmoHelper>
  </>;
}

export default function MemoryScene(props:Props){ return <Canvas dpr={[1,1.5]} gl={{antialias:true,powerPreference:'high-performance'}} onCreated={({gl})=>gl.setPixelRatio(Math.min(window.devicePixelRatio,1.5))}><SceneContent {...props}/></Canvas>; }
