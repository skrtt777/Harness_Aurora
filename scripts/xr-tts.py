"""Resident, loopback-only Brazilian Portuguese neural speech worker."""
import io
import json
import os
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
import soundfile as sf
from kokoro_onnx import Kokoro

directory = Path(os.environ['APPDATA']) / 'Harness Aurora XR' / 'kokoro'
model = Kokoro(str(directory / 'kokoro-v1.0.onnx'), str(directory / 'voices-v1.0.bin'))
VOICE = 'pf_dora'

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/health':
            self.send_error(404); return
        payload = json.dumps({'engine': 'kokoro-82m', 'voice': VOICE, 'language': 'pt-BR', 'local': True}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)

    def do_POST(self):
        try:
            if self.headers.get('Origin'):
                self.send_error(403); return
            length = int(self.headers.get('Content-Length', '0'))
            if self.path != '/speak' or not 1 <= length <= 40000:
                self.send_error(400); return
            text = json.loads(self.rfile.read(length)).get('text')
            if not isinstance(text, str) or not text.strip() or len(text) > 6000:
                self.send_error(400); return
            started = time.monotonic()
            samples, rate = model.create(text, voice=VOICE, speed=1.0, lang='pt-br')
            output = io.BytesIO()
            sf.write(output, samples, rate, format='WAV', subtype='PCM_16')
            payload = output.getvalue()
            self.send_response(200); self.send_header('Content-Type', 'audio/wav')
            self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)
            print(f'Neural speech completed: {len(samples)/rate:.1f}s audio, {time.monotonic()-started:.2f}s synthesis', flush=True)
        except (ValueError, TypeError, AttributeError):
            self.send_error(400, 'Invalid speech request')
        except Exception:
            self.send_error(500, 'Neural speech unavailable')

    def log_message(self, *args):
        pass

print('Aurora neural TTS ready on loopback:8791 / pf_dora', flush=True)
HTTPServer(('127.0.0.1', 8791), Handler).serve_forever()
