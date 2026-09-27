import http from 'node:http';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
const phase=process.argv[2];
if(!['before','after'].includes(phase))throw new Error('Use before or after. Forward adb tcp:18887 -> tcp:8787 first.');
const file='unreal/AuroraXR/Saved/Standalone/OptimizationBenchmark.json';
const report=existsSync(file)?JSON.parse(readFileSync(file)):{};
let token;
function call(path,body){return new Promise((resolve,reject)=>{
 const request=http.request({hostname:'127.0.0.1',port:18887,path:'/api'+path,method:body?'POST':'GET',headers:{host:'127.0.0.1:8787','content-type':'application/json',...(token?{'x-harness-token':token}:{})}},res=>{
  let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{if(res.statusCode>=400)throw new Error(text);resolve(JSON.parse(text));}catch(error){reject(error);}});
 });request.setTimeout(240000,()=>request.destroy(new Error('Timeout')));request.on('error',reject);request.end(body?JSON.stringify(body):undefined);
});}
({token}=await call('/session'));
report[phase]={at:new Date().toISOString(),turns:[]};
const conversation=await call('/conversations',{title:`Benchmark Quest ${phase}`,provider:'local',teacherProvider:'claude'});
const questions=phase==='before'?['Responda somente o número: quanto é 3 + 5?']:[
 'Responda somente o número: quanto é 3 + 5?',
 'Escolhi a cor violeta para o meu painel. Confirme em uma frase.',
 'Qual cor eu escolhi para o painel? Responda apenas a cor.',
 'Explique em português, em duas frases, a diferença entre uma IA pequena executada localmente em um headset e professores de IA consultados remotamente.'
];
for(const question of questions){
 const started=Date.now();
 const result=await call(`/conversations/${conversation.id}/messages`,{message:question});
 const turn={question,seconds:(Date.now()-started)/1000,ok:result.ok,text:result.message?.content,error:result.error,execution:result.execution};
 if(question===questions[0]){
   turn.arithmeticCorrect=/^(?:3\s*\+\s*5\s*=\s*)?8\.?$/.test(turn.text?.trim()||'');
   turn.requestedFormatCorrect=turn.text?.trim()==='8';
 }
 report[phase].turns.push(turn);writeFileSync(file,JSON.stringify(report,null,2));
 console.log(JSON.stringify({phase,seconds:turn.seconds,ok:turn.ok,tokens:turn.execution?.knownUsage,text:turn.text}));
 if(!result.ok)throw new Error(result.error||'Generation failed');
}
