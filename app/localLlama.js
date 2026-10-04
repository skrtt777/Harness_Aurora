// Android execution adapter. Context, memory, correction and persistence stay in Harness.
// A text prompt gets the same template, sampling and output limit the desktop Ollama
// path uses (app/local.js), so identical weights behave the same on both platforms.
const OLLAMA_SAMPLING={temperature:.8,top_k:40,top_p:.9,min_p:0,repeat_penalty:1.1,repeat_last_n:64};
// Ollama's own template for the model, rendered for a single prompt without system/tools.
export const PROMPT_FORMATS={
  llama3:prompt=>`<|start_header_id|>system<|end_header_id|>\n\nCutting Knowledge Date: December 2023\n\n<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n${prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`,
};
function endpoint(env,url=env.LOCAL_BASE_URL||'http://127.0.0.1:18080'){
  url=new URL(url);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('O executor embarcado deve usar loopback.');
  return url.origin;
}
const authHeaders=env=>({'content-type':'application/json',...(env.LOCAL_API_KEY?{authorization:`Bearer ${env.LOCAL_API_KEY}`}:{})});
export async function llamaReady(env=process.env){
  try{return (await fetch(endpoint(env)+'/health',{signal:AbortSignal.timeout(3000)})).ok;}catch{return false;}
}
// Same vector space as Ollama's nomic-embed-text, so embeddings stored on the PC stay valid.
export async function embedLlama(text,env=process.env,signal){
  if(!env.EMBEDDING_BASE_URL)return null;
  try{
    const timeout=AbortSignal.timeout(10_000);
    const response=await fetch(endpoint(env,env.EMBEDDING_BASE_URL)+'/v1/embeddings',{method:'POST',headers:authHeaders(env),
      body:JSON.stringify({input:text,...(env.EMBEDDING_MODEL?{model:env.EMBEDDING_MODEL}:{})}),signal:signal?AbortSignal.any([signal,timeout]):timeout});
    if(!response.ok)return null;
    const vector=(await response.json()).data?.[0]?.embedding;
    return Array.isArray(vector)&&vector.length&&vector.every(Number.isFinite)?vector:null;
  }catch{return null;}
}
function sampling(env){
  const out={...OLLAMA_SAMPLING};
  if(env.LOCAL_TEMPERATURE!==undefined&&Number.isFinite(Number(env.LOCAL_TEMPERATURE)))out.temperature=Math.min(2,Math.max(0,Number(env.LOCAL_TEMPERATURE)));
  if(env.LOCAL_SEED!==undefined&&Number.isInteger(Number(env.LOCAL_SEED)))out.seed=Number(env.LOCAL_SEED);
  return out;
}
async function tokenCount(base,headers,signal,body){
  const response=await fetch(base+'/tokenize',{method:'POST',signal,headers,body:JSON.stringify(body)});
  const tokenized=await response.json();
  if(!response.ok||!Array.isArray(tokenized.tokens))throw new Error('Não foi possível contar os tokens do contexto local.');
  return tokenized.tokens.length;
}
// Reads llama.cpp server-sent events, reporting the accumulated text as it grows.
async function streamCompletion(response,onText){
  const decoder=new TextDecoder();let buffer='',text='',last={};
  for await(const chunk of response.body){
    buffer+=decoder.decode(chunk,{stream:true});
    let end;
    while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);
      if(!line.startsWith('data:'))continue;
      const event=JSON.parse(line.slice(5));
      if(event.error)throw new Error(event.error.message||'Executor local: erro durante a geração.');
      if(event.content){text+=event.content;onText(text);}
      last=event;
    }
  }
  return {...last,content:text};
}
export async function runLlama(prompt,env=process.env,externalSignal,{onText}={}){
  const started=performance.now(),model=env.LOCAL_MODEL||'llama3.2:3b';
  const timeout=AbortSignal.timeout(Number(env.LOCAL_TIMEOUT_MS||120000));
  const signal=externalSignal?AbortSignal.any([timeout,externalSignal]):timeout;
  try{
    const format=typeof prompt==='string'?PROMPT_FORMATS[env.LOCAL_PROMPT_FORMAT]:null;
    const messages=Array.isArray(prompt)?prompt:[{role:'user',content:prompt}];
    const maxOutput=Math.min(8192,Math.max(128,Number(env.LOCAL_MAX_OUTPUT_TOKENS)||2048));
    const headers=authHeaders(env),base=endpoint(env),context=Number(env.LOCAL_CONTEXT_TOKENS)||8192;
    // UTF-8 bytes are a conservative upper bound for text tokens. For larger
    // prompts, ask the actual model tokenizer instead of silently losing input.
    const byteBound=messages.reduce((n,m)=>n+Buffer.byteLength(m.content,'utf8')+32,64);
    if(byteBound+maxOutput>context){
      let used;
      if(format)used=await tokenCount(base,headers,signal,{content:format(prompt),add_special:true,parse_special:true});
      else{
        const template=await fetch(base+'/apply-template',{method:'POST',signal,headers,body:JSON.stringify({messages,chat_template_kwargs:{enable_thinking:false}})});
        const formatted=await template.json();
        if(!template.ok||typeof formatted.prompt!=='string')throw new Error('Não foi possível verificar o tamanho do contexto local.');
        used=await tokenCount(base,headers,signal,{content:formatted.prompt,add_special:false,parse_special:true});
      }
      if(used+maxOutput+32>context)return {ok:false,status:413,error:'O contexto excede a janela do modelo no Quest. Divida o pedido ou abra uma nova conversa; nenhum conteúdo foi cortado.'};
    }
    const schema=env.LOCAL_OUTPUT_SCHEMA?JSON.parse(env.LOCAL_OUTPUT_SCHEMA):env.LOCAL_OUTPUT_FORMAT==='json'?{type:'object'}:null;
    let text,usage=null,truncated,timings,cached=null;
    if(format){
      const stream=typeof onText==='function';
      const response=await fetch(base+'/completion',{method:'POST',signal,headers,body:JSON.stringify({
        prompt:format(prompt),n_predict:maxOutput,cache_prompt:true,stream,...sampling(env),...(schema?{json_schema:schema}:{})})});
      if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error?.message||`Executor local: HTTP ${response.status}`);}
      const data=stream?await streamCompletion(response,onText):await response.json();
      text=data.content;truncated=data.stop_type==='limit'||data.stopped_limit===true;timings=data.timings;
      if(Number.isFinite(data.tokens_evaluated)&&Number.isFinite(data.tokens_predicted))usage={input_tokens:data.tokens_evaluated,output_tokens:data.tokens_predicted};
      cached=Number.isFinite(data.tokens_cached)?data.tokens_cached:null;
    }else{
      const response=await fetch(base+'/v1/chat/completions',{method:'POST',signal,headers,body:JSON.stringify({
        model,messages,stream:false,cache_prompt:true,max_tokens:maxOutput,chat_template_kwargs:{enable_thinking:false},...sampling(env),
        ...(env.LOCAL_OUTPUT_SCHEMA?{response_format:{type:'json_schema',json_schema:{name:'harness',strict:true,schema}}}:schema?{response_format:{type:'json_object'}}:{})})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error?.message||`Executor local: HTTP ${response.status}`);
      const choice=data.choices?.[0];
      text=choice?.message?.content;truncated=choice?.finish_reason==='length';timings=data.timings;
      if(data.usage)usage={input_tokens:data.usage.prompt_tokens,output_tokens:data.usage.completion_tokens};
      cached=data.usage?.prompt_tokens_details?.cached_tokens??null;
    }
    if(typeof text!=='string'||!text.trim())throw new Error('O executor local retornou uma resposta vazia.');
    return {ok:true,status:200,text,threadId:null,usage,truncated,metrics:{model,wallMs:performance.now()-started,engine:'llama.cpp',device:'quest',
      promptMs:timings?.prompt_ms??null,generationMs:timings?.predicted_ms??null,promptTokensPerSecond:timings?.prompt_per_second??null,
      outputTokensPerSecond:timings?.predicted_per_second??null,cachedInputTokens:cached}};
  }catch(error){return {ok:false,status:502,error:externalSignal?.aborted?'Cancelado pelo usuário.':error.message,cancelled:!!externalSignal?.aborted,metrics:{model,wallMs:performance.now()-started}};}
}

