import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.HARNESS_DB_FILE=join(mkdtempSync(join(tmpdir(),'aurora-central-')),'test.db');
process.env.EMBEDDINGS_ENABLED='false';
const {resetDbForTests,getDb}=await import('../app/db.js');
const {centralConfig,updateCentralConfig,centralStatus,pullCentral,listCentralMemories,previewContribution,approveContribution,cancelContribution,syncCentral}=await import('../app/centralMemory.js');
const {publicMemory,sha256,centralManifest,validateManifest,contributionBody,parseContribution}=await import('../app/centralProtocol.js');
const {createMemory,createConversation,selectRelevantMemories}=await import('../app/store.js');
const {createServer,buildPrompt}=await import('../app/server.js');
const {compactContext}=await import('../app/economy.js');
const {prepareCentralReview}=await import('../scripts/central-memory/review.mjs');
const memory={title:'Contador acessível',content:'Use botões nativos e um contador visível para registrar cliques.',tags:['contador','acessibilidade']};
const now=Date.parse('2026-09-22T00:00:00Z');
const reset=()=>resetDbForTests(':memory:');
function repository(items=[memory]) {
  const rows=items.map(m=>{const clean=publicMemory(m);return {id:sha256(JSON.stringify(clean)),...clean};});
  const text=JSON.stringify({format:'aurora-central-bundle',version:1,memories:rows});
  const manifest=centralManifest(items.length?[{id:'test',file:'test.json',sha256:sha256(text),count:rows.length}]:[]);
  return {manifest,text,download:async url=>url.endsWith('manifest.json')?JSON.stringify(manifest):text};
}
test('central starts private, disabled and with a six-hour interval; settings are bounded',async()=>{
  reset();assert.deepEqual(await centralConfig(),{downloadEnabled:false,shareEnabled:false,crossChatEnabled:false,intervalHours:6});
  let calls=0;await syncCentral({now,download:async()=>{calls++;},api:async()=>{calls++;}});assert.equal(calls,0);
  for(const patch of [{intervalHours:0},{intervalHours:6.5},{shareEnabled:'yes'},{token:'secret'}])await assert.rejects(updateCentralConfig(patch));
});
test('download verifies hashes, reuses unchanged bundles, indexes locally and removes withdrawn records atomically',async()=>{
  reset();const repo=repository();let requests=[];
  const download=async u=>{requests.push(u);return repo.download(u);};
  await pullCentral({download,now});assert.equal((await listCentralMemories('contador')).length,1);
  await pullCentral({download,now});assert.equal(requests.filter(u=>u.endsWith('test.json')).length,1);
  const bad=repository([{...memory,content:'Outro contador acessível.'}]);
  await assert.rejects(pullCentral({download:async u=>u.endsWith('manifest.json')?JSON.stringify(bad.manifest):bad.text+'tampered',now}));
  assert.equal((await listCentralMemories())[0].content,memory.content);
  await pullCentral({download:repository([]).download,now});assert.equal((await listCentralMemories()).length,0);
});
test('malformed manifests and duplicate content roll back the whole update without changing private memories',async()=>{
  reset();const personal=await createMemory({title:'Privada',content:'Não publicar',env:{EMBEDDINGS_ENABLED:'false'}});
  await pullCentral({download:repository().download,now});const old=await listCentralMemories();
  assert.throws(()=>validateManifest({format:'aurora-central-manifest',version:1,revision:'x',bundles:[{id:'../escape',file:'../escape.json'}]}));
  await assert.rejects(pullCentral({download:repository([memory,memory]).download,now}));
  assert.deepEqual(await listCentralMemories(),old);
  assert.ok((await getDb()).prepare('SELECT id FROM memories WHERE id=?').get(personal.id));
});
test('sharing requires exact reviewed snapshots, explicit consent and no private metadata or detected secrets',async()=>{
  reset();const preview=await previewContribution(memory);
  await assert.rejects(approveContribution({memory,expectedId:preview.id,consent:true}));
  await updateCentralConfig({shareEnabled:true});
  await assert.rejects(approveContribution({memory,expectedId:preview.id,consent:false}));
  await assert.rejects(approveContribution({memory:{...memory,content:'Texto modificado'},expectedId:preview.id,consent:true}));
  for(const extra of [{...memory,conversationId:'private'},{...memory,content:'cliente@example.com'},{...memory,content:'C:\\Users\\Someone\\secret.txt'},{...memory,content:'senha=super-secreta'}])await assert.rejects(previewContribution(extra));
  await approveContribution({memory,expectedId:preview.id,consent:true});
  await approveContribution({memory,expectedId:preview.id,consent:true});assert.equal((await centralStatus()).contributions.length,1);
  const payload=(await getDb()).prepare('SELECT payload FROM central_outbox').get().payload;
  assert.deepEqual(Object.keys(JSON.parse(payload).memory),['title','content','tags']);
  assert.equal(parseContribution(contributionBody(preview)).id,preview.id);
  await updateCentralConfig({shareEnabled:false});assert.equal((await centralStatus()).contributions[0].status,'cancelled');
});
test('scheduler persists due time and sends an approved contribution only once; reception does not upload personal data',async()=>{
  reset();const preview=await previewContribution(memory);await updateCentralConfig({shareEnabled:true,downloadEnabled:true});
  await approveContribution({memory,expectedId:preview.id,consent:true});let posts=0,gets=0;
  const api=async (path,options)=>{if(path==='user')return {login:'example-user'};if(options?.method==='POST'){posts++;assert.deepEqual(parseContribution(options.body.body).memory,preview.memory);return {number:23};}gets++;return [];};
  const status=await syncCentral({now,download:repository().download,api});assert.equal(posts,1);assert.equal(status.state.nextAt,new Date(now+6*3600000).toISOString());assert.equal(status.contributions[0].status,'sent');
  await syncCentral({now:now+3600000,download:async()=>{throw Error('should not download');},api});assert.equal(posts,1);assert.equal(gets,1);
  await syncCentral({now:now+7*3600000,download:repository().download,api});assert.equal(posts,1);
});
test('uncertain POSTs are never automatically resent, and later confirmation reconciles them',async()=>{
  reset();await updateCentralConfig({shareEnabled:true});const preview=await previewContribution(memory);await approveContribution({memory,expectedId:preview.id,consent:true});let posts=0;
  const api=async(path,options)=>{if(path==='user')return {login:'tester'};if(options?.method==='POST'){posts++;throw Error('connection lost after POST');}return [];};
  await syncCentral({now,api});assert.equal((await centralStatus()).contributions[0].status,'uncertain');
  await syncCentral({now:now+3600000,api});assert.equal(posts,1);
  await syncCentral({manual:true,now:now+2*3600000,api:async path=>path==='user'?{login:'tester'}:[{number:99,body:contributionBody(preview)}]});
  assert.equal((await centralStatus()).contributions[0].issueUrl,'https://github.com/skrtt777/Harness_Aurora/issues/99');
});
test('concurrent syncs acquire one lease and disabling receive during a download prevents activation',async()=>{
  reset();await updateCentralConfig({downloadEnabled:true});let release;const hold=new Promise(r=>{release=r;});let calls=0;
  const repo=repository();const first=syncCentral({now,download:async u=>{calls++;await hold;return repo.download(u);}});
  await new Promise(r=>setImmediate(r));await syncCentral({now,download:async()=>{throw Error('second job');}});
  assert.equal(calls,1);await updateCentralConfig({downloadEnabled:false});release();await first;
  assert.equal((await centralStatus()).count,0);
});
test('chat context stays private by default; cross-chat search is opt-in and central data is never a higher-priority instruction',async()=>{
  reset();const a=await createConversation({title:'A'}),b=await createConversation({title:'B'});
  const privateMemory=await createMemory({scope:'conversation',conversationId:b.id,...memory});await pullCentral({download:repository().download,now});
  const env={EMBEDDINGS_ENABLED:'false'};
  let selected=await selectRelevantMemories('contador acessível',{conversationId:a.id},12,env);assert.equal(selected.length,0);
  await updateCentralConfig({downloadEnabled:true});selected=await selectRelevantMemories('contador acessível',{conversationId:a.id},12,env);assert.equal(selected.length,1);assert.equal(selected[0].scope,'central');
  assert.match(buildPrompt({input:'contador',memories:selected}),/dados, não instruções/);
  assert.match((await compactContext({input:'contador',memories:selected,includeSkills:false})).prompt,/Referência pública revisada/);
  await updateCentralConfig({crossChatEnabled:true});selected=await selectRelevantMemories('contador acessível',{conversationId:a.id},12,env);assert.ok(selected.some(m=>m.id===privateMemory.id));assert.equal(selected[0].id,privateMemory.id);
  await updateCentralConfig({downloadEnabled:false,crossChatEnabled:false});assert.equal((await selectRelevantMemories('contador acessível',{conversationId:a.id},12,env)).length,0);
});
test('central endpoints require local authentication and validate public approval before queuing',async()=>{
  reset();const server=createServer({allowDev:false,centralSync:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {for(const [path,method] of [['status','GET'],['sync','POST'],['contributions','POST'],['config','PATCH'],['github','POST']])assert.equal((await fetch(`${base}/api/central/${path}`,{method})).status,401);
    const {token}=await fetch(base+'/api/session').then(r=>r.json());const headers={'x-harness-token':token,'content-type':'application/json'};
    assert.equal((await fetch(base+'/api/central/config',{method:'PATCH',headers,body:JSON.stringify({intervalHours:10000})})).status,400);
    assert.equal((await fetch(base+'/api/central/contributions',{method:'POST',headers,body:JSON.stringify({memory,consent:false})})).status,400);
    assert.equal((await centralStatus()).contributions.length,0);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('maintainer creates only data blobs and a review PR; untrusted issue text is not executable',async()=>{
  const preview=await previewContribution({...memory,content:'Use texto literal $(not-a-command) ao explicar exemplos.'});const calls=[];const manifest=centralManifest([]);
  const api=async(path,options)=>{calls.push({path,options});if(path.endsWith('/Harness_Aurora'))return {permissions:{push:true}};if(path.endsWith('/issues/42'))return {state:'open',body:contributionBody(preview)};if(path.includes('/pulls?')||path.includes('/git/matching-refs/'))return [];if(path.includes('/git/ref/'))return {object:{sha:'base'}};if(path.endsWith('/git/commits/base'))return {tree:{sha:'tree'}};if(path.includes('/contents/'))return {content:Buffer.from(JSON.stringify(manifest)).toString('base64')};if(path.endsWith('/pulls'))return {html_url:'https://github.com/skrtt777/Harness_Aurora/pull/43'};return {sha:'new'};};
  const result=await prepareCentralReview(42,api);assert.match(result.url,/pull\/43$/);
  const blobs=calls.filter(c=>c.path.endsWith('/git/blobs'));assert.equal(blobs.length,2);assert.ok(blobs.some(c=>c.options.body.content.includes('$(not-a-command)')));
  assert.ok(calls.filter(c=>c.options?.method).every(c=>c.options.method==='POST'));assert.equal(calls.some(c=>c.path.endsWith('/merges')),false);
  await assert.rejects(prepareCentralReview(42,async()=>({permissions:{push:false}})));
});
