import test from 'node:test';
import assert from 'node:assert/strict';
import {createMedia} from '../app/xrMedia.js';

test('Neural speech rejects missing, blank and excessive text before contacting a service',async()=>{
  for(const text of [null,' ','a'.repeat(6001)])await assert.rejects(createMedia().speak({text}),error=>error.status===400);
});
test('Unavailable neural speech reports a service error without silently changing the voice',async t=>{
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('connection refused');});
  await assert.rejects(createMedia().speak({text:'Olá, Aurora.'}),error=>error.status===503&&error.message.includes('Voz neural'));
});
test('Speech rejects an invalid audio response',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('not audio',{status:200}));
  await assert.rejects(createMedia().speak({text:'Olá, Aurora.'}),/inválido/);
});
