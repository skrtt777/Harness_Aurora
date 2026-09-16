[CmdletBinding()]
param([string]$InstallPath = "$env:LOCALAPPDATA\AI-Harness")

$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'AI Harness.lnk'
if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
if (Test-Path -LiteralPath $InstallPath) {
  Write-Host "Removendo aplicação de $InstallPath" -ForegroundColor Yellow
  Remove-Item -LiteralPath $InstallPath -Recurse -Force
}
Write-Host 'Aplicação removida. O histórico do navegador não é apagado por este script.' -ForegroundColor Green
