import test from 'node:test';
import assert from 'node:assert/strict';
import {resetDbForTests} from '../app/db.js';
import {createConversation,updateConversation,getConversation} from '../app/store.js';
test('Changing a Quest teacher preserves the conversation and rejects invalid teachers',async()=>{
  resetDbForTests();const c=await createConversation({title:'Quest',provider:'local',teacherProvider:'codex'});
  await updateConversation(c.id,{teacherProvider:'claude'});
  const updated=await getConversation(c.id);assert.equal(updated.teacherProvider,'claude');assert.equal(updated.title,'Quest');assert.equal(updated.provider,'local');
  await assert.rejects(updateConversation(c.id,{teacherProvider:'untrusted'}),/Professor/);
  assert.equal((await getConversation(c.id)).teacherProvider,'claude');
});
