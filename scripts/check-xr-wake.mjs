import https from 'node:https';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createMedia} from '../app/xrMedia.js';
const dir=join(process.env.APPDATA,'Harness Aurora XR');
const config=JSON.parse(readFileSync(join(dir,'quest-connection.json'),'utf8'));
const ca=readFileSync(join(dir,'server-cert.pem'));
const call=body=>new Promise((resolve,reject)=>{
  const req=https.request(config.endpoint+'/xr/v1/wake',{ca,method:'POST',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'}},res=>{
    let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>res.statusCode===200?resolve(JSON.parse(text)):reject(new Error(`HTTP ${res.statusCode}`)));
  });req.on('error',reject);req.end(JSON.stringify(body));
});
const results=[];
for(const [text,expected] of [['Aurora, abra o menu.',true],['Estou aqui. Pode falar.',false]]){
  const speech=await createMedia().speak({text});
  const started=Date.now();const result=await call({audio:speech.audio});
  assert.equal(result.triggered,expected);
  results.push({input:text,...result,detectorMs:Date.now()-started,engine:speech.engine});
}
writeFileSync('unreal/AuroraXR/Saved/WakeTLSValidation.json',JSON.stringify(results,null,2));
console.log(results);
