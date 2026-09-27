$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$python=Join-Path $repo '.venv-xr/Scripts/python.exe'
if (!(Test-Path -LiteralPath $python)) { throw 'Crie o ambiente .venv-xr antes de instalar a voz.' }
& $python -m pip install -r (Join-Path $PSScriptRoot 'xr-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências de voz.' }
$voiceDir=Join-Path $env:APPDATA 'Harness Aurora XR/kokoro'
New-Item -ItemType Directory -Force -Path $voiceDir | Out-Null
$models=@{
    'kokoro-v1.0.onnx'='7D5DF8ECF7D4B1878015A32686053FD0EEBE2BC377234608764CC0EF3636A6C5'
    'voices-v1.0.bin'='BCA610B8308E8D99F32E6FE4197E7EC01679264EFED0CAC9140FE9C29F1FBF7D'
}
foreach ($name in $models.Keys) {
    $target=Join-Path $voiceDir $name
    if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $models[$name]) { continue }
    $partial=$target+'.part'
    & curl.exe -L --fail --silent --show-error "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/$name" -o $partial
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao baixar o modelo neural.' }
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $models[$name]) { throw 'O hash do modelo não corresponde à versão validada.' }
    Move-Item -LiteralPath $partial -Destination $target -Force
}
Write-Output 'Voz neural local instalada: Kokoro / pf_dora / pt-BR.'
& (Join-Path $PSScriptRoot 'setup-xr-qwen.ps1')
