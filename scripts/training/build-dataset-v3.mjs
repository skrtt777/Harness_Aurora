import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {curriculum} from './curriculum.mjs';
import {diverseCurriculum} from './curriculum-v2.mjs';
import {curriculumV3} from './curriculum-v3.mjs';
import {compactContext} from '../../app/economy.js';
import {browserChecker} from './browser-check.mjs';
import {applyLocalEdits} from '../../app/localDiagnostics.js';
const out='models/local-training/dataset-v3';await mkdir(out,{recursive:false});
const sha=x=>createHash('sha256').update(x).digest('hex'),train=[],dev=[],checks=[],families=new Set();
const checker=await browserChecker();
try{
 // All of v1+v2's authored families, plus the new v3 families targeting
 // failure patterns actually measured this session (see curriculum-v3.mjs) —
 // maximizes verified training volume instead of starting over.
 for(let v=0;v<3;v++)for(const t of [...diverseCurriculum(v),...curriculumV3(v),...(v<2?curriculum(v):[])]){
  const good=await checker.check(t),bad=await checker.check({...t,reference:t.bad});
  const answer=JSON.stringify({edits:[{before:t.before,after:t.after}]}),applied=applyLocalEdits(t.bad,answer);
  if(good.status!=='passed'||bad.status!=='failed'||!applied.ok||applied.text!==t.reference)throw Error('Invalid example '+t.id+JSON.stringify({good,bad,applied}));
  const family=t.family||t.id.replace(/-\d+$/,'');families.add(family);checks.push({id:t.id,family,good,bad,referenceHash:sha(t.reference)});
  const context=await compactContext({input:t.goal,includeOptional:false,required:[`Etapa 1: ${t.goal}\nAceitação: ${t.goal}\nEntregue somente o artefato html completo.`,'Contrato de comportamento fixado antes da geração; implemente os seletores e valores esperados, sem alterar os testes:\n'+JSON.stringify(t.contract)]});
  const prompt=v===1?t.goal:context.prompt;
  train.push({id:t.id+'-generate',kind:'generation',family,messages:[{role:'user',content:prompt},{role:'assistant',content:t.reference}]});
  const repair=await compactContext({input:'Corrija a causa da falha acima. Retorne SOMENTE JSON {"edits":[{"before":"trecho exato do código existente","after":"trecho corrigido"}]}. Use 1 a 3 substituições curtas e únicas. before e after devem ser diferentes. Copie before literalmente, inclusive quebras de linha. Não devolva uma página inteira nem altere testes.',includeOptional:false,required:[`Objetivo original (referência para o reparo): ${t.goal}`,'Código existente (CSS omitido, preserve o restante):\n'+t.bad.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'<!-- CSS preservado -->'),'Resultado do teste real:\n'+bad.evidence.join('\n'),'Preserve os comportamentos que já passam. A correção será executada e testada novamente.']});
  train.push({id:t.id+'-repair',kind:'repair',family,messages:[{role:'user',content:repair.prompt},{role:'assistant',content:answer}]});
  console.log(JSON.stringify({checked:checks.length,id:t.id}));
 }
}finally{await checker.close();}
// Exact executable pure-function examples, not copied model answers. All
// v2's 20 plus new ones (distinct names) so nothing already-verified is lost.
const algorithms=[
 ['sum','somar números de um array (vazio retorna 0)','xs.reduce((a,x)=>a+x,0)',[[[],0],[[2,-1,5],6]]],
 ['unique','remover números duplicados preservando ordem','[...new Set(xs)]',[[[2,1,2],[2,1]],[[],[]]]],
 ['positive','filtrar números estritamente positivos','xs.filter(x=>x>0)',[[[-1,0,3],[3]],[[],[]]]],
 ['mean','calcular média, com 0 para array vazio','xs.length?xs.reduce((a,x)=>a+x,0)/xs.length:0',[[[2,4],3],[[],0]]],
 ['max','maior número, com null para vazio','xs.length?Math.max(...xs):null',[[[-5,-2],-2],[[],null]]],
 ['min','menor número, com null para vazio','xs.length?Math.min(...xs):null',[[[4,2,9],2],[[],null]]],
 ['ascending','ordenar números de forma crescente sem modificar entrada','[...xs].sort((a,b)=>a-b)',[[[10,2,1],[1,2,10]],[[],[]]]],
 ['descending','ordenar números de forma decrescente sem modificar entrada','[...xs].sort((a,b)=>b-a)',[[[10,2,1],[10,2,1]],[[],[]]]],
 ['squares','elevar números ao quadrado','xs.map(x=>x*x)',[[[-2,3],[4,9]],[[],[]]]],
 ['even','filtrar números pares','xs.filter(x=>x%2===0)',[[[-2,1,4],[-2,4]],[[],[]]]],
 ['odd','filtrar números ímpares, incluindo negativos','xs.filter(x=>x%2!==0)',[[[-3,2,1],[-3,1]],[[],[]]]],
 ['reverse','inverter array sem modificar entrada','[...xs].reverse()',[[[1,2,3],[3,2,1]],[[],[]]]],
 ['nonempty','remover strings vazias ou apenas espaços','xs.filter(x=>x.trim().length>0)',[[['',' ','a'],['a']],[[],[]]]],
 ['lengths','comprimentos das strings','xs.map(x=>x.length)',[[['a','abc'],[1,3]],[[],[]]]],
 ['totalPrice','somar price*qty de objetos','xs.reduce((a,x)=>a+x.price*x.qty,0)',[[[{price:5,qty:2},{price:3,qty:4}],22],[[],0]]],
 ['flatten','achatar um nível de arrays','xs.flat()',[[[[1,2],[3]],[1,2,3]],[[],[]]]],
 ['allPositive','verificar se todos os números são positivos','xs.every(x=>x>0)',[[[1,2],true],[[1,0],false]]],
 ['anyNegative','verificar se há algum número negativo','xs.some(x=>x<0)',[[[0,2],false],[[-1,3],true]]],
 ['countTrue','contar valores estritamente true','xs.filter(x=>x===true).length',[[[true,1,false,true],2],[[],0]]],
 ['names','extrair a propriedade name de cada objeto','xs.map(x=>x.name)',[[[{name:'Ana'},{name:'Bia'}],['Ana','Bia']],[[],[]]]],
 // New for v3.
 ['clampAll','limitar cada número entre 0 e 10','xs.map(x=>Math.min(10,Math.max(0,x)))',[[[-5,3,20],[0,3,10]],[[],[]]]],
 ['groupCount','contar ocorrências de cada valor de string em um objeto','xs.reduce((a,x)=>{a[x]=(a[x]||0)+1;return a;},{})',[[['a','b','a'],{a:2,b:1}],[[],{}]]],
 ['roundTwo','arredondar cada número para duas casas decimais','xs.map(x=>Math.round(x*100)/100)',[[[1.005,2.999],[1,3]],[[],[]]]],
 ['distinctBy','remover objetos com id duplicado, mantendo o primeiro','xs.filter((x,i)=>xs.findIndex(y=>y.id===x.id)===i)',[[[{id:1},{id:1},{id:2}],[{id:1},{id:2}]],[[],[]]]],
];
for(const [family,description,expression,cases] of algorithms)for(let v=0;v<3;v++){
 const name=family+(v?'V'+v:''),code=`function ${name}(xs) {\n  return ${expression};\n}`;
 for(const [input,expected] of cases){const actual=vm.runInNewContext(code+`;${name}(${JSON.stringify(input)})`,Object.create(null),{timeout:100});assert.equal(JSON.stringify(actual),JSON.stringify(expected));}
 train.push({id:`algorithm-${name}`,family,kind:'javascript',messages:[{role:'user',content:`Escreva somente a função JavaScript ${name}(xs) para ${description}.`},{role:'assistant',content:code}]});
}
for(let n=0;n<24;n++){
 const a=n+11,b=n%5+3,kind=n%3;
 const input=kind===0?`Responda apenas o resultado: ${a} + ${b}.`:kind===1?`Responda somente JSON com soma e produto de ${a} e ${b}.`:`Converta em CSV com cabeçalho nome,valor: item Azul com valor ${a}, item Verde com valor ${b}.`;
 const output=kind===0?String(a+b):kind===1?JSON.stringify({soma:a+b,produto:a*b}):`nome,valor\nAzul,${a}\nVerde,${b}`;
 train.push({id:'format-'+n,kind:'retention',messages:[{role:'user',content:input},{role:'assistant',content:output}]});
}
const answers=[
 ['Como validar uma correção?','Reproduza o defeito, aplique a correção e execute testes do comportamento esperado e dos recursos já existentes.'],
 ['Você já testou o código que acabou de escrever?','Ainda não executei esse código. A validação precisa ocorrer em um ambiente de execução.'],
 ['Preciso de um BI com dados reais, mas não tenho a planilha aqui.','Envie os dados e informe os indicadores desejados. Posso preparar a estrutura, mas não calcular resultados reais sem os dados.'],
 ['O que devo guardar na memória da IA?','Guarde decisões, requisitos e soluções verificadas que possam ser reutilizados. Inclua o contexto e as limitações de cada informação.'],
 ['Qual a diferença entre treino e memória?','O treinamento ajusta parâmetros do modelo. A memória fornece informações para consultas futuras, sem necessariamente alterar esses parâmetros.'],
 ['Por que dividir um projeto em etapas?','Etapas pequenas permitem validar resultados, localizar falhas e evitar repetir trabalho que já foi concluído.'],
 ['Como reduzir tokens sem perder requisitos?','Recupere apenas informações relevantes, reutilize resultados aprovados e mantenha completos os requisitos necessários para a tarefa atual.'],
 ['Uma página abrir significa que o jogo funciona?','Não. Também é necessário testar controles, regras, pontuação e reinício.'],
 ['Posso considerar precisão de 100% porque três exemplos passaram?','Três exemplos aprovados mostram apenas que esses casos passaram. É necessário avaliar uma amostra maior e variada.'],
 ['O que é um teste de regressão?','É um teste que verifica se uma mudança prejudicou um comportamento que antes funcionava.'],
 ['Como evitar injetar HTML ao mostrar nomes de usuário?','Use textContent ou nós de texto para exibir o conteúdo como texto literal.'],
 ['Qual o custo de energia sem medir potência?','Só é possível estimar com uma hipótese de potência e tarifa. O resultado deve ser identificado como estimativa.'],
 ['Um select com opção "todos" deve começar em qual estado?','No estado normal (ex.: "todos"), não no caso de borda vazio — o caso de borda é tratado quando o usuário escolher, não como padrão inicial.'],
 ['Um campo numérico que recebe um valor após um clique deve continuar editável?','Sim. Um valor que precisa ser lido de novo depois exige um elemento editável real, não um texto estático.'],
];
for(const [i,[q,a]] of answers.entries())train.push({id:'qa-'+i,kind:'retention',messages:[{role:'user',content:q},{role:'assistant',content:a}]});
// Development loss is auxiliary only. Functional development tasks choose checkpoint.
const oldDev=(await readFile('models/local-training/dataset-v1/dev.jsonl','utf8')).trim().split('\n').map(JSON.parse);
dev.push(...oldDev);
const seen=new Set();const dedup=train.filter(r=>{const h=sha(JSON.stringify(r.messages));if(seen.has(h))return false;seen.add(h);return true;});
for(const [name,rows] of [['train',dedup],['dev',dev]])await writeFile(out+'/'+name+'.jsonl',rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
await writeFile(out+'/checks.json',JSON.stringify(checks,null,2));
await writeFile(out+'/manifest.json',JSON.stringify({createdAt:new Date().toISOString(),train:dedup.length,dev:dev.length,browserCases:checks.length,browserFamilies:[...families],algorithmFamilies:algorithms.length,algorithmCasesChecked:algorithms.reduce((s,x)=>s+x[3].length*3,0),categories:Object.fromEntries([...new Set(dedup.map(r=>r.kind))].map(k=>[k,dedup.filter(r=>r.kind===k).length])),trainHash:sha(await readFile(out+'/train.jsonl')),devHash:sha(await readFile(out+'/dev.jsonl')),origin:'Authored and verified locally (v1+v2 families retained, new v3 families added). No final references, user conversations or external teacher API.'},null,2));
