import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetDbForTests } from '../app/db.js';
import { createProject, listMemories } from '../app/store.js';
import { captureBenchMaterial, getBench, getBenchPreview, saveBenchDecision } from '../app/bench.js';
const dir=mkdtempSync(join(tmpdir(),'aurora-bench-'));
const file=join(dir,'state.db');
resetDbForTests(file);
after(()=>resetDbForTests());
test('capture and decision persist, replay after database reopen does not duplicate memory', async()=>{
  const project=await createProject({name:'Estúdio criativo'});
  const capture={projectId:project.id,operationKey:'telegram:123:555:1',title:'Luz indireta',note:'Uma faixa azul junto à mesa.'};
  const m=await captureBenchMaterial(capture);
  assert.equal((await captureBenchMaterial(capture)).id,m.id);
  let board=await getBench(project.id);assert.equal(board.materials.length,1);assert.equal(board.revision,1);
  const request={operationKey:'xr:quest:save-1',expectedRevision:1,materialIds:[m.id],content:'Usar luz azul indireta.'};
  const saved=await saveBenchDecision(project.id,request);
  resetDbForTests(file); // Connection is lost after COMMIT, before the client gets its acknowledgment.
  const replay=await saveBenchDecision(project.id,request);
  assert.equal(replay.id,saved.id);assert.equal(replay.replayed,true);
  board=await getBench(project.id);assert.equal(board.decisions.length,1);assert.equal(board.revision,2);
  assert.equal((await listMemories({projectId:project.id})).length,1);
  await assert.rejects(saveBenchDecision(project.id,{...request,content:'Diferente'}),e=>e.status===409);
});
test('concurrent update forces review and references cannot cross projects',async()=>{
  const a=await createProject({name:'A'}), b=await createProject({name:'B'});
  const ref=await captureBenchMaterial({projectId:a.id,operationKey:'ref-a',title:'A',note:''});
  await assert.rejects(saveBenchDecision(a.id,{operationKey:'stale',expectedRevision:0,materialIds:[ref.id],content:'Decisão'}),e=>e.status===409);
  await assert.rejects(saveBenchDecision(b.id,{operationKey:'foreign',expectedRevision:0,materialIds:[ref.id],content:'Decisão'}),e=>e.status===400);
  assert.equal((await getBench(b.id)).decisions.length,0);
  assert.equal((await listMemories({projectId:b.id})).length,0);
});
test('real image preview is bounded and public snapshots never expose filesystem paths',async()=>{
  const {createCanvas}=await import('@napi-rs/canvas');
  const canvas=createCanvas(1200,800);const ctx=canvas.getContext('2d');ctx.fillStyle='#2288aa';ctx.fillRect(0,0,1200,800);
  const image=join(dir,'reference.png');writeFileSync(image,await canvas.encode('png'));
  const p=await createProject({name:'Imagem'});
  const m=await captureBenchMaterial({projectId:p.id,operationKey:'image',title:'Referência',file:image});
  assert.equal(m.hasPreview,true);assert.match(m.sha256,/^[a-f0-9]{64}$/);
  const preview=await getBenchPreview(p.id,m.id);assert.equal(preview.mime,'image/jpeg');assert.ok(Buffer.from(preview.image,'base64').length<1000000);
  const snapshot=await getBench(p.id);assert.equal(JSON.stringify(snapshot).includes(dir),false);assert.equal('original_path' in snapshot.materials[0],false);
  const other=await createProject({name:'Outra imagem'});await assert.rejects(getBenchPreview(other.id,m.id),e=>e.status===404);
});
