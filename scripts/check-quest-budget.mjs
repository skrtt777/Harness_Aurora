// Verify the embedded llama tokenizer rejects a large Unicode request before inference.
import http from 'node:http';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
let token;
function call(path,body){return new Promise((resolve,reject)=>{
 const request=http.request({hostname:'127.0.0.1',port:18887,path:'/api'+path,method:body?'POST':'GET',headers:{host:'127.0.0.1:8787','content-type':'application/json',...(token?{'x-harness-token':token}:{})}},res=>{
  let data='';res.on('data',c=>data+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(data)});}catch(error){reject(error);}});
 });request.setTimeout(20000,()=>request.destroy(new Error('Budget check timed out')));request.on('error',reject);request.end(body?JSON.stringify(body):undefined);
});}
token=(await call('/session')).body.token;
const conversation=(await call('/conversations',{title:'Validação — limite de tokens Quest',provider:'local'})).body;
const started=Date.now();
const result=await call(`/conversations/${conversation.id}/messages`,{message:'\u{13000}'.repeat(3000),contextLimit:10000});
assert.equal(result.status,413);
assert.match(result.body.error,/janela do modelo/);
const report={seconds:(Date.now()-started)/1000,status:result.status,error:result.body.error};
writeFileSync('unreal/AuroraXR/Saved/Standalone/QuestTokenBudget.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
