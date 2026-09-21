import {simple} from 'acorn-walk';
import {parseJavaScript} from './jsSandbox.js';
import {getDb} from './db.js';
import {digest,importSkill,enableSkill,readSkill,skillReferences,skillCompatibility,skillInScope} from './skills.js';
import {httpError} from './httpSecurity.js';

export const ENGINE_VERSION='evidence-engine-v1';
// Narrow, auditable hypotheses, not unconditional rewrites. Every candidate must
// be tested against the unchanged functional contract before it can be adopted.
export function proposeDeterministicRepairs(source) {
  const candidates=[],seen=new Set();
  for(const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(/\bsrc\s*=|\btype\s*=/i.test(match[1]))continue;
    const js=match[2],offset=match.index+match[0].indexOf('>')+1;let ast;
    try{ast=parseJavaScript(js);}catch{continue;}
    const vars=[],assignments=[],conditions=[],calls=[],statements=[],mutable=new Set();
    simple(ast,{VariableDeclarator:n=>vars.push(n),VariableDeclaration:n=>{if(n.kind!=='const')for(const d of n.declarations)if(d.id.name)mutable.add(d.id.name);},AssignmentExpression:n=>assignments.push(n),ConditionalExpression:n=>conditions.push(n),CallExpression:n=>calls.push(n),ExpressionStatement:n=>statements.push(n)});
    const code=n=>js.slice(n.start,n.end);
    const add=(node,replacement,kind)=>{
      if(replacement===code(node))return;
      const text=source.slice(0,offset+node.start)+replacement+source.slice(offset+node.end),hash=digest(text);
      if(!seen.has(hash)&&candidates.length<6){seen.add(hash);candidates.push({kind,text,hash});}
    };
    for(const n of conditions){
      if(n.test.type!=='Identifier')continue;
      simple(n.consequent,{BinaryExpression:b=>{if(b.operator==='/'&&b.right.type==='Identifier'&&b.right.name!==n.test.name)add(b.right,n.test.name,'guarded-denominator');}});
    }
    for(const n of assignments){
      if(n.right.type!=='Literal'||n.right.value!==0||n.left.type!=='MemberExpression'||!['textContent','innerText'].includes(n.left.property.name))continue;
      const alias=assignments.find(a=>code(a.left)===code(n.left)&&a.right.type==='Identifier'&&mutable.has(a.right.name));
      if(alias)add(n,`(${alias.right.name}=0,${code(n)})`,'reset-state-and-display');
    }
    for(const v of vars){
      if(v.id.type!=='Identifier'||v.init?.type!=='CallExpression')continue;
      const reads=[];simple(v.init,{CallExpression:n=>{if(n.callee.type==='MemberExpression'&&n.callee.object.name==='localStorage'&&n.callee.property.name==='getItem'&&typeof n.arguments[0]?.value==='string')reads.push(n.arguments[0].value);}});
      for(const key of reads){
        if(calls.some(n=>n.callee.type==='MemberExpression'&&n.callee.object.name==='localStorage'&&n.callee.property.name==='setItem'&&n.arguments[0]?.value===key))continue;
        for(const stmt of statements){const n=stmt.expression;if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.object.name===v.id.name&&['push','splice','pop','shift','unshift'].includes(n.callee.property.name))add(stmt,code(stmt)+`;localStorage.setItem(${JSON.stringify(key)},JSON.stringify(${v.id.name}));`,'persist-mutated-state');}
      }
    }
    for(const call of calls){
      if(call.callee.type!=='MemberExpression'||call.callee.property.name!=='filter'||call.callee.object.type!=='Identifier')continue;
      const fn=call.arguments[0],body=fn?.body,param=fn?.params?.[0]?.name;
      if(!param||body?.type!=='LogicalExpression'||body.operator!=='&&'||body.left.type!=='Literal'||body.left.value!==true)continue;
      const data=vars.find(v=>v.id.name===call.callee.object.name&&v.init?.type==='ArrayExpression');
      if(!data)continue;
      const fields=new Map();for(const row of data.init.elements){if(row?.type!=='ObjectExpression')continue;for(const p of row.properties){const k=p.key?.name||p.key?.value;if(typeof k==='string'&&/^[a-zA-Z_$][\w$]*$/.test(k)&&typeof p.value?.value==='string'){if(!fields.has(k))fields.set(k,new Set());fields.get(k).add(p.value.value);}}}
      for(const v of vars){
        const init=v.init,lookup=init?.object;
        if(v.id.type!=='Identifier'||init?.type!=='MemberExpression'||init.property.name!=='value'||lookup?.type!=='CallExpression'||lookup.callee.object?.name!=='document'||lookup.callee.property?.name!=='getElementById')continue;
        const id=lookup.arguments[0]?.value;if(typeof id!=='string'||!/^[\w-]+$/.test(id))continue;
        const select=[...source.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)].find(m=>new RegExp(`\\bid=["']${id}["']`).test(m[1]));if(!select)continue;
        const options=[...select[2].matchAll(/<option\b([^>]*)>([^<]*)<\/option>/gi)].map(m=>m[1].match(/\bvalue=["']([^"']*)["']/i)?.[1]??m[2].trim());
        for(const [field,values] of fields){const matches=options.filter(o=>values.has(o));const sentinel=options.find(o=>!values.has(o));if(matches.length<2||sentinel===undefined)continue;add(body.left,`(${v.id.name}===${JSON.stringify(sentinel)}||${param}.${field}===${v.id.name})`,'compose-category-filter');}
      }
    }
  }
  return candidates;
}
export function repairTargets(source) {
  const targets=[];
  for(const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if(/\bsrc\s*=|\btype\s*=\s*["'](?:importmap|application\/json)/i.test(match[1]))continue;
    const offset=match.index+match[0].indexOf('>')+1,js=match[2];
    let ast;try{ast=parseJavaScript(js);}catch{continue;}
    const add=(node,label)=>{if(node.end-node.start>5000)return;targets.push({id:'t'+(targets.length+1),label,start:offset+node.start,end:offset+node.end,code:js.slice(node.start,node.end)});};
    simple(ast,{VariableDeclarator(n){if(n.init&&n.id.type==='Identifier')add(n.init,'valor de '+n.id.name);},AssignmentExpression(n){add(n,js.slice(n.left.start,n.left.end));},FunctionDeclaration(n){add(n,'função '+n.id?.name);}});
  }
  return {version:ENGINE_VERSION,artifactHash:digest(source),targets:targets.slice(0,60)};
}
export function applyTargetEdits(source,response,packet) {
  if(digest(source)!==packet.artifactHash)return {ok:false,reason:'stale_artifact'};
  let value;try{value=JSON.parse(String(response).trim().replace(/^```(?:json)?\s*\n/,'').replace(/\n```\s*$/,''));}catch{return {ok:false,reason:'invalid_edit_json'};}
  if(!Array.isArray(value.replacements)||value.replacements.length<1||value.replacements.length>3)return {ok:false,reason:'invalid_replacements'};
  const edits=[];
  for(const r of value.replacements){
    const target=packet.targets.find(t=>t.id===r.id);
    if(!target||typeof r.code!=='string'||r.code.length>6000||!r.code.trim()||r.code===target.code||/<\/?script\b/i.test(r.code))return {ok:false,reason:'invalid_target_or_code'};
    edits.push({...target,after:r.code});
  }
  edits.sort((a,b)=>a.start-b.start);
  if(edits.some((e,i)=>i>0&&e.start<edits[i-1].end))return {ok:false,reason:'overlapping_targets'};
  let text=source;for(const e of [...edits].reverse())text=text.slice(0,e.start)+e.after+text.slice(e.end);
  return {ok:true,text,edits};
}
async function ready(){
  const db=await getDb();
  db.exec('CREATE TABLE IF NOT EXISTS engine_knowledge(id TEXT PRIMARY KEY,document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS engine_references(cache_key TEXT PRIMARY KEY,text TEXT NOT NULL);');
  return db;
}
export async function loadRequestedReference(request,options,scope) {
  if(!request||typeof request.id!=='string'||typeof request.resource!=='string')throw httpError(400,'Solicitação de referência inválida.');
  const option=options.find(s=>s.id===request.id&&s.resources.includes(request.resource));
  if(!option)throw httpError(400,'Referência fora do índice selecionado para esta etapa.');
  const skill=await readSkill(request.id);
  if(!skill.enabled||skill.hash!==option.hash||!skillInScope(skill,scope)||skillCompatibility(skill).status==='blocked')throw httpError(409,'Skill indisponível ou alterada; prepare novamente a etapa.');
  const db=await ready(),key=digest([skill.hash,skill.source,request.resource].join('\0'));
  const immutable=/^(catalog:github:|hermes:)/.test(skill.source),cached=immutable?db.prepare('SELECT text FROM engine_references WHERE cache_key=?').get(key):null;
  const text=cached?.text??(await readSkill(request.id,request.resource)).text;
  if(text.length>5000)throw httpError(413,'Referência excede 5.000 caracteres; use uma referência menor.');
  if(immutable&&!cached)db.prepare('INSERT OR IGNORE INTO engine_references VALUES(?,?)').run(key,text);
  return {id:skill.id,hash:skill.hash,resource:request.resource,text,cached:!!cached,contentHash:digest(text)};
}
const assertions=v=>(v?.functional?.results||[]).filter(r=>r.op?.startsWith('assert')&&r.status==='passed');
export async function captureVerifiedRepair(job,step,before) {
  if(!before||before.validation?.status!=='failed'||step.validation?.status!=='passed'||step.testsSource!=='request'||!assertions(step.validation).length||!before.validation?.functional||digest(step.artifact)!==step.artifactHash)return null;
  const oldChecks=new Set(assertions(before.validation).map(r=>r.caseId+':'+r.action));
  const nextChecks=new Set(assertions(step.validation).map(r=>r.caseId+':'+r.action));
  if([...oldChecks].some(k=>!nextChecks.has(k)))return null;
  let start=0;while(start<before.artifact.length&&before.artifact[start]===step.artifact[start])start++;
  let a=before.artifact.length,b=step.artifact.length;while(a>start&&b>start&&before.artifact[a-1]===step.artifact[b-1]){a--;b--;}
  const left=Math.max(0,start-100),old=before.artifact.slice(left,Math.min(before.artifact.length,a+100)),fixed=step.artifact.slice(left,Math.min(step.artifact.length,b+100));
  if(old.length>2400||fixed.length>2400)return null;
  const scope=job.projectId?{projectId:job.projectId}:{conversationId:job.conversationId};
  const id=digest(JSON.stringify({scope,old,fixed})),db=await ready();
  const row=db.prepare('SELECT document FROM engine_knowledge WHERE id=?').get(id);
  const record=row?JSON.parse(row.document):{id,status:'candidate',scope,createdAt:new Date().toISOString(),title:step.title,goal:job.goal,old,fixed,evidence:[],version:1};
  const proof={workflowId:job.id,stepId:step.id,beforeHash:digest(before.artifact),afterHash:step.artifactHash,testsHash:step.testsHash,validator:step.validation.validator,checks:nextChecks.size,at:new Date().toISOString()};
  if(!record.evidence.some(p=>p.workflowId===proof.workflowId&&p.afterHash===proof.afterHash))record.evidence.push(proof);
  db.prepare('INSERT OR REPLACE INTO engine_knowledge VALUES(?,?)').run(id,JSON.stringify(record));
  return id;
}
export async function listEngineKnowledge(){return (await ready()).prepare('SELECT document FROM engine_knowledge').all().map(r=>JSON.parse(r.document));}
export async function reviewEngineKnowledge(id,accepted) {
  if(typeof accepted!=='boolean')throw httpError(400,'Revisão inválida.');
  const db=await ready(),row=db.prepare('SELECT document FROM engine_knowledge WHERE id=?').get(id);
  if(!row)throw httpError(404,'Conhecimento não encontrado.');
  const record=JSON.parse(row.document);
  if(!record.evidence.length)throw httpError(409,'Sem evidência verificável.');
  if(accepted){
    const text=`---\nname: learned-${id.slice(0,12)}\ndescription: ${JSON.stringify(record.goal.slice(0,700))}\nmetadata:\n  aurora:\n    scope: ${JSON.stringify(record.scope)}\n---\nCorreção observada e testada em um caso; não é regra universal. Confirme pertinência antes de adaptar. Preserve as verificações existentes.\nAntes:\n${record.old}\nDepois:\n${record.fixed}\nReproduza o defeito, aplique somente a mudança pertinente e valide com os testes da tarefa atual. Não copie dados nem valores de exemplo se o pedido for diferente.`;
    record.skill=await importSkill(text,'engine:'+id);await enableSkill(record.skill.id,true);record.status='active';
  }else{if(record.skill)await enableSkill(record.skill.id,false);record.status='rejected';}
  record.reviewedAt=new Date().toISOString();db.prepare('UPDATE engine_knowledge SET document=? WHERE id=?').run(JSON.stringify(record),id);return record;
}
export async function engineSummary() {
  const db=await ready(),knowledge=await listEngineKnowledge();
  const exists=db.prepare("SELECT name FROM sqlite_master WHERE name='workflows'").get();
  const jobs=exists?db.prepare('SELECT document FROM workflows').all().map(r=>JSON.parse(r.document)).filter(j=>j.engineVersion===ENGINE_VERSION):[];
  const attempted=jobs.filter(j=>j.steps.some(s=>s.artifact));
  const approved=attempted.filter(j=>j.steps.length&&j.steps.every(s=>s.validation?.status==='passed'&&s.testsSource==='request'&&s.validation?.functional));
  const measuredTokens=attempted.reduce((n,j)=>n+j.stats.inputTokens+j.stats.outputTokens,0),elapsedMs=attempted.reduce((n,j)=>n+j.stats.elapsedMs,0);
  return {version:ENGINE_VERSION,knowledge,metrics:{attempted:attempted.length,passedContracts:approved.length,humanAccepted:attempted.filter(j=>j.status==='completed').length,measuredTokens,estimatedTokens:attempted.reduce((n,j)=>n+j.stats.estimatedTokens,0),tokensPerPassed:approved.length?measuredTokens/approved.length:null,elapsedMs,references:attempted.reduce((n,j)=>n+(j.stats.referenceLoads||0),0),reuses:jobs.reduce((n,j)=>n+j.stats.reuses,0)}};
}
