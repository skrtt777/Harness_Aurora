"""Local GPU voice design worker. No text or speech is sent to a cloud service."""
import io
import json
import os
import re
import time
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, HTTPServer
import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

torch.set_num_threads(4)
MODEL = 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign'
INSTRUCTION = ('A warm, clear adult female voice speaking native Brazilian Portuguese with a neutral Brazilian accent. '
               'Natural conversational rhythm, confident and friendly, medium pitch, smooth connected phrases, '
               'subtle expressive intonation. A personal assistant talking to one person. No theatrical delivery, no whispering.')
model = Qwen3TTSModel.from_pretrained(MODEL, device_map='cuda:0', dtype=torch.bfloat16, attn_implementation='sdpa')

@lru_cache(maxsize=8)
def synthesize(text):
    # Short sentence groups avoid long autoregressive tails while keeping punctuation.
    parts, current = [], ''
    for sentence in re.split(r'(?<=[.!?;])\s+', text.strip()):
        if current and len(current) + len(sentence) > 240:
            parts.append(current); current = ''
        current += (' ' if current else '') + sentence
    if current: parts.append(current)
    audio = []
    for part in parts:
        torch.manual_seed(42)
        with torch.inference_mode():
            waves, rate = model.generate_voice_design(text=part, language='Portuguese', instruct=INSTRUCTION,
                                                       max_new_tokens=1536, do_sample=True, temperature=0.7)
        audio.append(waves[0])
        audio.append(np.zeros(int(rate * .12), dtype=np.float32))
    samples = np.concatenate(audio)
    peak = np.max(np.abs(samples))
    if peak > .95: samples *= .95 / peak
    output = io.BytesIO(); sf.write(output, samples, rate, format='WAV', subtype='PCM_16')
    return output.getvalue(), len(samples) / rate, rate

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/health': self.send_error(404); return
        payload = json.dumps({'engine':'qwen3-tts-1.7b','voice':'aurora-br','language':'pt-BR','local':True}).encode()
        self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(payload)))
        self.end_headers(); self.wfile.write(payload)

    def do_POST(self):
        try:
            if self.headers.get('Origin'): self.send_error(403); return
            length = int(self.headers.get('Content-Length','0'))
            if self.path != '/speak' or not 1 <= length <= 40000: self.send_error(400); return
            text = json.loads(self.rfile.read(length)).get('text')
            if not isinstance(text,str) or not text.strip() or len(text)>6000: self.send_error(400); return
            started=time.monotonic(); payload,duration,rate=synthesize(text.strip())
            self.send_response(200); self.send_header('Content-Type','audio/wav'); self.send_header('Content-Length',str(len(payload)))
            self.send_header('X-Aurora-Engine','qwen3-tts-1.7b'); self.send_header('X-Aurora-Voice','aurora-br'); self.send_header('X-Aurora-Rate',str(rate))
            self.end_headers(); self.wfile.write(payload)
            print(f'Speech: {duration:.2f}s audio, {time.monotonic()-started:.2f}s generation',flush=True)
        except (ValueError,TypeError,AttributeError): self.send_error(400)
        except Exception as error:
            print(type(error).__name__,flush=True); self.send_error(500,'Voice unavailable')
    def log_message(self,*args): pass

port=int(os.environ.get('AURORA_TTS_PORT','8791'))
synthesize('Estou aqui. Pode falar.')
print(f'Aurora Qwen GPU voice ready on loopback:{port}',flush=True)
HTTPServer(('127.0.0.1',port),Handler).serve_forever()
