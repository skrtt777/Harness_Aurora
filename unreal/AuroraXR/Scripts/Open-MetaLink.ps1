param([string]$Engine='C:\Program Files\Epic Games\UE_5.8')
$ErrorActionPreference='Stop'
$runtime = @(
    'C:\Program Files\Meta Horizon\Support\oculus-runtime\oculus_openxr_64.json',
    'C:\Program Files\Oculus\Support\oculus-runtime\oculus_openxr_64.json'
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$runtime) { throw 'Meta Link OpenXR runtime not found.' }
$previousRuntime=$env:XR_RUNTIME_JSON
try {
    $env:XR_RUNTIME_JSON=$runtime
    $project=Join-Path (Split-Path $PSScriptRoot -Parent) 'AuroraXR.uproject'
    Start-Process -FilePath (Join-Path $Engine 'Engine\Binaries\Win64\UnrealEditor.exe') -ArgumentList ('"'+$project+'"')
} finally { $env:XR_RUNTIME_JSON=$previousRuntime }
