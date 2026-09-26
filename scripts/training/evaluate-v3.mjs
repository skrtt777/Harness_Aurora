import {mkdir,readFile,writeFile,readdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {heldout,retention} from './heldout-v3.mjs';
import {heldout as oldTasks,retention as oldRetention} from './heldout-v2.mjs';
import {engineTasks} from '../benchmark/engine-tasks.mjs';
import {browserChecker} from './browser-check.mjs';
const root=resolve('reports/model-training-v3'),phase=process.argv[2],arm=process.argv[3];
const sha=x=>createHash('sha256').update(x).digest('hex'),read=p=>readFile(p,'utf8').then(JSON.parse);
const models={baseline:'qwen2.5-coder:1.5b',control:'aurora-control:1.5b-v1',e1:'aurora-local:1.5b-v3-e1',e2:'aurora-local:1.5b-v3-e2',candidate:'aurora-local:1.5b-v3'};
const files=['scripts/training/evaluate-v3.mjs','scripts/training/heldout-v3.mjs','scripts/training/heldout-v2.mjs','scripts/training/final-tasks-v3.mjs','scripts/training/curriculum.mjs','scripts/training/curriculum-v2.mjs','scripts/training/curriculum-v3.mjs','scripts/training/build-dataset-v3.mjs','scripts/training/train-lora-v3.py','scripts/training/browser-check.mjs','scripts/benchmark/engine-tasks.mjs',...(await readdir('app')).filter(f=>f.endsWith('.js')).map(f=>'app/'+f),...(await readdir('app/runtime-policy')).map(f=>'app/runtime-policy/'+f)];
const hashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(f))])));
const devTasks=[...oldTasks,...engineTasks].map(t=>({...t,id:'dev-'+t.id}));
const dataset=await read('models/local-training/dataset-v3/manifest.json');
if(phase==='freeze'){
 await mkdir(root);const tags=await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json());
 const manifest={id:'model-training-v3',createdAt:new Date().toISOString(),baseline:models.baseline,candidate:models.candidate,control:models.control,models,seeds:[211,419],temperature:.2,budget:{maxCalls:4,maxTokens:22000,maxAttempts:2,maxInputChars:12000,maxOutputTokens:1536,maxDurationMs:180000},gate:{minimumPassRate:.70,minimumGainPoints:15,noDomainRegression:true,minimumRetentionPassed:3,noRetentionRegression:true,maxTokenRatio:1.2},sourceHashes:hashes,taskHash:sha(JSON.stringify(heldout)),tasks:heldout.map(({reference,...t})=>t),development:{taskHash:sha(JSON.stringify(devTasks)),tasks:devTasks.map(({reference,...t})=>t),seeds:[101],selectionRule:'Most full functional passes, then retention passes, then fewer total tokens, then earlier epoch. No final results in selection.'},dataset,baseDigests:Object.fromEntries(tags.models.filter(m=>[models.baseline,models.control].includes(m.name)).map(m=>[m.name,m.digest])),scope:'8 new composed HTML tasks x 2 seeds. Related components in training; heldout references excluded. 24 previously observed tasks (v2 heldout + engine-tasks) used only for development. Small engineering sample, not general accuracy.'};
 await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 for(const f of files){const to=join(root,'source',f);await mkdir(dirname(to),{recursive:true});await copyFile(f,to);}
 console.log('Frozen '+root);process.exit(0);
}
const manifest=await read(join(root,'manifest.json'));
if(JSON.stringify(hashes)!==JSON.stringify(manifest.sourceHashes))throw Error('Frozen source changed');
if(!['dev','final'].includes(phase)||!(arm in models)||(phase==='dev'&&!['control','e1','e2'].includes(arm))||(phase==='final'&&!['baseline','control','candidate'].includes(arm)))throw Error('Use dev control/e1/e2 or final baseline/control/candidate');
const selected=phase==='final'?await read(join(root,'selection.json')):null;
const tasks=phase==='dev'?devTasks:heldout,seeds=phase==='dev'?[101]:manifest.seeds,retentionTasks=phase==='dev'?oldRetention:retention,model=models[arm];
const out=join(root,phase);await mkdir(join(out,'runs'),{recursive:true});
const tags=await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json());const installed=tags.models.find(m=>m.name===model);if(!installed)throw Error('Missing '+model);
if(manifest.baseDigests[model]&&manifest.baseDigests[model]!==installed.digest)throw Error('Base weights changed');
if(arm==='candidate'&&selected.modelDigest!==installed.digest)throw Error('Selected model changed');
const identityFile=join(out,arm+'-identity.json');
try{if((await read(identityFile)).digest!==installed.digest)throw Error('Model changed while resuming');}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(identityFile,JSON.stringify(installed,null,2),{flag:'wx'});}
process.env.HARNESS_DB_FILE=resolve('app/data/benchmarks/model-training-v3',phase+'-'+arm+'.db');await mkdir(dirname(process.env.HARNESS_DB_FILE),{recursive:true});
Object.assign(process.env,{LOCAL_MODEL:model,LOCAL_TEMPERATURE:'.2',LOCAL_TIMEOUT_MS:'120000',EMBEDDINGS_ENABLED:'false',HARNESS_CONTEXT_POLICY:'legacy'});
const {createConversation}=await import('../../app/store.js');const {createWorkflow,runWorkflow}=await import('../../app/workflows.js');const {runLocal}=await import('../../app/local.js');const {unwrap}=await import('../../app/workflowValidation.js');
const checker=await browserChecker(),records=[];
try{
 const references=[];for(const t of tasks){const validation=await checker.check(t);references.push({id:t.id,validation});if(validation.status!=='passed')throw Error('Reference failed '+t.id+JSON.stringify(validation));}
 await writeFile(join(out,arm+'-references.json'),JSON.stringify(references,null,2));
 await runLocal('Responda OK.',{...process.env,LOCAL_MAX_OUTPUT_TOKENS:'128'});
 for(const t of tasks)for(const seed of seeds){
  const file=join(out,'runs',`${arm}-${t.id}-${seed}.json`);
  try{records.push(await read(file));continue;}catch(e){if(e.code!=='ENOENT')throw e;}
  const env={...process.env,LOCAL_SEED:String(seed)},c=await createConversation({provider:'local',title:`V3 ${phase}/${arm}/${t.id}/${seed}`});
  let job=await createWorkflow({conversationId:c.id,goal:t.goal,functionalContracts:[{step:0,contract:t.contract}],knowledgeMode:'none',budget:manifest.budget,env});
  await runWorkflow(job.id,{env,call:()=>{throw Error('Unexpected planner call');}});
  const trace=[],start=performance.now();
  job=await runWorkflow(job.id,{env,call:async(prompt,settings,signal)=>{const response=await runLocal(prompt,settings,signal);trace.push({prompt,response});return response;},validate:async(reference,format,{contract})=>checker.check({reference:unwrap(reference,format),contract})});
  const step=job.steps[0],record={phase,arm,model,modelDigest:installed.digest,id:t.id,domain:t.domain,seed,passed:step?.validation?.status==='passed',firstPassed:step?.history?.find(h=>h.attempt===1)?.validation?.status==='passed',tokens:job.stats.inputTokens+job.stats.outputTokens,estimatedTokens:job.stats.estimatedTokens,calls:trace.length,elapsedMs:performance.now()-start,workflow:job,trace};
  records.push(record);await writeFile(file,JSON.stringify(record,null,2),{flag:'wx'});console.log(JSON.stringify({phase,arm,done:records.length,total:tasks.length*seeds.length,id:t.id,passed:record.passed,tokens:record.tokens}));
 }
 const checks=[];for(const t of retentionTasks){const response=await runLocal(t.prompt,{...process.env,LOCAL_SEED:'101',LOCAL_MAX_OUTPUT_TOKENS:'256'});let passed=false;try{passed=response.ok&&(t.kind==='json'?JSON.stringify(JSON.parse(unwrap(response.text,'json')))===JSON.stringify(t.expected):response.text.trim()===t.expected);}catch{}checks.push({...t,response,passed});}
 const result={phase,arm,model,modelDigest:installed.digest,completedAt:new Date().toISOString(),passed:records.filter(r=>r.passed).length,total:records.length,firstPassed:records.filter(r=>r.firstPassed).length,tokens:records.reduce((s,r)=>s+r.tokens,0),calls:records.reduce((s,r)=>s+r.calls,0),elapsedMs:records.reduce((s,r)=>s+r.elapsedMs,0),retentionPassed:checks.filter(c=>c.passed).length,retention:checks,records};
 await writeFile(join(out,arm+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,retention:undefined,records:undefined}));
}finally{await checker.close();}
