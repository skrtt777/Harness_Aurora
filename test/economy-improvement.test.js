import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
process.env.HARNESS_DB_FILE=join(mkdtempSync(join(tmpdir(),'aurora-economy-v1-')),'test.db');
process.env.LOCAL_BASE_URL='http://127.0.0.1:1';
process.env.HARNESS_CONTEXT_POLICY='selective-v1';
const {selectSkills}=await import('../app/skills.js');
const {createMemory,selectRelevantMemories,createConversation,addMessage,listMessages}=await import('../app/store.js');
const {compactContext}=await import('../app/economy.js');
const {refineLocalAnswer}=await import('../app/localRefine.js');
const {diagnoseLocalArtifact,applyLocalEdits}=await import('../app/localDiagnostics.js');
const {summarizeLocalCalls}=await import('../app/localTelemetry.js');
const env={LOCAL_BASE_URL:'http://127.0.0.1:1'};
const code='<html><body><button id="inc">Somar</button><script>const score=0;score++;</script></body></html>';
const result=text=>({ok:true,text,usage:{input_tokens:100,output_tokens:20},metrics:{wallMs:10}});

test('skills respect domain and explicit exclusions despite HTML boilerplate',async()=>{
 for(const [query,expected] of [['Crie um dashboard BI de receita. HTML com controles e reinício.', ['bi-analysis']],['Crie um jogo de clicar no alvo. Sem áudio nem dashboard de vendas.',['browser-game']],['Crie uma landing page com formulário. HTML, dados, controles, critérios verificáveis.',[]]])assert.deepEqual((await selectSkills(query)).map(x=>x.name),expected);
});
test('retrieval abstains and does not fill unrelated memories or duplicate content',async()=>{
 await createMemory({title:'Receita de Snake em grade',content:'Jogo Snake com pontos e níveis.',tags:['biblioteca-jogos-v1'],env});
 await createMemory({title:'Áudio e música no jogo',content:'AudioContext para som.',tags:['biblioteca-jogos-v1'],env});
 const a=await createMemory({title:'Reiniciar partida',content:'Limpe eventos e pontos ao reiniciar partida.',tags:['biblioteca-jogos-v1'],env});
 await createMemory({title:'Reiniciar rodada',content:'Limpe eventos e pontos ao reiniciar partida.',tags:['biblioteca-jogos-v1'],env});
 assert.deepEqual(await selectRelevantMemories('Crie BI de faturamento e receita',{},12,env),[]);
 const m=await selectRelevantMemories('Jogo de clicar: reiniciar partida. Sem áudio e sem Snake.',{},12,env);
 assert.equal(m.length,1);assert.equal(m[0].content,a.content);assert(m[0].retrieval.titleMatches.length>0);
});
test('memory budget uses whole blocks and never cuts the user task',async()=>{
 const memories=Array.from({length:12},(_,i)=>({id:String(i),title:'Regra',content:'x'.repeat(600)}));
 const c=await compactContext({input:'Requisito essencial exato',memories,limit:6000});
 assert(c.memoryChars<=1800);assert.equal(c.memoryIds.length,2);assert.equal(c.omittedMemories,10);assert(c.prompt.endsWith('Requisito essencial exato'));
});
test('diagnostics inspect every script and explicitly distinguish static from functional validation',()=>{
 const d=diagnoseLocalArtifact('<html><button id="ok">OK</button><script>document.getElementById("missing").click()</script><script>const a=0;a++</script></html>');
 assert(d.issues.some(i=>i.code==='missing_dom_id'&&i.target==='#missing'));assert(d.issues.some(i=>i.code==='const_assignment'));assert(d.issues.every(i=>i.expected&&i.observed));assert.equal(diagnoseLocalArtifact('<html><script>1</script></html>').status,'needs_functional_validation');
});
test('guarded edits reject ambiguity, overlap and removal of existing interfaces',()=>{
 assert.equal(applyLocalEdits('aa aa',JSON.stringify({edits:[{before:'aa',after:'bb'}]})).ok,false);
 assert.equal(applyLocalEdits('abcdef',JSON.stringify({edits:[{before:'abc',after:'x'},{before:'bcd',after:'y'}]})).ok,false);
 assert.equal(applyLocalEdits(code,JSON.stringify({edits:[{before:'<button id="inc">Somar</button>',after:''}]})).reason,'removed_dom_interface');
});
test('localized repair preserves markup and sums initial and correction usage',async()=>{
 const r=await refineLocalAnswer({task:'Contador',result:result(code),call:async(prompt,env)=>{assert.match(prompt,/esperado/);assert.equal(env.LOCAL_OUTPUT_FORMAT,'json');return result(JSON.stringify({edits:[{before:'const score=0;',after:'let score=0;'}]}));}});
 assert.equal(r.text,code.replace('const score','let score'));assert.deepEqual(r.usage,{input_tokens:200,output_tokens:40});assert.equal(r.telemetry.callCount,2);assert.equal(r.diagnostics.status,'needs_functional_validation');
});
test('failed and invalid retries are counted and cannot replace previous artifact',async()=>{
 let count=0;const r=await refineLocalAnswer({task:'Contador',result:result(code),call:async()=>++count===1?result('{}'):{ok:false,error:'failed',metrics:{wallMs:20}}});
 assert.equal(count,2);assert.equal(r.text,code);assert.equal(r.usage,null);assert.equal(r.telemetry.unknownUsageCalls,1);assert.deepEqual(r.telemetry.knownUsage,{input_tokens:200,output_tokens:40});
});
test('identical replies switch repair prompt and stop after bounded attempts',async()=>{
 const broken='<script>const a=0;a++;</script>',prompts=[];
 const r=await refineLocalAnswer({task:'Contador',result:result(broken),call:async p=>{prompts.push(p);return result(broken);}});
 assert.equal(prompts.length,2);assert.notEqual(prompts[0],prompts[1]);assert.equal(r.telemetry.events.filter(e=>e.reason==='no_change').length,2);assert.equal(r.telemetry.callCount,3);assert.deepEqual(r.usage,{input_tokens:300,output_tokens:60});assert.equal(r.diagnostics.status,'failed');
});
test('a repair introducing a different static error is rejected',async()=>{
 const r=await refineLocalAnswer({task:'Contador',result:result(code),call:async()=>result(JSON.stringify({edits:[{before:'const score=0;score++;',after:'missingFunction();'}]}))});
 assert.equal(r.text,code);assert(r.telemetry.events.some(e=>e.reason==='static_regression'));
});
test('unknown usage stays unknown and execution evidence survives DB reload',async()=>{
 const execution=summarizeLocalCalls([{ok:false,usage:null}]);assert.equal(execution.completeUsage,false);assert.equal(execution.unknownUsageCalls,1);
 const c=await createConversation({title:'telemetry',provider:'local'});await addMessage({conversationId:c.id,role:'assistant',content:'Falha',execution});assert.deepEqual((await listMessages(c.id))[0].execution,execution);
});
test('real chat integration persists every Ollama call including a localized repair',async()=>{
 const {handleChatTurn}=await import('../app/server.js');let calls=0;
 const stub=http.createServer((req,res)=>{if(req.url!=='/api/generate'){res.writeHead(404);return res.end();}let body='';req.on('data',c=>body+=c);req.on('end',()=>{const request=JSON.parse(body);calls++;const response=calls===1?code:JSON.stringify({edits:[{before:'const score=0;',after:'let score=0;'}]});if(calls>1)assert.equal(request.format,'json');res.setHeader('content-type','application/json');res.end(JSON.stringify({response,prompt_eval_count:100,eval_count:20,prompt_eval_cached_count:5,total_duration:10000000}));});});
 await new Promise(r=>stub.listen(0,'127.0.0.1',r));
 try{const c=await createConversation({title:'Integration',provider:'local'});const response=await handleChatTurn({conversationId:c.id,message:'Crie um contador com botão Somar.',env:{LOCAL_BASE_URL:`http://127.0.0.1:${stub.address().port}`,LOCAL_MODEL:'test-model'}});assert.equal(response.ok,true);assert.equal(calls,2);assert.deepEqual(response.usage,{input_tokens:200,output_tokens:40});assert.equal(response.execution.callCount,2);assert.equal(response.message.execution.callCount,2);assert.equal((await listMessages(c.id)).at(-1).execution.knownUsage.input_tokens,200);}finally{await new Promise(r=>stub.close(r));}
});
test('a browser initialization check never claims functional approval',async()=>{
 const {validateArtifact}=await import('../app/workflowValidation.js');
 const r=await validateArtifact('<html><body><button>Does nothing</button></body></html>','html');
 assert.equal(r.status,'needs_review');assert.match(r.limitation,/funcionais|inconclusivo/);
});
