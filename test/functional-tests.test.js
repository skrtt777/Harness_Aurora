import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
process.env.HARNESS_DB_FILE=join(mkdtempSync(join(tmpdir(),'aurora-functional-')),'test.db');
process.env.LOCAL_MODEL='test-model';process.env.LOCAL_BASE_URL='http://127.0.0.1:1';process.env.EMBEDDINGS_ENABLED='false';
process.env.HARNESS_EVIDENCE_ENGINE='false'; // Preserve the original model-repair regression suite; engine behavior has its own suite.
const { normalizeTestContract, parseDisplayedNumber } = await import('../app/functionalTests.js');
const { validateArtifact } = await import('../app/workflowValidation.js');
const { functionalFixtures } = await import('../scripts/benchmark/functional-fixtures.mjs');
const { createConversation } = await import('../app/store.js');
const { createWorkflow, runWorkflow, getWorkflow, recheckWorkflow, reviewWorkflow } = await import('../app/workflows.js');
const ok = text => ({ok:true,text,usage:{input_tokens:10,output_tokens:20}});
async function prepare(f, budget={}) {
 const c=await createConversation({provider:'local'});
 const job=await createWorkflow({conversationId:c.id,goal:f.goal,functionalContracts:[{step:0,contract:f.contract}],budget});
 await runWorkflow(job.id,{call:()=>{throw Error('Unexpected planning call');}});
 return getWorkflow(job.id);
}

test('contracts reject code, unknown operations, vacuous cases, duplicates and excessive tolerance',()=>{
 const valid=functionalFixtures[0].contract;
 assert.equal(normalizeTestContract(valid).cases.length,1);
 const caseWith=actions=>({version:1,cases:[{id:'a',name:'a',actions}]});
 for(const actions of [[{op:'evaluate',value:'process.exit()'}],[{op:'click',selector:'#x'}],[{op:'assertNumber',selector:'#x',expected:3,tolerance:999}],[{op:'assertText',selector:'#x',expected:'a',code:'evil'}]]) assert.throws(()=>normalizeTestContract(caseWith(actions)),/inválido/);
 assert.throws(()=>normalizeTestContract({version:1,cases:[...valid.cases,...valid.cases]}));
 assert.equal(parseDisplayedNumber('R$ 1.234,50'),1234.5);
 assert.equal(parseDisplayedNumber('37,14%'),37.14);
 assert.equal(parseDisplayedNumber('1,234.50','en-US'),1234.5);
 assert.equal(parseDisplayedNumber('receita 100 custo 70'),null);
 assert.equal(parseDisplayedNumber('NaN'),null);
});

test('assertNumber and assertText read .value on input/textarea, not innerText (always empty there)',async()=>{
 const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Teste</title></head><body><input type="number" id="units" readonly><textarea id="note" readonly></textarea><script>document.getElementById("units").value=12;document.getElementById("note").value="ok";</script></body></html>';
 const contract={version:1,cases:[{id:'c0',name:'Campos somente leitura',actions:[{op:'assertNumber',selector:'#units',expected:12},{op:'assertText',selector:'#note',expected:'ok'}]}]};
 const result=await validateArtifact(html,'html',{contract});
 assert.equal(result.status,'passed',JSON.stringify(result));
});

for(const fixture of functionalFixtures) test(`real browser: ${fixture.id} passes correct behavior and rejects controlled defect`,async()=>{
 const pass=await validateArtifact(fixture.good,'html',{contract:fixture.contract});
 assert.equal(pass.status,'passed',JSON.stringify(pass));
 const fail=await validateArtifact(fixture.bad,'html',{contract:fixture.contract});
 assert.equal(fail.status,'failed',JSON.stringify(fail));
 assert.ok(fail.functional.results.some(r=>r.status==='failed'&&r.expected!==r.observed));
 assert.match(fail.evidence.join('\n'),/esperado.*observado/);
});

test('planner tests never self-approve requirement coverage and no contract is only initialization',async()=>{
 const f=functionalFixtures[0];
 assert.equal((await validateArtifact(f.good,'html',{contract:f.contract,contractSource:'planner'})).status,'needs_review');
 assert.equal((await validateArtifact(f.good,'html')).status,'needs_review');
 const c=await createConversation({provider:'local'});
 const j=await createWorkflow({conversationId:c.id,goal:'Criar contador HTML com reinício'});
 await runWorkflow(j.id,{call:async()=>ok(JSON.stringify({steps:[{title:'Contador',instruction:f.goal,acceptance:'Reinício correto',format:'html',dependsOn:[],tests:f.contract}]}))});
 const final=await runWorkflow(j.id,{call:async()=>ok(f.good)});
 assert.equal(final.status,'awaiting_review');assert.equal(final.steps[0].testsSource,'planner');
});

test('executor repairs the real failed behavior, accounts both calls and gates the next step',async()=>{
 const f=functionalFixtures[0];let j=await prepare(f);let calls=0;
 j=await runWorkflow(j.id,{call:async(prompt,env)=>{
  calls++;
  if(calls===1) return ok(f.bad);
  assert.match(prompt,/esperado "1"; observado "3"/);
  assert.equal(env.LOCAL_OUTPUT_FORMAT,'json');
  return ok(JSON.stringify({edits:[{before:f.after,after:f.before}]}));
 }});
 assert.equal(j.status,'awaiting_acceptance',JSON.stringify(j));
 assert.equal(j.stats.localCalls,2);assert.equal(j.stats.inputTokens,20);assert.equal(j.stats.outputTokens,40);
 assert.equal(j.steps[0].history.length,2);assert.equal(j.steps[0].history[0].validation.status,'failed');
 assert.equal(j.steps[0].validation.status,'passed');assert.equal(j.steps[0].artifact,f.good);
 assert.equal((await getWorkflow(j.id)).steps[0].testsHash,j.steps[0].testsHash);
});

