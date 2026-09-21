import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.HARNESS_DB_FILE=join(mkdtempSync(join(tmpdir(),'aurora-workflow-')),'test.db');
process.env.LOCAL_MODEL='test-model';
process.env.LOCAL_BASE_URL='http://127.0.0.1:1';
process.env.EMBEDDINGS_ENABLED='false';
const {createConversation,createProject,updateProject}=await import('../app/store.js');
const {createWorkflow,runWorkflow,getWorkflow,reviewWorkflow,cancelWorkflow,acceptanceHash,parsePlan}=await import('../app/workflows.js');
const {parseSkill,importSkill,enableSkill,selectSkills,readSkill}=await import('../app/skills.js');
const {compactContext}=await import('../app/economy.js');
const {validateArtifact}=await import('../app/workflowValidation.js');
const {refineLocalAnswer}=await import('../app/localRefine.js');
const {getDb}=await import('../app/db.js');
const plan=(format='html')=>JSON.stringify({steps:[{title:'Entrega',instruction:'Produzir documento solicitado',acceptance:'Documento correto',format,dependsOn:[]}]});
const ok=text=>({ok:true,text,usage:{input_tokens:100,output_tokens:40}});
const passed=async()=>({status:'passed',evidence:['Validador determinístico de teste.'],validator:'test'});
const conversation=()=>createConversation({provider:'local'});
async function ready(format='html',budget,knowledgeMode='none') {
 const c=await conversation();const j=await createWorkflow({conversationId:c.id,goal:'Criar um artefato de teste',budget,knowledgeMode});
 await runWorkflow(j.id,{call:async()=>ok(plan(format))});return getWorkflow(j.id);
}
test('skill import validates YAML, deduplicates, remains inactive until enabled',async()=>{
 const text='---\nname: unique-zebra\ndescription: Procedimento zebra exclusivo\n---\nValide o resultado com a referência.';
 const a=await importSkill(text),b=await importSkill(text);assert.equal(a.id,b.id);assert.equal(a.enabled,false);
 assert.equal((await selectSkills('unique-zebra')).length,0);
 await enableSkill(a.id,true);assert.equal((await selectSkills('unique-zebra'))[0].name,'unique-zebra');
 assert.equal((await readSkill(a.id)).text,text);
 await assert.rejects(()=>readSkill(a.id,'../../.env'),/inválida/);
 assert.throws(()=>parseSkill('---\nname: ../x\ndescription: bad\n---\nx'));
});
test('context preserves essential blocks, respects budget, omits oversized optional content',async()=>{
 const ctx=await compactContext({input:'Pedido final específico',memories:[{id:'huge',title:'x',content:'a'.repeat(20000)}],limit:6500});
 assert.ok(ctx.prompt.endsWith('Pedido final específico'));assert.ok(ctx.prompt.length<=6500);assert.deepEqual(ctx.memoryIds,[]);
 await assert.rejects(()=>compactContext({input:'x',required:['a'.repeat(30000)],limit:6500}),/nenhum conteúdo foi truncado/);
});
test('malformed plans and forward dependencies are rejected',()=>{
 assert.throws(()=>parsePlan('{}'));
 assert.throws(()=>parsePlan(JSON.stringify({steps:[{title:'a',instruction:'x',acceptance:'x',format:'html',dependsOn:[0]}]})));
});
test('planning is separate, step checks cannot be self-approved, final acceptance is tied to artifact hash',async()=>{
 let j=await ready();assert.equal(j.status,'planned');assert.equal(j.stats.localCalls,1);
 j=await runWorkflow(j.id,{call:async()=>ok('<html><body>ok</body></html>'),validate:passed});
 assert.equal(j.status,'awaiting_acceptance');assert.equal(j.stats.localCalls,2);assert.equal(j.stats.inputTokens,200);
 await assert.rejects(()=>reviewWorkflow(j.id,{accepted:true,artifactHash:'forged'}),/mudou/);
 j=await reviewWorkflow(j.id,{accepted:true,note:'Conferido',artifactHash:acceptanceHash(j)});
 assert.equal(j.status,'completed');assert.ok(j.messageId);
 const reused=await createWorkflow({conversationId:j.conversationId,goal:j.goal});
 assert.equal(reused.id,j.id);assert.equal(reused.stats.localCalls,2);assert.equal(reused.stats.reuses,1);
});
test('unsupported semantic checks stop progression until human review',async()=>{
 let j=await ready('json');
 j=await runWorkflow(j.id,{call:async()=>ok('{"total":25}'),validate:validateArtifact});
 assert.equal(j.status,'awaiting_review');assert.equal(j.steps[0].status,'awaiting_review');
 const calls=j.stats.localCalls;await runWorkflow(j.id,{call:()=>{throw new Error('must not call');}});
 assert.equal((await getWorkflow(j.id)).stats.localCalls,calls);
 await reviewWorkflow(j.id,{stepId:0,accepted:true,note:'Total conferido com origem',artifactHash:j.steps[0].artifactHash});
 j=await runWorkflow(j.id,{call:()=>{throw new Error('must not call');}});
 assert.equal(j.status,'awaiting_acceptance');
});
test('failed checks retry only to the persisted limit and cannot be overridden',async()=>{
 let j=await ready();let calls=0;
 j=await runWorkflow(j.id,{call:async()=>{calls++;return ok('bad');},validate:async()=>({status:'failed',evidence:['Erro real']})});
 assert.equal(j.status,'failed');assert.equal(calls,2);assert.equal(j.steps[0].attempts,2);
 await assert.rejects(()=>reviewWorkflow(j.id,{stepId:0,accepted:true,artifactHash:j.steps[0].artifactHash}),/Corrija/);
 await runWorkflow(j.id,{call:async()=>{calls++;return ok('bad');}});assert.equal(calls,2);
});
test('call budget persists across planning, execution and resume',async()=>{
 let j=await ready('html',{maxCalls:1});
 j=await runWorkflow(j.id,{call:()=>{throw new Error('must not call');}});
 assert.equal(j.status,'budget_exhausted');assert.equal(j.stats.localCalls,1);
 await runWorkflow(j.id,{call:()=>{throw new Error('must not call');}});
 assert.equal((await getWorkflow(j.id)).stats.localCalls,1);
});
test('cancellation interrupts a model call and conservatively charges an unknown outcome',async()=>{
 const j=await ready();let entered;const started=new Promise(r=>entered=r);
 const running=runWorkflow(j.id,{call:async(_p,_e,signal)=>{entered();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {ok:false,error:'Cancelado'};}});
 await started;assert.equal(cancelWorkflow(j.id).cancelled,true);await running;
 const saved=await getWorkflow(j.id);assert.equal(saved.status,'interrupted');assert.equal(saved.stats.localCalls,2);assert.ok(saved.stats.estimatedTokens>0);
});
test('valid local code avoids a redundant full rewrite by default',async()=>{
 const answer={ok:true,text:'<html><script>const n = 1;</script></html>'};
 assert.equal(await refineLocalAnswer({task:'x',result:answer,memories:[{title:'regra',content:'texto'}],env:{LOCAL_BASE_URL:'http://127.0.0.1:1'}}),answer);
});
test('validators reject malformed artifacts without ever executing host commands',async()=>{
 assert.equal((await validateArtifact('not json','json')).status,'failed');
 assert.equal((await validateArtifact('const =','javascript')).status,'failed');
 assert.equal((await validateArtifact('texto','markdown')).status,'needs_review');
});
test('interrupted process state is recovered without losing evidence or granting new attempts',async()=>{
 const j=await ready();const db=await getDb();j.status='running';j.owner='dead-process';j.steps[0].status='running';j.steps[0].attempts=1;
 db.prepare('UPDATE workflows SET document=? WHERE id=?').run(JSON.stringify(j),j.id);
 const recovered=await getWorkflow(j.id);assert.equal(recovered.status,'interrupted');assert.equal(recovered.steps[0].attempts,1);assert.equal(recovered.steps[0].status,'pending');
});

