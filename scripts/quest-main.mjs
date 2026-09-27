// Entry point for the original Harness server inside the Android application.
import http from 'node:http';
import {readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync,unlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),data=process.env.AURORA_DATA,saved=process.env.AURORA_SAVED;
mkdirSync(data,{recursive:true});mkdirSync(saved,{recursive:true});
process.env.HARNESS_DB_FILE=join(data,'harness.db');
const imported=join(saved,'harness-import.db');
if(!existsSync(process.env.HARNESS_DB_FILE)&&existsSync(imported)){copyFileSync(imported,process.env.HARNESS_DB_FILE);unlinkSync(imported);}
process.env.HARNESS_PLATFORM='quest';process.env.LOCAL_ENGINE='llama.cpp';process.env.LOCAL_BASE_URL='http://127.0.0.1:18080';
process.env.LOCAL_MODEL='qwen3.5:0.8b';process.env.LOCAL_CONTEXT_TOKENS='4096';process.env.LOCAL_MAX_OUTPUT_TOKENS='384';process.env.LOCAL_TIMEOUT_MS='180000';
process.env.HARNESS_QUEST_CHAT_PROFILE='quest-chat-v1';process.env.LOCAL_TEMPERATURE='0.3';
const remote=join(saved,'aurora-connection.json');
if(existsSync(remote)){process.env.HARNESS_REMOTE_CONFIG=remote;process.env.HARNESS_REMOTE_CA=join(root,'remote-ca.pem');}
const {createServer}=await import('./app/server.js');
const {XRStore,createXRHandler,createDesktopClient}=await import('./app/xrBridge.js');
const {remoteXR}=await import('./app/remoteXR.js');
const backend=createServer({allowDev:false,centralSync:false});
await new Promise((resolve,reject)=>backend.once('error',reject).listen(8787,'127.0.0.1',resolve));
const store=new XRStore(join(data,'xr'));
const file=join(saved,'aurora-local-connection.json');let config;
try{config=JSON.parse(readFileSync(file));store.authenticate(config.token);}catch{config={endpoint:'http://127.0.0.1:8788',...store.issueDevice('Aurora MR local')};}
const media={};
for(const kind of ['speak','transcribe','observe'])media[kind]=body=>remoteXR('/media',{...body,kind});
media.wake=body=>remoteXR('/wake',body);
const bridge=createXRHandler({store,desktop:createDesktopClient(),media});
const server=http.createServer(bridge.handler);
await new Promise((resolve,reject)=>server.once('error',reject).listen(8788,'127.0.0.1',resolve));
writeFileSync(file,JSON.stringify(config),{mode:0o600});
console.log('Harness original ready: Android, SQLite, local model; remote teachers/media when configured.');
