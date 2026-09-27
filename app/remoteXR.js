import https from 'node:https';
import {readFileSync} from 'node:fs';
export function remoteXR(path,body,env=process.env,signal){
  if(!env.HARNESS_REMOTE_CONFIG)return Promise.reject(new Error('Este recurso requer conexão com o Harness do PC.'));
  const config=JSON.parse(readFileSync(env.HARNESS_REMOTE_CONFIG,'utf8'));
  const url=new URL(config.endpoint+'/xr/v1'+path);
  if(url.protocol!=='https:')return Promise.reject(new Error('O relay remoto exige TLS.'));
  const ca=readFileSync(env.HARNESS_REMOTE_CA);
  return new Promise((resolve,reject)=>{
    const req=https.request(url,{ca,signal,method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.token}`}},res=>{
      let text='',size=0;res.on('data',chunk=>{size+=chunk.length;if(size>12000000){req.destroy(new Error('Resposta remota excedeu o limite.'));return;}text+=chunk;});
      res.on('end',()=>{try{const data=JSON.parse(text);res.statusCode>=400?reject(new Error(data.error||'Relay indisponível')):resolve(data);}catch{reject(new Error('Resposta remota inválida.'));}});
    });req.setTimeout(180000,()=>req.destroy(new Error('Tempo esgotado no relay.')));req.on('error',reject);req.end(JSON.stringify(body));
  });
}
export async function remoteTeacher(provider,prompt,env,signal){
  try{return await remoteXR('/teacher',{provider,prompt},env,signal);}
  catch(error){return {ok:false,status:503,error:`Professor remoto indisponível: ${error.message}`};}
}
