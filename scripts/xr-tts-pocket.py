"""Kyutai Pocket TTS adapter for the existing Aurora XR WAV contract (local CPU)."""
import io
import json
import os
import sys
import time
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import soundfile as sf
import torch
from pocket_tts import TTSModel

ENGINE = 'kyutai-pocket-tts-3.3.0'
VOICE = os.environ.get('AURORA_POCKET_VOICE', 'alba')
LANGUAGE = 'portuguese'
torch.set_num_threads(2)
torch.set_num_interop_threads(1)


class Voice:
    def __init__(self):
        self.model = TTSModel.load_model(language=LANGUAGE)
        self.state = self.model.get_state_for_audio_prompt(VOICE)

    @lru_cache(maxsize=8)
    def synthesize(self, text):
        started = time.monotonic()
        first_chunk = None
        chunks = []
        torch.manual_seed(42)
        # Pocket streams across worker threads; inference-mode tensors cannot
        # be mutated by its decoder thread. no_grad keeps ordinary mutable state.
        with torch.no_grad():
            for chunk in self.model.generate_audio_stream(self.state, text):
                if first_chunk is None:
                    first_chunk = time.monotonic() - started
                chunks.append(chunk.detach().cpu().numpy().reshape(-1))
        if not chunks:
            raise RuntimeError('Empty Pocket TTS audio')
        samples = np.concatenate(chunks)
        if not np.isfinite(samples).all() or not samples.size:
            raise RuntimeError('Invalid Pocket TTS samples')
        peak = np.max(np.abs(samples))
        if peak > .95:
            samples *= .95 / peak
        rate = self.model.sample_rate
        output = io.BytesIO()
        sf.write(output, samples, rate, format='WAV', subtype='PCM_16')
        return output.getvalue(), {'duration': len(samples) / rate, 'sampleRate': rate,
                                   'firstChunkSeconds': first_chunk, 'generationSeconds': time.monotonic() - started}


def serve(voice):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != '/health':
                self.send_error(404); return
            payload = json.dumps({'engine': ENGINE, 'voice': VOICE, 'language': LANGUAGE, 'device': 'cpu', 'local': True}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers(); self.wfile.write(payload)

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
                payload, metrics = voice.synthesize(text.strip())
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(len(payload)))
                self.send_header('X-Aurora-Engine', ENGINE)
                self.send_header('X-Aurora-Voice', VOICE)
                self.send_header('X-Aurora-Rate', str(metrics['sampleRate']))
                self.send_header('X-Aurora-Generation-Ms', str(round(metrics['generationSeconds'] * 1000)))
                self.send_header('X-Aurora-First-Chunk-Ms', str(round(metrics['firstChunkSeconds'] * 1000)))
                self.end_headers(); self.wfile.write(payload)
                print(json.dumps({**metrics, 'requestSeconds': time.monotonic() - started}), flush=True)
            except (ValueError, TypeError, AttributeError):
                self.send_error(400)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as error:
                print(type(error).__name__, flush=True)
                self.send_error(500, 'Pocket TTS unavailable')

        def log_message(self, *args):
            pass

    port = int(os.environ.get('AURORA_TTS_PORT', '8791'))
    voice.synthesize('Estou aqui. Pode falar.')
    print(f'Aurora Pocket TTS ready on loopback:{port}', flush=True)
    HTTPServer(('127.0.0.1', port), Handler).serve_forever()


if __name__ == '__main__':
    voice = Voice()
    if '--prepare' in sys.argv:
        print(json.dumps({'engine': ENGINE, 'language': LANGUAGE, 'voice': VOICE, 'sampleRate': voice.model.sample_rate}), flush=True)
    else:
        serve(voice)
