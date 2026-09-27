// Read-only verification after reinstall/restart; requires adb forward 18887 -> 8787.
import http from 'node:http';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const file='unreal/AuroraXR/Saved/Standalone/DeviceValidation.json';
const report=JSON.parse(readFileSync(file));
let token;
function get(path){return new Promise((resolve,reject)=>{
 const request=http.get({hostname:'127.0.0.1',port:18887,path:'/api'+path,headers:{host:'127.0.0.1:8787',...(token?{'x-harness-token':token}:{})}},res=>{
  let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{assert.equal(res.statusCode,200);resolve(JSON.parse(text));}catch(error){reject(error);}});
 });request.setTimeout(5000,()=>request.destroy(new Error('Timeout')));request.on('error',reject);
});}
({token}=await get('/session'));
const conversation=await get(`/conversations/${report.local.conversationId}`);
assert.ok(conversation.messages.some(m=>m.id===report.local.messageId));
assert.ok(conversation.messages.some(m=>m.correctionOf===report.local.messageId));
const memories=await get('/memories');
assert.ok(memories.memories.length>=report.dataBefore.memories+report.teacher.memories);
report.afterRestart={at:new Date().toISOString(),messagesAndCorrectionPersisted:true,memories:memories.memories.length};
writeFileSync(file,JSON.stringify(report,null,2));
console.log(JSON.stringify(report.afterRestart));
