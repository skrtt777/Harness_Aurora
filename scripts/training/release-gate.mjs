// Pure acceptance gate. Criteria are frozen before candidate evaluation.
export function decideRelease(manifest,baseline,candidate,control){
 const expected=new Set(manifest.tasks.flatMap(t=>manifest.seeds.map(s=>`${t.id}/${s}`)));
 const complete=r=>Array.isArray(r?.records)&&r.records.length===expected.size&&new Set(r.records.map(x=>`${x.id}/${x.seed}`)).size===expected.size&&r.records.every(x=>expected.has(`${x.id}/${x.seed}`)&&typeof x.passed==='boolean'&&Number.isFinite(x.tokens)&&x.tokens>0&&x.estimatedTokens===0&&x.trace.length>0&&x.trace.every(t=>Number.isFinite(t.response.usage?.input_tokens)&&Number.isFinite(t.response.usage?.output_tokens)));
 if(!complete(baseline)||!complete(candidate))return {passed:false,checks:[{name:'Evidência completa',passed:false}],reason:'Resultados ausentes, duplicados ou uso incompleto.'};
 const stats=r=>({passed:r.records.filter(x=>x.passed).length,total:r.records.length,tokens:r.records.reduce((s,x)=>s+x.tokens,0),elapsedMs:r.records.reduce((s,x)=>s+x.elapsedMs,0),calls:r.records.reduce((s,x)=>s+x.calls,0),retentionPassed:r.retention.filter(x=>x.passed).length});
 const b=stats(baseline),c=stats(candidate),gainPoints=100*(c.passed/c.total-b.passed/b.total),tokenRatio=c.tokens/b.tokens;
 const domains=[...new Set(manifest.tasks.map(t=>t.domain))];
 const domainResults=domains.map(domain=>({domain,baseline:baseline.records.filter(r=>r.domain===domain&&r.passed).length,candidate:candidate.records.filter(r=>r.domain===domain&&r.passed).length,total:manifest.tasks.filter(t=>t.domain===domain).length*manifest.seeds.length}));
 const canonical=control?.summary?.find(x=>x.model==='aurora-control:1.5b-v1'),adapted=control?.summary?.find(x=>x.model===manifest.candidate);
 const samePrompts=candidate.records.every(r=>r.trace[0].prompt===baseline.records.find(b=>b.id===r.id&&b.seed===r.seed)?.trace[0].prompt);
 const checks=[
  {name:'Mesmos pedidos e orçamento',passed:samePrompts},
  {name:'Pelo menos 70% dos cenários',passed:c.passed/c.total>=manifest.gate.minimumPassRate},
  {name:'Ganho de pelo menos 15 pontos percentuais',passed:gainPoints>=manifest.gate.minimumGainPoints},
  {name:'Nenhuma área piora',passed:domainResults.every(d=>d.candidate>=d.baseline)},
  {name:'Retenção de respostas e JSON',passed:c.retentionPassed>=manifest.gate.minimumRetentionPassed&&c.retentionPassed>=b.retentionPassed},
  {name:'Tokens até 120% da base',passed:tokenRatio<=manifest.gate.maxTokenRatio},
  {name:'Melhora frente à base com a mesma conversão',passed:!!canonical&&!!adapted&&canonical.total===expected.size&&adapted.total===expected.size&&adapted.passed>canonical.passed}
 ];
 return {passed:checks.every(c=>c.passed),checks,baseline:b,candidate:c,domains:domainResults,gainPoints,tokenRatio,control:control?.summary||[],reason:checks.every(c=>c.passed)?'Critérios experimentais atingidos.':'Candidato experimental: não substituir o modelo estável.'};
}
