// Supplemental quality control through installed Ollama, without CPU working-set cap.
// Run separately from the CPU campaign (paused or finished), never concurrently.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {heldout,retention} from '../training/heldout-v2.mjs';
import {browserChecker} from '../training/browser-check.mjs';
const arm=process.argv[2],models={old:'qwen2.5-coder:1.5b',current:'qwen3.5:4b',moe:'qwen3-coder:30b'};
if(!models[arm])throw Error('Select old, current or moe');
const model=models[arm],root=resolve('reports/ssd-quality-control-v1');
await mkdir(root,{recursive:true});
const read=p=>readFile(p,'utf8').then(JSON.parse),sha=x=>createHash('sha256').update(x).digest('hex');
const files=['scripts/benchmark/ssd-quality-control.mjs','scripts/training/heldout-v2.mjs','scripts/training/curriculum.mjs','scripts/training/browser-check.mjs',...(await readdir('app')).filter(f=>f.endsWith('.js')).map(f=>'app/'+f),...(await readdir('app/runtime-policy')).map(f=>'app/runtime-policy/'+f)];
const definitions={sourceHashes:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(f))]))),models,seeds:[211,419],temperature:.2,budget:{maxCalls:4,maxTokens:22000,maxAttempts:2,maxInputChars:12000,maxOutputTokens:1536,maxDurationMs:180000},scope:'Supplemental uncapped Ollama quality control with available GPU. Not CPU/SSD performance and not representative of a 16 GB PC.',taskHash:sha(JSON.stringify(heldout))};
try{const m=await read(join(root,'manifest.json'));if(JSON.stringify(m.definitions)!==JSON.stringify(definitions))throw Error('Frozen quality control changed');}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(join(root,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),definitions},null,2),{flag:'wx'});}
const out=join(root,arm);await mkdir(join(out,'runs'),{recursive:true});
const installed=(await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json())).models.find(m=>m.name===model);if(!installed)throw Error('Missing '+model);
try{if((await read(join(out,'identity.json'))).digest!==installed.digest)throw Error('Model changed');}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(join(out,'identity.json'),JSON.stringify(installed,null,2),{flag:'wx'});}
process.env.HARNESS_DB_FILE=resolve('app/data/benchmarks/ssd-quality-control-v1',arm+'.db');await mkdir(resolve(process.env.HARNESS_DB_FILE,'..'),{recursive:true});
Object.assign(process.env,{LOCAL_MODEL:model,LOCAL_TEMPERATURE:'.2',LOCAL_TIMEOUT_MS:'120000',EMBEDDINGS_ENABLED:'false',HARNESS_CONTEXT_POLICY:'legacy'});
const {createConversation}=await import('../../app/store.js'),{createWorkflow,runWorkflow}=await import('../../app/workflows.js'),{runLocal}=await import('../../app/local.js'),{unwrap}=await import('../../app/workflowValidation.js');
const checker=await browserChecker();
try{
 const references=[];for(const t of heldout){const validation=await checker.check(t);references.push({id:t.id,validation});if(validation.status!=='passed')throw Error('Reference failed '+t.id);}
 await writeFile(join(out,'references.json'),JSON.stringify(references,null,2));
 const warmup=await runLocal('Responda OK.',{...process.env,LOCAL_MAX_OUTPUT_TOKENS:'128',LOCAL_TIMEOUT_MS:'600000'});
 await writeFile(join(out,'warmup.json'),JSON.stringify({response:warmup,version:await fetch('http://127.0.0.1:11434/api/version').then(r=>r.json()),loaded:await fetch('http://127.0.0.1:11434/api/ps').then(r=>r.json())},null,2));
 if(!warmup.ok)throw Error('Model preparation failed; quality tasks not scored: '+warmup.error);
 const records=[];
 for(const seed of definitions.seeds)for(const t of heldout){
  const file=join(out,'runs',`${t.id}-${seed}.json`);try{records.push(await read(file));continue;}catch(e){if(e.code!=='ENOENT')throw e;}
  const env={...process.env,LOCAL_SEED:String(seed)},c=await createConversation({provider:'local',title:`Quality control ${arm}/${t.id}/${seed}`});
  let job=await createWorkflow({conversationId:c.id,goal:t.goal,functionalContracts:[{step:0,contract:t.contract}],knowledgeMode:'none',budget:definitions.budget,env});
  await runWorkflow(job.id,{env,call:()=>{throw Error('Unexpected planner call');}});
  const trace=[],startedAt=Date.now();job=await runWorkflow(job.id,{env,call:async(prompt,settings,signal)=>{const response=await runLocal(prompt,settings,signal);trace.push({prompt,response});return response;},validate:async(reference,format,{contract})=>checker.check({reference:unwrap(reference,format),contract})});
  const step=job.steps[0],record={arm,model,id:t.id,domain:t.domain,seed,passed:step?.validation?.status==='passed',firstPassed:step?.history?.find(h=>h.attempt===1)?.validation?.status==='passed',inputTokens:job.stats.inputTokens,outputTokens:job.stats.outputTokens,estimatedTokens:job.stats.estimatedTokens,calls:trace.length,startedAt,finishedAt:Date.now(),elapsedMs:Date.now()-startedAt,workflow:job,trace};
  records.push(record);await writeFile(file,JSON.stringify(record,null,2),{flag:'wx'});console.log(JSON.stringify({arm,done:records.length,total:24,id:t.id,passed:record.passed,elapsedMs:record.elapsedMs,error:job.error}));
 }
 const checks=[];for(const t of retention){const response=await runLocal(t.prompt,{...process.env,LOCAL_SEED:'101',LOCAL_MAX_OUTPUT_TOKENS:'256'});let passed=false;try{passed=response.ok&&(t.kind==='json'?JSON.stringify(JSON.parse(unwrap(response.text,'json')))===JSON.stringify(t.expected):response.text.trim()===t.expected);}catch{}checks.push({...t,response,passed});}
 await writeFile(join(out,'summary.json'),JSON.stringify({arm,model,completedAt:new Date().toISOString(),passed:records.filter(r=>r.passed).length,total:records.length,firstPassed:records.filter(r=>r.firstPassed).length,retentionPassed:checks.filter(c=>c.passed).length,retention:checks},null,2));
}finally{await checker.close();}
