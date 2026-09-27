// Bootstrap this user's attached Quest through the already-authorized USB channel.
// No credential is embedded in source or the APK.
import https from 'node:https';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const directory=join(process.env.APPDATA,'Harness Aurora XR');
const ca=readFileSync(join(directory,'server-cert.pem'));
const {code}=JSON.parse(readFileSync(join(directory,'pairing.json'),'utf8'));
const body=JSON.stringify({code,name:'Quest de Lucas'});
const paired=await new Promise((resolve,reject)=>{
  const req=https.request('https://127.0.0.1:8788/xr/v1/pair',{method:'POST',ca,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
    let data='';res.on('data',c=>data+=c);res.on('end',()=>{if(res.statusCode!==201)return reject(new Error('Pareamento indisponível; reinicie a ponte para abrir nova janela.'));resolve(JSON.parse(data));});
  });req.on('error',reject);req.end(body);
});
const config={endpoint:`https://${process.env.AURORA_XR_ADDRESS||'192.168.0.40'}:8788`,...paired};
const path=join(directory,'quest-connection.json');writeFileSync(path,JSON.stringify(config),{mode:0o600});
writeFileSync('unreal/AuroraXR/Saved/aurora-connection.json',JSON.stringify(config),{mode:0o600});
const adb=join(process.env.LOCALAPPDATA,'Android/Sdk/platform-tools/adb.exe');
const target='/sdcard/Android/data/com.aurora.xr/files/UnrealGame/AuroraXR/AuroraXR/Saved/aurora-connection.json';
const r=spawnSync(adb,['push',path,target],{encoding:'utf8',windowsHide:true});
if(r.status!==0)throw new Error('Pareado; provisionamento USB falhou: '+r.stderr);
console.log('Quest pareado e provisionado; token não exibido.');
