// Only a complete, hash-matched and approved experiment can become automatic.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decideRelease} from './release-gate.mjs';
const reportId=process.argv[3]||'model-training-v1';
if(!/^model-training-v[0-9]+$/.test(reportId))throw Error('Invalid experiment ID');
const root='reports/'+reportId,read=p=>readFile(root+'/'+p,'utf8').then(JSON.parse),hash=b=>createHash('sha256').update(b).digest('hex');
const summary=await read('summary.json');
for(const [file,expected] of Object.entries(summary.sourceHashes))if(hash(await readFile(root+'/'+file))!==expected)throw Error('Evidence changed: '+file);
const [manifest,b,c,control]=await Promise.all(['manifest.json','baseline.json','candidate.json','weights-control.json'].map(read));
const decision=decideRelease(manifest,b,c,control);
if(JSON.stringify(decision)!==JSON.stringify(summary.gateDecision||summary.decision))throw Error('Decision mismatch');
const mode=process.argv[2];if(!['--record-only','--activate'].includes(mode))throw Error('Use --record-only or --activate with HARNESS_DB_FILE set to the target database');
if(!process.env.HARNESS_DB_FILE)throw Error('Explicit target database required');
const {getSetting,setSetting}=await import('../../app/store.js');
if(mode==='--record-only'){
 await setSetting('local_model_experiment',JSON.stringify(summary));console.log('Experimental results recorded; active model unchanged.');
}else{
 if(!decision.passed)throw Error('Activation rejected: candidate did not meet frozen quality gates.');
 const tags=await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json());
 if(!tags.models?.some(m=>m.name===summary.model&&m.digest===summary.modelDigest))throw Error('Candidate weights changed or unavailable');
 await setSetting('local_model_previous',await getSetting('local_model')||'auto');
 await setSetting('local_model_release',JSON.stringify(summary));await setSetting('local_model','auto');
 console.log('Approved local model activated.');
}
