// Read-only check of the paired PC route. Never prints device credentials.
import https from 'node:https';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {X509Certificate} from 'node:crypto';

const directory=process.env.AURORA_XR_DATA||join(process.env.APPDATA,'Harness Aurora XR');
const config=JSON.parse(readFileSync(join(directory,'quest-connection.json'),'utf8'));
const ca=readFileSync(join(directory,'server-cert.pem'));
const certificate=new X509Certificate(ca);
function get(path){
  return new Promise((resolve,reject)=>{
    const req=https.get(config.endpoint+'/xr/v1'+path,{ca,headers:{authorization:`Bearer ${config.token}`}},res=>{
      let body='';
      res.setEncoding('utf8');
      res.on('data',chunk=>body+=chunk);
      res.on('end',()=>{
        if(res.statusCode!==200)return reject(new Error(`${path}: HTTP ${res.statusCode}`));
        try{resolve(JSON.parse(body));}catch{reject(new Error(`${path}: invalid JSON`));}
      });
    });
    req.setTimeout(10000,()=>req.destroy(new Error(`${path}: timeout`)));
    req.on('error',reject);
  });
}
try{
  const capabilities=await get('/capabilities');
  const projects=await get('/projects');
  const conversations=await get('/conversations');
  console.log(JSON.stringify({ok:true,endpoint:config.endpoint,certificateValidTo:certificate.validTo,
    capabilities,projects:projects.projects?.length,conversations:conversations.conversations?.length},null,2));
}catch(error){console.error('XR PC diagnostic failed:',error.message);process.exitCode=1;}
