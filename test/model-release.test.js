import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
process.env.HARNESS_DB_FILE=join(mkdtempSync(join(tmpdir(),'aurora-release-')),'test.db');
const {approvedInstalledModel}=await import('../app/localModelRelease.js');
const {setSetting}=await import('../app/store.js');
const {resolveLocalModel,DEFAULT_LOCAL_MODEL}=await import('../app/ollamaSetup.js');
const {decideRelease}=await import('../scripts/training/release-gate.mjs');
test('automatic selection rejects failed releases, removed weights and changed model digest',async()=>{
 const digest='a'.repeat(64),release={model:'aurora:test',modelDigest:digest,decision:{passed:true,checks:Array.from({length:7},()=>({passed:true}))}};
 assert.equal(approvedInstalledModel(release,[{name:'aurora:test',digest}]),'aurora:test');
 assert.equal(approvedInstalledModel({...release,decision:{...release.decision,passed:false}},[{name:'aurora:test',digest}]),null);
 assert.equal(approvedInstalledModel(release,[{name:'aurora:test',digest:'b'.repeat(64)}]),null);
 assert.equal(approvedInstalledModel(release,[]),null);
 const server=http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({models:[{name:'aurora:test',digest}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const env={LOCAL_BASE_URL:`http://127.0.0.1:${server.address().port}`};
 try{
  await setSetting('local_model','auto');await setSetting('local_model_release',JSON.stringify(release));
  assert.equal(await resolveLocalModel(env),'aurora:test');
  assert.equal(await resolveLocalModel({...env,LOCAL_MODEL:'explicit:model'}),'explicit:model');
  await setSetting('local_model','manual:model');assert.equal(await resolveLocalModel(env),'manual:model');
  await setSetting('local_model','auto');await setSetting('local_model_release','invalid json');assert.equal(await resolveLocalModel(env),DEFAULT_LOCAL_MODEL);
 }finally{await new Promise(r=>server.close(r));}
});
test('release gate rejects duplicate or absent evidence and performance regression',()=>{
 const manifest={tasks:[{id:'x',domain:'app'}],seeds:[1,2],candidate:'aurora-local:1.5b-v1',gate:{minimumPassRate:.7,minimumGainPoints:15,minimumRetentionPassed:3,maxTokenRatio:1.2}};
 const record=(seed,passed)=>({id:'x',domain:'app',seed,passed,tokens:10,estimatedTokens:0,calls:1,elapsedMs:10,trace:[{prompt:'fixed',response:{usage:{input_tokens:5,output_tokens:5}}}]});
 const b={records:[record(1,true),record(2,false)],retention:[{passed:true},{passed:true},{passed:true}]},c={records:[record(1,true),record(2,true)],retention:b.retention};
 const control={summary:[{model:'aurora-control:1.5b-v1',passed:1,total:2},{model:manifest.candidate,passed:2,total:2}]};
 assert.equal(decideRelease(manifest,b,c,control).passed,true);
 assert.equal(decideRelease(manifest,b,b,control).passed,false);
 assert.equal(decideRelease(manifest,b,{...c,records:[record(1,true),record(1,true)]},control).passed,false);
 assert.equal(decideRelease(manifest,b,c,null).passed,false);
 assert.equal(decideRelease(manifest,b,{...c,retention:[{passed:true}]},control).passed,false);
});
