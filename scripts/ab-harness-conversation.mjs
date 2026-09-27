// A/B of two Harness checkouts on the same conversation, several seeds each.
// Each variant runs its own server (no central sync) on a fresh copy of the database.
// Usage: node scripts/ab-harness-conversation.mjs <dirA> <dirB> <db> [seeds=3]
import {spawn} from 'node:child_process';
import {copyFileSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const [dirA,dirB,db,seedCount='3']=process.argv.slice(2);
if(!db)throw new Error('Uso: node scripts/ab-harness-conversation.mjs <dirA> <dirB> <db> [seeds]');
const out='tmp/ab';mkdirSync(out,{recursive:true});
// Objective checks per question; each returns true when the answer meets the request.
const CHECKS=[
  // Any HH:MM in the answer within 2 minutes of the real local time of the request.
  ['que horas são?',(t,at)=>[...t.matchAll(/\b(\d{1,2})[:h](\d{2})/g)].some(([,h,m])=>{
    const real=at.getHours()*60+at.getMinutes(),said=Number(h)*60+Number(m);
    return Math.min(Math.abs(real-said),1440-Math.abs(real-said))<=2;})],
  ['Quanto é 17 × 23? Responda só o número.',t=>/\b391\b/.test(t)],
  ['Meu painel favorito é o violeta. Confirme em uma frase.',t=>/violeta/i.test(t)],
  ['Qual é a cor do meu painel favorito?',t=>/violeta/i.test(t)],
  ['No Godot, como devo mover um personagem controlado por código?',t=>/CharacterBody|move_and_slide/i.test(t)],
  ['Como faço o áudio de um jogo no navegador tocar sem ser bloqueado?',t=>/(intera|clique|gesto|a[çc][ãa]o do usu[áa]rio|user gesture)/i.test(t)&&/AudioContext|resume/i.test(t)],
  ['Mudando de assunto: me dê duas dicas curtas para dormir melhor.',t=>!/(n[ãa]o (posso|consigo|é poss[ií]vel)|lacuna)/i.test(t)&&/(luz|tela|cafe[íi]na|hor[áa]rio|rotina|escuro|quarto)/i.test(t)],
  ['Resuma em uma frase o que conversamos até agora.',t=>/(violeta|godot|[áa]udio|sono|dormir)/i.test(t)],
];
const call=(port,path,body,token)=>fetch(`http://127.0.0.1:${port}/api${path}`,{method:body?'POST':'GET',
  headers:{'content-type':'application/json',...(token?{'x-harness-token':token}:{})},body:body&&JSON.stringify(body),signal:AbortSignal.timeout(600000)}).then(r=>r.json());
async function run(dir,label,seed,port){
  const copy=resolve(out,`${label}-${seed}.db`);copyFileSync(db,copy);
  const server=spawn(process.execPath,['-e',`import(${JSON.stringify('file:///'+resolve(dir,'app/server.js').replace(/\\/g,'/'))}).then(({createServer})=>createServer({allowDev:false,centralSync:false}).listen(${port},'127.0.0.1',()=>console.log('pronto')))`],
    {env:{...process.env,HARNESS_DB_FILE:copy,LOCAL_SEED:String(seed)},stdio:['ignore','pipe','inherit']});
  await new Promise(ok=>server.stdout.on('data',d=>String(d).includes('pronto')&&ok()));
  try{
    const {token}=await call(port,'/session');
    const conversation=await call(port,'/conversations',{title:`AB ${label} ${seed}`,provider:'local'},token);
    const turns=[];
    for(const [question,check] of CHECKS){
      const at=new Date(),r=await call(port,`/conversations/${conversation.id}/messages`,{message:question},token);
      const text=r.message?.content||r.error||'';
      turns.push({question,text,pass:check(text,at),memories:(r.message?.memoryAccess||[]).length,inputTokens:r.execution?.knownUsage?.input_tokens??null});
    }
    return turns;
  }finally{server.kill();}
}
const results={};
for(const [label,dir] of [['A',dirA],['B',dirB]]){
  results[label]=[];
  for(let seed=1;seed<=Number(seedCount);seed++)results[label].push(await run(dir,label,seed,8810+seed));
}
writeFileSync(join(out,'resultado.json'),JSON.stringify(results,null,2));
for(let i=0;i<CHECKS.length;i++){
  const row=['A','B'].map(l=>{const t=results[l].map(s=>s[i]);return `${t.filter(x=>x.pass).length}/${t.length} ok, ~${Math.round(t.reduce((n,x)=>n+(x.inputTokens||0),0)/t.length)} tok`;});
  console.log(`${String(i+1).padStart(2)} A: ${row[0]} | B: ${row[1]} | ${CHECKS[i][0]}`);
}
const total=l=>results[l].flat().filter(x=>x.pass).length+'/'+results[l].flat().length;
const tokens=l=>Math.round(results[l].flat().reduce((n,x)=>n+(x.inputTokens||0),0)/results[l].flat().length);
console.log(`\nTotal A: ${total('A')} (média ${tokens('A')} tokens de entrada) | B: ${total('B')} (média ${tokens('B')} tokens de entrada)`);