test('regressive candidate is preserved in history but never replaces the better version',async()=>{
 const f=functionalFixtures[0];let j=await prepare(f);let calls=0;
 j=await runWorkflow(j.id,{call:async()=>ok(++calls===1?f.bad:JSON.stringify({edits:[{before:'points++;render();',after:'points+=2;render();'}]}))});
 assert.equal(j.status,'failed');assert.equal(j.steps[0].artifact,f.bad);
 assert.equal(j.steps[0].history.at(-1).accepted,false);assert.match(j.steps[0].evidence.at(-1),/regrediu/);
 await assert.rejects(()=>reviewWorkflow(j.id,{stepId:0,accepted:true,artifactHash:j.steps[0].artifactHash}),/Corrija/);
 const callsBefore=j.stats.localCalls;const rechecked=await recheckWorkflow(j.id,0);
 assert.equal(rechecked.status,'failed');assert.equal(rechecked.stats.localCalls,callsBefore);
});

test('changed contracts invalidate reuse and budget still stops before a repair call',async()=>{
 const f=functionalFixtures[0];const j=await prepare(f,{maxCalls:1});
 const result=await runWorkflow(j.id,{call:async()=>ok(f.bad)});
 assert.equal(result.status,'budget_exhausted');assert.equal(result.stats.localCalls,1);
 const changed=structuredClone(f.contract);changed.cases[0].actions[0].expected='5';
 const different=await createWorkflow({conversationId:j.conversationId,goal:j.goal,functionalContracts:[{step:0,contract:changed}],budget:{maxCalls:1}});
 assert.notEqual(different.fingerprint,j.fingerprint);
});

test('functional validator propagates cancellation and blocks outbound requests',async()=>{
 const controller=new AbortController();controller.abort(new Error('Parar teste'));
 await assert.rejects(()=>validateArtifact(functionalFixtures[0].good,'html',{signal:controller.signal,contract:functionalFixtures[0].contract}),/Parar/);
 let requests=0;const server=createServer((req,res)=>{requests++;res.end('private');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {
  const f=functionalFixtures[0];
  const withFetch=f.good.replace('</script>',`fetch('http://127.0.0.1:${server.address().port}/private').catch(()=>{});</script>`);
  assert.equal((await validateArtifact(withFetch,'html',{contract:f.contract})).status,'passed');
  assert.equal(requests,0);
  const runningController=new AbortController();
  // Keep an assertion pending so a fast machine cannot finish before cancellation.
  const waitingContract={version:1,cases:[{id:'waiting',name:'Pending assertion',actions:[{op:'assertCount',selector:'#never-present',expected:1}]}]};
  const timer=setTimeout(()=>runningController.abort(new Error('Parar em andamento')),500);
  try {await assert.rejects(()=>validateArtifact(f.good,'html',{contract:waitingContract,signal:runningController.signal}),/Parar em andamento/);} finally{clearTimeout(timer);}
 } finally {await new Promise(r=>server.close(r));}
});

test('dependent steps cannot run while a functional failure persists',async()=>{
 const f=functionalFixtures[0],c=await createConversation({provider:'local'});
 let job=await createWorkflow({conversationId:c.id,goal:'Criar contador HTML com reinício e depois um resumo JSON.',functionalContracts:[{step:0,contract:f.contract}]});
 await runWorkflow(job.id,{call:async()=>ok(JSON.stringify({steps:[{title:'Contador',instruction:f.goal,acceptance:'Reinício correto',format:'html',dependsOn:[]},{title:'Resumo',instruction:'Resumo JSON',acceptance:'Resumo',format:'json',dependsOn:[0]}]}))});
 let calls=0;
 job=await runWorkflow(job.id,{call:async()=>{
  calls++;if(calls>2) throw Error('Dependency ran before passing');
  return ok(calls===1?f.bad:JSON.stringify({edits:[{before:'points++;render();',after:'points+=2;render();'}]}));
 }});
 assert.equal(job.status,'failed');assert.equal(job.steps[1].status,'pending');assert.equal(job.steps[1].attempts,0);
});

test('workflow API validates supplied contracts before creation and binds them before inference',async()=>{
 const {createServer}=await import('../app/server.js');const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {
  const c=await createConversation({provider:'local'}),base='http://127.0.0.1:'+server.address().port;
  const headers={'x-harness-token':server.apiToken,'content-type':'application/json'};
  const route=base+'/api/conversations/'+c.id+'/workflows';
  const bad=await fetch(route,{method:'POST',headers,body:JSON.stringify({goal:'HTML',functionalContracts:[{step:0,contract:{version:1,cases:[]}}]})});
  assert.equal(bad.status,400);
  const good=await fetch(route,{method:'POST',headers,body:JSON.stringify({goal:functionalFixtures[0].goal,functionalContracts:[{step:0,contract:functionalFixtures[0].contract}]})});
  assert.equal(good.status,201);const job=await good.json();assert.equal(job.stats.localCalls,0);
  assert.deepEqual(job.functionalContracts[0].contract,functionalFixtures[0].contract);
 } finally {await new Promise(r=>server.close(r));}
});
