export function rankDevelopmentCheckpoints(manifest,results){
 const expected=new Set(manifest.development.tasks.flatMap(t=>manifest.development.seeds.map(seed=>`${t.id}/${seed}`)));
 if(results.length!==2||new Set(results.map(r=>r.arm)).size!==2||results.some(r=>!['e1','e2'].includes(r.arm)))throw Error('Both predefined checkpoints required');
 const ranked=results.map(r=>{
  if(r.phase!=='dev'||r.model!==manifest.models[r.arm]||!Array.isArray(r.records)||r.records.length!==expected.size||new Set(r.records.map(x=>`${x.id}/${x.seed}`)).size!==expected.size||r.records.some(x=>x.phase!=='dev'||x.model!==r.model||!expected.has(`${x.id}/${x.seed}`)||!Number.isFinite(x.estimatedTokens)||x.estimatedTokens<0||!Number.isFinite(x.tokens)||x.tokens<0||x.tokens+x.estimatedTokens<=0||(x.estimatedTokens>0&&x.passed)))throw Error('Only complete development outcomes can select checkpoints');
  if(!Array.isArray(r.retention)||r.retention.length!==4)throw Error('Retention evidence missing');
  const measuredTokens=r.records.reduce((s,x)=>s+x.tokens,0),estimatedTokens=r.records.reduce((s,x)=>s+x.estimatedTokens,0);
  // A model abort remains a failure; its reserved budget is not a free retry.
  // Final promotion still requires fully measured usage in release-gate.mjs.
  return {...r,passed:r.records.filter(x=>x.passed).length,retentionPassed:r.retention.filter(x=>x.passed).length,measuredTokens,estimatedTokens,tokens:measuredTokens+estimatedTokens};
 });
 return ranked.sort((a,b)=>b.passed-a.passed||b.retentionPassed-a.retentionPassed||a.tokens-b.tokens||a.arm.localeCompare(b.arm));
}