test('project-scoped approved results can be reused in a new conversation without crossing projects',async()=>{
 const project=await createProject({name:'Reuse project'});
 const a=await createConversation({provider:'local',projectId:project.id});
 let job=await createWorkflow({conversationId:a.id,goal:'Painel aprovado'});
 await runWorkflow(job.id,{call:async()=>ok(plan())});
 job=await runWorkflow(job.id,{call:async()=>ok('<html>ok</html>'),validate:passed});
 await reviewWorkflow(job.id,{accepted:true,artifactHash:acceptanceHash(job)});
 const b=await createConversation({provider:'local',projectId:project.id});
 const cached=await createWorkflow({conversationId:b.id,goal:'Painel aprovado'});
 assert.equal(cached.status,'completed');assert.equal(cached.reusedFrom,job.id);assert.equal(cached.stats.localCalls,0);
 const other=await conversation();const fresh=await createWorkflow({conversationId:other.id,goal:'Painel aprovado'});
 assert.equal(fresh.status,'draft');
 await assert.rejects(()=>createWorkflow({conversationId:other.id,goal:'Modify',baseWorkflowId:job.id}),e=>e.status===400);
 const extension=await createWorkflow({conversationId:b.id,goal:'Adicionar um filtro',baseWorkflowId:cached.id});
 assert.equal(extension.base.artifact,'<html>ok</html>');
});
test('teacher is explicit, limited to one call and does not auto-enable proposed skills',async()=>{
 const {teachWorkflow}=await import('../app/workflows.js');
 const job=await ready();let calls=0;
 const helped=await teachWorkflow(job.id,{call:async()=>{calls++;return ok(JSON.stringify({guidance:'Conferir dados antes do painel.',skill:{name:'test-teacher-guide',description:'Dados de exemplo controlados',body:'Conferir os valores contra a origem.'}}));}});
 assert.equal(calls,1);assert.equal(helped.stats.teacherCalls,1);assert.equal(helped.proposedSkill.enabled,false);
 await assert.rejects(()=>teachWorkflow(job.id,{call:()=>{calls++;}}),e=>e.status===429);
 assert.equal(calls,1);
});
test('changed project rules invalidate a pending plan before another model call',async()=>{
 const project=await createProject({name:'Changing project',instructions:'Version A'});
 const c=await createConversation({provider:'local',projectId:project.id});
 const j=await createWorkflow({conversationId:c.id,goal:'Criar painel'});
 await runWorkflow(j.id,{call:async()=>ok(plan())});
 await updateProject(project.id,{instructions:'Version B'});
 const stopped=await runWorkflow(j.id,{call:()=>{throw new Error('must not call');}});
 assert.equal(stopped.status,'failed');assert.equal(stopped.stats.localCalls,1);
});

