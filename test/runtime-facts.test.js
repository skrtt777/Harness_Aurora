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
test('Requests relative to today get the date as evidence, not the clock answer',()=>{
  for(const input of ['Mostre quantos funcionários vão entrar de férias esse mês?','Como está o budget este ano?','Quem está de férias agora?','Qual contrato vence primeiro?','Qual é o próximo imposto a vencer?']){
    const fact=clockObservation(input,options);
    assert.ok(fact,input);assert.match(fact.block,/^Data de hoje: .*27 de setembro de 2026/);assert.doesNotMatch(fact.block,/Hora atual/);
  }
});
test('Ordinary requests and prayer do not become canned clock responses',()=>{
  for(const input of ['Que oração!','Crie um jogo','Quanto é 3 + 5?','Explique as horas extras'])assert.equal(clockObservation(input,options),null);
});

test('arithmetic in Portuguese is computed exactly and handed to the model', async () => {
  const { mathObservation } = await import('../app/runtimeFacts.js');
  const value = (q) => mathObservation(q)?.local ?? null;
  assert.equal(value('Quanto é 17 vezes 3? Responda só o número.'), '17 * 3 = 51');
  assert.equal(value('quanto é 17x3'), '17 * 3 = 51');
  assert.equal(value('Calcule 15% de 200'), '( 15 / 100 * 200 ) = 30');
  assert.equal(value('quanto fica 84 dividido por 4'), '84 / 4 = 21');
  assert.equal(value('quanto é 1.234,50 mais 10'), '1.234,50 + 10 = 1.244,5');
  assert.match(mathObservation('quanto é 17 vezes 3').block, /responda com este valor/);
  for (const q of ['Quanto é o vale-refeição?', 'O plantão vai de 26/12/2026 a 30/12/2026', 'ligue 4000-1234', 'Me traz um resumo de 2026', 'quanto é 10 dividido por 0', 'abra o texto 2 de 3']) assert.equal(value(q), null, q);
});
