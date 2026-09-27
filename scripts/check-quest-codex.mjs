// Run after check-quest-harness.mjs, through adb forward tcp:18887 tcp:8787.
import http from 'node:http';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const file='unreal/AuroraXR/Saved/Standalone/DeviceValidation.json';
const report=JSON.parse(readFileSync(file));
let token;
function call(path,body,method=body?'POST':'GET'){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:18887,path:'/api'+path,method,headers:{host:'127.0.0.1:8787','content-type':'application/json',...(token?{'x-harness-token':token}:{})}},res=>{
   let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{const j=JSON.parse(text);res.statusCode>=400?reject(new Error(j.error||`HTTP ${res.statusCode}`)):resolve(j);}catch(e){reject(e);}});
  });req.setTimeout(240000,()=>req.destroy(new Error('Quest request timed out')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
}
({token}=await call('/session'));
const conversation=await call('/conversations',{title:'Validação — professor Codex no Quest',provider:'local',teacherProvider:'codex'});
const id=conversation.id;
const local=await call(`/conversations/${id}/messages`,{message:'Responda somente o número: quanto é 2 + 2?',contextLimit:1000});
assert.equal(local.ok,true);
const started=Date.now();
const correction=await call(`/conversations/${id}/messages/${local.message.id}/correct`,{note:'Confira a conta e o cumprimento do formato pedido. Se já estiver correto, confirme sem inventar defeitos ou memórias desnecessárias.'});
assert.equal(correction.message.correctionOf,local.message.id);
assert.match(correction.message.provider,/Codex/);
const memories=await call('/memories');
for(const memory of correction.memoryCreated)assert.ok(memories.memories.some(m=>m.id===memory.id));
report.codex={seconds:(Date.now()-started)/1000,provider:correction.message.provider,memories:correction.memoryCreated.length,persistenceVerified:true};
writeFileSync(file,JSON.stringify(report,null,2));
console.log(JSON.stringify(report.codex));
