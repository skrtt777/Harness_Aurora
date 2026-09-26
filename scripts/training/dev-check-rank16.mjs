// Fase A.1 (docs/ROADMAP_MODELO_LOCAL.md): quick development-set check for
// the rank-16 LoRA variation, reusing the exact same 24 already-observed
// dev tasks and retention set evaluate-v3.mjs used for e1/e2 selection, so
// numbers are directly comparable to control (3/24, retention 4/4) and
// v3-e1 (4/24, retention 2/4) without repeating the frozen-manifest
// ceremony -- this is a diagnostic step, not a candidate promotion.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {heldout as oldTasks,retention as oldRetention} from './heldout-v2.mjs';
import {engineTasks} from '../benchmark/engine-tasks.mjs';
import {browserChecker} from './browser-check.mjs';
const model=process.argv[2];if(!model)throw Error('Usage: dev-check-rank16.mjs <ollama-model-name>');
const devTasks=[...oldTasks,...engineTasks].map(t=>({...t,id:'dev-'+t.id}));
const out='reports/model-training-v3-rank16/dev';await mkdir(join(out,'runs'),{recursive:true});
const tags=await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json());const installed=tags.models.find(m=>m.name===model);if(!installed)throw Error('Missing '+model);
process.env.HARNESS_DB_FILE='app/data/benchmarks/model-training-v3-rank16/dev-'+model.replace(/[^a-z0-9]/gi,'-')+'.db';await mkdir(dirname(process.env.HARNESS_DB_FILE),{recursive:true});
Object.assign(process.env,{LOCAL_MODEL:model,LOCAL_TEMPERATURE:'.2',LOCAL_TIMEOUT_MS:'120000',EMBEDDINGS_ENABLED:'false',HARNESS_CONTEXT_POLICY:'legacy'});
const {createConversation}=await import('../../app/store.js');const {createWorkflow,runWorkflow}=await import('../../app/workflows.js');const {runLocal}=await import('../../app/local.js');const {unwrap}=await import('../../app/workflowValidation.js');
const budget={maxCalls:4,maxTokens:22000,maxAttempts:2,maxInputChars:12000,maxOutputTokens:1536,maxDurationMs:180000};
const checker=await browserChecker(),records=[];
try{
 await runLocal('Responda OK.',{...process.env,LOCAL_MAX_OUTPUT_TOKENS:'128'});
 for(const t of devTasks){
  const seed=101,env={...process.env,LOCAL_SEED:String(seed)},c=await createConversation({provider:'local',title:`RankV16 dev/${model}/${t.id}`});
  let job=await createWorkflow({conversationId:c.id,goal:t.goal,functionalContracts:[{step:0,contract:t.contract}],knowledgeMode:'none',budget,env});
  await runWorkflow(job.id,{env,call:()=>{throw Error('Unexpected planner call');}});
  job=await runWorkflow(job.id,{env,call:async(prompt,settings,signal)=>runLocal(prompt,settings,signal),validate:async(reference,format,{contract})=>checker.check({reference:unwrap(reference,format),contract})});
  const step=job.steps[0],record={model,id:t.id,domain:t.domain,passed:step?.validation?.status==='passed',tokens:job.stats.inputTokens+job.stats.outputTokens};
  records.push(record);console.log(JSON.stringify({done:records.length,total:devTasks.length,id:t.id,passed:record.passed}));
 }
 const checks=[];for(const t of oldRetention){const response=await runLocal(t.prompt,{...process.env,LOCAL_SEED:'101',LOCAL_MAX_OUTPUT_TOKENS:'256'});let passed=false;try{passed=response.ok&&(t.kind==='json'?JSON.stringify(JSON.parse(unwrap(response.text,'json')))===JSON.stringify(t.expected):response.text.trim()===t.expected);}catch{}checks.push({...t,passed});}
 const result={model,passed:records.filter(r=>r.passed).length,total:records.length,tokens:records.reduce((s,r)=>s+r.tokens,0),retentionPassed:checks.filter(c=>c.passed).length,records};
 await writeFile(join(out,model.replace(/[^a-z0-9]/gi,'-')+'.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,records:undefined}));
}finally{await checker.close();}
