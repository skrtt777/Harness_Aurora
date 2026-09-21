import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

process.env.HARNESS_DB_FILE=join(mkdtempSync(join(tmpdir(),'aurora-catalog-')),'test.db');
const {replaceCatalog,searchSkillCatalog,importCatalogSkill,catalogRemoteText,syncSkillCatalog}=await import('../app/skillCatalog.js');
const {listSkills,readSkill,selectSkills}=await import('../app/skills.js');
const sha='a'.repeat(40);
const content='---\nname: catalog-probe\ndescription: zebracatalog functionality\n---\nTest the result before moving on. See references/check.md.';
const entry=(source,identifier,extra={})=>({name:'catalog-probe',description:'zebracatalog functionality',source,identifier,repo:'sample/skills',path:'skills/catalog-probe',tags:['validation'],...extra});
const json=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const payload=skills=>({version:1,generated_at:'2026-09-20T00:00:00Z',skills});

test('catalogue is metadata only, searchable offline, paginated and atomically replaced',async()=>{
  const a=entry('github','sample/skills/a'),b=entry('official','official/b',{name:'second',description:'BI financial dashboard'});
  const meta=await replaceCatalog(payload([a,b,a,{name:''}]));
  assert.equal(meta.total,2);assert.equal(meta.duplicates,1);assert.equal(meta.rejected,1);
  const first=await searchSkillCatalog({limit:1}),second=await searchSkillCatalog({limit:1,page:1});
  assert.notEqual(first.skills[0].id,second.skills[0].id);
  assert.equal((await searchSkillCatalog({query:'zebra'})).total,1);
  assert.equal((await searchSkillCatalog({query:'finance',source:'github'})).total,0);
  assert.equal((await searchSkillCatalog({source:'official'})).total,1);
  assert.equal((await searchSkillCatalog({query:'" OR *'})).total,0);
  assert.equal((await listSkills()).filter(s=>s.name==='catalog-probe').length,0);
  await assert.rejects(replaceCatalog(payload([{name:''}])));
  await assert.rejects(replaceCatalog({version:2,skills:[a]}));
  assert.equal((await searchSkillCatalog()).total,2);
  await assert.rejects(searchSkillCatalog({page:-1}));
});

test('GitHub import pins a revision, is inactive and deduplicates without loading catalogue into context',async()=>{
  await replaceCatalog(payload([entry('skills.sh','skills-sh/sample/skills/catalog-probe',{path:'catalog-probe'})]));
  const id=(await searchSkillCatalog()).skills[0].id,urls=[];
  const fetcher=async(url,opts)=>{
    urls.push(url);assert.equal(opts.redirect,'error');
    if(url.startsWith('https://api.github.com/'))return json({sha,tree:[{type:'blob',path:'skills/catalog-probe/SKILL.md'}]});
    assert.equal(url,`https://raw.githubusercontent.com/sample/skills/${sha}/skills/catalog-probe/SKILL.md`);
    return new Response(content);
  };
  const skill=await importCatalogSkill(id,{fetcher});
  assert.equal(skill.enabled,false);assert.ok(skill.source.includes(sha));
  assert.equal((await importCatalogSkill(id,{fetcher})).id,skill.id);
  assert.equal((await listSkills()).filter(s=>s.id===skill.id).length,1);
  assert.equal((await selectSkills('zebracatalog')).some(s=>s.id===skill.id),false);
  assert.deepEqual((await readSkill(skill.id)).resources,['references/check.md']);
  await assert.rejects(readSkill(skill.id,'references/../../secrets.txt'));
  assert.equal(urls.length,4);
});

test('ambiguous, truncated and unsafe repository paths do not import a guessed skill',async()=>{
  await replaceCatalog(payload([entry('github','a',{path:'catalog-probe'})]));
  let id=(await searchSkillCatalog()).skills[0].id;
  const ambiguous=async()=>json({sha,tree:['a','b'].map(p=>({type:'blob',path:p+'/catalog-probe/SKILL.md'}))});
  await assert.rejects(importCatalogSkill(id,{fetcher:ambiguous}),/único/);
  await assert.rejects(importCatalogSkill(id,{fetcher:async()=>json({sha,truncated:true,tree:[{type:'blob',path:'a/catalog-probe/SKILL.md'}]})}),/incompleta/);
  await replaceCatalog(payload([entry('github','unsafe',{path:'../secret'})]));
  id=(await searchSkillCatalog()).skills[0].id;
  await assert.rejects(importCatalogSkill(id,{fetcher:()=>{throw Error('must not fetch');}}),/inválido/);
});

