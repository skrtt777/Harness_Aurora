"""Loopback-only Portuguese transcription worker; raw audio never saved to disk."""
import io
import json
import os
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer
from faster_whisper import WhisperModel

model = WhisperModel(os.environ.get('AURORA_WHISPER_MODEL', 'small'), device='cpu', compute_type='int8', cpu_threads=4)

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if self.path != '/transcribe' or not 44 <= length <= 4_000_000:
                self.send_error(400); return
            audio = self.rfile.read(length)
            with wave.open(io.BytesIO(audio)) as wav:
                duration = wav.getnframes() / wav.getframerate()
                if duration > 40 or wav.getnchannels() > 2:
                    self.send_error(400); return
            segments, info = model.transcribe(io.BytesIO(audio), language='pt', beam_size=3, vad_filter=True, condition_on_previous_text=False)
            text = ' '.join(s.text.strip() for s in segments).strip()
            payload = json.dumps({'text': text, 'language': 'pt', 'duration': duration}, ensure_ascii=False).encode('utf-8')
            self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(payload)
        except Exception:
            self.send_error(500, 'Transcription failed')
    def log_message(self, *args):
        pass

print('Aurora STT ready on loopback:8790', flush=True)
HTTPServer(('127.0.0.1', 8790), Handler).serve_forever()
