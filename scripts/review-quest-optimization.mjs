import {correctLocalAnswer} from '../app/correction.js';
import {readFileSync,writeFileSync} from 'node:fs';
const question='Revise esta otimização do Harness no Quest, sem executar ferramentas. O modelo é Qwen3.5 0.8B com 4096 tokens. O prompt antigo injetava skills e memórias irrelevantes (até conta simples levava 59 s). A nova seleção léxica é restrita ao perfil quest-chat-v1, no backend original. O desktop continua no caminho anterior. Examine riscos de perda de contexto, autoridade das mensagens, regressão e medição. Não afirme ter executado testes.';
const source=readFileSync('app/questContext.js','utf8');
const result=await correctLocalAnswer({question,wrongAnswer:source,note:'Revise o código proposto. Retorne avaliação em answer, apontando somente problemas concretos e a correção mínima. Não reescreva o projeto. Testes já verificam ordem, referências, requisito grande e ausência de skills irrelevantes.',teacherProvider:'claude',env:{...process.env,CORRECTION_TIMEOUT_MS:'120000'}});
writeFileSync('unreal/AuroraXR/Saved/Standalone/OptimizationTeacherReview.json',JSON.stringify(result,null,2));
console.log(result.ok?'Review ready':result.error);
