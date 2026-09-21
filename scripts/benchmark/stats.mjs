export const sum=(xs,fn=x=>x)=>xs.reduce((s,x)=>s+fn(x),0);
export const mean=xs=>xs.length?sum(xs)/xs.length:null;
export function quantile(xs,p){if(!xs.length)return null;const a=[...xs].sort((a,b)=>a-b),i=(a.length-1)*p,l=Math.floor(i);return a[l]+(a[Math.ceil(i)]-a[l])*(i-l);}
export function aggregate(runs){
 const attempts=runs.flatMap(r=>r.attempts),last=runs.map(r=>r.attempts.at(-1)),approved=last.filter(a=>a.validation.approved).length;
 const failedFirst=runs.filter(r=>!r.attempts[0].validation.approved),recovered=failedFirst.filter(r=>r.attempts.at(-1).validation.approved).length;
 const input=sum(attempts,a=>a.metrics.prompt_eval_count||0),output=sum(attempts,a=>a.metrics.eval_count||0),wallMs=sum(runs,r=>r.wallMs),modelMs=sum(attempts,a=>a.wallMs||0);
 const cachedAvailable=attempts.every(a=>Number.isFinite(a.metrics.prompt_eval_cached_count));
 return {n:runs.length,calls:attempts.length,approved,approvalRate:runs.length?approved/runs.length*100:0,firstApproved:runs.filter(r=>r.attempts[0].validation.approved).length,initialScore:mean(runs.map(r=>r.attempts[0].validation.score)),score:mean(last.map(a=>a.validation.score)),repaired:runs.filter(r=>r.attempts.length>1).length,repairRecovered:recovered,repairRecoveryRate:failedFirst.length?recovered/failedFirst.length*100:null,input,output,tokens:input+output,tokensPerApproved:approved?(input+output)/approved:null,cachedInput:cachedAvailable?sum(attempts,a=>a.metrics.prompt_eval_cached_count):null,wallMs,modelMs,wallP50:quantile(runs.map(r=>r.wallMs),.5),wallP95:quantile(runs.map(r=>r.wallMs),.95),ttftP50:quantile(attempts.map(a=>a.firstTokenMs).filter(Number.isFinite),.5),ttftP95:quantile(attempts.map(a=>a.firstTokenMs).filter(Number.isFinite),.95),decodeTokensPerSecond:sum(attempts,a=>a.metrics.eval_duration||0)>0?output/(sum(attempts,a=>a.metrics.eval_duration||0)/1e9):null,retrievalMs:sum(runs,r=>r.retrievalMs),validationMs:sum(attempts,a=>a.validationMs),loadMs:sum(attempts,a=>(a.metrics.load_duration||0)/1e6),prefillMs:sum(attempts,a=>(a.metrics.prompt_eval_duration||0)/1e6),decodeMs:sum(attempts,a=>(a.metrics.eval_duration||0)/1e6),gpuWh:runs.every(r=>r.gpu)?sum(runs,r=>r.gpu.wh):null,gpuPeakW:Math.max(0,...runs.map(r=>r.gpu?.peakW||0)),gpuPeakMemoryMiB:Math.max(0,...runs.map(r=>r.gpu?.peakMemoryMiB||0)),truncated:attempts.filter(a=>a.metrics.done_reason==='length').length,generationErrors:attempts.filter(a=>a.error).length,memoriesPerCall:mean(attempts.map(a=>a.memoryIds.length)),groups:Object.fromEntries(['functional','structure','accessibility','responsive','runtime'].map(g=>[g,mean(last.map(a=>a.validation.groups[g]))]))};
}
export const savings=(baseline,memory)=>baseline>0?(baseline-memory)/baseline*100:null;
export function paired(runs){
 const byKey=new Map();for(const r of runs){const k=r.task+'-'+r.seed;const p=byKey.get(k)||{};p[r.condition]=r;byKey.set(k,p);}
 const pairs=[...byKey.values()].filter(p=>p.baseline&&p.memory).map(p=>({task:p.baseline.task,seed:p.baseline.seed,identicalPrompt:!!p.baseline.attempts[0].promptHash&&p.baseline.attempts[0].promptHash===p.memory.attempts[0].promptHash,baseline:p.baseline.attempts.at(-1).validation.score,memory:p.memory.attempts.at(-1).validation.score,delta:p.memory.attempts.at(-1).validation.score-p.baseline.attempts.at(-1).validation.score}));
 const tasks=[...new Set(pairs.map(p=>p.task))],clusters=tasks.map(t=>mean(pairs.filter(p=>p.task===t).map(p=>p.delta)));
 let ci=null;if(clusters.length>1){let state=9137;const rand=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};const values=Array.from({length:4000},()=>mean(clusters.map(()=>clusters[Math.floor(rand()*clusters.length)])));ci=[quantile(values,.025),quantile(values,.975)];}
 return {pairs,wins:pairs.filter(p=>p.delta>1e-8).length,ties:pairs.filter(p=>Math.abs(p.delta)<=1e-8).length,losses:pairs.filter(p=>p.delta< -1e-8).length,meanDelta:mean(pairs.map(p=>p.delta)),clusterBootstrap95:ci,taskClusters:clusters.length};
}
export function cost(a,p){
 const hours=a.wallMs/3600000,energy=hours*(p.watts/1000)*p.tariff,hardware=hours*p.hardwarePrice/p.hardwareHours,total=energy+hardware;
 const api=(a.input*p.inputUSD+a.output*p.outputUSD)/1e6*p.usdBRL;
 return {energy,hardware,total,perRequest:a.n?total/a.n:null,perApproved:a.approved?total/a.approved:null,monthly:a.n?total/a.n*p.monthlyRequests:null,apiHypothetical:api,gpuElectricity:a.gpuWh===null?null:a.gpuWh/1000*p.tariff};
}
