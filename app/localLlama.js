// Android execution adapter. Context, memory, correction and persistence stay in Harness.
function endpoint(env){
  const url=new URL(env.LOCAL_BASE_URL||'http://127.0.0.1:18080');
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('O executor embarcado deve usar loopback.');
  return url.origin;
}
export async function llamaReady(env=process.env){
  try{return (await fetch(endpoint(env)+'/health',{signal:AbortSignal.timeout(3000)})).ok;}catch{return false;}
}
export async function runLlama(prompt,env=process.env,externalSignal){
  const started=performance.now(),model=env.LOCAL_MODEL||'qwen3.5:0.8b';
  const timeout=AbortSignal.timeout(Number(env.LOCAL_TIMEOUT_MS||120000));
  const signal=externalSignal?AbortSignal.any([timeout,externalSignal]):timeout;
  try{
    const messages=Array.isArray(prompt)?prompt:[{role:'user',content:prompt}];
    const maxOutput=Math.min(2048,Math.max(64,Number(env.LOCAL_MAX_OUTPUT_TOKENS)||384));
    const headers={'content-type':'application/json',...(env.LOCAL_API_KEY?{authorization:`Bearer ${env.LOCAL_API_KEY}`}:{})};
    const base=endpoint(env),context=Number(env.LOCAL_CONTEXT_TOKENS)||4096;
    // UTF-8 bytes are a conservative upper bound for text tokens. For larger
    // prompts, ask the actual model tokenizer instead of silently losing input.
    const byteBound=messages.reduce((n,m)=>n+Buffer.byteLength(m.content,'utf8')+32,64);
    if(byteBound+maxOutput>context){
      const template=await fetch(base+'/apply-template',{method:'POST',signal,headers,body:JSON.stringify({messages,chat_template_kwargs:{enable_thinking:false}})});
      const formatted=await template.json();
      if(!template.ok||typeof formatted.prompt!=='string')throw new Error('Não foi possível verificar o tamanho do contexto local.');
      const count=await fetch(base+'/tokenize',{method:'POST',signal,headers,body:JSON.stringify({content:formatted.prompt,add_special:false,parse_special:true})});
      const tokenized=await count.json();
      if(!count.ok||!Array.isArray(tokenized.tokens))throw new Error('Não foi possível contar os tokens do contexto local.');
      if(tokenized.tokens.length+maxOutput+32>context)return {ok:false,status:413,error:'O contexto excede a janela do modelo no Quest. Divida o pedido ou abra uma nova conversa; nenhum conteúdo foi cortado.'};
    }
    const response=await fetch(base+'/v1/chat/completions',{method:'POST',signal,headers,body:JSON.stringify({
      model,messages,stream:false,cache_prompt:true,
      max_tokens:maxOutput,
      temperature:Number(env.LOCAL_TEMPERATURE??.5),chat_template_kwargs:{enable_thinking:false},
      ...(env.LOCAL_SEED!==undefined?{seed:Number(env.LOCAL_SEED)}:{}),
      ...(env.LOCAL_OUTPUT_SCHEMA?{response_format:{type:'json_schema',json_schema:{name:'harness',strict:true,schema:JSON.parse(env.LOCAL_OUTPUT_SCHEMA)}}}:env.LOCAL_OUTPUT_FORMAT==='json'?{response_format:{type:'json_object'}}:{})
    })});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error?.message||`Executor local: HTTP ${response.status}`);
    const choice=data.choices?.[0],text=choice?.message?.content;
    if(typeof text!=='string'||!text.trim())throw new Error('O executor local retornou uma resposta vazia.');
    return {ok:true,status:200,text,threadId:null,usage:data.usage?{input_tokens:data.usage.prompt_tokens,output_tokens:data.usage.completion_tokens}:null,
      truncated:choice.finish_reason==='length',metrics:{model,wallMs:performance.now()-started,engine:'llama.cpp',device:'quest',
        promptMs:data.timings?.prompt_ms??null,generationMs:data.timings?.predicted_ms??null,promptTokensPerSecond:data.timings?.prompt_per_second??null,
        outputTokensPerSecond:data.timings?.predicted_per_second??null,cachedInputTokens:data.usage?.prompt_tokens_details?.cached_tokens??null}};
  }catch(error){return {ok:false,status:502,error:externalSignal?.aborted?'Cancelado pelo usuário.':error.message,cancelled:!!externalSignal?.aborted,metrics:{model,wallMs:performance.now()-started}};}
}