test('explicit single-stage requests bypass planning inference and keep the original acceptance criteria',async()=>{
 const c=await conversation();const goal='Entregue em uma unica etapa um HTML com botao Somar que adiciona 1.';
 const j=await createWorkflow({conversationId:c.id,goal});
 const result=await runWorkflow(j.id,{call:()=>{throw new Error('must not call');}});
 assert.equal(result.status,'planned');assert.equal(result.stats.localCalls,0);assert.equal(result.steps.length,1);assert.equal(result.steps[0].acceptance,goal);
});
test('ordinary local chat reuses a compatible approved artifact without contacting Ollama',async()=>{
 const {handleChatTurn}=await import('../app/server.js');
 let j=await ready('html',undefined,'skills');j=await runWorkflow(j.id,{call:async()=>ok('<html><body>Cached answer</body></html>'),validate:passed});
 await reviewWorkflow(j.id,{accepted:true,artifactHash:acceptanceHash(j)});
 const result=await handleChatTurn({conversationId:j.conversationId,message:j.goal,env:{LOCAL_BASE_URL:'http://127.0.0.1:1'}});
 assert.equal(result.ok,true);assert.equal(result.message.provider,'Local (reutilizado)');assert.match(result.message.content,/Cached answer/);assert.equal(result.usage.input_tokens,0);
});
test('large skill loading selects complete relevant sections within the context budget',async()=>{
 const {skillExcerpt}=await import('../app/skills.js');
 const excerpt=skillExcerpt({body:'# Intro\nBrief instructions.\n## unrelated\n'+'x'.repeat(7000)+'\n## invoices\nCheck invoice totals.\n'},'invoices',1000);
 assert.equal(excerpt.partial,true);assert.ok(excerpt.body.length<=1000);assert.match(excerpt.body,/Check invoice totals/);assert.ok(!excerpt.body.includes('x'.repeat(100)));
});
test('workflow routes require a session and never accept a client asserted completion state',async()=>{
 const {createServer}=await import('../app/server.js');const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 try {
  assert.equal((await fetch(base+'/api/skills')).status,401);
  const headers={'x-harness-token':server.apiToken,'content-type':'application/json'};
  assert.equal((await fetch(base+'/api/skills',{headers})).status,200);
  const c=await conversation();
  const response=await fetch(base+'/api/conversations/'+c.id+'/workflows',{method:'POST',headers,body:JSON.stringify({goal:'Test',status:'completed',budget:{maxCalls:2}})});
  const job=await response.json();assert.equal(response.status,201);assert.equal(job.status,'draft');
  const bad=await fetch(base+'/api/workflows/'+job.id+'/review',{method:'POST',headers,body:JSON.stringify({accepted:true,artifactHash:'fake'})});
  assert.equal(bad.status,409);
 }finally{await new Promise(r=>server.close(r));}
});
