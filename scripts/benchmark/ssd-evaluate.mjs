// Same Aurora workflow, contracts, seeds and budgets as evaluate-v2; separate evidence.
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {heldout,retention} from '../training/heldout-v2.mjs';
import {browserChecker} from '../training/browser-check.mjs';

const root=resolve(process.env.SSD_REPORT_DIR||'reports/ssd-moe-v1');
const sha=x=>createHash('sha256').update(x).digest('hex');
const read=p=>readFile(p,'utf8').then(JSON.parse);
const profiles=[{id:'old-30',model:'qwen25-coder-15b',percent:30},
 ...[20,30,40,50].map(percent=>({id:`moe-${percent}`,model:'qwen3-coder-30b',percent})),
 // Tuned profile: batch=512 + --expert-prefetch, winner of the round-2 calibration in
 // reports/ssd-moe-calibration-v2/ (3/4 sample domains passed, well within the time budget;
 // --expert-keep-recent added no benefit at this cap and was dropped). Verified to also hold
 // at 30% (4.8 GiB) in a 4-domain calibration sample before being promoted to a full campaign here.
 {id:'moe-50-tuned-b512-pf',model:'qwen3-coder-30b',percent:50,batch:512,expertPrefetch:true},
 {id:'moe-30-tuned-b512-pf',model:'qwen3-coder-30b',percent:30,batch:512,expertPrefetch:true},
 {id:'moe-20-tuned-b512-pf',model:'qwen3-coder-30b',percent:20,batch:512,expertPrefetch:true},
 // Diagnosed root cause of the 30%/20% within-session degradation above: the llama-server process's
 // private (non-file-backed) memory grows near-linearly with call count under --expert-streaming
 // (~80-90 MiB/call vs ~32 MiB/call without it), independent of the RAM cap; since rss is hard-capped,
 // that growth silently eats into the same fixed budget that would otherwise cache expert pages.
 // restartEveryTasks periodically relaunches llama-server (fresh process, private memory back near
 // zero, re-primed with the same probes as startup) to bound how much of that leak can accumulate
 // before it starts crowding out expert pages. A first attempt restarting before every single task
 // measured 0/24 (worse than no restart): it also discarded the resident dense backbone every time,
 // and re-priming it from cold within the 120s call budget didn't fit under the 30% cap either.
 {id:'moe-30-tuned-restart4',model:'qwen3-coder-30b',percent:30,batch:512,expertPrefetch:true,restartEveryTasks:4},
 {id:'moe-20-tuned-restart2',model:'qwen3-coder-30b',percent:20,batch:512,expertPrefetch:true,restartEveryTasks:2},
 {id:'moe-20-tuned-restart1',model:'qwen3-coder-30b',percent:20,batch:512,expertPrefetch:true,restartEveryTasks:1}];
const sources=['scripts/benchmark/ssd-evaluate.mjs','scripts/benchmark/ssd-monitor.py',
 'scripts/training/heldout-v2.mjs','scripts/training/curriculum.mjs','scripts/training/browser-check.mjs',
 ...(await readdir('app')).filter(f=>f.endsWith('.js')).map(f=>'app/'+f),
 ...(await readdir('app/runtime-policy')).map(f=>'app/runtime-policy/'+f)];
const sourceHashes=Object.fromEntries(await Promise.all(sources.map(async f=>[f,sha(await readFile(f))])));
const definitions={version:1,profiles,seeds:[211,419],temperature:.2,threads:8,context:8192,
 budget:{maxCalls:4,maxTokens:22000,maxAttempts:2,maxInputChars:12000,maxOutputTokens:1536,maxDurationMs:180000},
 perCallTimeoutMs:120000,sourceHashes,taskHash:sha(JSON.stringify(heldout)),
 weights:{'qwen25-coder-15b':'29d8c98fa6b098e200069bfb88b9508dc3e85586d20cba59f8dda9a808165104',
 'qwen3-coder-30b':'1194192cf2a187eb02722edcc3f77b11d21f537048ce04b67ccf8ba78863006a'},
 llamaCommit:'f5e85d43a048f3d5adefb4c5e29867d8077fba62',swapMoeCommit:'50459bb422a01c0ba2e1da08b4d932f652f3e413',
 memory:'Hard process working-set caps relative to 16 GiB. Windows standby/file cache outside cap; not a physical 16 GB machine.',
 cache:'No global flush. First request is process-cold, OS cache uncontrolled. Prompt KV reuse disabled.',
 comparison:'Reused regression tasks, not an independent heldout. Both models use same new CPU runtime. Historical Ollama results are context only.',
 energy:'No whole-computer power meter. Costs only editable power/time scenarios, never measured energy.'};
