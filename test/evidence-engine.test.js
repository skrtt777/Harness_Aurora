import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.HARNESS_DB_FILE=join(mkdtempSync(join(tmpdir(),'aurora-engine-')),'test.db');
process.env.LOCAL_MODEL='test';process.env.LOCAL_BASE_URL='http://127.0.0.1:1';process.env.EMBEDDINGS_ENABLED='false';
const {repairTargets,applyTargetEdits,listEngineKnowledge,reviewEngineKnowledge,captureVerifiedRepair,loadRequestedReference,engineSummary,proposeDeterministicRepairs}=await import('../app/evidenceEngine.js');
const {parseSkill,skillCompatibility,importSkill,enableSkill,selectSkills,readSkill}=await import('../app/skills.js');
const {createConversation,createProject}=await import('../app/store.js');
const {createWorkflow,runWorkflow}=await import('../app/workflows.js');
const {functionalFixtures}=await import('../scripts/benchmark/functional-fixtures.mjs');
const ok=text=>({ok:true,text,usage:{input_tokens:10,output_tokens:10}});

test('deterministic hypotheses cover the four development defects and do not rewrite the correct versions',()=>{
  for(const f of functionalFixtures){assert.ok(proposeDeterministicRepairs(f.bad).length>0,f.id);assert.equal(proposeDeterministicRepairs(f.good).length,0,f.id);}
});

test('target edits are bound to exact offsets/hash and reject overlap, stale source and script escape',()=>{
  const source='<html><script>const a=1,b=1;const c=()=>{let d=2;return d;};</script></html>',p=repairTargets(source);
  const b=p.targets.find(t=>t.label==='valor de b');
  const response=JSON.stringify({replacements:[{id:b.id,code:'3'}]});
  assert.match(applyTargetEdits(source,response,p).text,/a=1,b=3/);
  assert.equal(applyTargetEdits(source+' ',response,p).reason,'stale_artifact');
  assert.equal(applyTargetEdits(source,JSON.stringify({replacements:[{id:b.id,code:'</script><script>bad()'}]}),p).ok,false);
  const c=p.targets.find(t=>t.label==='valor de c'),d=p.targets.find(t=>t.label==='valor de d');
  assert.equal(applyTargetEdits(source,JSON.stringify({replacements:[{id:c.id,code:'()=>0'},{id:d.id,code:'3'}]}),p).reason,'overlapping_targets');
  assert.equal(applyTargetEdits(source,JSON.stringify({replacements:[{id:'invented',code:'3'}]}),p).ok,false);
});

test('declared missing tools/platforms/environment block activation and context selection',async()=>{
  const text='---\nname: incompatible-engine\ndescription: uniqueblocked procedure\nplatforms: [linux]\nmetadata:\n  hermes:\n    requires_tools: [terminal]\nrequired_environment_variables: [ENGINE_MISSING_KEY]\n---\nRun a terminal command.';
  assert.equal(skillCompatibility(parseSkill(text),{platform:'win32',env:{}}).reasons.length,3);
  const s=await importSkill(text);await assert.rejects(enableSkill(s.id,true),/incompatível/);
  assert.equal((await selectSkills('uniqueblocked')).length,0);
});

