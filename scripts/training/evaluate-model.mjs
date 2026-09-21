import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {heldout,retention} from './heldout.mjs';
import {browserChecker} from './browser-check.mjs';
const out=resolve('reports/model-training-v1');await mkdir(out,{recursive:true});await mkdir(join(out,'runs'),{recursive:true});
const sha=x=>createHash('sha256').update(x).digest('hex');
const manifestFile=join(out,'manifest.json');
let manifest;
try{manifest=JSON.parse(await readFile(manifestFile));}catch(e){if(e.code!=='ENOENT')throw e;}
const files=['scripts/training/heldout.mjs','scripts/training/curriculum.mjs','scripts/training/evaluate-model.mjs','scripts/training/train-lora.py','scripts/training/build-dataset.mjs',...(await readdir('app')).filter(f=>f.endsWith('.js')).map(f=>'app/'+f)];
const hashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(f))])));
if(!manifest){
 manifest={createdAt:new Date().toISOString(),baseline:'qwen2.5-coder:1.5b',candidate:'aurora-local:1.5b-v1',seeds:[101,307],temperature:.2,budget:{maxCalls:4,maxTokens:22000,maxAttempts:2,maxInputChars:12000,maxOutputTokens:1536,maxDurationMs:180000},sourceHashes:hashes,tasks:heldout.map(({reference,...t})=>t),taskHash:sha(JSON.stringify(heldout)),retention,gate:{minimumPassRate:.70,minimumGainPoints:15,noDomainRegression:true,minimumRetentionPassed:3,noRetentionRegression:true,maxTokenRatio:1.20},scope:'12 new composed HTML tasks, 2 seeds; related components exist in training but these task references are never in the dataset. Four simple retention prompts. Small engineering acceptance set, not general accuracy.'};
 await writeFile(manifestFile,JSON.stringify(manifest,null,2));
}else if(JSON.stringify(hashes)!==JSON.stringify(manifest.sourceHashes))throw Error('Frozen source changed; create a new evaluation, do not overwrite evidence');
const arm=process.argv[2];if(!['baseline','candidate','freeze'].includes(arm))throw Error('Use freeze, baseline or candidate');
if(arm==='freeze'){console.log('Frozen '+manifestFile);process.exit(0);}
const model=manifest[arm];process.env.HARNESS_DB_FILE=resolve('app/data/benchmarks/model-training-v1',arm+'.db');await mkdir(resolve('app/data/benchmarks/model-training-v1'),{recursive:true});
process.env.LOCAL_MODEL=model;process.env.LOCAL_TEMPERATURE=String(manifest.temperature);process.env.LOCAL_TIMEOUT_MS='120000';process.env.EMBEDDINGS_ENABLED='false';process.env.HARNESS_CONTEXT_POLICY='legacy';
const {createConversation}=await import('../../app/store.js');
const {createWorkflow,runWorkflow}=await import('../../app/workflows.js');
const {runLocal}=await import('../../app/local.js');
const {unwrap}=await import('../../app/workflowValidation.js');
const checker=await browserChecker();const records=[];
try{
 const references=[];
 for(const t of heldout){const validation=await checker.check(t);references.push({id:t.id,validation});if(validation.status!=='passed')throw Error('Invalid reference '+t.id+JSON.stringify(validation));}
 await writeFile(join(out,'references.json'),JSON.stringify(references,null,2));
 const show=await fetch('http://127.0.0.1:11434/api/show',{method:'POST',body:JSON.stringify({model})}).then(r=>r.json());if(show.error)throw Error(show.error);
 await writeFile(join(out,arm+'-model.json'),JSON.stringify({details:show.details,model_info:show.model_info,template:show.template,parameters:show.parameters},null,2));
 await runLocal('Responda OK.',{...process.env,LOCAL_MAX_OUTPUT_TOKENS:'128'});
 for(const t of heldout)for(const seed of manifest.seeds){
   const file=join(out,'runs',`${arm}-${t.id}-${seed}.json`);
   try{const saved=JSON.parse(await readFile(file));records.push(saved);continue;}catch(e){if(e.code!=='ENOENT')throw e;}
   const env={...process.env,LOCAL_SEED:String(seed)};
   const c=await createConversation({provider:'local',title:`Model test ${arm}/${t.id}/${seed}`});
   let job=await createWorkflow({conversationId:c.id,goal:t.goal,functionalContracts:[{step:0,contract:t.contract}],knowledgeMode:'none',budget:manifest.budget,env});
   await runWorkflow(job.id,{env,call:()=>{throw Error('Unexpected planner call');}});
   const trace=[],start=performance.now();
   job=await runWorkflow(job.id,{env,call:async(prompt,settings,signal)=>{const response=await runLocal(prompt,settings,signal);trace.push({prompt,response});return response;},validate:async(reference,format,{contract})=>checker.check({reference:unwrap(reference,format),contract})});
   const step=job.steps[0],record={arm,model,id:t.id,domain:t.domain,seed,passed:step?.validation?.status==='passed',firstPassed:step?.history?.find(h=>h.attempt===1)?.validation?.status==='passed',tokens:job.stats.inputTokens+job.stats.outputTokens,estimatedTokens:job.stats.estimatedTokens,calls:trace.length,elapsedMs:performance.now()-start,workflow:job,trace};
   records.push(record);await writeFile(file,JSON.stringify(record,null,2));console.log(JSON.stringify({arm,done:records.length,total:24,id:t.id,seed,passed:record.passed,tokens:record.tokens}));
 }
 const checks=[];
 for(const t of retention){const r=await runLocal(t.prompt,{...process.env,LOCAL_SEED:'101',LOCAL_MAX_OUTPUT_TOKENS:'256'});let passed=false;try{passed=r.ok&&(t.kind==='json'?JSON.stringify(JSON.parse(unwrap(r.text,'json')))===JSON.stringify(t.expected):r.text.trim()===t.expected);}catch{}checks.push({...t,response:r,passed});}
 const result={arm,model,completedAt:new Date().toISOString(),passed:records.filter(r=>r.passed).length,total:records.length,firstPassed:records.filter(r=>r.firstPassed).length,tokens:records.reduce((s,r)=>s+r.tokens,0),calls:records.reduce((s,r)=>s+r.calls,0),elapsedMs:records.reduce((s,r)=>s+r.elapsedMs,0),domains:Object.fromEntries(['jogo','pagina','app','bi'].map(d=>[d,{passed:records.filter(r=>r.domain===d&&r.passed).length,total:records.filter(r=>r.domain===d).length}])),retentionPassed:checks.filter(c=>c.passed).length,retention:checks,records};
 await writeFile(join(out,arm+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,records:undefined,retention:undefined}));
}finally{await checker.close();}
