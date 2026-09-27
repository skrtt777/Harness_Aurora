import json
import time
import urllib.request
from pathlib import Path

base=Path(__file__).resolve().parents[1]/'unreal/AuroraXR/Saved'
for attempt in range(60):
    try:
        health=json.load(urllib.request.urlopen('http://127.0.0.1:8792/health',timeout=2));break
    except OSError: time.sleep(1)
else: raise RuntimeError('Voice worker did not start')
results=[]
for name,text in [('QwenGreeting','Estou aqui. Pode falar.'),('QwenVoiceSample','Oi, eu sou a Aurora. Estou aqui com você. Podemos conversar e retomar suas ideias.')]:
    started=time.monotonic()
    request=urllib.request.Request('http://127.0.0.1:8792/speak',data=json.dumps({'text':text}).encode(),headers={'Content-Type':'application/json'})
    audio=urllib.request.urlopen(request,timeout=180).read()
    elapsed=time.monotonic()-started
    (base/(name+'.wav')).write_bytes(audio)
    request=urllib.request.Request('http://127.0.0.1:8790/transcribe',data=audio,headers={'Content-Type':'audio/wav'})
    transcription=json.load(urllib.request.urlopen(request,timeout=40))
    results.append({'text':text,'seconds':elapsed,'bytes':len(audio),'transcription':transcription['text']})
    print(results[-1],flush=True)
(base/'QwenVoiceValidation.json').write_text(json.dumps({'health':health,'results':results},ensure_ascii=False,indent=2),encoding='utf-8')
