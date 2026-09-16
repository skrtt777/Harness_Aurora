import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, Sphere, Tube } from '@react-three/drei';
import * as THREE from 'three';
import type { Memory } from './data';

const materialByKind = { demo: '#638aff', context: '#52d6c1' };
function seed(id:string,n:number){let h=0;for(const c of id)h=(h*31+c.charCodeAt(0))%100000;return((h+n*97)%1000)/1000;}
function branch(id:string,origin:THREE.Vector3,i:number,detail:boolean){const points=[origin.clone()];const direction=new THREE.Vector3(seed(id,i)-.5,seed(id,i+2)-.5,seed(id,i+4)-.5).normalize();const length=(detail?1.8:1.15)+seed(id,i+5)*1.4;for(let j=1;j<5;j++)points.push(origin.clone().add(direction.clone().multiplyScalar(length*j/4)).add(new THREE.Vector3(Math.sin(j+i)*.22,Math.cos(j+i)*.18,Math.sin(j*.7+i)*.2)));return new THREE.CatmullRomCurve3(points);}

export default function Neuron({memory,selected,dimmed,onSelect,onFocus,inspect,cad,wireframe,accessed}:{memory:Memory;selected:boolean;dimmed:boolean;onSelect:()=>void;onFocus:()=>void;inspect:boolean;cad:boolean;wireframe:boolean;accessed:boolean}){
  const detail=selected||inspect; const color=materialByKind[memory.kind]; const activity=useRef<THREE.Group>(null); const halo=useRef<THREE.Mesh>(null);
  const branches=useMemo(()=>Array.from({length:detail?7:2},(_,i)=>branch(memory.id,new THREE.Vector3(0,0,0),i,detail)),[memory.id,detail]); const scale=selected?1.25:1;
  useFrame(({clock})=>{if(!accessed)return;const wave=(Math.sin(clock.getElapsedTime()*4.5+seed(memory.id,8)*6.28)+1)/2;if(activity.current)activity.current.scale.setScalar(.96+wave*.08);if(halo.current){halo.current.rotation.z+=.012;const mat=halo.current.material as THREE.MeshBasicMaterial;mat.opacity=.16+wave*.28;}});
  return <group position={memory.position} scale={scale} onClick={e=>{e.stopPropagation();onSelect();}} onDoubleClick={e=>{e.stopPropagation();onFocus();}}>
    <group ref={activity}><Sphere args={[selected?.35:.24,detail?16:8,detail?12:6]} scale={[1.25,1,.9]}><meshStandardMaterial color={color} emissive={accessed?'#ff9f5b':color} emissiveIntensity={accessed?1.15:selected?.3:.08} metalness={.45} roughness={.38} transparent opacity={dimmed?.2:1} wireframe={wireframe}/></Sphere>
      {detail&&<><Sphere args={[.12,12,8]}><meshStandardMaterial color="#ffd18a" emissive="#ff9e45" emissiveIntensity={.9} transparent opacity={dimmed?.2:1}/></Sphere><Sphere args={[.28,12,8]} scale={[1.1,.7,.8]}><meshBasicMaterial color={color} wireframe transparent opacity={cad?.45:.12}/></Sphere></>}
      {branches.map((curve,i)=><Tube key={i} args={[curve,detail?18:8,detail?.035:.022,5,false]}><meshStandardMaterial color={color} emissive={accessed?'#ff9f5b':color} emissiveIntensity={accessed?.7:.12} transparent opacity={dimmed?.16:detail?1:.72} wireframe={wireframe}/></Tube>)}
      {detail&&branches.map((curve,i)=><Line key={`tip-${i}`} points={[curve.getPointAt(.78),curve.getPointAt(1)]} color={color} lineWidth={1} transparent opacity={dimmed?.1:.75}/>)}</group>
    {accessed&&<mesh ref={halo} rotation={[Math.PI/2,0,0]}><ringGeometry args={[.52,.57,32]}/><meshBasicMaterial color="#ffb46f" transparent opacity={.3} toneMapped={false}/></mesh>}
    {selected&&<><pointLight color={accessed?'#ffad68':color} intensity={accessed?2.5:1.5} distance={4}/><mesh rotation={[Math.PI/2,0,0]}><ringGeometry args={[.7,.72,32]}/><meshBasicMaterial color="#ffd7a1" transparent opacity={.65}/></mesh></>}
  </group>;
}
