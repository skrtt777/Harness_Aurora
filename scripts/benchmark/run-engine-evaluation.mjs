import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {engineTasks} from './engine-tasks.mjs';
import {functionalFixtures} from './functional-fixtures.mjs';
import {writeEngineReport} from './engine-report.mjs';
const id=process.argv[2]||'engine-evaluation-v1';
if(!/^[a-z0-9-]+$/.test(id))throw Error('Invalid experiment ID');
const out=resolve('reports',id);await mkdir(out);await mkdir(join(out,'runs'));
const data=resolve('app/data/benchmarks',id);await mkdir(data,{recursive:true});
process.env.HARNESS_DB_FILE=join(data,'engine.db');process.env.LOCAL_MODEL='qwen2.5-coder:1.5b';
process.env.LOCAL_TEMPERATURE='0.2';process.env.LOCAL_TIMEOUT_MS='120000';process.env.EMBEDDINGS_ENABLED='false';process.env.HARNESS_CONTEXT_POLICY='legacy';
process.env.HARNESS_EVIDENCE_ENGINE='true';
const {createConversation,createProject,createMemory}=await import('../../app/store.js');
const {createWorkflow,runWorkflow}=await import('../../app/workflows.js');
const {reviewEngineKnowledge,listEngineKnowledge}=await import('../../app/evidenceEngine.js');
const {runLocal}=await import('../../app/local.js');
const {validateArtifact}=await import('../../app/workflowValidation.js');
const hash=s=>createHash('sha256').update(s).digest('hex');
const files=[...(await readdir('app')).filter(f=>f.endsWith('.js')).map(f=>'app/'+f),'package-lock.json','scripts/benchmark/engine-tasks.mjs','scripts/benchmark/run-engine-evaluation.mjs','scripts/benchmark/engine-report.mjs'];
const hashes=Object.fromEntries(await Promise.all(files.map(async p=>[p,hash(await readFile(p))])));
const seeds=[17,41,73],arms=['none','memory','skills'];
const manifest={id,createdAt:new Date().toISOString(),model:process.env.LOCAL_MODEL,seeds,temperature:.2,arms,tasks:engineTasks.map(({reference,...t})=>t),taskHash:hash(JSON.stringify(engineTasks)),sourceHashes:hashes,budget:{maxCalls:4,maxTokens:22000,maxAttempts:2,maxInputChars:12000,maxOutputTokens:1536,maxDurationMs:180000},scope:'Geração de 12 artefatos HTML pequenos, com contratos fornecidos; 3 sementes, 3 configurações. Engine idêntica nos três grupos. Conhecimento de quatro defeitos anteriores; nada dos resultados novos é ativado durante a avaliação. Não mede projetos grandes nem precisão geral.'};
await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
// Verify the test harness against handwritten references before any model output.
const referenceChecks=[];
for(const t of engineTasks){const v=await validateArtifact(t.reference,'html',{contract:t.contract});referenceChecks.push({id:t.id,validation:v});if(v.status!=='passed'){await writeFile(join(out,'reference-checks.json'),JSON.stringify(referenceChecks,null,2));throw Error('Reference failed: '+t.id+': '+JSON.stringify(v));}}
await writeFile(join(out,'reference-checks.json'),JSON.stringify(referenceChecks,null,2));
const project=await createProject({name:'Frozen engine evaluation '+id});
const training=[];
for(const f of functionalFixtures){
  const c=await createConversation({provider:'local',projectId:project.id,title:'Treino: '+f.id});
  let job=await createWorkflow({conversationId:c.id,goal:f.goal,functionalContracts:[{step:0,contract:f.contract}],budget:manifest.budget});
  await runWorkflow(job.id,{call:()=>{throw Error('Planning should be deterministic');}});
  let fixture=true;job=await runWorkflow(job.id,{call:async()=>{if(!fixture)throw Error('Training cannot invoke a model');fixture=false;return {ok:true,text:f.bad,usage:{input_tokens:0,output_tokens:0}};}});
  const learned=(await listEngineKnowledge()).find(k=>k.id===job.steps[0].learnedKnowledgeId);
  if(!learned)throw Error('Verified training repair absent: '+f.id);
  await reviewEngineKnowledge(learned.id,true); // Explicit experimental activation, in this isolated project only.
  await createMemory({scope:'project',projectId:project.id,title:f.goal.slice(0,140),content:`Reparo observado em um caso; valide antes de adaptar.\nAntes:\n${learned.old}\nDepois:\n${learned.fixed}`,tags:[f.id,'verified-repair']});
  training.push({id:f.id,workflow:job,knowledge:learned});
}
await writeFile(join(out,'training.json'),JSON.stringify(training,null,2));
// Warm the same model once. Its response is excluded and cannot become knowledge.
const warm=await runLocal('Responda apenas OK.',{...process.env,LOCAL_MAX_OUTPUT_TOKENS:'128',LOCAL_SEED:'17'});
await writeFile(join(out,'warmup.json'),JSON.stringify(warm,null,2));
const records=[];
for(const [ti,t] of engineTasks.entries())for(const [si,seed] of seeds.entries()){
  const rotation=(ti+si)%arms.length,order=[...arms.slice(rotation),...arms.slice(0,rotation)];
  for(const arm of order){
    const c=await createConversation({provider:'local',projectId:project.id,title:`${t.id}/${seed}/${arm}`});
    const env={...process.env,LOCAL_SEED:String(seed)};
    let job=await createWorkflow({conversationId:c.id,goal:t.goal,functionalContracts:[{step:0,contract:t.contract}],budget:manifest.budget,knowledgeMode:arm,env});
    const start=performance.now();
    await runWorkflow(job.id,{env,call:()=>{throw Error('Unexpected plan call');}});
    const trace=[];
    job=await runWorkflow(job.id,{env,call:async(prompt,settings,signal)=>{const response=await runLocal(prompt,settings,signal);trace.push({prompt,response});return response;}});
    const first=job.steps[0]?.history?.find(h=>h.attempt===1)?.validation;
    const record={id:t.id,domain:t.domain,arm,seed,passed:job.steps[0]?.validation?.status==='passed',firstPassed:first?.status==='passed',status:job.status,tokens:job.stats.inputTokens+job.stats.outputTokens,estimatedTokens:job.stats.estimatedTokens,elapsedMs:performance.now()-start,calls:trace.length,repairCalls:job.stats.calls?.filter(c=>c.stage==='repair').length||0,deterministicChecks:job.stats.deterministicChecks||0,referenceLoads:job.stats.referenceLoads||0,completeUsage:trace.every(t=>Number.isFinite(t.response.usage?.input_tokens)&&Number.isFinite(t.response.usage?.output_tokens)),workflow:job,trace};
    records.push(record);await writeFile(join(out,'runs',`${t.id}-${seed}-${arm}.json`),JSON.stringify(record,null,2));
    await writeFile(join(out,'progress.json'),JSON.stringify({completed:records.length,total:engineTasks.length*seeds.length*arms.length,last:{task:t.id,seed,arm,passed:record.passed}}));
    console.log(JSON.stringify({done:records.length,total:108,task:t.id,arm,seed,passed:record.passed,tokens:record.tokens}));
  }
}
const changed=[];for(const [p,h] of Object.entries(hashes))if(hash(await readFile(p))!==h)changed.push(p);
const result={...manifest,completedAt:new Date().toISOString(),sourceChanged:changed,records};
await writeFile(join(out,'results.json'),JSON.stringify(result,null,2));
if(changed.length)throw Error('Source changed while evaluation was running: '+changed.join(', '));
await writeEngineReport(result,out);
console.log('Complete: '+out);
