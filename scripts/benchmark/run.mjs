import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import {chromium} from 'playwright';
import {tasks,validate} from './tasks.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const id=process.env.BENCHMARK_ID || 'memory-ab-2026-09-20';
if(!/^[a-z0-9-]+$/.test(id))throw Error('Invalid benchmark ID');
const out=join(root,'reports',id), privateDir=join(root,'app/data/benchmarks',id);
await mkdir(out,{recursive:true});await mkdir(privateDir,{recursive:true});await mkdir(join(out,'runs'),{recursive:true});
try {await readFile(join(out,'manifest.json'));throw Error('An existing experiment must not be overwritten. Set a new BENCHMARK_ID.');} catch(e){if(e.code!=='ENOENT')throw e;}
const hash=s=>createHash('sha256').update(s).digest('hex');
const source=process.env.BENCHMARK_SOURCE_DB || join(root,'app/data/economy-preview.db');
const original=new DatabaseSync(source,{readOnly:true});
await backup(original,join(privateDir,'snapshot.db'));original.close();
process.env.HARNESS_DB_FILE=join(privateDir,'snapshot.db');
process.env.LOCAL_MODEL='qwen2.5-coder:1.5b';
process.env.HARNESS_CONTEXT_POLICY='selective-v1';
const {selectRelevantMemories}=await import('../../app/store.js');
const {compactContext,policyHash}=await import('../../app/economy.js');
const {getDb}=await import('../../app/db.js');
const db=await getDb();
const corpus=db.prepare('SELECT id,scope,title,content,tags,embedding_model FROM memories ORDER BY id').all();
const corpusHash=hash(JSON.stringify(corpus));
await writeFile(join(out,'memory-corpus.json'),JSON.stringify(corpus,null,2));
const base='http://127.0.0.1:11434', model=process.env.LOCAL_MODEL;
const options={temperature:0.2,num_ctx:8192,num_predict:2048};
const seeds=[17,41,73];
// Predeclared task order, pairing adjacent and balancing which condition goes first.
const order=[3,0,5,1,4,2], schedule=[];
for(let s=0;s<seeds.length;s++)for(let j=0;j<order.length;j++){
  const task=tasks[order[(j+s)%order.length]];
  for(const condition of (s+j)%2?['memory','baseline']:['baseline','memory'])schedule.push({task:task.id,seed:seeds[s],condition});
}
const runExec=promisify(execFile);
const gpuInfo=await runExec('nvidia-smi',['--query-gpu=name,memory.total','--format=csv,noheader'],{windowsHide:true}).then(x=>x.stdout.trim()).catch(()=>null);
const tags=await fetch(base+'/api/tags').then(r=>r.json());
const sourceHashes=Object.fromEntries(await Promise.all(['scripts/benchmark/run.mjs','scripts/benchmark/tasks.mjs','app/economy.js','app/store.js','app/skills.js','app/contextSelection.js'].map(async p=>[p,hash(await readFile(join(root,p)))])));
const manifest={id,startedAt:new Date().toISOString(),model,modelInfo:tags.models.find(x=>x.name===model),ollama:await fetch(base+'/api/version').then(r=>r.json()),hardware:{cpu:os.cpus()[0].model,logicalCores:os.cpus().length,ramGB:os.totalmem()/2**30,gpu:gpuInfo},options,seeds,tasks,schedule,policyHash,corpusHash,corpusSize:corpus.length,sourceHashes,maxAttempts:2,contextChars:16000,teacherCalls:0,method:'Same Aurora kernel, skill selector and memory retrieval. Direct instrumented Ollama calls; controlled correction loop, not the complete production chat pipeline.',rubric:{functional:70,structure:10,accessibility:10,responsive:5,runtime:5,approval:'Every functional and runtime assertion passes, score >= 90. Quality score is automated criteria, not aesthetic or expert review.'},limitations:['Six small single-file HTML tasks; not large projects or native apps.','Three seeds per task are repetitions, not 18 independent task types.','Existing corpus specializes in games; no new memories learned during the experiment.','Normal Ollama cache remains enabled; order is counterbalanced, timings are warm local runs.','All input/output generation tokens summed including correction. Embedding tokens unavailable from existing retrieval API and excluded; retrieval wall time included.','GPU power is sampled for the whole GPU including background activity, not whole-PC electricity.','Cost uses editable assumptions; no paid teacher/API called. Knowledge preparation, human review and prior indexing cost are not measured.']};
await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
const samples=[];let sampling=false;
async function sample(){if(sampling)return;sampling=true;try{const {stdout}=await runExec('nvidia-smi',['--query-gpu=power.draw,memory.used,utilization.gpu','--format=csv,noheader,nounits'],{windowsHide:true,timeout:2000});const [watts,memoryMiB,utilization]=stdout.trim().split(',').map(Number);if(Number.isFinite(watts))samples.push({t:Date.now(),watts,memoryMiB,utilization});}catch{}finally{sampling=false;}}
await sample();const sampler=setInterval(()=>void sample(),350);
let served='';
const server=createServer((req,res)=>{if(req.url==='/artifact'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(served);}else{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/artifact`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const nativeFetch=globalThis.fetch;
let embeddingAudit=[];
// Observe existing retrieval without changing its ranking or the model request.
globalThis.fetch=async(...args)=>{const t=performance.now();const r=await nativeFetch(...args);if(String(args[0]).endsWith('/api/embeddings'))embeddingAudit.push({status:r.status,ms:performance.now()-t});return r;};
async function infer(prompt,seed,maxOutput=options.num_predict){
 const started=performance.now(),events=[];let firstTokenMs=null,text='',final=null;
 const response=await fetch(base+'/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt,stream:true,keep_alive:'30m',options:{...options,num_predict:maxOutput,seed}}),signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error('Ollama HTTP '+response.status);
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
 for(;;){const {value,done}=await reader.read();pending+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=pending.split('\n');pending=lines.pop();if(done&&pending){lines.push(pending);pending='';}for(const line of lines){if(!line.trim())continue;const x=JSON.parse(line);if(x.error)throw Error(x.error);if(x.response){if(firstTokenMs===null)firstTokenMs=performance.now()-started;text+=x.response;}if(x.done)final=x;}if(done)break;}
 if(!final)throw Error('Ollama stream has no final metrics');
 const {response:ignored,context:unused,...metrics}=final;
 return {text,metrics,firstTokenMs,wallMs:performance.now()-started};
}
function extract(text){const fence=[...text.matchAll(/```(?:html)?\s*\n([\s\S]*?)(?:```|$)/gi)].find(m=>/<(?:!doctype|html|body|head)/i.test(m[1]));const s=fence?fence[1]:text;const start=s.search(/<!doctype\s+html|<html[\s>]/i);if(start<0)return s.trim();const end=s.toLowerCase().lastIndexOf('</html>');return s.slice(start,end>=0?end+7:undefined).trim();}
const runs=[];let warmup;
try {
  const t=performance.now();await selectRelevantMemories('aquecimento da busca de memórias',{},1);const e=performance.now()-t;
  const w=await infer('Responda apenas OK.',1,16);warmup={embeddingMs:e,generation:w};
  await writeFile(join(out,'warmup.json'),JSON.stringify(warmup,null,2));
  for(const [index,item] of schedule.entries()){
    const task=tasks.find(x=>x.id===item.task),key=`${task.id}-${item.seed}-${item.condition}`;
    const startedAt=Date.now(),t=performance.now();embeddingAudit=[];
    const retrievalStart=performance.now();const memories=item.condition==='memory'?await selectRelevantMemories(task.prompt,{},12):[];const retrievalMs=performance.now()-retrievalStart;
    const run={...item,key,domain:task.domain,name:task.name,startedAt,retrievalMs,embeddingAudit:embeddingAudit.slice(),retrieved:memories.map(m=>({id:m.id,title:m.title})),attempts:[]};
    for(let attempt=0;attempt<2;attempt++){
      const prev=run.attempts.at(-1);
      const input=attempt===0?task.prompt:task.prompt+'\n\nCorrija o HTML anterior com base nestas falhas verificadas no navegador. Preserve o que funciona. Entregue novamente o HTML completo.\n'+prev.validation.checks.filter(c=>!c.pass).map(c=>`${c.label}: ${String(c.actual).slice(0,160)}`).join('\n');
      const buildStart=performance.now();
      const context=await compactContext({input,memories,skillQuery:task.prompt,required:prev?['HTML anterior:\n'+prev.html]:[],limit:16000});
      const contextMs=performance.now()-buildStart;
      const prefix=`runs/${key}-a${attempt+1}`;
      await writeFile(join(out,prefix+'.prompt.txt'),context.prompt);
      let gen;
      try{gen=await infer(context.prompt,item.seed);}catch(e){gen={text:'',metrics:{},wallMs:null,firstTokenMs:null,error:e.message};}
      const html=extract(gen.text);served=html;
      await writeFile(join(out,prefix+'.response.txt'),gen.text);await writeFile(join(out,prefix+'.html'),html);
      const ctx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
      await ctx.route('**/*',route=>route.request().url()===url&&route.request().method()==='GET'?route.continue():route.abort());
      const page=await ctx.newPage();page.on('dialog',d=>void d.dismiss());
      const validationStart=performance.now();
      const validation=await validate(page,task,url);
      if(gen.error){validation.approved=false;validation.generationError=gen.error;}
      if(gen.metrics.done_reason==='length'){validation.approved=false;validation.truncated=true;}
      const validationMs=performance.now()-validationStart;
      await page.setViewportSize({width:1280,height:900});await page.goto(url).catch(()=>{});
      await page.screenshot({path:join(out,prefix+'.png'),fullPage:false,timeout:5000}).catch(()=>{});
      await ctx.close();
      const record={attempt:attempt+1,prefix,html,contextMs,promptChars:context.prompt.length,memoryIds:context.memoryIds,omittedMemories:context.omittedMemories,skills:context.skills,estimatedInputTokens:context.estimatedInputTokens,...gen,text:undefined,validation,validationMs};
      await writeFile(join(out,prefix+'.json'),JSON.stringify({...record,html:undefined},null,2));
      run.attempts.push(record);
      console.log(JSON.stringify({progress:`${index+1}/${schedule.length}`,key,attempt:attempt+1,score:+validation.score.toFixed(1),approved:validation.approved,tokens:(gen.metrics.prompt_eval_count||0)+(gen.metrics.eval_count||0),seconds:+((gen.wallMs||0)/1000).toFixed(2)}));
      if(validation.approved)break;
    }
    run.endedAt=Date.now();run.wallMs=performance.now()-t;
    run.attempts.forEach(a=>delete a.html);runs.push(run);
    await writeFile(join(out,'results.partial.json'),JSON.stringify({manifest,warmup,runs},null,2));
  }
} finally {clearInterval(sampler);await sample();await browser.close();await new Promise(r=>server.close(r));globalThis.fetch=nativeFetch;}
const finalCorpus=db.prepare('SELECT id,scope,title,content,tags,embedding_model FROM memories ORDER BY id').all();
if(hash(JSON.stringify(finalCorpus))!==corpusHash)throw Error('Memory corpus changed during experiment');
function powerDuring(start,end){const inside=samples.filter(s=>s.t>=start&&s.t<=end);if(!inside.length)return null;let joules=0;const points=[{...inside[0],t:start},...inside,{...inside.at(-1),t:end}];for(let i=1;i<points.length;i++)joules+=(points[i].t-points[i-1].t)/1000*(points[i].watts+points[i-1].watts)/2;return {samples:inside.length,joules,wh:joules/3600,averageW:joules/((end-start)/1000),peakW:Math.max(...inside.map(s=>s.watts)),peakMemoryMiB:Math.max(...inside.map(s=>s.memoryMiB))};}
for(const r of runs)r.gpu=powerDuring(r.startedAt,r.endedAt);
manifest.selection={version:"selective-v1",maxMemories:3,maxMemoryChars:1800,repair:"original full rewrite, unchanged evaluator"};
const report={manifest,warmup,finishedAt:new Date().toISOString(),corpusUnchanged:true,runs};
await writeFile(join(out,'results.json'),JSON.stringify(report,null,2));await writeFile(join(out,'gpu-telemetry.json'),JSON.stringify(samples));
console.log(JSON.stringify({complete:true,out,runs:runs.length,calls:runs.reduce((s,r)=>s+r.attempts.length,0)}));
