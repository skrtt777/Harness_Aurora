"""Fetch verified Android runtime packages for the existing Harness backend."""
import gzip, hashlib, io, json, re, tarfile, urllib.request
from pathlib import Path

root=Path(__file__).resolve().parents[1]/'unreal/AuroraXR/Saved/Standalone'
root.mkdir(parents=True,exist_ok=True)
base='https://packages.termux.dev/apt/termux-main/'
index=gzip.decompress(urllib.request.urlopen(base+'dists/stable/main/binary-aarch64/Packages.gz').read()).decode()
packages={}
for block in index.split('\n\n'):
    fields=dict(line.split(': ',1) for line in block.splitlines() if ': ' in line and not line.startswith(' '))
    if 'Package' in fields: packages[fields['Package']]=fields
pending=['nodejs-lts','llama-cpp'];done=set();manifest=[];links=[]
prefix='data/data/com.termux/files/usr/'
while pending:
    name=pending.pop()
    if name in done: continue
    done.add(name);p=packages[name]
    for dep in p.get('Depends','').split(','):
        dep=re.split(r'[ (|]',dep.strip())[0]
        if dep and dep in packages and (dep.startswith('lib') or dep in ['openssl','c-ares','zlib','brotli','krb5']):pending.append(dep)
    cached=root/Path(p['Filename']).name
    if not cached.exists() or hashlib.sha256(cached.read_bytes()).hexdigest()!=p['SHA256']:
        cached.write_bytes(urllib.request.urlopen(base+p['Filename']).read())
    raw=cached.read_bytes();assert hashlib.sha256(raw).hexdigest()==p['SHA256']
    manifest.append({k:p[k] for k in ['Package','Version','Filename','SHA256']})
    pos=8
    while pos+60<=len(raw):
        header=raw[pos:pos+60];size=int(header[48:58]);entry=header[:16].decode().strip().rstrip('/');payload=raw[pos+60:pos+60+size];pos+=60+size+(size%2)
        if not entry.startswith('data.tar'):continue
        with tarfile.open(fileobj=io.BytesIO(payload)) as tar:
            for m in tar:
                rel=m.name.lstrip('./')
                if not rel.startswith(prefix):continue
                rel=rel[len(prefix):]
                if not rel.startswith(('bin/','lib/','share/licenses/')):continue
                dest=(root/'runtime'/rel).resolve();assert dest.is_relative_to((root/'runtime').resolve())
                if m.isfile():dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(tar.extractfile(m).read())
                elif m.issym():links.append((dest,m.linkname))
    print(name,p['Version'],flush=True)
for _ in range(4):
    for dest,link in links:
        target=(dest.parent/link).resolve()
        if target.is_relative_to((root/'runtime').resolve()) and target.is_file():dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(target.read_bytes())
(root/'runtime-manifest.json').write_text(json.dumps(manifest,indent=2))
