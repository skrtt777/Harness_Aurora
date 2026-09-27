// Read-only audit of actual text delivered to the Quest Harness (ADB 18887 -> 8787).
import http from 'node:http';
import {writeFileSync} from 'node:fs';
let token;
function get(path){return new Promise((resolve,reject)=>{
  const req=http.get({hostname:'127.0.0.1',port:18887,path:'/api'+path,
    headers:{host:'127.0.0.1:8787',...(token?{'x-harness-token':token}:{})}},res=>{
    let data='';res.on('data',c=>data+=c);res.on('end',()=>{
      try{if(res.statusCode!==200)throw new Error(`HTTP ${res.statusCode}`);resolve(JSON.parse(data));}catch(e){reject(e);}
    });
  });req.setTimeout(10000,()=>req.destroy(new Error('Quest offline')));req.on('error',reject);
});}
({token}=await get('/session'));
const list=await get('/conversations'),report={at:new Date().toISOString(),conversations:[]};
for(const c of list.conversations.slice(0,12)){
  const detail=await get('/conversations/'+c.id);
  report.conversations.push(detail);
  const messages=detail.messages||[];
  const matches=messages.map((m,i)=>/\bhoras?\b|ora[çc][aã]o/i.test(m.content)?i:-1).filter(i=>i>=0);
  if(matches.length){
    const indices=new Set(matches.flatMap(i=>[i-1,i,i+1]).filter(i=>i>=0&&i<messages.length));
    console.log(JSON.stringify({title:c.title,messages:[...indices].sort((a,b)=>a-b).map(i=>{
      const m=messages[i];return {role:m.role,text:m.content,createdAt:m.createdAt,memoryAccess:m.memoryAccess};
    })},null,2));
  }
}
writeFileSync('unreal/AuroraXR/Saved/MoePort/conversation-audit.json',JSON.stringify(report,null,2));
console.log('Read-only audit saved:',report.conversations.length,'conversations');