// Agent turns on llama-server (OpenAI-compatible /v1/chat/completions with
// tools; start it with --jinja). The agent speaks Ollama's message format,
// so tool calls get ids here and tool results are matched back to them.
export function toOpenAiMessages(messages){
  const pending=[];let n=0;
  return messages.map((m)=>{
    if(m.role==='assistant'&&Array.isArray(m.tool_calls)&&m.tool_calls.length){
      const tool_calls=m.tool_calls.map((c)=>{const id=`call_${++n}`;pending.push(id);return {id,type:'function',function:{name:c.function?.name,arguments:typeof c.function?.arguments==='string'?c.function.arguments:JSON.stringify(c.function?.arguments||{})}};});
      return {role:'assistant',content:m.content||'',tool_calls};
    }
    if(m.role==='tool')return {role:'tool',tool_call_id:pending.shift()||`call_${++n}`,content:String(m.content??'')};
    return {role:m.role,content:String(m.content??'')};
  });
}
export async function runLlamaChat(messages,tools=[],env=process.env,externalSignal){
  const started=performance.now(),model=env.LOCAL_MODEL||'local';
  const timeout=AbortSignal.timeout(Number(env.LOCAL_TIMEOUT_MS||120000));
  const signal=externalSignal?AbortSignal.any([timeout,externalSignal]):timeout;
  try{
    const response=await fetch(endpoint(env)+'/v1/chat/completions',{method:'POST',signal,headers:authHeaders(env),body:JSON.stringify({
      model,messages:toOpenAiMessages(messages),stream:false,cache_prompt:true,
      max_tokens:Math.min(8192,Math.max(128,Number(env.LOCAL_MAX_OUTPUT_TOKENS)||2048)),
      chat_template_kwargs:{enable_thinking:env.LOCAL_THINK==='true'},
      ...(env.LOCAL_THINK==='true'?{}:{reasoning_effort:'low'}),
      ...(tools.length?{tools,tool_choice:'auto'}:{}),...sampling(env)})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const error=data.error?.message||`Executor local: HTTP ${response.status}`;
      return {ok:false,status:502,unsupported:/tools? (is )?not supported|jinja/i.test(error),error,metrics:{model,wallMs:performance.now()-started,engine:'llama.cpp'}};
    }
    const choice=data.choices?.[0],message=choice?.message||{};
    const toolCalls=(message.tool_calls||[]).map((c)=>{let args={};try{args=typeof c.function?.arguments==='string'?JSON.parse(c.function.arguments||'{}'):c.function?.arguments||{};}catch{args={};}return {name:c.function?.name,arguments:args};}).filter((c)=>c.name);
    const text=typeof message.content==='string'?message.content:'';
    const usage=data.usage?{input_tokens:data.usage.prompt_tokens,output_tokens:data.usage.completion_tokens}:null;
    const timings=data.timings;
    const metrics={model,wallMs:performance.now()-started,engine:'llama.cpp',promptMs:timings?.prompt_ms??null,generationMs:timings?.predicted_ms??null,
      promptTokensPerSecond:timings?.prompt_per_second??null,outputTokensPerSecond:timings?.predicted_per_second??null,cachedInputTokens:data.usage?.prompt_tokens_details?.cached_tokens??null};
    if(!toolCalls.length&&!text.trim())return {ok:false,status:502,error:'O modelo local retornou uma resposta vazia ou inválida.',usage,metrics};
    return {ok:true,status:200,text,toolCalls,threadId:null,usage,metrics,truncated:choice?.finish_reason==='length'};
  }catch(error){return {ok:false,status:502,error:externalSignal?.aborted?'Cancelado pelo usuário.':error.message,cancelled:!!externalSignal?.aborted,metrics:{model,wallMs:performance.now()-started,engine:'llama.cpp'}};}
}
