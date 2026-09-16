param([string]$Branch = "main")
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
Write-Host "AI Harness update - preservando dados locais" -ForegroundColor Cyan
if (Test-Path ".git") {
  git pull origin $Branch
} else {
  Write-Warning "Esta pasta nao e um checkout Git. Copie a nova versao do pacote antes de executar este atualizador."
}
if (Test-Path "frontend\package.json") {
  npm --prefix frontend install
  npm --prefix frontend run build
}
Write-Host "Atualizacao concluida. Memorias locais e historico do navegador foram preservados." -ForegroundColor Green
