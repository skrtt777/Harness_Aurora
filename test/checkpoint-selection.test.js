import test from 'node:test';
import assert from 'node:assert/strict';
import {rankDevelopmentCheckpoints} from '../scripts/training/checkpoint-selection.mjs';
const manifest={models:{e1:'model:e1',e2:'model:e2'},development:{tasks:[{id:'a'},{id:'b'}],seeds:[1]}};
const result=(arm,passes,tokens=20)=>({phase:'dev',arm,model:'model:'+arm,passed:999,records:['a','b'].map((id,i)=>({phase:'dev',id,seed:1,model:'model:'+arm,passed:i<passes,tokens,estimatedTokens:0})),retention:[true,true,true,true].map(passed=>({passed}))});
test('checkpoint selection uses measured development results, ties prefer tokens then earlier epoch',()=>{
 assert.equal(rankDevelopmentCheckpoints(manifest,[result('e1',1),result('e2',2)])[0].arm,'e2');
 assert.equal(rankDevelopmentCheckpoints(manifest,[result('e2',1,30),result('e1',1,20)])[0].arm,'e1');
 assert.equal(rankDevelopmentCheckpoints(manifest,[result('e2',1),result('e1',1)])[0].arm,'e1');
});
test('final results, duplicates and incomplete checkpoints cannot select a model',()=>{
 const a=result('e1',1),b=result('e2',2);
 assert.throws(()=>rankDevelopmentCheckpoints(manifest,[a,{...b,phase:'final'}]));
 assert.throws(()=>rankDevelopmentCheckpoints(manifest,[a,{...b,records:[b.records[0],b.records[0]]}]));
 assert.throws(()=>rankDevelopmentCheckpoints(manifest,[a]));
 assert.throws(()=>rankDevelopmentCheckpoints(manifest,[a,{...b,retention:[]}]));
});
test('a model abort is a failed outcome with charged reserved tokens, never a free retry',()=>{
 const a=result('e1',1),b=result('e2',1);b.records[1].estimatedTokens=80;
 const ranked=rankDevelopmentCheckpoints(manifest,[a,b]);assert.equal(ranked[0].arm,'e1');assert.equal(ranked[1].tokens,120);assert.equal(ranked[1].estimatedTokens,80);
 b.records[1].passed=true;assert.throws(()=>rankDevelopmentCheckpoints(manifest,[a,b]));
});
