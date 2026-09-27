import https from 'node:https';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const directory=join(process.env.APPDATA,'Harness Aurora XR');
const config=JSON.parse(readFileSync(join(directory,'quest-connection.json'),'utf8'));
const ca=readFileSync(join(directory,'server-cert.pem'));
function call(path,body){return new Promise((resolve,reject)=>{
  const payload=body?JSON.stringify(body):undefined;
  const req=https.request(config.endpoint+'/xr/v1'+path,{ca,method:body?'POST':'GET',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'}},res=>{
    let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>{const data=JSON.parse(text);res.statusCode>=400?reject(new Error(data.error)):resolve(data);});});req.on('error',reject);req.end(payload);
});}
async function operation(path,body){const requestId=randomUUID();await call(path,{...body,requestId});for(let i=0;i<180;i++){
  await new Promise(r=>setTimeout(r,1000));const op=await call('/operations/'+requestId);if(op.state==='complete')return op.result;if(op.state!=='pending')throw new Error(op.error);
}throw new Error('Operation timeout');}
const report={at:new Date().toISOString(),capabilities:await call('/capabilities')};
report.projects=(await call('/projects')).projects.length;report.conversations=(await call('/conversations')).conversations.length;
console.log('TLS e leitura do Harness real: OK');
const conversation=await operation('/conversations',{title:'Validação Aurora Presence — integração',provider:'local'});
report.conversationId=conversation.id;
const answer=await operation(`/conversations/${conversation.id}/messages`,{message:'Este é um teste de integração do aplicativo Aurora Presence. Responda em português, em uma frase curta: a conexão com o Harness está funcionando.'});
report.chat=!!answer.message?.content;console.log('Conversa persistida no Harness:',report.chat);
const speech=await operation('/speak',{text:'Olá, Lucas. A Aurora está conectada ao seu projeto.'});
report.speechBytes=Buffer.from(speech.audio,'base64').length;console.log('Síntese local pt-BR: OK');
const transcript=await operation('/transcribe',{audio:speech.audio});report.transcription=transcript.text;console.log('Transcrição local:',transcript.text);
writeFileSync('unreal/AuroraXR/Saved/PresenceIntegration.json',JSON.stringify(report,null,2));
