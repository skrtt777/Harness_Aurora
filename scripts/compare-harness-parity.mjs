// Runs the same local conversation against any Harness endpoint (desktop, desktop
// simulating the Quest, or the Quest through `adb forward tcp:18887 tcp:8787`) so
// answers, memory use and latency can be compared side by side.
// Usage: node scripts/compare-harness-parity.mjs <label> [port=8787] [serverPort=port] [out=tmp/parity]
// Quest: adb forward tcp:18887 tcp:8787, then `quest 18887 8787`.
import http from 'node:http';
import {writeFileSync,mkdirSync} from 'node:fs';
const [label,port='8787',serverPort=port,outDir='tmp/parity']=process.argv.slice(2);
if(!label)throw new Error('Informe um rótulo, por exemplo: pc-ollama, pc-llamacpp, quest.');
export const QUESTIONS=[
  'que horas são?',
  'Quanto é 17 × 23? Responda só o número.',
  'Meu painel favorito é o violeta. Confirme em uma frase.',
  'Qual é a cor do meu painel favorito?',
  'No Godot, como devo mover um personagem controlado por código?',
  'Como faço o áudio de um jogo no navegador tocar sem ser bloqueado?',
  'Mudando de assunto: me dê duas dicas curtas para dormir melhor.',
  'Resuma em uma frase o que conversamos até agora.',
];
let token;
function call(path,body){return new Promise((resolve,reject)=>{
  const request=http.request({hostname:'127.0.0.1',port:Number(port),path:'/api'+path,method:body?'POST':'GET',
    headers:{host:`127.0.0.1:${serverPort}`,'content-type':'application/json',...(token?{'x-harness-token':token}:{})}},res=>{
    let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,...JSON.parse(text)});}catch(error){reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0,300)}`));}});
  });
  request.setTimeout(600000,()=>request.destroy(new Error('Timeout')));request.on('error',reject);request.end(body?JSON.stringify(body):undefined);
});}
// Share of repeated word 4-grams: a cheap signal for looping/echoing answers.
export function repetition(text){
  const words=String(text||'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
  const grams=words.slice(3).map((_,i)=>words.slice(i,i+4).join(' '));
  return grams.length?+(1-new Set(grams).size/grams.length).toFixed(3):0;
}
({token}=await call('/session'));
const conversation=await call('/conversations',{title:`Paridade ${label} ${new Date().toISOString()}`,provider:'local'});
const report={label,port:Number(port),startedAt:new Date().toISOString(),conversationId:conversation.id,turns:[]};
mkdirSync(outDir,{recursive:true});
for(const question of QUESTIONS){
  const started=Date.now(),result=await call(`/conversations/${conversation.id}/messages`,{message:question});
  const text=result.message?.content??null;
  const turn={question,seconds:(Date.now()-started)/1000,ok:!!result.ok,text,error:result.error??null,repetition:repetition(text),
    memoryAccess:result.message?.memoryAccess??null,usage:result.execution?.knownUsage??null,model:result.execution?.model??null};
  report.turns.push(turn);writeFileSync(`${outDir}/${label}.json`,JSON.stringify(report,null,2));
  console.log(`[${label}] ${turn.seconds.toFixed(1)}s rep=${turn.repetition} | ${question}\n  -> ${(text??turn.error??'').replace(/\s+/g,' ').slice(0,300)}`);
}