await mkdir(root,{recursive:true});
let manifest;try{manifest=await read(join(root,'manifest.json'));if(JSON.stringify(manifest.definitions)!==JSON.stringify(definitions))throw Error('Frozen experiment changed; use new report directory');}
catch(e){if(e.code!=='ENOENT')throw e;manifest={createdAt:new Date().toISOString(),definitions};await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});}
const selected=process.argv[2];
if(!profiles.some(p=>p.id===selected))throw Error('Select '+profiles.map(p=>p.id).join('|'));
const profile=profiles.find(p=>p.id===selected),out=join(root,profile.id);
await mkdir(join(out,'runs'),{recursive:true});
process.env.HARNESS_DB_FILE=resolve('app/data/benchmarks/ssd-moe-v1',profile.id+'.db');
await mkdir(resolve(process.env.HARNESS_DB_FILE,'..'),{recursive:true});
Object.assign(process.env,{LOCAL_MODEL:profile.model,LOCAL_TEMPERATURE:'.2',LOCAL_TIMEOUT_MS:'120000',EMBEDDINGS_ENABLED:'false',HARNESS_CONTEXT_POLICY:'legacy'});
const {createConversation}=await import('../../app/store.js');
const {createWorkflow,runWorkflow}=await import('../../app/workflows.js');
const {unwrap}=await import('../../app/workflowValidation.js');
const checker=await browserChecker();let supervisor;
const base='http://127.0.0.1:18795';
async function generate(prompt,settings={},externalSignal){
 const start=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),definitions.perCallTimeoutMs);
 const signal=externalSignal?AbortSignal.any([controller.signal,externalSignal]):controller.signal;
 let answer='',firstTokenMs=null,final=null,generatedTokens=0;
 try{
  const templated=await fetch(base+'/apply-template',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:prompt}]}),signal});
  if(!templated.ok)throw Error('Template HTTP '+templated.status);
  const {prompt:formatted}=await templated.json();
  const body={prompt:formatted,n_predict:Number(settings.LOCAL_MAX_OUTPUT_TOKENS||1536),temperature:.2,
   seed:Number(settings.LOCAL_SEED||211),top_k:40,top_p:.9,repeat_penalty:1,stream:true,cache_prompt:false,
   ...(settings.LOCAL_OUTPUT_FORMAT==='json'?{json_schema:{type:'object'}}:{})};
  const response=await fetch(base+'/completion',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});
  if(!response.ok)throw Error('Completion HTTP '+response.status+': '+await response.text());
  let buffer='';const decoder=new TextDecoder();
  for await(const bytes of response.body){buffer+=decoder.decode(bytes,{stream:true});let nl;
   while((nl=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,nl).trim();buffer=buffer.slice(nl+1);if(!line.startsWith('data:'))continue;
    const data=JSON.parse(line.slice(5));if(data.error)throw Error(JSON.stringify(data.error));
    if(data.content){answer+=data.content;if(firstTokenMs===null)firstTokenMs=Date.now()-start;}
    generatedTokens+=data.tokens?.length||0;if(data.stop)final=data;
   }
  }
  if(!final)throw Error('Stream ended without terminal record');
  return {ok:!!answer.trim(),status:200,text:answer,usage:{input_tokens:final.tokens_evaluated,output_tokens:final.timings?.predicted_n??generatedTokens},
   truncated:final.stop_type==='limit'||final.truncated,metrics:{startedAt:start,finishedAt:Date.now(),wallMs:Date.now()-start,firstTokenMs,timings:final.timings,model:profile.model},rawFinal:final};
 }catch(error){return {ok:false,status:502,error:error.message,partial:answer,metrics:{startedAt:start,finishedAt:Date.now(),wallMs:Date.now()-start,firstTokenMs,partialOutputTokens:generatedTokens,model:profile.model}};}
 finally{clearTimeout(timer);}
}
async function launchServer(configFile){
 const startedAt=Date.now();
 const proc=spawn(resolve('.venv-training/Scripts/python.exe'),[resolve('scripts/benchmark/ssd-monitor.py'),configFile],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 proc.stdout.on('data',x=>process.stdout.write(x));proc.stderr.on('data',x=>process.stderr.write(x));
 let ready=false;while(Date.now()-startedAt<300000){if(proc.exitCode!==null)throw Error('Server supervisor exited '+proc.exitCode);try{ready=(await fetch(base+'/health',{signal:AbortSignal.timeout(2000)})).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,500));}
 if(!ready)throw Error('Server startup timeout');
 return {proc,startupMs:Date.now()-startedAt};
}
async function stopServer(proc){if(proc&&proc.exitCode===null){proc.stdin.end('stop\n');await new Promise(r=>proc.once('exit',r));}}
try{
 const refs=[];for(const t of heldout){const validation=await checker.check(t);refs.push({id:t.id,validation});if(validation.status!=='passed')throw Error('Reference failed '+t.id);}
 await writeFile(join(out,'references.json'),JSON.stringify(refs,null,2));
 const capBytes=Math.floor(16*1024**3*profile.percent/100/4096)*4096;
 const batch=profile.batch??128;
 const command=[resolve('tmp/llama-ssd/build/bin/Release/llama-server.exe'),'-m',resolve(`tmp/ssd-models/${profile.model}.gguf`),
  '--host','127.0.0.1','--port','18795','-ngl','0','-t','8','-tb','8','-c','8192','-np','1','-b',String(batch),'-ub',String(batch),'--no-warmup',
  ...(profile.id.startsWith('moe')?['--expert-streaming']:[]),
  ...(profile.expertKeepRecent?['--expert-keep-recent',String(profile.expertKeepRecent)]:[]),
  ...(profile.expertCacheSizeMib?['--expert-cache-size',String(profile.expertCacheSizeMib)]:[]),
  ...(profile.expertPrefetch?['--expert-prefetch']:[])];
 const configFile=join(out,'launch.json');await writeFile(configFile,JSON.stringify({directory:out,capBytes,physicalDisk:'PhysicalDrive4',command},null,2));
 let launch=await launchServer(configFile);supervisor=launch.proc;
 await writeFile(join(out,'startup.json'),JSON.stringify({startupMs:launch.startupMs,readyAt:Date.now(),props:await fetch(base+'/props').then(r=>r.json())},null,2));
 async function warmup(){const probes=[];for(const state of ['process-cold','warm']){const response=await generate('Responda somente o número: quanto é 38 + 25?',{LOCAL_MAX_OUTPUT_TOKENS:'128'});probes.push({state,response});}return probes;}
 await writeFile(join(out,'probes.json'),JSON.stringify(await warmup(),null,2));
 const records=[];let sinceRestart=0;
 for(const seed of definitions.seeds)for(const t of heldout){
  const file=join(out,'runs',`${t.id}-${seed}.json`);try{records.push(await read(file));continue;}catch(e){if(e.code!=='ENOENT')throw e;}
  // A full restart drops the resident dense backbone (attention/router weights every token needs,
  // regardless of routing) along with the leaked private memory, so a bare restart before every task
  // made things worse (measured: 0/24, every call timing out) - the dense backbone must be re-primed
  // with the same warmup() probes before resuming real tasks on a freshly restarted server.
  if(profile.restartEveryTasks&&sinceRestart>=profile.restartEveryTasks){await stopServer(supervisor);launch=await launchServer(configFile);supervisor=launch.proc;await warmup();sinceRestart=0;}
  sinceRestart++;
  const env={...process.env,LOCAL_SEED:String(seed)},c=await createConversation({provider:'local',title:`SSD ${profile.id}/${t.id}/${seed}`});
  let job=await createWorkflow({conversationId:c.id,goal:t.goal,functionalContracts:[{step:0,contract:t.contract}],knowledgeMode:'none',budget:definitions.budget,env});
  await runWorkflow(job.id,{env,call:()=>{throw Error('Unexpected planner call');}});
  const trace=[],startedAt=Date.now();job=await runWorkflow(job.id,{env,call:async(prompt,settings,signal)=>{const response=await generate(prompt,settings,signal);trace.push({prompt,response});return response;},validate:async(reference,format,{contract})=>checker.check({reference:unwrap(reference,format),contract})});
  const step=job.steps[0],record={profile:profile.id,model:profile.model,id:t.id,domain:t.domain,seed,
   passed:step?.validation?.status==='passed',firstPassed:step?.history?.find(h=>h.attempt===1)?.validation?.status==='passed',
   inputTokens:job.stats.inputTokens,outputTokens:job.stats.outputTokens,estimatedTokens:job.stats.estimatedTokens,
   calls:trace.length,startedAt,finishedAt:Date.now(),elapsedMs:Date.now()-startedAt,workflow:job,trace};
  records.push(record);await writeFile(file,JSON.stringify(record,null,2),{flag:'wx'});
  console.log(JSON.stringify({profile:profile.id,done:records.length,total:24,id:t.id,passed:record.passed,elapsedMs:record.elapsedMs,error:job.error}));
 }
 const checks=[];for(const t of retention){const response=await generate(t.prompt,{LOCAL_SEED:'101',LOCAL_MAX_OUTPUT_TOKENS:'256'});let passed=false;try{passed=response.ok&&(t.kind==='json'?JSON.stringify(JSON.parse(unwrap(response.text,'json')))===JSON.stringify(t.expected):response.text.trim()===t.expected);}catch{}checks.push({...t,response,passed});}
 const summary={profile,completedAt:new Date().toISOString(),passed:records.filter(r=>r.passed).length,total:records.length,firstPassed:records.filter(r=>r.firstPassed).length,retentionPassed:checks.filter(c=>c.passed).length,retention:checks};
 await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{
 await checker.close();await stopServer(supervisor);
}
