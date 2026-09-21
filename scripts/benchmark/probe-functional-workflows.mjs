import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { functionalFixtures } from './functional-fixtures.mjs';
const id=process.argv[2] || 'cycle2-functional-workflows';
if(!/^[a-z0-9-]+$/.test(id)) throw Error('Invalid report ID');
const out=resolve('reports',id);
await mkdir(out); // Preserve prior measurements; a rerun needs another ID.
await mkdir(resolve('app/data/benchmarks',id),{recursive:true});
process.env.HARNESS_DB_FILE=resolve('app/data/benchmarks',id,'workflow.db');
process.env.LOCAL_MODEL='qwen2.5-coder:1.5b';
process.env.LOCAL_SEED='17';process.env.LOCAL_TEMPERATURE='0.2';process.env.LOCAL_TIMEOUT_MS='120000';
process.env.EMBEDDINGS_ENABLED='false';process.env.HARNESS_CONTEXT_POLICY='legacy';
const {createConversation}=await import('../../app/store.js');
const {createWorkflow,runWorkflow}=await import('../../app/workflows.js');
const {runLocal}=await import('../../app/local.js');
const records=[];
for(const f of functionalFixtures){
 const c=await createConversation({title:'Teste funcional: '+f.id,provider:'local'});
 let job=await createWorkflow({conversationId:c.id,goal:f.goal,functionalContracts:[{step:0,contract:f.contract}],budget:{maxAttempts:3,maxCalls:3,maxOutputTokens:1024}});
 job=await runWorkflow(job.id,{call:()=>{throw Error('Single-step plan must not call model');}});
 const trace=[];let fixture=true;
 job=await runWorkflow(job.id,{call:async(prompt,env,signal)=>{
  if(fixture){fixture=false;return {ok:true,text:f.bad,usage:{input_tokens:0,output_tokens:0},metrics:{fixture:true,wallMs:0}};}
  const response=await runLocal(prompt,env,signal);trace.push({prompt,response});return response;
 }});
 const record={id:f.id,goal:f.goal,initial:'controlled synthetic defect, supplied as a zero-token fixture; not a model generation',status:job.status,passed:job.steps[0].validation?.status==='passed',realCalls:trace.length,usage:{input:trace.reduce((n,t)=>n+(t.response.usage?.input_tokens||0),0),output:trace.reduce((n,t)=>n+(t.response.usage?.output_tokens||0),0)},completeUsage:trace.every(t=>!!t.response.usage),wallMs:trace.reduce((n,t)=>n+(t.response.metrics?.wallMs||0),0),workflow:job,trace};
 records.push(record);
 await writeFile(resolve(out,f.id+'-before.html'),f.bad);await writeFile(resolve(out,f.id+'-after.html'),job.steps[0].artifact);
 await writeFile(resolve(out,f.id+'.json'),JSON.stringify(record,null,2));
 console.log(JSON.stringify({id:f.id,passed:record.passed,status:job.status,realCalls:record.realCalls,tokens:record.usage.input+record.usage.output}));
}
const report={at:new Date().toISOString(),model:process.env.LOCAL_MODEL,seed:17,temperature:0.2,scope:'4 controlled defects through the production workflow executor; no comparison of generated projects, memory benefit, energy or financial savings',recovered:records.filter(r=>r.passed).length,total:records.length,realCalls:records.reduce((n,r)=>n+r.realCalls,0),tokens:records.reduce((n,r)=>n+r.usage.input+r.usage.output,0),records};
await writeFile(resolve(out,'results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({recovered:report.recovered,total:report.total,realCalls:report.realCalls,tokens:report.tokens}));
