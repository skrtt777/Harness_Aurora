// Use the original Harness teacher path; advisory review, not device validation.
import {correctLocalAnswer} from '../app/correction.js';
import {readFileSync,writeFileSync} from 'node:fs';
const files=['docs/QUEST_MOE_PORT.md','scripts/probe-quest-moe.py','scripts/prepare-quest-moe.py'];
const source=files.map(file=>`${file}\n${readFileSync(file,'utf8')}`).join('\n\n');
await Promise.all(['claude','codex'].map(async teacherProvider=>{
  const result=await correctLocalAnswer({
    question:'Revise o porte fiel do Harness original e de seu experimento Swap-MoE/Qwen3-Coder30B para Quest3S 8GB. O usuario rejeitou a substituicao por modelo denso0.8B e exige a arquitetura original com pesos no armazenamento. Nao execute ferramentas nem altere arquivos. Avalie problemas concretos no probe e no gerenciamento de memoria Android; nao invente resultados.',
    wrongAnswer:source,
    note:'O executavel ja compilou e --version rodou no Android. Os pesos estao sendo transferidos; nenhuma inferencia MoE no aparelho foi medida. O contexto de conversa alternativo foi removido do servidor. Auditoria real encontrou transcricao inicial "Que Oracao!", depois "Que horas sao?" correto e repeticao da resposta antiga. Distinguir problema de transcricao, arrasto de historico e ausencia de relogio factual. Retorne apenas revisao em answer; nao afirme ter validado o dispositivo.',
    teacherProvider,env:{...process.env,CORRECTION_TIMEOUT_MS:'180000'}});
  writeFileSync(`unreal/AuroraXR/Saved/MoePort/review-${teacherProvider}.json`,JSON.stringify(result,null,2));
  console.log(teacherProvider,result.ok?'review saved':result.error);
}));
