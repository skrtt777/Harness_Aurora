// Dedicated, TLS-only XR surface. The desktop API and its local session stay private.
import https from 'node:https';
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const equal = (a,b) => a.length === b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
export class XRStore {
  constructor(directory) {
    mkdirSync(directory,{recursive:true}); this.file=join(directory,'state.json');
    this.data=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{devices:{},operations:{}};
    // A desktop mutation may have succeeded before a crash. Never replay it automatically.
    for(const op of Object.values(this.data.operations)) if(op.state==='pending') { op.state='uncertain'; op.error='Ponte reiniciada durante a operação. Confira a conversa antes de enviar novamente.'; }
    this.save();
  }
  save() { writeFileSync(this.file+'.tmp',JSON.stringify(this.data),{mode:0o600}); renameSync(this.file+'.tmp',this.file); }
  issueDevice(name) {
    const token=randomBytes(32).toString('hex'), id=randomBytes(16).toString('hex');
    this.data.devices[id]={name:String(name).slice(0,80),hash:digest(token),createdAt:new Date().toISOString()}; this.save();
    return {deviceId:id,token};
  }
  authenticate(token) {
    if(!/^[a-f0-9]{64}$/.test(token)) fail(401,'Dispositivo não pareado.');
    const hashed=digest(token);
    const device=Object.entries(this.data.devices).find(([,d])=>!d.revoked && equal(d.hash,hashed));
    if(!device) fail(401,'Sessão do dispositivo inválida ou revogada.');
    return device[0];
  }
  revoke(id) { if(this.data.devices[id]) {this.data.devices[id].revoked=true;this.save();} }
}

export function createDesktopClient(base='http://127.0.0.1:8787') {
  const url=new URL(base);
  if(url.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('Backend XR deve ser loopback.');
  let session;
  return async (path,method='GET',body) => {
    if(!session) {
      const r=await fetch(`${base}/api/session`,{signal:AbortSignal.timeout(5000)});
      if(!r.ok) fail(502,'Harness local indisponível.');
      session=(await r.json()).token;
    }
    const r=await fetch(`${base}/api${path}`,{method,headers:{'content-type':'application/json','x-harness-token':session},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(600000)});
    if(r.status===401) session=undefined; // Never retry mutations implicitly.
    const result=await r.json();
    if(!r.ok) fail(r.status,result.error||'Falha no Harness.');
    return result;
  };
}

async function jsonBody(req,limit=1_000_000) {
  if(req.headers['content-type']?.split(';')[0]!=='application/json') fail(415,'Use application/json.');
  const chunks=[];let length=0;
  for await (const chunk of req) {length+=chunk.length;if(length>limit) fail(413,'Conteúdo grande demais.');chunks.push(chunk);}
  let body;try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'JSON inválido.');}
  if(!body||Array.isArray(body)||typeof body!=='object')fail(400,'Objeto JSON obrigatório.');
  return body;
}
function textField(body,key,max,required=true) {
  const value=body[key];
  if(!required&&value===undefined)return undefined;
  if(typeof value!=='string'||!value.trim()||value.length>max) fail(400,`Campo ${key} inválido.`);
  return value;
}
function identifier(value) {if(typeof value!=='string'||!idPattern.test(value))fail(400,'Identificador inválido.');return value;}

