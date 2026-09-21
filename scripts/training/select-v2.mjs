import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access} from 'node:fs/promises';
import {rankDevelopmentCheckpoints} from './checkpoint-selection.mjs';
const root='reports/model-training-v2',read=p=>readFile(root+'/'+p,'utf8').then(JSON.parse),hash=b=>createHash('sha256').update(b).digest('hex');
try{await access(root+'/selection.json');throw Error('Selection already frozen; no model alias changed');}catch(e){if(e.code!=='ENOENT')throw e;}
const manifest=await read('manifest.json'),results=rankDevelopmentCheckpoints(manifest,await Promise.all(['e1','e2'].map(a=>read('dev/'+a+'.json'))));
const selected=results[0];const result=spawnSync('ollama',['cp',selected.model,manifest.candidate],{encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error(result.stderr);
const tags=await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json()),model=tags.models.find(m=>m.name===manifest.candidate);
if(model?.digest!==selected.modelDigest)throw Error('Copied weights changed');
const selection={createdAt:new Date().toISOString(),model:manifest.candidate,modelDigest:model.digest,modelBytes:model.size,selected: selected.arm,sourceModel:selected.model,rule:manifest.development.selectionRule,development:results.map(({arm,passed,total,retentionPassed,tokens,measuredTokens,estimatedTokens})=>({arm,passed,total,retentionPassed,tokens,measuredTokens,estimatedTokens})),sourceHashes:Object.fromEntries(await Promise.all(['e1','e2'].map(async arm=>[arm,hash(await readFile(root+'/dev/'+arm+'.json'))])))};
await writeFile(root+'/selection.json',JSON.stringify(selection,null,2),{flag:'wx'});console.log(JSON.stringify(selection));
