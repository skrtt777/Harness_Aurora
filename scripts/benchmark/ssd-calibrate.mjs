// Follow-up diagnostic round 2: Swap-MoE mitigation flags (--expert-keep-recent/--expert-prefetch/--expert-cache-size)
// left untested in v1, combined with the batch=512 win already found in v1 calibration. Original first-attempt prompts
// across all 4 task domains (jogo/pagina/app/bi), moe-50 (most generous cap).
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {heldout} from '../training/heldout-v2.mjs';
import {browserChecker} from '../training/browser-check.mjs';
import {unwrap} from '../../app/workflowValidation.js';
// --expert-cache-size and --expert-keep-recent are alternative eviction strategies in the patch (rarely combined);
// cacheSizeMib below is a rough first guess, not derived from a measured fixed-memory breakdown.
const presets={
 'b512-pf':{batch:512,prefetch:true},
 'b512-kr8':{batch:512,keepRecent:8},
 'b512-kr8-pf':{batch:512,keepRecent:8,prefetch:true},
 'b512-kr16-pf':{batch:512,keepRecent:16,prefetch:true},
 'b512-cs-pf':{batch:512,cacheSizeMib:2048,prefetch:true},
 // Smaller budget for tighter caps: fresh-process private memory alone is ~1 GiB at 20% (3.2 GiB
 // cap) before any request, so 2048 MiB would claim nearly the whole remaining budget by itself.
 'b512-cs512-pf':{batch:512,cacheSizeMib:512,prefetch:true},
 // Resource-reduction round: shrink the fixed footprint (KV cache) instead of tuning eviction policy.
 // KV cache ~= 2(K+V) x 48 layers x ctx x 4 kv_heads x 128 head_dim x bytes/elem: ~768 MiB at ctx=8192/f16,
 // observed to roughly match the ~1 GiB fixed "private" floor measured at process start (rodada 3/4).
 // ctx=6144 keeps >=4600 tokens of headroom for the harness's own maxInputChars:12000 (~3000-4000 tok)
 // + up to 1536 output tokens, so it shouldn't truncate; ctx=4096 would risk it on a long retry prompt.
 'b512-pf-ctk8':{batch:512,prefetch:true,kvQuant:'q8_0',flashAttn:true},
 'b512-pf-ctx6144':{batch:512,prefetch:true,ctx:6144},
 'b512-pf-ctx6144-ctk8':{batch:512,prefetch:true,ctx:6144,kvQuant:'q8_0',flashAttn:true},
 'b512-pf-ctk4':{batch:512,prefetch:true,kvQuant:'q4_0',flashAttn:true},
};
const presetId=process.argv[2];
if(!presets[presetId])throw Error('Select '+Object.keys(presets).join('|'));
const preset=presets[presetId];
const percent=Number(process.env.SSD_CALIBRATE_PERCENT||50);
const root=resolve('reports/ssd-moe-calibration-v2',percent===50?presetId:`${presetId}-p${percent}`),base='http://127.0.0.1:18795';
await mkdir(root,{recursive:true});
const sha=x=>createHash('sha256').update(x).digest('hex');
const command=[resolve('tmp/llama-ssd/build/bin/Release/llama-server.exe'),'-m',resolve('tmp/ssd-models/qwen3-coder-30b.gguf'),'--host','127.0.0.1','--port','18795','-ngl','0','-t','8','-tb','8','-c',String(preset.ctx??8192),'-np','1','-b',String(preset.batch),'-ub',String(preset.batch),'--no-warmup','--expert-streaming',
 ...(preset.keepRecent?['--expert-keep-recent',String(preset.keepRecent)]:[]),
 ...(preset.cacheSizeMib?['--expert-cache-size',String(preset.cacheSizeMib)]:[]),
 ...(preset.prefetch?['--expert-prefetch']:[]),
 ...(preset.kvQuant?['-ctk',preset.kvQuant,'-ctv',preset.kvQuant]:[]),
 ...(preset.flashAttn?['-fa','on']:[])];
