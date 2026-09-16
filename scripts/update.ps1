param(
  [string]$Branch = "main",
  [string]$RepositoryUrl = "https://github.com/skrtt777/Harness_Aurora"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
Write-Host "AI Harness update - preservando dados locais" -ForegroundColor Cyan

$sourcePath = $projectRoot
$tempRoot = $null
try {
  if (Test-Path ".git") {
    git pull origin $Branch
  } else {
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("ai-harness-update-" + [Guid]::NewGuid().ToString("N"))
    $zipPath = Join-Path $tempRoot "source.zip"
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    Write-Host "Baixando a versao mais recente de $RepositoryUrl ($Branch)..."
    Invoke-WebRequest -Uri "$RepositoryUrl/archive/refs/heads/$Branch.zip" -OutFile $zipPath
    Expand-Archive -LiteralPath $zipPath -DestinationPath $tempRoot -Force
    $sourcePath = (Get-ChildItem -LiteralPath $tempRoot -Directory | Where-Object { $_.Name -ne "" } | Select-Object -First 1).FullName
    Get-ChildItem -LiteralPath $sourcePath -Force | Where-Object { $_.Name -notin @(".git", "node_modules", "dist", "app") } | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $projectRoot -Recurse -Force
    }
    Get-ChildItem -LiteralPath (Join-Path $sourcePath "app") -Force | Where-Object { $_.Name -ne "data" } | ForEach-Object {
      $destination = Join-Path (Join-Path $projectRoot "app") $_.Name
      Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
    }
  }

  if (Test-Path "frontend\package.json") {
    npm --prefix frontend install
    npm --prefix frontend run build
  }
  Write-Host "Atualizacao concluida. Memorias locais e historico do navegador foram preservados." -ForegroundColor Green
} finally {
  if ($tempRoot -and (Test-Path -LiteralPath $tempRoot)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
