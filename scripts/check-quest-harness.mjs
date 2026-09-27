import http from 'node:http';
import {writeFileSync} from 'node:fs';
let token;
function call(path,body,method=body?'POST':'GET'){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:18887,path:'/api'+path,method,headers:{host:'127.0.0.1:8787','content-type':'application/json',...(token?{'x-harness-token':token}:{})}},res=>{
   let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{const j=JSON.parse(text);res.statusCode>=400?reject(new Error(j.error||`HTTP ${res.statusCode}`)):resolve(j);}catch(e){reject(e);}});
  });req.setTimeout(240000,()=>req.destroy(new Error('Quest request timed out')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
}
({token}=await call('/session'));
const projects=await call('/projects'),memories=await call('/memories'),conversations=await call('/conversations');
const report={at:new Date().toISOString(),dataBefore:{projects:projects.projects.length,memories:memories.memories.length,conversations:conversations.conversations.length}};
const c=await call('/conversations',{title:'Validação — Harness embarcado e professores',provider:'local',teacherProvider:'claude'});
const started=Date.now();
const result=await call(`/conversations/${c.id}/messages`,{message:'Explique em português, em duas frases, a diferença entre uma IA pequena executada localmente em um headset e professores de IA consultados remotamente.',contextLimit:4000});
report.local={seconds:(Date.now()-started)/1000,ok:result.ok,conversationId:c.id,messageId:result.message?.id,text:result.message?.content,execution:result.execution};
console.log('Quest local generation:',report.local.seconds,'seconds',report.local.ok);
writeFileSync('unreal/AuroraXR/Saved/Standalone/DeviceValidation.json',JSON.stringify(report,null,2));
if(!result.ok)throw new Error(result.error||'Local inference failed');
const teacherStarted=Date.now();
try{
 const correction=await call(`/conversations/${c.id}/messages/${result.message.id}/correct`,{note:'Confira a distinção: o Harness e o modelo local rodam no Quest. Claude/Codex continuam remotos. Corrija exageros e ensine apenas regras corretas e reutilizáveis.'});
 report.teacher={seconds:(Date.now()-teacherStarted)/1000,provider:correction.message?.provider,correctionOf:correction.message?.correctionOf,memories:correction.memoryCreated?.length,text:correction.message?.content};
 console.log('Teacher correction:',report.teacher.provider,report.teacher.memories,'memories');
}catch(error){report.teacher={error:error.message};console.log('Teacher unavailable:',error.message);}
writeFileSync('unreal/AuroraXR/Saved/Standalone/DeviceValidation.json',JSON.stringify(report,null,2));
