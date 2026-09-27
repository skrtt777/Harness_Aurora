import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XRStore, createXRHandler, createDesktopClient } from '../app/xrBridge.js';

async function setup(t,desktop=async()=>({projects:[{id:'project-a',name:'Aurora'}]}),media={},teachers={}) {
  const directory=mkdtempSync(join(tmpdir(),'aurora-xr-test-'));
  const store=new XRStore(directory);const bridge=createXRHandler({store,desktop,media,teachers});
  // HTTP only for isolated handler tests. Production factory is HTTPS-only.
  const server=http.createServer(bridge.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});});
  const call=async(path,token,body,method=body?'POST':'GET',extra={})=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/xr/v1${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{ }),...extra},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  };
  return {store,bridge,call,directory};
}

test('Teacher relay is authenticated, selects the existing executor and rejects unknown providers',async t=>{
  const seen=[];const {store,call}=await setup(t,undefined,{}, {claude:async prompt=>{seen.push(prompt);return {ok:true,text:'review'};}});
  assert.equal((await call('/teacher',null,{provider:'claude',prompt:'Review'})).status,401);
  const {token}=store.issueDevice('Quest');
  assert.equal((await call('/teacher',token,{provider:'unknown',prompt:'Review'})).status,503);
  assert.equal((await call('/teacher',token,{provider:'claude',prompt:'Review'})).data.text,'review');assert.deepEqual(seen,['Review']);
});

test('XR forwards teacher selection and correction to the original Harness routes',async t=>{
  const seen=[];const {store,call}=await setup(t,async(path,method,body)=>{seen.push({path,method,body});return {message:{content:'corrigido'}};});
  const {token}=store.issueDevice('Quest');
  assert.equal((await call('/conversations/c',token,{teacherProvider:'claude'},'PATCH')).status,200);
  assert.equal((await call('/conversations/c/messages/m/correct',token,{requestId:'correction-one',note:'revise'})).status,202);
  await call('/operations/correction-one',token);
  assert.deepEqual(seen.map(x=>x.path),['/conversations/c','/conversations/c/messages/m/correct']);
  assert.equal(seen[0].body.teacherProvider,'claude');
});

test('Name detection requires authentication and never persists ambient transcription',async t=>{
  let calls=0;
  const {store,call}=await setup(t,undefined,{wake:async()=>{calls++;return {triggered:false};}});
  assert.equal((await call('/wake',null,{audio:'sample'})).status,401);
  const {token}=store.issueDevice('Quest');
  assert.deepEqual((await call('/wake',token,{audio:'sample'})).data,{triggered:false});
  assert.equal(calls,1);assert.deepEqual(store.data.operations,{});
});
test('XR pairing is temporary, single use; credentials can be revoked',async t=>{
  const {bridge,call}=await setup(t);
  assert.equal((await call('/projects')).status,401);
  const {code}=bridge.startPairing();const paired=await call('/pair',null,{name:'Quest',code});
  assert.equal(paired.status,201);assert.equal((await call('/pair',null,{name:'Other',code})).status,403);
  const {token}=paired.data;
  assert.equal((await call('/projects',token)).data.projects[0].id,'project-a');
  assert.equal((await call('/projects',token,undefined,'GET',{origin:'https://evil.example'})).status,403);
  assert.equal((await call('/device',token,undefined,'DELETE')).status,200);
  assert.equal((await call('/projects',token)).status,401);
});
test('XR brute-force window closes after five attempts',async t=>{
  const {bridge,call}=await setup(t);const {code}=bridge.startPairing();
  for(let i=0;i<5;i++)assert.equal((await call('/pair',null,{name:'Q',code:'wrong'})).status,403);
  assert.equal((await call('/pair',null,{name:'Q',code})).status,403);
});
test('XR deduplicates mutations and rejects conflicting reuse across reconnect',async t=>{
  let writes=0;
  const {store,call}=await setup(t,async()=>{writes++;return {message:{content:'Resposta real'}};});
  const {token}=store.issueDevice('Quest');const body={requestId:'test-request',message:'Oi'};
  assert.equal((await call('/conversations/chat-a/messages',token,body)).status,202);
  assert.equal((await call('/conversations/chat-a/messages',token,body)).status,202);
  assert.equal((await call('/conversations/chat-a/messages',token,{...body,message:'Outra'})).status,409);
  const op=await call('/operations/test-request',token);assert.equal(op.data.state,'complete');assert.equal(writes,1);
  const other=store.issueDevice('Other');assert.equal((await call('/operations/test-request',other.token)).status,404);
});
test('XR persisted in-flight operations become uncertain and are never replayed',async t=>{
  const {store,directory}=await setup(t);store.data.operations['d:r']={state:'pending'};store.save();
  assert.equal(new XRStore(directory).data.operations['d:r'].state,'uncertain');
});
test('XR exposes only allowlisted operations and validates memory scopes',async t=>{
  const {store,call}=await setup(t);const {token}=store.issueDevice('Quest');
  assert.equal((await call('/settings',token,{requestId:'x',defaultProvider:'claude'})).status,404);
  assert.equal((await call('/memories',token,{requestId:'x',title:'T',content:'C',scope:'project'})).status,400);
  assert.throws(()=>createDesktopClient('http://192.168.0.2:8787'));
});
test('Desktop client renews the session once after the desktop app restarts',async t=>{
  const {createDesktopClient}=await import('../app/xrBridge.js');
  let token='old',posts=0;
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    if(url.endsWith('/api/session'))return Response.json({token});
    if(options.method==='POST')posts++;
    return options.headers['x-harness-token']===token?Response.json({ok:true}):Response.json({error:'Sessão local inválida.'},{status:401});
  });
  const desktop=createDesktopClient();
  assert.equal((await desktop('/conversations','GET')).ok,true);
  token='new';
  assert.equal((await desktop('/conversations/x/messages','POST',{message:'oi'})).ok,true);
  assert.equal(posts,2);
});
