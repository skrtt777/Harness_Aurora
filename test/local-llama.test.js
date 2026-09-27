import test from 'node:test';
import assert from 'node:assert/strict';
import {runLocal,buildProviderConfig} from '../app/local.js';
test('Quest execution preserves the Harness result contract and forwards cancellation',async t=>{
  const controller=new AbortController();
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:18080/v1/chat/completions');
    const body=JSON.parse(options.body);assert.equal(body.messages[0].content,'Memória: jardim. Pergunta: onde paramos?');
    assert.equal(body.chat_template_kwargs.enable_thinking,false);assert.equal(options.signal.aborted,false);
    return Response.json({choices:[{message:{content:'Continuamos o jardim.'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:6}});
  });
  const r=await runLocal('Memória: jardim. Pergunta: onde paramos?',{LOCAL_ENGINE:'llama.cpp'},controller.signal);
  assert.equal(r.ok,true);assert.equal(r.text,'Continuamos o jardim.');assert.equal(r.usage.output_tokens,6);
});
test('Quest readiness and failures do not fall back to the desktop provider',async t=>{
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('offline');});
  assert.equal((await buildProviderConfig({LOCAL_ENGINE:'llama.cpp'})).configured,false);
  assert.equal((await runLocal('oi',{LOCAL_ENGINE:'llama.cpp'})).ok,false);
  assert.equal((await runLocal('oi',{LOCAL_ENGINE:'llama.cpp',LOCAL_BASE_URL:'https://example.com'})).ok,false);
});
test('Quest adapter preserves message roles, zero temperature, caching and measured timings',async t=>{
  const messages=[{role:'system',content:'Seja breve.'},{role:'user',content:'2+2?'}];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const body=JSON.parse(options.body);assert.deepEqual(body.messages,messages);
    assert.equal(body.temperature,0);assert.equal(body.cache_prompt,true);assert.equal(body.seed,7);
    return Response.json({choices:[{message:{content:'4'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:1,prompt_tokens_details:{cached_tokens:10}},timings:{prompt_ms:100,predicted_ms:20,prompt_per_second:100,predicted_per_second:50}});
  });
  const result=await runLocal(messages,{LOCAL_ENGINE:'llama.cpp',LOCAL_TEMPERATURE:'0',LOCAL_SEED:'7'});
  assert.equal(result.metrics.promptMs,100);assert.equal(result.metrics.cachedInputTokens,10);
});
test('Large Quest prompts use actual tokenizer and reject overflow without inference',async t=>{
  const paths=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    paths.push(new URL(url).pathname);
    if(url.endsWith('/apply-template'))return Response.json({prompt:'formatted'});
    if(url.endsWith('/tokenize'))return Response.json({tokens:Array(4000).fill(1)});
    assert.fail('An oversized prompt must never reach generation');
  });
  const result=await runLocal('x'.repeat(6000),{LOCAL_ENGINE:'llama.cpp',LOCAL_CONTEXT_TOKENS:'4096',LOCAL_MAX_OUTPUT_TOKENS:'384'});
  assert.equal(result.ok,false);assert.equal(result.status,413);
  assert.deepEqual(paths,['/apply-template','/tokenize']);
});
test('Large character count does not reject a tokenized prompt that fits',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('/apply-template'))return Response.json({prompt:'formatted'});
    if(url.endsWith('/tokenize'))return Response.json({tokens:Array(1800).fill(1)});
    return Response.json({choices:[{message:{content:'Entendido.'},finish_reason:'stop'}]});
  });
  assert.equal((await runLocal('x'.repeat(6000),{LOCAL_ENGINE:'llama.cpp',LOCAL_CONTEXT_TOKENS:'4096',LOCAL_MAX_OUTPUT_TOKENS:'384'})).ok,true);
});
test('Desktop-parity prompt uses the Ollama template and sampling on /completion',async t=>{
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:18080/completion');
    const body=JSON.parse(options.body);
    assert.equal(body.prompt,'<|start_header_id|>system<|end_header_id|>\n\nCutting Knowledge Date: December 2023\n\n<|eot_id|><|start_header_id|>user<|end_header_id|>\n\nque horas são?<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n');
    assert.equal(body.temperature,.8);assert.equal(body.repeat_penalty,1.1);assert.equal(body.top_p,.9);assert.equal(body.top_k,40);
    assert.equal(body.n_predict,2048);assert.equal(body.cache_prompt,true);
    return Response.json({content:'São 14h.',stop_type:'eos',tokens_evaluated:29,tokens_predicted:5,tokens_cached:20,timings:{prompt_ms:50}});
  });
  const r=await runLocal('que horas são?',{LOCAL_ENGINE:'llama.cpp',LOCAL_PROMPT_FORMAT:'llama3'});
  assert.equal(r.ok,true);assert.equal(r.text,'São 14h.');assert.equal(r.truncated,false);
  assert.deepEqual(r.usage,{input_tokens:29,output_tokens:5});assert.equal(r.metrics.cachedInputTokens,20);
});
test('Desktop-parity overflow is measured on the exact formatted prompt',async t=>{
  const paths=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    paths.push(new URL(url).pathname);
    const body=JSON.parse(options.body);assert.equal(body.add_special,true);assert.match(body.content,/^<\|start_header_id\|>system/);
    return Response.json({tokens:Array(7000).fill(1)});
  });
  const r=await runLocal('x'.repeat(9000),{LOCAL_ENGINE:'llama.cpp',LOCAL_PROMPT_FORMAT:'llama3'});
  assert.equal(r.status,413);assert.deepEqual(paths,['/tokenize']);
});
test('Quest embeddings come from the local llama.cpp embedding server, never Ollama',async t=>{
  const {embedText}=await import('../app/embeddings.js');
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:18081/v1/embeddings');
    assert.equal(options.headers.authorization,'Bearer k');assert.equal(JSON.parse(options.body).input,'jardim');
    return Response.json({data:[{embedding:[.1,.2,.3]}]});
  });
  assert.deepEqual(await embedText(' jardim ',{LOCAL_ENGINE:'llama.cpp',EMBEDDING_BASE_URL:'http://127.0.0.1:18081',LOCAL_API_KEY:'k'}),[.1,.2,.3]);
  assert.equal(await embedText('jardim',{LOCAL_ENGINE:'llama.cpp'}),null);
});
