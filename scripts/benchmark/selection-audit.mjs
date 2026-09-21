import {readFile,writeFile,mkdir} from 'node:fs/promises';
process.env.HARNESS_DB_FILE ||= 'app/data/benchmarks/memory-selective-v1-2026-09-20/snapshot.db';
process.env.HARNESS_CONTEXT_POLICY='selective-v1';
const {selectRelevantMemories}=await import('../../app/store.js');
const {compactContext}=await import('../../app/economy.js');
const positive=[
 ['Implemente colisão AABB entre retângulos com teste de bordas e sobreposição.','Colisão AABB entre retângulos'],
 ['Meu jogo duplica eventos ao reiniciar. Corrija reset, timers e listeners para cinco partidas.','Reiniciar sem estado antigo nem eventos duplicados'],
 ['O AudioContext bloqueia som antes de interação. Quero áudio, música, mute e controle de volume.','Áudio iniciado por interação e controle de volume'],
 ['No Godot 4, como mover CharacterBody2D com move_and_slide e colisões de chão e parede?','Godot: CharacterBody e movimento controlado'],
 ['Movimento com velocidade em segundos deve funcionar em 30, 60 e 120 FPS; use delta dt.','Movimento independente de FPS com delta time'],
];
const negative=['Escreva um poema sobre saudade.','Crie um dashboard BI com receita, custos e margem.','Monte uma landing page com formulário de inscrição.','Crie um app de lista de tarefas com checkbox e filtro de pendentes.'];
const checks=[];
for(const [query,expected]of [...positive,...negative.map(q=>[q,null])]){const memories=await selectRelevantMemories(query);const context=await compactContext({input:query,memories});checks.push({query,expected,selected:memories.map(m=>m.title),memoryChars:context.memoryChars,pass:expected?memories.some(m=>m.title===expected&&context.memoryIds.includes(m.id)):memories.length===0});}
const out='reports/cycle1-selection-audit';await mkdir(out,{recursive:true});await writeFile(out+'/results.json',JSON.stringify({date:new Date().toISOString(),kind:'development regression set, not held-out precision estimate',checks,passed:checks.filter(c=>c.pass).length,total:checks.length},null,2));console.log(JSON.stringify(checks,null,2));
