import {readFile} from 'node:fs/promises';
import {validateManifest,validateBundle} from '../../app/centralProtocol.js';
const root=new URL('../../central-memories/',import.meta.url);
const manifest=validateManifest(JSON.parse(await readFile(new URL('manifest.json',root),'utf8')));
const seen=new Set();
for(const b of manifest.bundles)for(const m of validateBundle(await readFile(new URL(b.file,root),'utf8'),b)){
  if(seen.has(m.id))throw Error('Memória central duplicada: '+m.id);
  seen.add(m.id);
}
console.log(`${manifest.bundles.length} pacote(s), ${seen.size} memória(s): hashes, formato e deduplicação conferidos.`);
