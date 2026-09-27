// Offline prompt comparison on a copy of the initial database; no model calls.
import {copyFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const stage=resolve('unreal/AuroraXR/Saved/Standalone');
const db=resolve(stage,'context-audit.db');
copyFileSync(resolve(stage,'harness-import.db'),db);
process.env.HARNESS_DB_FILE=db;process.env.LOCAL_ENGINE='llama.cpp';
const {selectRelevantMemories}=await import('../app/store.js');
const {compactContext}=await import('../app/economy.js');
const {compactQuestContext}=await import('../app/questContext.js');
const questions=['Responda somente o número: quanto é 3 + 5?',
 'Explique em português, em duas frases, a diferença entre uma IA pequena executada localmente em um headset e professores de IA consultados remotamente.',
 'Qual é o projeto Aurora Presence?'];
const report={source:'Copy of initial Quest database (90 memories), no inference or speed claims',rows:[]};
for(const input of questions){
 const legacy=await compactContext({input,memories:await selectRelevantMemories(input,{},12,{LOCAL_ENGINE:'llama.cpp'}),limit:12000});
 const env={LOCAL_ENGINE:'llama.cpp',HARNESS_CONTEXT_POLICY:'quest-chat-v1'};
 const optimized=await compactQuestContext({input,memories:await selectRelevantMemories(input,{},12,env),env});
 const row={question:input,before:{characters:legacy.prompt.length,memories:legacy.memoryIds.length,skills:legacy.skills.map(s=>s.name)},after:{characters:optimized.prompt.length,memories:optimized.memoryIds.length,skills:optimized.skills.map(s=>s.name)}};
 report.rows.push(row);console.log(JSON.stringify(row));
}
writeFileSync(resolve(stage,'ContextAudit.json'),JSON.stringify(report,null,2));
