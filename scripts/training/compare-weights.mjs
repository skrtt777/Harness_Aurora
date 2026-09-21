// Same newly imported quantization, template, prompt and decoding on both arms.
// This control separates adapter effects from possible old GGUF export differences.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {heldout,retention} from './heldout.mjs';
import {browserChecker} from './browser-check.mjs';
import {runLocal} from '../../app/local.js';
import {unwrap} from '../../app/workflowValidation.js';
const out='reports/model-training-v1',sha=x=>createHash('sha256').update(x).digest('hex');
const frozen=JSON.parse(await readFile(out+'/manifest.json'));
if(frozen.taskHash!==sha(JSON.stringify(heldout)))throw Error('Heldout tasks changed');
const manifest={createdAt:new Date().toISOString(),models:['aurora-control:1.5b-v1','aurora-local:1.5b-v1'],seeds:frozen.seeds,taskHash:frozen.taskHash,scriptHash:sha(await readFile(new URL(import.meta.url))),gate:'Candidate first-pass count must be strictly greater than the canonical untrained control; main promotion gates still required.'};
if(process.argv[2]==='freeze'){await writeFile(out+'/weights-control-manifest.json',JSON.stringify(manifest,null,2),{flag:'wx'});console.log('Weight control frozen');process.exit(0);}
const frozenControl=JSON.parse(await readFile(out+'/weights-control-manifest.json'));if(frozenControl.scriptHash!==manifest.scriptHash)throw Error('Control script changed');
const checker=await browserChecker(),records=[];
try{
 for(const model of manifest.models){
  await runLocal('Responda OK.',{...process.env,LOCAL_MODEL:model,LOCAL_MAX_OUTPUT_TOKENS:'128'});
  for(const t of heldout)for(const seed of manifest.seeds){
   const baseline=JSON.parse(await readFile(`${out}/runs/baseline-${t.id}-${seed}.json`));
   const response=await runLocal(baseline.trace[0].prompt,{...process.env,LOCAL_MODEL:model,LOCAL_CONTEXT_TOKENS:'8192',LOCAL_MAX_OUTPUT_TOKENS:'1536',LOCAL_TEMPERATURE:'.2',LOCAL_SEED:String(seed),LOCAL_TIMEOUT_MS:'120000'});
   const validation=response.ok&&!response.truncated?await checker.check({...t,reference:unwrap(response.text,'html')}):{status:'failed'};
   records.push({model,id:t.id,seed,passed:validation.status==='passed',response,validation});console.log(JSON.stringify({model,id:t.id,seed,passed:validation.status==='passed'}));
  }
 }
 await writeFile(out+'/weights-control.json',JSON.stringify({manifest:frozenControl,summary:manifest.models.map(model=>({model,passed:records.filter(r=>r.model===model&&r.passed).length,total:records.filter(r=>r.model===model).length})),records},null,2));
}finally{await checker.close();}
