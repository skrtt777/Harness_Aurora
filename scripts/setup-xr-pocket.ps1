$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$python=Join-Path $repo '.venv-xr-pocket/Scripts/python.exe'
if (!(Test-Path -LiteralPath $python)) {
    & python -m venv (Join-Path $repo '.venv-xr-pocket')
    if($LASTEXITCODE -ne 0){throw 'Pocket TTS environment creation failed'}
}
& $python -m pip install --upgrade pip
if($LASTEXITCODE -ne 0){throw 'pip upgrade failed'}
& $python -m pip install torch==2.10.0 --index-url https://download.pytorch.org/whl/cpu
if($LASTEXITCODE -ne 0){throw 'CPU PyTorch installation failed'}
& $python -m pip install pocket-tts==3.3.0 soundfile==0.13.1
if($LASTEXITCODE -ne 0){throw 'Pocket TTS installation failed'}
$ErrorActionPreference='Continue' # Native warnings must not mask the actual exit code on Windows PowerShell.
& $python -X utf8 (Join-Path $repo 'scripts/xr-tts-pocket.py') --prepare
if($LASTEXITCODE -ne 0){throw 'Portuguese model preparation failed'}
Write-Output 'Kyutai Pocket TTS Portuguese prepared on CPU.'