test('ClawHub imports exact version and LobeHub explicitly converts agent instructions',async()=>{
  await replaceCatalog(payload([entry('clawhub','unique-probe'),entry('lobehub','lobehub/agent-probe')]));
  let id=(await searchSkillCatalog({source:'clawhub'})).skills[0].id;
  await importCatalogSkill(id,{fetcher:async url=>{
    if(!url.includes('/file?'))return json({latestVersion:{version:'1.2.3'}});
    assert.ok(url.endsWith('/file?path=SKILL.md&version=1.2.3'));return new Response(content.replaceAll('catalog-probe','claw-probe'));
  }});
  await assert.rejects(importCatalogSkill(id,{fetcher:async()=>new Response('',{status:409})}),/ambíguos/);
  const wrapped=await importCatalogSkill(id,{fetcher:async url=>url.includes('/file?')?new Response('# Plain instructions\nValidate the result.'):json({latestVersion:{version:'2.0.0'}})});
  assert.equal(wrapped.name,'unique-probe');assert.equal(wrapped.enabled,false);assert.ok(wrapped.source.endsWith(':wrapped'));
  assert.equal((await readSkill(wrapped.id)).body,'# Plain instructions\nValidate the result.');
  id=(await searchSkillCatalog({source:'lobehub'})).skills[0].id;
  const skill=await importCatalogSkill(id,{fetcher:async url=>{assert.equal(url,'https://chat-agents.lobehub.com/agent-probe.json');return json({config:{systemRole:'Validate every result.'}});}});
  assert.equal(skill.enabled,false);assert.equal(skill.source,'catalog:lobehub:agent-probe:converted');
  assert.equal((await readSkill(skill.id)).body,'Validate every result.');
});

test('browse.sh resolves the selected hostname and path without executing scripts',async()=>{
  await replaceCatalog(payload([entry('browse-sh','browse-sh/example.com/catalog-probe')]));
  const id=(await searchSkillCatalog()).skills[0].id;
  const skill=await importCatalogSkill(id,{fetcher:async url=>{
    if(url.startsWith('https://api.github.com/')){assert.ok(url.includes('/browserbase/browse.sh/'));return json({sha,tree:[{type:'blob',path:'skills/example.com/catalog-probe/SKILL.md'}]});}
    assert.ok(url.endsWith('/skills/example.com/catalog-probe/SKILL.md'));return new Response(content.replaceAll('catalog-probe','browse-probe'));
  }});
  assert.equal(skill.enabled,false);
});

test('downloads are bounded and a failed sync preserves the searchable index',async()=>{
  await assert.rejects(catalogRemoteText('https://example.com',3,async()=>new Response('1234')),/limite/);
  const before=(await searchSkillCatalog()).total;
  await assert.rejects(syncSkillCatalog({fetcher:async()=>new Response('bad JSON')}));
  assert.equal((await searchSkillCatalog()).total,before);
  const meta=await syncSkillCatalog({fetcher:async(url)=>{assert.equal(url,'https://nousresearch.github.io/hermes-agent/docs/api/skills-index.json');return json(payload([entry('official','official/probe')]));}});
  assert.equal(meta.total,1);
});

test('catalogue API enforces session authentication and validates pagination',async()=>{
  const {createServer}=await import('../app/server.js');
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const headers={'x-harness-token':server.apiToken};
    assert.equal((await fetch(base+'/api/skills/catalog')).status,401);
    assert.equal((await fetch(base+'/api/skills/catalog?page=-1',{headers})).status,400);
    const r=await fetch(base+'/api/skills/catalog?q=probe',{headers});assert.equal(r.status,200);assert.equal((await r.json()).total,1);
    assert.equal((await fetch(base+'/api/skills/catalog/sync',{method:'POST'})).status,401);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
