import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.HARNESS_DB_FILE=join(mkdtempSync(join(tmpdir(),'quest-context-')),'test.db');
const {compactQuestContext,QUEST_CHAT_SYSTEM}=await import('../app/questContext.js');
const {createMemory,selectRelevantMemories}=await import('../app/store.js');
const env={LOCAL_ENGINE:'llama.cpp',HARNESS_CONTEXT_POLICY:'quest-chat-v1'};

test('A short Quest question does not inherit unrelated skills or global memories',async()=>{
  await createMemory({scope:'global',title:'Construir jogo Snake',content:'Para criar jogos em HTML, use JavaScript e valide os controles.',tags:['jogo']});
  const input='Responda somente o número: quanto é 2 + 2?';
  const memories=await selectRelevantMemories(input,{},12,env);
  assert.equal(memories.length,0);
  const context=await compactQuestContext({input,memories,env});
  assert.deepEqual(context.skills,[]);assert.deepEqual(context.memoryIds,[]);
  assert.equal(context.messages.length,2);assert.equal(context.messages.at(-1).content,`Pedido atual:\n${input}`);
  assert.ok(context.prompt.length<500);
});
test('Quest never carries an orphan answer after dropping an oversized question',async()=>{
  const context=await compactQuestContext({input:'Continue.',env,history:[{role:'user',content:'x'.repeat(2000)},{role:'assistant',content:'Resposta curta sem o contexto.'}]});
  assert.equal(context.messages.length,2);assert.equal(context.omittedHistory,2);assert.equal(context.historyChars,0);
});
test('Quest retains project requirements and recent messages in chronological roles',async()=>{
  const history=[{role:'user',content:'Escolhi verde.'},{role:'assistant',content:'A cor ficou verde.'},{role:'assistant',provider:'Sistema',content:'erro de rede'}];
  const context=await compactQuestContext({input:'Qual cor escolhi?',instructions:'Não mudar a cor sem pedido.',history,env});
  assert.match(context.messages[0].content,/Não mudar a cor/);
  assert.deepEqual(context.messages.slice(1,-1),history.slice(0,2));
  assert.equal(context.omittedHistory,0);
});
test('Relevant teacher memory reaches the model as reference data, with provenance',async()=>{
  const memory=await createMemory({scope:'global',title:'Cor escolhida para painel Aurora',content:'A cor escolhida para o painel Aurora é dourada.',tags:['painel','aurora']});
  const memories=await selectRelevantMemories('Qual a cor escolhida para o painel Aurora?',{},12,env);
  assert.ok(memories.some(m=>m.id===memory.id));
  const context=await compactQuestContext({input:'Qual a cor escolhida para o painel Aurora?',memories,env});
  assert.ok(context.memoryIds.includes(memory.id));assert.match(context.messages.at(-1).content,/dourada/);
  assert.equal(context.messages[0].content,QUEST_CHAT_SYSTEM);
});
test('Quest rejects oversized essential requirements and never cuts a memory or history record',async()=>{
  await assert.rejects(compactQuestContext({input:'x'.repeat(1100),limit:1000,env}),/nenhum requisito/);
  const context=await compactQuestContext({input:'Oi',limit:1000,env,memories:[{id:'large',title:'Documento',content:'z'.repeat(2000)}],history:[{role:'assistant',content:'y'.repeat(2000)}]});
  assert.equal(context.omittedHistory,1);assert.equal(context.omittedMemories,1);
  assert.deepEqual(context.memoryIds,[]);assert.equal(context.messages.length,2);
});
test('Quest transport uses the original Harness context even with the obsolete profile flag',async t=>{
  const {createConversation,listMessages}=await import('../app/store.js');
  const {handleChatTurn}=await import('../app/server.js');
  const captured=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.ok(url.endsWith('/v1/chat/completions'));
    captured.push(JSON.parse(options.body));
    return Response.json({choices:[{message:{content:'8'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:1}});
  });
  const optimized=await createConversation({provider:'local',title:'Quest test'});
  const result=await handleChatTurn({conversationId:optimized.id,message:'Quanto é 3 + 5?',env:{LOCAL_ENGINE:'llama.cpp',HARNESS_QUEST_CHAT_PROFILE:'quest-chat-v1'}});
  assert.equal(result.ok,true);assert.equal(result.execution.context.selectionVersion,'legacy');
  assert.equal(captured[0].messages[0].role,'user');
  assert.equal((await listMessages(optimized.id)).at(-1).content,'8');
  const desktop=await createConversation({provider:'local',title:'Legacy test'});
  const legacy=await handleChatTurn({conversationId:desktop.id,message:'Quanto é 3 + 5?',env:{LOCAL_ENGINE:'llama.cpp'}});
  assert.equal(legacy.ok,true);assert.equal(legacy.execution.context.selectionVersion,'legacy');
  assert.equal(captured[1].messages[0].role,'user');
  assert.deepEqual(captured[0].messages,captured[1].messages);
});
