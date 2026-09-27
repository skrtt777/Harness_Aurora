param([ValidateSet('pocket','qwen')][string]$TtsEngine='pocket')
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$data=Join-Path $env:APPDATA 'Harness Aurora XR'
if (-not (Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath 'node.exe' -ArgumentList 'app/xrBridge.js' -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'bridge.log') -RedirectStandardError (Join-Path $data 'bridge-error.log')
}
if (-not (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath (Join-Path $repo '.venv-xr\Scripts\python.exe') -ArgumentList 'scripts/xr-voice.py' -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'voice.log') -RedirectStandardError (Join-Path $data 'voice-error.log')
}
Write-Output 'Serviços XR iniciados em segundo plano. O Harness desktop deve continuar aberto.'
if (-not (Get-NetTCPConnection -LocalPort 8791 -State Listen -ErrorAction SilentlyContinue)) {
    $ttsPython=if($TtsEngine -eq 'pocket'){Join-Path $repo '.venv-xr-pocket\Scripts\python.exe'}else{Join-Path $repo '.venv-xr-tts\Scripts\python.exe'}
    $ttsScript=if($TtsEngine -eq 'pocket'){'-X utf8 scripts/xr-tts-pocket.py'}else{'scripts/xr-tts-qwen.py'}
    if(!(Test-Path -LiteralPath $ttsPython)){throw "Motor $TtsEngine não preparado. Execute scripts/setup-xr-$TtsEngine.ps1."}
    Start-Process -FilePath $ttsPython -ArgumentList $ttsScript -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'tts.log') -RedirectStandardError (Join-Path $data 'tts-error.log')
}
