import os,shutil,zipfile,json,argparse,hashlib
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
stage=repo/'unreal/AuroraXR/Saved/Standalone'
out=repo/'unreal/AuroraXR/Source/AuroraXR/ThirdParty/QuestRuntime';out.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser(description='Bundle the original Harness and the Android llama.cpp executor. Model weights are provisioned separately (scripts/provision-quest-models.mjs).')
parser.add_argument('--profile',choices=['parity','moe','legacy-dense'],default='parity',
    help='parity: same weights, template and sampling as the desktop app (default); moe: Qwen3-Coder SSD experiment; legacy-dense: old 0.8B diagnostic')
args=parser.parse_args()
moe=repo/'unreal/AuroraXR/Saved/MoePort'
def ollama_blob(model):
    # Exact file the desktop Ollama serves; its blob name is already the SHA-256.
    blobs=Path(os.environ.get('OLLAMA_MODELS','C:/IA/ollama/models'))/'blobs'
    manifest=json.loads((blobs.parent/'manifests/registry.ollama.ai/library'/model.split(':')[0]/model.split(':')[1]).read_text())
    digest=next(l['digest'] for l in manifest['layers'] if l['mediaType']=='application/vnd.ollama.image.model')
    return {'sha256':digest.split(':')[1],'bytes':(blobs/digest.replace(':','-')).stat().st_size}
if args.profile=='legacy-dense':
    executable=stage/'runtime/bin/llama-server'
    engine={'model':'qwen3.5:0.8b','contextProfile':'original-harness','modelStorage':'bundled',
        'modelFile':'model.gguf','modelBytes':(stage/'model.gguf').stat().st_size,
        'contextTokens':4096,'maxOutputTokens':384,'timeoutMs':180000,'dynamicBackends':True,
        'args':['-c','4096','-t','3','-tb','3','-np','1','--no-webui']}
else:
    manifest=json.loads((moe/'moe-build.json').read_text())
    executable=moe/'build-android/bin/llama-server'
    if hashlib.sha256(executable.read_bytes()).hexdigest()!=manifest['binarySha256']:
        raise RuntimeError('Android executable hash does not match build manifest')
    if args.profile=='moe':
        engine={'model':manifest['model'],'contextProfile':'original-harness','modelStorage':'external',
            'modelFile':'qwen3-coder-30b.gguf','modelBytes':manifest['modelBytes'],'modelSha256':manifest['modelSha256'],
            'contextTokens':8192,'maxOutputTokens':512,'timeoutMs':600000,
            'args':manifest['candidateArgs'],'deviceValidated':manifest['deviceValidated']}
    else:
        chat,embed=ollama_blob('llama3.2:3b'),ollama_blob('nomic-embed-text:latest')
        # Same context (8192) and output limit (2048) as the desktop defaults in app/local.js.
        engine={'model':'llama3.2:3b','contextProfile':'original-harness','promptFormat':'llama3','modelStorage':'external',
            'modelFile':'llama3.2-3b.gguf','modelBytes':chat['bytes'],'modelSha256':chat['sha256'],
            'contextTokens':8192,'maxOutputTokens':2048,'timeoutMs':240000,
            'args':['-c','8192','-t','4','-tb','4','-np','1','-fa','on','-ctk','q8_0','-ctv','q8_0','--no-webui'],
            'embedding':{'model':'nomic-embed-text','modelFile':'nomic-embed-text.gguf','modelBytes':embed['bytes'],'modelSha256':embed['sha256'],
                'port':18081,'args':['--embeddings','-c','2048','-t','2','-np','1','--no-webui']}}
shutil.copy2(stage/'runtime/bin/node',out/'libaurora_node.so')
shutil.copy2(executable,out/'libaurora_llama.so')
with zipfile.ZipFile(out/'aurora-runtime.zip','w',compression=zipfile.ZIP_STORED) as archive:
    if args.profile=='legacy-dense':archive.write(stage/'model.gguf','model.gguf')
    archive.writestr('harness/engine-config.json',json.dumps(engine,indent=2))
    if args.profile!='legacy-dense':archive.write(moe/'moe-build.json','moe-build.json')
    archive.write(stage/'runtime-manifest.json','runtime-manifest.json')
    for f in (stage/'runtime/lib').glob('*'):
        if f.is_file() and '.so' in f.name:archive.write(f,'lib/'+f.name)
    for f in (stage/'runtime/share/licenses').rglob('*'):
        if f.is_file():archive.write(f,'licenses/'+str(f.relative_to(stage/'runtime/share/licenses')))
    for f in (repo/'app').rglob('*'):
        if f.is_file() and 'data' not in f.relative_to(repo/'app').parts:archive.write(f,'harness/app/'+str(f.relative_to(repo/'app')))
    dependencies=stage/'harness/node_modules'
    for f in dependencies.rglob('*'):
        if f.is_symlink():raise RuntimeError('Dependency symlink: '+str(f))
        if f.is_file():archive.write(f,'harness/node_modules/'+str(f.relative_to(dependencies)))
    archive.write(repo/'package.json','harness/package.json')
    archive.write(repo/'scripts/quest-main.mjs','harness/quest-main.mjs')
    archive.write(Path(os.environ['APPDATA'])/'Harness Aurora XR/server-cert.pem','harness/remote-ca.pem')
print('Runtime bundled:',(out/'aurora-runtime.zip').stat().st_size,flush=True)
