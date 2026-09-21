import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {curriculum} from './curriculum.mjs';
import {compactContext} from '../../app/economy.js';
import {browserChecker} from './browser-check.mjs';
import {applyLocalEdits} from '../../app/localDiagnostics.js';
const out=resolve('models/local-training/dataset-v1');await mkdir(out,{recursive:true});
const sha=x=>createHash('sha256').update(x).digest('hex');
const train=[],dev=[],checks=[];
const checker=await browserChecker();
try{
for(let variant=0;variant<10;variant++)for(const t of curriculum(variant)){
 const split=variant<8?'train':'dev',target=split==='train'?train:dev;
 const good=await checker.check(t);
 const bad=await checker.check({...t,reference:t.bad});
 const answer=JSON.stringify({edits:[{before:t.before,after:t.after}]});
 const applied=applyLocalEdits(t.bad,answer);
 if(good.status!=='passed'||bad.status!=='failed'||!applied.ok||applied.text!==t.reference)throw Error('Invalid training example '+t.id+JSON.stringify({good,bad,applied}));
 checks.push({id:t.id,split,good,bad,referenceHash:sha(t.reference)});
 const generate=await compactContext({input:t.goal,includeOptional:false,required:[`Etapa 1: ${t.goal}\nAceitação: ${t.goal}\nEntregue somente o artefato html completo.`, 'Contrato de comportamento fixado antes da geração; implemente os seletores e valores esperados, sem alterar os testes:\n'+JSON.stringify(t.contract)]});
 const repair=await compactContext({input:'Corrija a causa da falha acima. Retorne SOMENTE JSON {"edits":[{"before":"trecho exato do código existente","after":"trecho corrigido"}]}. Use 1 a 3 substituições curtas e únicas. before e after devem ser diferentes. Copie before literalmente, inclusive quebras de linha. Não devolva uma página inteira nem altere testes.',includeOptional:false,required:[`Objetivo original (referência para o reparo): ${t.goal}`,'Código existente (CSS omitido, preserve o restante):\n'+t.bad.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'<!-- CSS preservado -->'),'Resultado do teste real:\n'+bad.evidence.join('\n'),'Preserve os comportamentos que já passam. A correção será executada e testada novamente.']});
 target.push({id:t.id+'-generate',kind:'generation',messages:[{role:'user',content:generate.prompt},{role:'assistant',content:t.reference}]},{id:t.id+'-repair',kind:'repair',messages:[{role:'user',content:repair.prompt},{role:'assistant',content:answer}]});
 console.log(JSON.stringify({validated:checks.length,total:100,id:t.id}));
}
}finally{await checker.close();}
// Small retention set: preserve format following and ordinary answers. No personal data.
for(let n=0;n<40;n++){
 const a=n+3,b=n%7+2;
 const pairs=[
 [`Responda somente JSON com soma e produto de ${a} e ${b}.`,JSON.stringify({soma:a+b,produto:a*b})],
 [`Escreva somente uma função JavaScript chamada dobro que devolve o dobro de um número.`, 'function dobro(n) { return n * 2; }'],
 [`Responda apenas o resultado de ${a} + ${b}.`,String(a+b)],
 ['Você executou os testes do meu projeto?','Não executei os testes do seu projeto. Preciso do código e de um ambiente de execução para verificar o resultado.'],
 ['Qual é a diferença entre memória e treinamento de uma IA?','A memória fornece informações no contexto da conversa. O treinamento ajusta parâmetros do modelo com exemplos; precisa ser avaliado para confirmar melhorias.'],
 ['Crie um relatório de vendas real, mas ainda não enviei os dados.','Envie os dados de vendas e o período desejado para eu montar o relatório sem inventar valores.'],
 ['Explique uma lista de tarefas em uma frase.','Uma lista de tarefas organiza o que precisa ser feito e permite acompanhar o que já foi concluído.'],
 ['Como validar uma correção de software?','Reproduza o erro, aplique a correção e execute os testes do comportamento esperado e dos recursos que já funcionavam.']
 ];
 const [q,a2]=pairs[n%pairs.length];train.push({id:'retention-'+n,kind:'retention',messages:[{role:'user',content:q},{role:'assistant',content:a2}]});
}
for(const [name,rows] of [['train',train],['dev',dev]])await writeFile(join(out,name+'.jsonl'),rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
await writeFile(join(out,'checks.json'),JSON.stringify(checks,null,2));
await writeFile(join(out,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),train:train.length,dev:dev.length,verifiedBrowserCases:checks.length,origin:'Hand-authored parameterized curriculum; no user data, previous benchmark output or evaluation references',devLimitation:'Different values and IDs, same training families; development loss is not an independent capability score',trainHash:sha(await readFile(join(out,'train.jsonl'))),devHash:sha(await readFile(join(out,'dev.jsonl'))),sourceHash:sha(await readFile(new URL('./curriculum.mjs',import.meta.url)))},null,2));
