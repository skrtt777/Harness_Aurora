"""Merge an immutable epoch adapter, export and quantize with pinned local tools."""
import argparse, hashlib, json, subprocess, sys, shutil
from pathlib import Path
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel
p=argparse.ArgumentParser();p.add_argument('epoch',type=int,choices=[1,2]);args=p.parse_args()
root=Path('models/local-training');run=root/'aurora-lora-v3';out=run/f'export-e{args.epoch}'
out.mkdir(exist_ok=False);torch.set_num_threads(6)
base=AutoModelForCausalLM.from_pretrained(root/'base',local_files_only=True,torch_dtype=torch.bfloat16)
model=PeftModel.from_pretrained(base,run/f'epoch-{args.epoch}').merge_and_unload(safe_merge=True)
model.config.use_cache=True;model.save_pretrained(out/'merged',safe_serialization=True)
AutoTokenizer.from_pretrained(root/'base',local_files_only=True).save_pretrained(out/'merged')
shutil.copyfile(root/'base/LICENSE',out/'merged/LICENSE')
del model,base
subprocess.run([sys.executable,str(root/'llama.cpp/convert_hf_to_gguf.py'),str(out/'merged'),'--outfile',str(out/'f16.gguf'),'--outtype','f16'],check=True)
subprocess.run([str((root/'llama-bin/llama-quantize.exe').resolve()),str(out/'f16.gguf'),str(out/'q4_k_m.gguf'),'Q4_K_M','8'],check=True)
sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest() if hasattr(hashlib,'file_digest') else hashlib.sha256(p.read_bytes()).hexdigest()
template=json.loads(Path('reports/model-training-v1/baseline-model.json').read_text(encoding='utf-8'))['template']
license=(root/'base/LICENSE').read_text(encoding='utf-8');model_name=f'aurora-local:1.5b-v3-e{args.epoch}'
(out/'Modelfile').write_text(f'FROM "{(out/"q4_k_m.gguf").resolve().as_posix()}"\nTEMPLATE """{template}"""\nLICENSE """{license}"""\n',encoding='utf-8')
subprocess.run(['ollama','create',model_name,'-f',str(out/'Modelfile')],check=True)
import urllib.request
tags=json.load(urllib.request.urlopen('http://127.0.0.1:11434/api/tags'))
info=next(m for m in tags['models'] if m['name']==model_name)
(out/'registration.json').write_text(json.dumps({'model':info,'epoch':args.epoch,'adapterHash':sha(run/f'epoch-{args.epoch}/adapter_model.safetensors'),'mergedHash':sha(out/'merged/model.safetensors'),'ggufHash':sha(out/'q4_k_m.gguf'),'templateHash':hashlib.sha256(template.encode()).hexdigest(),'exportScriptHash':sha(Path(__file__))},indent=2))
print(json.dumps(info),flush=True)
