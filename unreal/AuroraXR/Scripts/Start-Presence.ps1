$ErrorActionPreference='Stop'
$repo=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$harness=Join-Path $env:ProgramFiles 'Harness Aurora\Harness Aurora.exe'
if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path -LiteralPath $harness)) { throw 'Abra o Harness Aurora antes de iniciar a ponte.' }
    Start-Process -FilePath $harness -WindowStyle Hidden
}
& (Join-Path $repo 'scripts\start-xr.ps1')
