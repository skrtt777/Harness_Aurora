"""Compare complete WAV latency on PC. This is not Quest or audible streaming latency."""
import io
import json
import time
import urllib.request
import wave
from pathlib import Path

stage = Path(__file__).resolve().parents[1] / 'unreal/AuroraXR/Saved/Standalone'
text = 'Olá, Lucas. O menu da Aurora está pronto. Você pode escolher uma conversa ou ajustar a posição do painel.'
report = {'text': text, 'location': 'Windows PC; complete WAV, not streamed playback', 'engines': []}
report_file = stage / 'PocketVoiceComparison.json'
if report_file.exists():
    saved = json.loads(report_file.read_text(encoding='utf-8'))
    if saved.get('text') == text:
        report = saved
for name, port in [('qwen', 8791), ('pocket', 8792)]:
    expected = 'qwen3-tts-1.7b' if name == 'qwen' else 'kyutai-pocket-tts-3.3.0'
    if any(r.get('engine') == expected for r in report['engines']):
        continue  # Preserve uncached measurements when resuming a failed candidate.
    started = time.monotonic()
    request = urllib.request.Request(f'http://127.0.0.1:{port}/speak', data=json.dumps({'text': text}).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=180) as response:
        audio = response.read()
        engine = response.headers.get('X-Aurora-Engine')
        first_chunk = response.headers.get('X-Aurora-First-Chunk-Ms')
    elapsed = time.monotonic() - started
    (stage / f'{name}-aurora.wav').write_bytes(audio)
    with wave.open(io.BytesIO(audio)) as wav:
        duration = wav.getnframes() / wav.getframerate()
        rate = wav.getframerate()
        assert wav.getsampwidth() == 2 and wav.getnchannels() == 1
    record = {'engine': engine, 'seconds': elapsed, 'audioSeconds': duration, 'sampleRate': rate, 'firstChunkMs': first_chunk}
    request = urllib.request.Request('http://127.0.0.1:8790/transcribe', data=audio, headers={'Content-Type': 'audio/wav'})
    with urllib.request.urlopen(request, timeout=120) as response:
        record['transcription'] = json.load(response).get('text')
    report['engines'].append(record)
    (stage / 'PocketVoiceComparison.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False), flush=True)
