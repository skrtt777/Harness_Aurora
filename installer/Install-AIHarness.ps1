[CmdletBinding()]
param(
  [string]$InstallPath = "$env:LOCALAPPDATA\AI-Harness",
  [switch]$SkipDependencies,
  [switch]$Launch
)

$ErrorActionPreference = 'Stop'
$sourcePath = Split-Path -Parent $PSScriptRoot

function Require-Command([string]$Name, [string]$Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name nao foi encontrado. $Hint"
  }
}

Require-Command 'node' 'Instale Node.js 20 ou superior e execute o instalador novamente.'
Require-Command 'npm' 'Instale o Node.js, que inclui o npm.'
Require-Command 'codex' 'Instale e autentique o Codex CLI antes de iniciar o AI Harness.'

New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
Write-Host "Instalando AI Harness em $InstallPath" -ForegroundColor Cyan

$excluded = @('node_modules', 'dist', '.git', 'app\data')
Get-ChildItem -LiteralPath $sourcePath -Force | Where-Object { $excluded -notcontains $_.Name } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $InstallPath -Recurse -Force
}

if (-not $SkipDependencies) {
  npm --prefix (Join-Path $InstallPath 'frontend') install
  npm --prefix (Join-Path $InstallPath 'frontend') run build
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'AI Harness.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $InstallPath 'start-test.cmd'
$shortcut.WorkingDirectory = $InstallPath
$shortcut.Description = 'AI Harness - Memory Atlas'
$shortcut.Save()

Write-Host "Instalacao concluida. Atalho criado em $shortcutPath" -ForegroundColor Green
if ($Launch) { Start-Process -FilePath $shortcutPath }
