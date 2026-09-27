// Copies the weights named in the bundled engine-config.json to the Quest and checks
// size and SHA-256 on the device. Weights never go inside the APK.
// Usage: node scripts/provision-quest-models.mjs [--serial <adb serial>]
import {execFileSync} from 'node:child_process';
import {existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
const adb=join(process.env.LOCALAPPDATA,'Android/Sdk/platform-tools/adb.exe');
const serialAt=process.argv.indexOf('--serial'),serial=serialAt>0?['-s',process.argv[serialAt+1]]:[];
const run=(...args)=>execFileSync(adb,[...serial,...args],{encoding:'utf8',maxBuffer:1<<24}).trim();
const zip='unreal/AuroraXR/Source/AuroraXR/ThirdParty/QuestRuntime/aurora-runtime.zip';
const engine=JSON.parse(execFileSync('python',['-c',`import zipfile,sys;sys.stdout.write(zipfile.ZipFile(${JSON.stringify(zip)}).read('harness/engine-config.json').decode())`],{encoding:'utf8'}));
if(engine.modelStorage!=='external')throw new Error('Este perfil embute o modelo no APK; nada a provisionar.');
const blobs=join(process.env.OLLAMA_MODELS||'C:/IA/ollama/models','blobs');
const moe='unreal/AuroraXR/Saved/MoePort';
const remote='/sdcard/Android/data/com.aurora.xr/files/models';
run('shell','mkdir','-p',remote);
for(const spec of [engine,engine.embedding].filter(Boolean)){
  const local=[join(blobs,'sha256-'+spec.modelSha256),join(moe,spec.modelFile)].find(existsSync);
  if(!local||statSync(local).size!==spec.modelBytes)throw new Error(`Pesos locais ausentes ou incompletos: ${spec.modelFile}`);
  const target=`${remote}/${spec.modelFile}`;
  const size=run('shell',`stat -c %s ${target} 2>/dev/null || echo 0`);
  if(Number(size)!==spec.modelBytes){
    const free=Number(run('shell',`df -k ${remote} | tail -1 | awk '{print $4}'`))*1024;
    if(free<spec.modelBytes+1.5*2**30)throw new Error(`Espaço insuficiente no Quest para ${spec.modelFile}: ${(free/2**30).toFixed(1)} GiB livres.`);
    console.log(`Enviando ${spec.modelFile} (${(spec.modelBytes/2**30).toFixed(2)} GiB)...`);
    execFileSync(adb,[...serial,'push',local,target],{stdio:'inherit'});
  }
  const hash=run('shell','sha256sum',target).split(/\s+/)[0];
  if(hash!==spec.modelSha256)throw new Error(`SHA-256 divergente no Quest: ${spec.modelFile}`);
  console.log(`OK ${spec.modelFile} ${hash.slice(0,12)}…`);
}
