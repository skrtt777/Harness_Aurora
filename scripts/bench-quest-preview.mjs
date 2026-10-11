// Reversible headset preview against a throwaway PC backend on :8792.
// Original device configuration is kept privately and restored on --restore.
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { XRStore, createXRHandler, createDesktopClient } from '../app/xrBridge.js';
const serial='340YC10G7Y106Y';
const adb=join(process.env.LOCALAPPDATA,'Android/Sdk/platform-tools/adb.exe');
const remote='/sdcard/Android/data/com.aurora.xr/files/UnrealGame/AuroraXR/AuroraXR/Saved/';
const privateRoot=join(process.env.APPDATA,'Harness Aurora XR');
const backup=join(privateRoot,'bench-quest-preview');mkdirSync(backup,{recursive:true});
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{stdio:'pipe'});
const files=['aurora-connection.json','aurora-session-pc.json','aurora-wake.txt','aurora-bench-cache.json','aurora-bench-pending.json','aurora-probe.json'];
if(process.argv.includes('--restore')) {
  const manifest=JSON.parse(readFileSync(join(backup,'manifest.json'),'utf8'));
  run('shell','am','force-stop','com.aurora.xr');
  for(const name of files) if(manifest[name]) run('push',join(backup,name),remote+name); else run('shell','rm','-f',remote+name);
  run('shell','am','start','-n','com.aurora.xr/com.epicgames.unreal.GameActivity');
  renameSync(join(backup,'manifest.json'),join(backup,'restored-manifest-'+Date.now()+'.json'));
  console.log('Configuração original do Quest restaurada.');
} else {
  if(existsSync(join(backup,'manifest.json'))) throw new Error('Já existe backup da prévia. Restaure e arquive antes de iniciar outra.');
  const manifest={};
  for(const name of files) { try {run('pull',remote+name,join(backup,name));manifest[name]=true;} catch {manifest[name]=false;} }
  if(!manifest['aurora-connection.json']) throw new Error('Não foi possível preservar a conexão original.');
  writeFileSync(join(backup,'manifest.json'),JSON.stringify(manifest),{mode:0o600});
  const original=JSON.parse(readFileSync(join(backup,'aurora-connection.json'),'utf8'));
  const store=new XRStore(join(backup,'bridge'));
  const {token}=store.issueDevice('Quest — bancada isolada');
  const bridge=createXRHandler({store,desktop:createDesktopClient('http://127.0.0.1:8792')});
  const server=https.createServer({key:readFileSync(join(privateRoot,'server-key.pem')),cert:readFileSync(join(privateRoot,'server-cert.pem'))},bridge.handler);
  await new Promise(r=>server.listen(8793,'0.0.0.0',r));
  const localSession=await (await fetch('http://127.0.0.1:8792/api/session')).json();
  const data=await (await fetch('http://127.0.0.1:8792/api/projects',{headers:{'x-harness-token':localSession.token}})).json();
  const project=data.projects.find(p=>p.name.includes('TESTE ISOLADO'));
  if(!project) throw new Error('Projeto de teste não encontrado.');
  const endpoint=new URL(original.endpoint);endpoint.port='8793';
  const config={...original,endpoint:endpoint.toString().replace(/\/$/,''),token};
  writeFileSync(join(backup,'preview-connection.json'),JSON.stringify(config),{mode:0o600});
  writeFileSync(join(backup,'preview-session.json'),JSON.stringify({projectId:project.id}),{mode:0o600});
  writeFileSync(join(backup,'preview-wake.txt'),'off');
  writeFileSync(join(backup,'preview-probe.json'),JSON.stringify({action:'bench',draft:process.argv.includes('--show-saved')?'':'PRÉVIA ISOLADA: manter a superfície livre para desenhar e usar luz ciano indireta.'}));
  run('shell','am','force-stop','com.aurora.xr');
  run('push',join(backup,'preview-connection.json'),remote+'aurora-connection.json');
  run('push',join(backup,'preview-session.json'),remote+'aurora-session-pc.json');
  run('push',join(backup,'preview-wake.txt'),remote+'aurora-wake.txt');
  run('push',join(backup,'preview-probe.json'),remote+'aurora-probe.json');
  run('shell','am','start','-n','com.aurora.xr/com.epicgames.unreal.GameActivity');
  console.log('Bancada isolada aberta no Quest. Backup privado preservado; execute --restore ao terminar.');
}
