import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recognizeImage } from './ocr.js';

function invalid(message){throw Object.assign(new Error(message),{status:400});}
function decode(value,max){
  if(typeof value!=='string'||value.length>max*1.4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))invalid('Mídia inválida.');
  const data=Buffer.from(value,'base64');if(!data.length||data.length>max)invalid('Tamanho de mídia inválido.');return data;
}
export function createMedia(){return {
  async wake(body){
    const audio=decode(body.audio,2_000_000);
    if(audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')invalid('Envie áudio WAV.');
    const response=await fetch('http://127.0.0.1:8790/transcribe',{method:'POST',body:audio,headers:{'content-type':'audio/wav'},signal:AbortSignal.timeout(14000)});
    if(!response.ok)throw Object.assign(new Error('Detector indisponível.'),{status:503});
    const {text=''}=await response.json();
    return parseWake(text);
  },
  async transcribe(body){
    const audio=decode(body.audio,4_000_000);
    if(audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')invalid('Envie áudio WAV.');
    let response;
    try {response=await fetch('http://127.0.0.1:8790/transcribe',{method:'POST',body:audio,headers:{'content-type':'audio/wav'},signal:AbortSignal.timeout(120000)});}
    catch {throw Object.assign(new Error('Serviço de voz indisponível. Inicie Aurora Presence - PC.'),{status:503});}
    if(!response.ok)throw Object.assign(new Error('Transcrição indisponível.'),{status:503});
    return response.json();
  },
  async speak(body){
    if(typeof body.text!=='string'||!body.text.trim()||body.text.length>6000)invalid('Texto para fala inválido.');
    let response;
    try {response=await fetch('http://127.0.0.1:8791/speak',{method:'POST',body:JSON.stringify({text:body.text}),headers:{'content-type':'application/json'},signal:AbortSignal.timeout(120000)});}
    catch {throw Object.assign(new Error('Voz neural indisponível. Inicie Aurora Presence - PC.'),{status:503});}
    if(!response.ok)throw Object.assign(new Error('Falha na voz neural local.'),{status:503});
    const wav=Buffer.from(await response.arrayBuffer());
    if(wav.length<44||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw new Error('Áudio neural inválido.');
    return {audio:wav.toString('base64'),format:'wav',sampleRate:Number(response.headers.get('x-aurora-rate')||24000),engine:response.headers.get('x-aurora-engine')||'kokoro-82m',voice:response.headers.get('x-aurora-voice')||'pf_dora',local:true};
  },
  async observe(body){
    const image=decode(body.image,5_000_000);
    if(!(image[0]===0xff&&image[1]===0xd8)&&image.toString('hex',0,8)!=='89504e470d0a1a0a')invalid('Envie JPEG ou PNG.');
    const result=await recognizeImage(image,{...process.env,OCR_CACHE_PATH:join(process.env.APPDATA||tmpdir(),'Harness Aurora XR','ocr-cache')});
    return {text:result.text,confidence:result.confidence,source:'Captura explícita do Quest; leitura OCR local',mode:'ocr',capturedAt:body.capturedAt||null};
  }
};}

export function parseWake(text){
  const match=String(text).trim().match(/^(?:(?:oi|olá|ola|ei|hey)\s*[,!.]?\s*)?aurora\b[\s,.:;!?—-]*(.*)$/iu);
  return match?{triggered:true,command:match[1].trim()}:{triggered:false};
}
