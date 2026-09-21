import { parseJavaScript, constReassignments, runCodeInSandbox } from './jsSandbox.js';
import { simple } from 'acorn-walk';
import { createHash } from 'node:crypto';

export function artifactFingerprint(text) {
  const s=String(text||'').trim().replace(/^```html\s*\n/i,'').replace(/\n```\s*$/,'').replace(/\r\n/g,'\n').trim();
  return createHash('sha256').update(s).digest('hex');
}
export function diagnoseLocalArtifact(text) {
  const issues=[],source=String(text||''),scripts=[...source.matchAll(/<script(?![^>]*\bsrc\s*=)(?![^>]*\btype\s*=\s*["'](?:importmap|application\/json))[^>]*>([\s\S]*?)<\/script>/gi)];
  const document=source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  const ids=new Set([...document.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]));
  const dynamic=/\.id\s*=|setAttribute\s*\(\s*['"]id['"]|innerHTML\s*=|insertAdjacentHTML|document\.write/.test(scripts.map(m=>m[1]).join('\n'));
  for(const [index,m] of scripts.entries()){
    const js=m[1],target=`script[${index}]`;let ast;
    try {ast=parseJavaScript(js);}catch(e){issues.push({code:'syntax',target,expected:'JavaScript com sintaxe válida',observed:`Erro de sintaxe JavaScript: ${e.message}`,line:e.loc?.line});continue;}
    const constants=constReassignments(js);
    if(constants.length)issues.push({code:'const_assignment',target,expected:'Binding mutável para variáveis reatribuídas',observed:`Assignment to constant variable: ${constants.join(', ')}`,names:constants});
    if(scripts.length===1 && !constants.length){const d=runCodeInSandbox(js,source);if(d.crashed)issues.push({code:'static_analysis',target,expected:'Referências válidas na análise estática',observed:`A análise estática encontrou: ${d.error}`});}
    if(/<html[\s>]/i.test(source)&&!dynamic)simple(ast,{CallExpression(node){if(node.callee.type==='MemberExpression'&&node.callee.object.name==='document'&&node.callee.property.name==='getElementById'&&typeof node.arguments[0]?.value==='string'&&!ids.has(node.arguments[0].value))issues.push({code:'missing_dom_id',target:'#'+node.arguments[0].value,expected:'Elemento existente no documento antes do acesso',observed:`document.getElementById('${node.arguments[0].value}') não encontra um id no HTML estático`,line:node.loc.start.line});}});
  }
  return {level:'static',status:issues.length?'failed':'needs_functional_validation',issues,checkedScripts:scripts.length,limitation:'Análise estática não aprova controles, cálculos nem requisitos funcionais.'};
}
export function diagnosticText(diagnostics) {
  return diagnostics.issues.map(i=>`${i.code} em ${i.target}${i.line?' linha '+i.line:''}: esperado ${i.expected}; observado ${i.observed}`).join('\n');
}
export function repairContext(source, diagnostics) {
  const scripts=[...source.matchAll(/<script(?![^>]*\bsrc\s*=)(?![^>]*\btype\s*=\s*["'](?:importmap|application\/json))[^>]*>([\s\S]*?)<\/script>/gi)];
  const targets=new Set(diagnostics.issues.map(i=>Number(i.target.match(/^script\[(\d+)\]$/)?.[1])).filter(Number.isInteger));
  if(diagnostics.issues.some(i=>i.code==='missing_dom_id'))return source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'<!-- CSS preservado; não editar -->');
  const selected=[...targets].map(i=>scripts[i]?.[0]).filter(Boolean);
  return selected.length?selected.join('\n\n'):source;
}
export function applyLocalEdits(original, response) {
  let value;try{value=JSON.parse(String(response).trim().replace(/^```(?:json)?\s*\n/,'').replace(/\n```\s*$/,''));}catch{return {ok:false,reason:'invalid_edit_json'};}
  if(!Array.isArray(value.edits)||value.edits.length<1||value.edits.length>3)return {ok:false,reason:'invalid_edit_count'};
  // Resolve all targets against the original; overlapping edits are rejected.
  const patches=[];
  for(const e of value.edits){if(typeof e.before!=='string'||typeof e.after!=='string'||!e.before.trim()||e.before.length>6000||e.after.length>6000||e.before===e.after)return {ok:false,reason:'invalid_edit'};const start=original.indexOf(e.before);if(start<0||original.indexOf(e.before,start+1)!==-1)return {ok:false,reason:'ambiguous_or_missing_target'};patches.push({start,end:start+e.before.length,after:e.after});}
  patches.sort((a,b)=>a.start-b.start);
  if(patches.some((p,i)=>i>0&&p.start<patches[i-1].end))return {ok:false,reason:'overlapping_edits'};
  let text=original;for(const p of patches.reverse())text=text.slice(0,p.start)+p.after+text.slice(p.end);
  const ids=s=>[...s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]);
  const nextIds=new Set(ids(text));
  if(ids(original).some(id=>!nextIds.has(id)))return {ok:false,reason:'removed_dom_interface'};
  if(/<html[\s>]/i.test(original)&&(!/<html[\s>]/i.test(text)||!/<\/html>/i.test(text)))return {ok:false,reason:'incomplete_document'};
  return {ok:true,text};
}
