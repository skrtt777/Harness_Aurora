import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWake} from '../app/xrMedia.js';

test('Only directly addressed Aurora speech activates; unrelated text is discarded',()=>{
  for(const text of ['Aurora','AURORA!','Olá, Aurora.']) assert.deepEqual(parseWake(text),{triggered:true,command:''});
  assert.deepEqual(parseWake('Aurora, abra o projeto jardim.'),{triggered:true,command:'abra o projeto jardim.'});
  for(const text of ['', 'vamos falar com Aurora depois','auroral', 'a aurora boreal']) assert.deepEqual(parseWake(text),{triggered:false});
});
