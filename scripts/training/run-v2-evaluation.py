"""Sequential GPU use and immutable logs. Stops on a failed command."""
import subprocess,sys,json,time
from pathlib import Path
root=Path('reports/model-training-v2')
training=json.loads(Path('models/local-training/aurora-lora-v2/manifest.json').read_text())
if training.get('status')!='trained_unvalidated':raise RuntimeError('Training not complete')
commands=[
 ('export-e1',[sys.executable,'scripts/training/export-v2.py','1']),
 ('export-e2',[sys.executable,'scripts/training/export-v2.py','2']),
 ('dev-control',['node','scripts/training/evaluate-v2.mjs','dev','control']),
 ('dev-e1',['node','scripts/training/evaluate-v2.mjs','dev','e1']),
 ('dev-e2',['node','scripts/training/evaluate-v2.mjs','dev','e2']),
 ('selection',['node','scripts/training/select-v2.mjs']),
 ('final-baseline',['node','scripts/training/evaluate-v2.mjs','final','baseline']),
 ('final-control',['node','scripts/training/evaluate-v2.mjs','final','control']),
 ('final-candidate',['node','scripts/training/evaluate-v2.mjs','final','candidate'])]
for name,command in commands:
 print(json.dumps({'stage':name,'startedAt':time.time()}),flush=True)
 (root/'progress.json').write_text(json.dumps({'stage':name,'startedAt':time.time()}))
 with (root/(name+'.log')).open('x',encoding='utf-8') as log:subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,check=True)
print('Evaluation complete',flush=True)