export function createXRHandler({store,desktop,media={},teachers={},now=()=>Date.now()}) {
  let teachersActive=0;
  let wakeActive=0;
  let pairing=null;
  const startPairing=()=> { pairing={code:String(randomInt(100000,1000000)),expires:now()+120000,attempts:0};return {code:pairing.code,expiresAt:pairing.expires}; };
  const respond=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
  const submit=(device,body,kind,action)=>{
    const requestId=identifier(body.requestId),key=`${device}:${requestId}`;
    const hash=digest(JSON.stringify({kind,body}));
    const existing=store.data.operations[key];
    if(existing){if(existing.hash!==hash)fail(409,'Identificador já utilizado para outra operação.');return existing;}
    if(Object.values(store.data.operations).filter(o=>o.state==='pending').length>=4)fail(429,'Aguarde as operações em andamento.');
    const op={requestId,kind,hash,state:'pending',createdAt:new Date(now()).toISOString()};
    store.data.operations[key]=op;store.save();
    Promise.resolve().then(action).then(result=>{op.state='complete';op.result=result;},error=>{
      // Network errors cannot prove whether the desktop committed the request.
      op.state=error.status?'failed':'uncertain';op.error=error.status?error.message:'Conexão interrompida; confira o histórico antes de repetir.';
    }).finally(()=>store.save());
    return op;
  };
  const handler=async(req,res)=>{
    try {
      if(req.headers.origin)fail(403,'A ponte aceita somente clientes nativos.');
      const url=new URL(req.url,'https://xr.local');const p=url.pathname;const method=req.method;
      if(p==='/xr/v1/health'&&method==='GET')return respond(res,200,{ok:true,protocol:1});
      if(p==='/xr/v1/pair'&&method==='POST') {
        if(!pairing||pairing.expires<now()||pairing.attempts>=5)fail(403,'Pareamento fechado ou expirado.');
        pairing.attempts++;
        const body=await jsonBody(req,2048);
        if(typeof body.code!=='string'||!equal(body.code,pairing.code))fail(403,'Código inválido.');
        const device=store.issueDevice(textField(body,'name',80));pairing=null;
        return respond(res,201,device);
      }
      const device=store.authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''));
      if(p==='/xr/v1/teacher'&&method==='POST'){
        const body=await jsonBody(req,100000);if(!['codex','claude'].includes(body.provider)||!teachers[body.provider])fail(503,'Professor indisponível.');
        const prompt=textField(body,'prompt',32000);if(teachersActive>=2)fail(429,'Professores ocupados.');
        const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});teachersActive++;
        try{return respond(res,200,await teachers[body.provider](prompt,process.env,controller.signal));}finally{teachersActive--;}
      }
      if(p==='/xr/v1/media'&&method==='POST'){
        const body=await jsonBody(req,9000000);if(!['speak','transcribe','observe'].includes(body.kind)||!media[body.kind])fail(503,'Mídia indisponível.');
        return respond(res,200,await media[body.kind](body));
      }
      if(p==='/xr/v1/capabilities'&&method==='GET')return respond(res,200,{protocol:1,chat:true,projects:true,memories:true,artifacts:true,
        voice:!!media.transcribe,speech:!!media.speak,vision:!!media.observe,tokenStreaming:false});
      if(p==='/xr/v1/device'&&method==='DELETE'){store.revoke(device);return respond(res,200,{revoked:true});}
      // Ephemeral name detection: never journal ambient audio or non-addressed speech.
      if(p==='/xr/v1/wake'&&method==='POST'){
        if(!media.wake)fail(503,'Chamada por nome indisponível.');
        if(wakeActive>=2)fail(429,'Detector ocupado.');
        wakeActive++;
        try{return respond(res,200,await media.wake(await jsonBody(req,2_800_000)));}
        finally{wakeActive--;}
      }
      if(p==='/xr/v1/projects'&&method==='GET')return respond(res,200,await desktop('/projects'));
      if(p==='/xr/v1/providers'&&method==='GET')return respond(res,200,await desktop('/providers'));
      if(p==='/xr/v1/conversations'&&method==='GET') {
        const projectId=url.searchParams.get('projectId');return respond(res,200,await desktop('/conversations'+(projectId?'?projectId='+identifier(projectId):'')));
      }
      if(p==='/xr/v1/memories'&&method==='GET') {
        const params=new URLSearchParams();
        for(const key of ['scope','projectId','conversationId','query'])if(url.searchParams.has(key))params.set(key,url.searchParams.get(key).slice(0,500));
        return respond(res,200,await desktop('/memories?'+params));
      }
      let m=p.match(/^\/xr\/v1\/conversations\/([\w-]+)(?:\/(pending|artifacts))?$/);
      if(m&&method==='GET')return respond(res,200,await desktop('/conversations/'+m[1]+(m[2]?'/'+m[2]:'')));
      m=p.match(/^\/xr\/v1\/operations\/([\w-]+)$/);
      if(m&&method==='GET') {const op=store.data.operations[`${device}:${m[1]}`];if(!op)fail(404,'Operação não encontrada.');return respond(res,200,op);}
      m=p.match(/^\/xr\/v1\/conversations\/([\w-]+)\/cancel$/);
      if(m&&method==='POST')return respond(res,200,await desktop(`/conversations/${m[1]}/cancel`,'POST',{}));
      m=p.match(/^\/xr\/v1\/conversations\/([\w-]+)$/);
      if(m&&method==='PATCH'){const body=await jsonBody(req,2048);if(!['codex','claude'].includes(body.teacherProvider))fail(400,'Professor inválido.');return respond(res,200,await desktop(`/conversations/${m[1]}`,'PATCH',{teacherProvider:body.teacherProvider}));}
      if(method!=='POST')fail(404,'Operação não disponível.');
      const body=await jsonBody(req,9_000_000);
      let action,kind;
      m=p.match(/^\/xr\/v1\/conversations\/([\w-]+)\/messages\/([\w-]+)\/correct$/);
      if(m){kind='correction';const path=`/conversations/${m[1]}/messages/${m[2]}/correct`;action=()=>desktop(path,'POST',{note:typeof body.note==='string'?body.note.slice(0,4000):''});}
      if(p==='/xr/v1/conversations') {
        const data={title:textField(body,'title',200),provider:body.provider||'local'};
        if(body.teacherProvider!==undefined){if(!['codex','claude'].includes(body.teacherProvider))fail(400,'Professor inválido.');data.teacherProvider=body.teacherProvider;}
        if(!['local','codex','claude'].includes(data.provider))fail(400,'Provedor inválido.');
        if(body.projectId)data.projectId=identifier(body.projectId);
        kind='conversation';action=()=>desktop('/conversations','POST',data);
      }
      m=p.match(/^\/xr\/v1\/conversations\/([\w-]+)\/messages$/);
      if(m) {const conversationId=m[1],message=textField(body,'message',32000);kind='message';action=()=>desktop(`/conversations/${conversationId}/messages`,'POST',{message});}
      if(p==='/xr/v1/memories') {
        const data={title:textField(body,'title',200),content:textField(body,'content',32000),scope:body.scope,kind:'manual',source:'Aurora Presence — decisão explícita do usuário'};
        if(!['global','project','conversation'].includes(data.scope))fail(400,'Escopo inválido.');
        if(data.scope==='project')data.projectId=identifier(body.projectId);
        if(data.scope==='conversation')data.conversationId=identifier(body.conversationId);
        kind='memory';action=()=>desktop('/memories','POST',data);
      }
      m=p.match(/^\/xr\/v1\/conversations\/([\w-]+)\/artifacts\/([\w-]+)\/open$/);
      if(m){const path=`/conversations/${m[1]}/artifacts/${m[2]}/open`;kind='artifact';action=async()=>{const a=await desktop(path,'POST',{});delete a.filePath;return a;};}
      for(const [path,fn] of [['transcribe','transcribe'],['speak','speak'],['observe','observe']]) if(p===`/xr/v1/${path}`){if(!media[fn])fail(503,'Recurso indisponível.');kind=path;action=()=>media[fn](body);}
      if(!action)fail(404,'Operação não disponível.');
      return respond(res,202,submit(device,body,kind,action));
    } catch(error) {respond(res,error.status||502,{error:error.status?error.message:'Não foi possível comunicar com o Harness local.'});}
  };
  return {handler,startPairing};
}

export async function runBridge() {
  const directory=process.env.AURORA_XR_DATA||join(process.env.APPDATA||'.','Harness Aurora XR');
  const store=new XRStore(directory);
  const {createMedia}=await import('./xrMedia.js');
  const {runCodex}=await import('./codex.js');const {runClaude}=await import('./claude.js');
  const bridge=createXRHandler({store,desktop:createDesktopClient(),media:createMedia(),teachers:{codex:runCodex,claude:runClaude}});
  const server=https.createServer({key:readFileSync(join(directory,'server-key.pem')),cert:readFileSync(join(directory,'server-cert.pem')),minVersion:'TLSv1.2'},bridge.handler);
  server.requestTimeout=15000;server.headersTimeout=10000;
  const pairing=bridge.startPairing();
  writeFileSync(join(directory,'pairing.json'),JSON.stringify(pairing),{mode:0o600});
  server.listen(Number(process.env.AURORA_XR_PORT||8788),'0.0.0.0',()=>console.log('Aurora XR HTTPS pronta na porta 8788. Pareamento temporário no arquivo local pairing.json.'));
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runBridge().catch(e=>{console.error(e.message);process.exitCode=1;});
