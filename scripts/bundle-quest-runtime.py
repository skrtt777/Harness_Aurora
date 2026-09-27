import os,shutil,zipfile,json
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
stage=repo/'unreal/AuroraXR/Saved/Standalone'
out=repo/'unreal/AuroraXR/Source/AuroraXR/ThirdParty/QuestRuntime';out.mkdir(parents=True,exist_ok=True)
shutil.copy2(stage/'runtime/bin/node',out/'libaurora_node.so')
shutil.copy2(stage/'runtime/bin/llama-server',out/'libaurora_llama.so')
with zipfile.ZipFile(out/'aurora-runtime.zip','w',compression=zipfile.ZIP_STORED) as archive:
    archive.write(stage/'model.gguf','model.gguf')
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
