// Post-hoc validator audit, preserving the original scores and every model artifact.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {heldout} from '../training/heldout-v2.mjs';
import {diagnoseLocalArtifact} from '../../app/localDiagnostics.js';
const root=resolve('reports/ssd-semantic-review-v1'),sha=x=>createHash('sha256').update(x).digest('hex');
await mkdir(join(root,'source'),{recursive:true});
const original=await readFile('app/functionalTests.js','utf8');let adapted=original;
function replaceExactly(before,after){if(adapted.split(before).length!==2)throw Error('Review adapter requires exactly one match: '+before);adapted=adapted.replace(before,after);}
replaceExactly("'browser-contract-v1'","'browser-contract-semantic-review-v1'");
replaceExactly('{ signal, timeoutMs = 15000 } = {}','{ signal, timeoutMs = 15000, optionalDisabledClicks = [] } = {}');
replaceExactly("else if (a.op === 'click') await locator.click({ timeout });", "else if (a.op === 'click') { if (optionalDisabledClicks.some(x => x.caseId === c.id && x.action === index && x.selector === a.selector) && await locator.isDisabled({ timeout })) result.observed = 'Botão desabilitado após a chegada; nenhuma ação executada.'; else await locator.click({ timeout }); }");
replaceExactly('const text = textValue(await locator.innerText({ timeout }));', "const inputNumber = a.op === 'assertNumber' && await locator.evaluate(e => e.matches('input, textarea, select'));\n                  const text = textValue(inputNumber ? await locator.inputValue({ timeout }) : await locator.innerText({ timeout }));");
replaceExactly("if (!assertion(a.op)) result.observed = 'ação executada';", "if (!assertion(a.op) && result.observed === null) result.observed = 'ação executada';");
const manifest={createdAt:new Date().toISOString(),originalHash:sha(original),adaptedHash:sha(adapted),scriptHash:sha(await readFile('scripts/benchmark/ssd-semantic-review.mjs')),scope:'Post-hoc audit of saved artifacts. All three models rechecked under identical changes. No regeneration, artifact repair or replacement of primary scores.',changes:[
 'Read the displayed value of input/textarea/select for numeric assertions; preserve the complete-number parser and tolerances.',
 'Only race-finish action 5 (the extra click after reaching the finish) may be a no-op when the native button is disabled. Earlier clicks remain mandatory; distance/status/reset assertions unchanged.',
 'Only prefix-search final list text is checked among visible rows. Also verify the visible count after every search, preserving literal-text checks elsewhere.'
]};
await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
await writeFile(join(root,'source','functionalTests.original.mjs'),original);
await writeFile(join(root,'source','functionalTests.review.mjs'),adapted);
const {runFunctionalCases}=await import(pathToFileURL(join(root,'source','functionalTests.review.mjs')).href);
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
function contractFor(t){
 const contract=structuredClone(t.contract);
 if(t.id==='prefix-search'){
  for(const c of contract.cases){
   c.actions=c.actions.flatMap(a=>a.op==='assertText'&&a.selector==='#list li'?[{op:'assertNumber',selector:'#count',expected:1,locale:'en-US',tolerance:.001},{...a,selector:'#list li:visible'}]:[a]);
  }
 }
 return contract;
}
async function check(t,artifact){
 const diagnostics=diagnoseLocalArtifact(artifact);
 if(diagnostics.issues.length)return {passed:false,diagnostics};
 const functional=await runFunctionalCases(browser,artifact,contractFor(t),{optionalDisabledClicks:t.id==='race-finish'?[{caseId:'c0',action:5,selector:'#advance'}]:[]});
 return {passed:functional.passedCases.length===functional.totalCases,functional};
}
try{
 const controls=[];
 for(const t of heldout){const result=await check(t,t.reference);controls.push({id:t.id,expected:true,result});if(!result.passed)throw Error('Reference failed '+t.id);}
 const race=heldout.find(t=>t.id==='race-finish'),prefix=heldout.find(t=>t.id==='prefix-search'),units=heldout.find(t=>t.id==='break-even');
 const negative=[{task:race,artifact:race.reference.replace('id="advance"','id="advance" disabled'),id:'premature-disabled'},
  {task:prefix,artifact:prefix.reference.replace("'Lua'","'Luz'"),id:'wrong-visible-text'},
  {task:units,artifact:units.reference.replace('Math.ceil','Math.floor'),id:'wrong-rounding'}];
 for(const n of negative){const result=await check(n.task,n.artifact);controls.push({id:n.id,expected:false,result});if(result.passed)throw Error('Negative control accepted '+n.id);}
 await writeFile(join(root,'controls.json'),JSON.stringify(controls,null,2));
 const summaries=[];
 for(const arm of ['old','current','moe']){
  const source=resolve('reports/ssd-quality-control-v1',arm,'runs'),records=[];
  for(const file of (await readdir(source)).filter(f=>f.endsWith('.json'))){
   const r=JSON.parse(await readFile(join(source,file),'utf8')),t=heldout.find(t=>t.id===r.id),step=r.workflow.steps[0],first=step.history?.find(h=>h.attempt===1)?.artifact;
   const final=await check(t,step.artifact||''),initial=first?(first===step.artifact?final:await check(t,first)):null;
   records.push({id:r.id,seed:r.seed,domain:r.domain,originalPassed:r.passed,firstArtifactHash:first?sha(first):null,finalArtifactHash:sha(step.artifact||''),first:initial,final,
    redundantRepair:!!initial?.passed&&r.calls>1,postFirstTokens:r.trace.slice(1).reduce((s,t)=>s+(t.response.usage?.input_tokens||0)+(t.response.usage?.output_tokens||0),0)});
  }
  const summary={arm,total:records.length,originalPassed:records.filter(r=>r.originalPassed).length,reviewPassed:records.filter(r=>r.final.passed).length,firstReviewPassed:records.filter(r=>r.first?.passed).length,redundantRepairCases:records.filter(r=>r.redundantRepair).length,
   tokensSpentAfterAlreadyCorrectFirst:records.filter(r=>r.redundantRepair).reduce((s,r)=>s+r.postFirstTokens,0),records};
  await writeFile(join(root,arm+'.json'),JSON.stringify(summary,null,2));summaries.push({...summary,records:undefined});console.log(JSON.stringify({...summary,records:undefined}));
 }
 await writeFile(join(root,'summary.json'),JSON.stringify({manifest,summaries},null,2));
}finally{await browser.close();}
