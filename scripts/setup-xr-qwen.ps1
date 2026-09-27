$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$python=Join-Path $repo '.venv-xr-tts/Scripts/python.exe'
if (!(Test-Path -LiteralPath $python)) { & python -m venv (Join-Path $repo '.venv-xr-tts') }
& $python -m pip install --upgrade pip
if($LASTEXITCODE -ne 0){throw 'pip update failed'}
& $python -m pip install torch==2.10.0 torchaudio==2.10.0 --index-url https://download.pytorch.org/whl/cu128
if($LASTEXITCODE -ne 0){throw 'CUDA PyTorch installation failed'}
& $python -m pip install qwen-tts==0.1.1
if($LASTEXITCODE -ne 0){throw 'Qwen TTS installation failed'}
& $python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign')"
if($LASTEXITCODE -ne 0){throw 'Qwen model download failed'}
Write-Output 'Qwen voice ready. Requires an NVIDIA GPU and CUDA-compatible driver.'
