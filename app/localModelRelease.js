import {getSetting} from './store.js';

export function approvedInstalledModel(release, models) {
  if(release?.decision?.passed!==true || !Array.isArray(release.decision.checks) || release.decision.checks.length<7 || !release.decision.checks.every(c=>c.passed===true) || !/^[a-f0-9]{64}$/.test(release.modelDigest||''))return null;
  return models.find(m=>m.name===release.model&&m.digest===release.modelDigest)?.name||null;
}
export async function localExperiment(){
  try{return JSON.parse(await getSetting('local_model_experiment')||'null');}catch{return null;}
}
export async function automaticLocalModel(env){
  let release;try{release=JSON.parse(await getSetting('local_model_release')||'null');}catch{return null;}
  if(!release?.decision?.passed)return null;
  try{
    const response=await fetch(`${env.LOCAL_BASE_URL||'http://127.0.0.1:11434'}/api/tags`,{signal:AbortSignal.timeout(2500)});
    if(!response.ok)return null;
    return approvedInstalledModel(release,(await response.json()).models||[]);
  }catch{return null;}
}
