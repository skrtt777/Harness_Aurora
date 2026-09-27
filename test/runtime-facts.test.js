import test from 'node:test';
import assert from 'node:assert/strict';
import {clockObservation} from '../app/runtimeFacts.js';
const options={now:new Date('2026-09-27T04:36:00Z'),timeZone:'America/Sao_Paulo'};
test('Clock evidence uses the real instant and device time zone, not an old answer',()=>{
  const fact=clockObservation('Que horas são agora?',options);
  assert.equal(fact.source,'device-clock');
  assert.equal(fact.observedAt,'2026-09-27T04:36:00.000Z');
  assert.equal(fact.timeZone,'America/Sao_Paulo');
  assert.match(fact.local,/01:36:00/);
  assert.match(fact.block,/Hora atual deste dispositivo: .*01:36:00/);
});
test('Clock observation handles date changes across time zones',()=>{
  const fact=clockObservation('Qual dia é hoje?',{...options,now:new Date('2026-09-27T01:00:00Z')});
  assert.match(fact.local,/26 de setembro/);assert.match(fact.local,/22:00:00/);
});
test('Ordinary requests and prayer do not become canned clock responses',()=>{
  for(const input of ['Que oração!','Crie um jogo','Quanto é 3 + 5?','Explique as horas extras'])assert.equal(clockObservation(input,options),null);
});