const config={directory:root,capBytes:Math.floor(16*1024**3*percent/100/4096)*4096,physicalDisk:'PhysicalDrive4',command};
await writeFile(join(root,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),presetId,preset,percent,config,sourceHash:sha(await readFile('scripts/benchmark/ssd-calibrate.mjs')),scope:'Diagnostic round 2: Swap-MoE mitigation flags untested in the v1 baseline (--expert-keep-recent, --expert-prefetch, --expert-cache-size), combined with the batch=512 prefill win from v1 calibration. First attempts only, one case per domain (jogo/pagina/app/bi) reused from moe-50 v1 runs; not a full quality comparison. Same temperature, seed, tokens, context and process cap as v1. OS cache uncontrolled. cacheSizeMib in the cs preset is a rough first guess, not derived from a measured fixed-memory breakdown; that preset is a fallback only if keep-recent proves insufficient.'},null,2),{flag:'wx'});
await writeFile(join(root,'launch.json'),JSON.stringify(config,null,2));
const supervisor=spawn(resolve('.venv-training/Scripts/python.exe'),[resolve('scripts/benchmark/ssd-monitor.py'),join(root,'launch.json')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
supervisor.stdout.on('data',b=>process.stdout.write(b));supervisor.stderr.on('data',b=>process.stderr.write(b));
const checker=await browserChecker();
async function generate(prompt,n=1536){
 const startedAt=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);let text='',firstTokenMs=null,tokens=0,final=null;
 try{
  const formatted=await fetch(base+'/apply-template',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:prompt}]}),signal:controller.signal}).then(r=>r.json());
  const response=await fetch(base+'/completion',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:formatted.prompt,n_predict:n,temperature:.2,seed:211,top_k:40,top_p:.9,repeat_penalty:1,stream:true,cache_prompt:false}),signal:controller.signal});
  if(!response.ok)throw Error('HTTP '+response.status);const decoder=new TextDecoder();let buffer='';
  for await(const bytes of response.body){buffer+=decoder.decode(bytes,{stream:true});let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line.startsWith('data:'))continue;const d=JSON.parse(line.slice(5));if(d.error)throw Error(JSON.stringify(d.error));if(d.content){text+=d.content;firstTokenMs??=Date.now()-startedAt;}tokens+=d.tokens?.length||0;if(d.stop)final=d;}}
  return {ok:!!final,text,startedAt,wallMs:Date.now()-startedAt,firstTokenMs,tokens,final};
 }catch(e){return {ok:false,error:e.message,text,startedAt,wallMs:Date.now()-startedAt,firstTokenMs,tokens};}finally{clearTimeout(timer);}
}
try{
 let ready=false;for(let i=0;i<120;i++){if(supervisor.exitCode!==null)throw Error('Supervisor exited');try{ready=(await fetch(base+'/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,500));}if(!ready)throw Error('Startup timeout');
 const probes=[];for(let i=0;i<2;i++)probes.push(await generate('Responda somente o número: quanto é 38 + 25?',128));await writeFile(join(root,'probes.json'),JSON.stringify(probes,null,2));
 for(const id of ['dice-sequence','locale-greeting','word-count','break-even']){
  const original=JSON.parse(await readFile(`reports/ssd-moe-v1/moe-50/runs/${id}-211.json`,'utf8')),prompt=original.trace[0].prompt,response=await generate(prompt);
  const task=heldout.find(t=>t.id===id),validation=response.ok&&response.final.stop_type!=='limit'?await checker.check({reference:unwrap(response.text,'html'),contract:task.contract}):null;
  const record={id,presetId,preset,prompt,promptHash:sha(prompt),response,validation,original:{first:original.trace[0].response.metrics,passed:original.firstPassed}};
  await writeFile(join(root,id+'.json'),JSON.stringify(record,null,2),{flag:'wx'});
  console.log(JSON.stringify({id,presetId,ok:response.ok,passed:validation?.status==='passed',wallMs:response.wallMs,firstTokenMs:response.firstTokenMs,tokens:response.tokens}));
 }
}finally{await checker.close();if(supervisor.exitCode===null){supervisor.stdin.end('stop\n');await new Promise(r=>supervisor.once('exit',r));}}
