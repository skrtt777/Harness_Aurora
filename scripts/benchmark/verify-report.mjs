import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {aggregate,cost,savings} from './stats.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),id=process.argv[2]||'memory-ab-2026-09-20',dir=join(root,'reports',id);
if(!/^[a-z0-9-]+$/.test(id))throw Error('Invalid experiment ID');
const data=JSON.parse(await readFile(join(dir,'results.json'),'utf8')),summary=JSON.parse(await readFile(join(dir,'summary.json'),'utf8'));
let assertions=0;
for(const condition of ['baseline','memory']){
 const runs=data.runs.filter(r=>r.condition===condition),actual=summary[condition];
 let input=0,output=0,calls=0,passed=0,score=0;
 for(const r of runs){for(const a of r.attempts){input+=a.metrics.prompt_eval_count;output+=a.metrics.eval_count;calls++;const checks=a.validation.checks;let expected=0;for(const [group,weight] of Object.entries({functional:70,structure:10,accessibility:10,responsive:5,runtime:5})){const g=checks.filter(c=>c.group===group);expected+=weight*g.filter(c=>c.pass).length/g.length;}assert(Math.abs(expected-a.validation.score)<1e-9);assertions++;if(a.validation.approved)assert(checks.filter(c=>c.group==='functional'||c.group==='runtime').every(c=>c.pass));}score+=r.attempts.at(-1).validation.score;passed+=+r.attempts.at(-1).validation.approved;}
 for(const [key,value] of Object.entries({input,output,calls,tokens:input+output,approved:passed,score:score/runs.length})){assert(Math.abs(actual[key]-value)<1e-9,key);assertions++;}
 const p={watts:300,tariff:1,hardwarePrice:0,hardwareHours:10000,monthlyRequests:1000,inputUSD:1,outputUSD:5,usdBRL:5};
 const c=cost(actual,p);assert(Math.abs(c.total-actual.wallMs/3600000*.3)<1e-12);assert.equal(cost(actual,{...p,tariff:2}).total,c.total*2);assertions+=2;
 if(!passed){assert.equal(actual.tokensPerApproved,null);assert.equal(c.perApproved,null);assertions+=2;}
}
assert.equal(savings(100,200),-100);assert.equal(savings(0,0),null);assertions+=2;
const csv=await readFile(join(dir,'results.csv'),'utf8');assert.equal(csv.trim().split('\r\n').length,37);assertions++;
const html=await readFile(join(dir,'dashboard.html'),'utf8');assert(!html.includes('__DATA__'));assert(!html.includes('__STATS__'));assertions+=2;
await writeFile(join(dir,'verification.json'),JSON.stringify({date:new Date().toISOString(),assertions,passed:true,description:'Independent score/token/approval totals, cost formulas and zero-denominator handling; CSV and dashboard completeness.'},null,2));
console.log(JSON.stringify({assertions,passed:true}));
