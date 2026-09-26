"""Bounded supervised LoRA training, v3 dataset, RANK VARIATION experiment
(Fase A.1 of docs/ROADMAP_MODELO_LOCAL.md). Identical to train-lora-v3.py in
every respect (same dataset-v3, same lr, same epochs, same seed) except
rank=16/alpha=32 instead of rank=8/alpha=16 -- this isolates whether LoRA
capacity, not dataset size or lr/epochs, was the limiting factor across
v1 (rank 16, different dataset/lr/epochs), v2 and v3 (both rank 8).
"""
import argparse, hashlib, json, math, random, time, shutil, subprocess
from pathlib import Path
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import LoraConfig, get_peft_model

parser = argparse.ArgumentParser()
parser.add_argument('--run', default='aurora-lora-v3-rank16')
parser.add_argument('--epochs', type=int, default=2)
args = parser.parse_args()
if not args.run.replace('-', '').isalnum() or not 1 <= args.epochs <= 5:
    raise ValueError('Invalid bounded run configuration')
root = Path('models/local-training')
out = root / args.run
out.mkdir(exist_ok=False)
random.seed(20260920); torch.manual_seed(20260920)
if not torch.cuda.is_available(): raise RuntimeError('CUDA required; no silent CPU training')
torch.set_num_threads(6)
tokenizer = AutoTokenizer.from_pretrained(root/'base', local_files_only=True)
tokenizer.pad_token = tokenizer.eos_token
base = AutoModelForCausalLM.from_pretrained(root/'base', local_files_only=True, torch_dtype=torch.bfloat16, attn_implementation='sdpa').to('cuda')
base.config.use_cache = False
model = get_peft_model(base, LoraConfig(r=16, lora_alpha=32, lora_dropout=.05, bias='none', task_type='CAUSAL_LM', target_modules=['q_proj','k_proj','v_proj','o_proj','gate_proj','up_proj','down_proj']))
model.enable_input_require_grads()
model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant':False})
def encode(path):
    rows=[]
    for line in path.read_text(encoding='utf-8').splitlines():
        item=json.loads(line); messages=item['messages']
        prefix_text=''.join('<|im_start|>'+m['role']+'\n'+m['content']+'<|im_end|>\n' for m in messages[:-1])+'<|im_start|>assistant\n'
        prefix=tokenizer.encode(prefix_text,add_special_tokens=False)
        ids=tokenizer.encode(prefix_text+messages[-1]['content']+'<|im_end|>\n',add_special_tokens=False)
        if ids[:len(prefix)] != prefix: raise ValueError('Chat template boundary mismatch')
        if len(ids)>2048: raise ValueError(f'Example exceeds budget: {item["id"]} {len(ids)}')
        rows.append({'input_ids':ids,'labels':[-100]*len(prefix)+ids[len(prefix):]})
    return rows
train=encode(root/'dataset-v3/train.jsonl'); dev=encode(root/'dataset-v3/dev.jsonl')
def batch(rows):
    length=max(len(r['input_ids']) for r in rows)
    return {key:torch.tensor([r[key]+([tokenizer.pad_token_id] if key=='input_ids' else [-100])*(length-len(r[key])) for r in rows],device='cuda') for key in ['input_ids','labels']} | {'attention_mask':torch.tensor([[1]*len(r['input_ids'])+[0]*(length-len(r['input_ids'])) for r in rows],device='cuda')}
@torch.no_grad()
def evaluate():
    model.eval(); total=0; tokens=0
    for row in dev:
        n=sum(x!=-100 for x in row['labels'][1:]); loss=model(**batch([row])).loss
        total+=float(loss)*n;tokens+=n
    model.train();return total/tokens
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
trainable,total=model.get_nb_trainable_parameters()
manifest={'run':args.run,'base':json.loads((root/'base-provenance.json').read_text()),'seed':20260920,'epochs':args.epochs,'rank':16,'alpha':32,'learningRate':.00002,'chatFormat':'Exact Ollama generate ChatML, no implicit system message','batchSize':1,'gradientAccumulation':8,'maxSequenceLength':2048,'trainableParameters':trainable,'totalParameters':total,'trainHash':sha(root/'dataset-v3/train.jsonl'),'devHash':sha(root/'dataset-v3/dev.jsonl'),'trainingScriptHash':sha(Path(__file__)),'gpu':torch.cuda.get_device_name(0),'torch':torch.__version__,'startedAt':time.time(),'experiment':'Fase A.1 (docs/ROADMAP_MODELO_LOCAL.md): rank/alpha doubled vs v3 (8/16 -> 16/32), same dataset-v3, same lr/epochs -- isolates LoRA capacity as the variable.'}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2))
(out/'packages.txt').write_text(subprocess.check_output([__import__('sys').executable,'-m','pip','freeze'],text=True))
optim=torch.optim.AdamW((p for p in model.parameters() if p.requires_grad),lr=.00002,weight_decay=.01)
start=time.monotonic(); initial=evaluate(); best=initial; logs=[]; steps=0; step_total=math.ceil(len(train)/8)*args.epochs
print(json.dumps({'initialDevLoss':initial,'trainable':trainable,'steps':step_total}),flush=True)
for epoch in range(args.epochs):
    order=list(train);random.shuffle(order)
    for offset in range(0,len(order),8):
        chunk=order[offset:offset+8];optim.zero_grad(set_to_none=True); loss_sum=0
        for row in chunk:
            loss=model(**batch([row])).loss
            if not torch.isfinite(loss): raise RuntimeError('Nonfinite training loss')
            loss_sum+=float(loss.detach());(loss/len(chunk)).backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(),1.0)
        steps+=1
        lr=.00002*min(1,steps/5)*(.1+.9*.5*(1+math.cos(math.pi*steps/step_total)))
        for group in optim.param_groups:group['lr']=lr
        optim.step()
        event={'step':steps,'epoch':epoch+1,'loss':loss_sum/len(chunk),'seconds':round(time.monotonic()-start,2)}
        logs.append(event);print(json.dumps(event),flush=True)
        (out/'progress.json').write_text(json.dumps(event))
    val=evaluate();print(json.dumps({'epoch':epoch+1,'devLoss':val}),flush=True)
    logs.append({'epoch':epoch+1,'devLoss':val})
    best=min(best,val)
    checkpoint=out/f'epoch-{epoch+1}'
    model.save_pretrained(checkpoint);tokenizer.save_pretrained(checkpoint)
manifest.update({'completedAt':time.time(),'elapsedSeconds':time.monotonic()-start,'initialDevLoss':initial,'bestDevLoss':best,'peakAllocatedBytes':torch.cuda.max_memory_allocated(),'checkpoints':{f'epoch-{i+1}':sha(out/f'epoch-{i+1}'/'adapter_model.safetensors') for i in range(args.epochs)},'status':'trained_unvalidated','selectionRule':'Highest functional development pass count, then retention, then fewer tokens, then earlier epoch. Final evaluation never selects checkpoint.'})
(out/'manifest.json').write_text(json.dumps(manifest,indent=2));(out/'training-log.json').write_text(json.dumps(logs,indent=2))
print(json.dumps(manifest),flush=True)
