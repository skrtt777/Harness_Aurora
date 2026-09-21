export function localCallRecord(result, stage='generate') {
  return {stage,ok:!!result.ok,usage:result.usage||null,metrics:result.metrics||null,truncated:!!result.truncated,error:result.error||null};
}
export function summarizeLocalCalls(calls) {
  const known=calls.filter(c=>Number.isFinite(c.usage?.input_tokens)&&Number.isFinite(c.usage?.output_tokens));
  const knownUsage=known.reduce((a,c)=>({input_tokens:a.input_tokens+c.usage.input_tokens,output_tokens:a.output_tokens+c.usage.output_tokens}),{input_tokens:0,output_tokens:0});
  return {version:1,calls,callCount:calls.length,completeUsage:known.length===calls.length,unknownUsageCalls:calls.length-known.length,knownUsage,wallMs:calls.reduce((n,c)=>n+(c.metrics?.wallMs||0),0)};
}