test('real tested repair creates a deduplicated inactive candidate and activation remains scoped',async()=>{
  const fixture=functionalFixtures.find(f=>f.id==='calculations');
  const project=await createProject({name:'Evidence scope'}),conversation=await createConversation({provider:'local',projectId:project.id});
  let job=await createWorkflow({conversationId:conversation.id,goal:'Entregue em uma etapa HTML evidenceuniquemargin: '+fixture.goal.slice(0,650),functionalContracts:[{step:0,contract:fixture.contract}]});
  assert.equal(job.knowledgeMode,'none');assert.deepEqual(job.memories,[]);assert.deepEqual(job.skillVersion,[]);
  await runWorkflow(job.id,{call:()=>{throw Error('Unexpected plan call');}});
  let calls=0;
  job=await runWorkflow(job.id,{call:async()=>{
    if(calls++===0)return ok(fixture.bad);
    const p=repairTargets(fixture.bad),t=p.targets.find(t=>t.label==='valor de margin');
    return ok(JSON.stringify({replacements:[{id:t.id,code:'revenue?100*profit/revenue:0'}]}));
  }});
  assert.equal(job.status,'awaiting_acceptance');
  const id=job.steps[0].learnedKnowledgeId;assert.ok(id);
  let record=(await listEngineKnowledge()).find(k=>k.id===id);assert.equal(record.status,'candidate');
  assert.equal((await selectSkills('evidenceuniquemargin',3600,3,{projectId:project.id})).some(s=>s.source==='engine:'+id),false);
  record=await reviewEngineKnowledge(id,true);assert.equal(record.status,'active');
  assert.equal((await selectSkills('evidenceuniquemargin',3600,3,{projectId:project.id})).some(s=>s.id===record.skill.id),true);
  assert.equal((await selectSkills('evidenceuniquemargin',3600,3,{projectId:'other'})).some(s=>s.id===record.skill.id),false);
  const before={artifact:fixture.bad,validation:job.steps[0].history[0].validation};
  await captureVerifiedRepair(job,job.steps[0],before);assert.equal((await listEngineKnowledge()).find(k=>k.id===id).evidence.length,1);
  assert.equal(await captureVerifiedRepair(job,{...job.steps[0],testsSource:'planner'},before),null);
  await reviewEngineKnowledge(id,false);assert.equal((await readSkill(record.skill.id)).enabled,false);
  const summary=await engineSummary();assert.equal(summary.metrics.passedContracts,1);assert.equal(summary.metrics.humanAccepted,0);
});

test('on-demand references are allowlisted, cached by pinned revision and charged to model budget',async()=>{
  const text='---\nname: engine-ref\ndescription: enginereferenceunique\n---\nConsult references/guide.md before generating.';
  const skill=await importSkill(text,'catalog:github:sample/repo:'+'a'.repeat(40)+':skills/engine-ref/SKILL.md');await enableSkill(skill.id,true);
  const options=[{id:skill.id,hash:skill.hash,resources:['references/guide.md']}];
  await assert.rejects(loadRequestedReference({id:skill.id,resource:'references/other.md'},options,{}),/fora/);
  const previous=globalThis.fetch;let downloads=0;
  globalThis.fetch=async(url)=>{assert.ok(url.endsWith('/references/guide.md'));downloads++;return new Response('Use a clear heading.');};
  try{
    assert.equal((await loadRequestedReference({id:skill.id,resource:'references/guide.md'},options,{})).cached,false);
    assert.equal((await loadRequestedReference({id:skill.id,resource:'references/guide.md'},options,{})).cached,true);
    const c=await createConversation({provider:'local'});
    let job=await createWorkflow({conversationId:c.id,goal:'Entregue em uma etapa HTML enginereferenceunique.',knowledgeMode:'skills',budget:{maxCalls:2}});
    await runWorkflow(job.id,{call:()=>{throw Error('Unexpected plan call');}});
    let calls=0;
    job=await runWorkflow(job.id,{call:async(prompt)=>{
      if(calls++===0){assert.match(prompt,/skill_request/);return ok(JSON.stringify({skill_request:{id:skill.id,resource:'references/guide.md'}}));}
      assert.match(prompt,/Use a clear heading/);return ok('<html><h1>Title</h1></html>');
    },validate:async()=>({status:'needs_review',evidence:['Manual review']})});
    assert.equal(job.stats.localCalls,2);assert.equal(job.stats.referenceLoads,1);assert.equal(job.steps[0].attempts,1);assert.equal(downloads,1);
  }finally{globalThis.fetch=previous;}
});

test('engine endpoints require authentication and cannot assert learning without a stored record',async()=>{
  const {createServer}=await import('../app/server.js');const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(base+'/api/engine/summary')).status,401);
    const headers={'x-harness-token':server.apiToken,'content-type':'application/json'};
    const response=await fetch(base+'/api/engine/summary',{headers});assert.equal(response.status,200);assert.ok((await response.json()).metrics);
    assert.equal((await fetch(base+'/api/engine/knowledge/'+'0'.repeat(64)+'/review',{method:'POST',headers,body:JSON.stringify({accepted:true})})).status,404);
    assert.equal((await fetch(base+'/api/engine/knowledge/'+'0'.repeat(64)+'/review',{method:'POST',headers,body:JSON.stringify({accepted:'true'})})).status,400);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
