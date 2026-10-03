# Diagnóstico do Harness Aurora: por que a IA local, o Codex ou o Claude não respondem.
# Uso (PowerShell, sem administrador):
#   powershell -ExecutionPolicy Bypass -File diagnostico.ps1
# Gera "aurora-diagnostico.txt" na Área de Trabalho. Não mostra senhas, tokens nem conteúdo de conversas.

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$lines = New-Object System.Collections.Generic.List[string]
function Say($text) { $lines.Add($text); Write-Host $text }
function Run($exe, $argList, $stdin, $seconds) {
  # Runs a program with a deadline; returns exit code and the first lines of output.
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe; $psi.Arguments = $argList
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  try {
    $p = [System.Diagnostics.Process]::Start($psi)
    if ($stdin) { $p.StandardInput.Write($stdin) }
    $p.StandardInput.Close()
    $out = $p.StandardOutput.ReadToEndAsync(); $err = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($seconds * 1000)) { try { $p.Kill() } catch {} ; return "TEMPO ESGOTADO ($seconds s)" }
    $text = ($out.Result + "`n" + $err.Result).Trim()
    if ($text.Length -gt 600) { $text = $text.Substring(0, 600) + " ..." }
    return "saída $($p.ExitCode): $text"
  } catch { return "não executou: $($_.Exception.Message)" }
}
function Find($names) {
  foreach ($n in $names) { $c = Get-Command $n -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { return $c.Source } }
  return $null
}

Say "=== Harness Aurora — diagnóstico $(Get-Date -Format 'dd/MM/yyyy HH:mm') ==="

# Máquina
$os = Get-CimInstance Win32_OperatingSystem
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$gpus = (Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name) ($([math]::Round($_.AdapterRAM/1GB,1)) GB)" }) -join "; "
Say "Windows: $($os.Caption) $($os.Version) | RAM: $([math]::Round($os.TotalVisibleMemorySize/1MB,1)) GB (livre $([math]::Round($os.FreePhysicalMemory/1MB,1)) GB)"
Say "CPU: $cpu"
Say "GPU: $gpus"
Say "Usuário com acento/espaço no caminho: $(if ($env:USERPROFILE -match '[^\x00-\x7F ]|\s') { 'SIM' } else { 'não' }) ($($env:USERPROFILE.Length) caracteres)"

# Aurora instalada e servidor local
$exe = Join-Path $env:LOCALAPPDATA "Programs\Harness Aurora\Harness Aurora.exe"
if (Test-Path $exe) { Say "Aurora instalada: $((Get-Item $exe).VersionInfo.ProductVersion)" } else { Say "Aurora: não achei em $exe" }
$port = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($port) { Say "Porta 8787: em uso pelo processo $((Get-Process -Id $port.OwningProcess -ErrorAction SilentlyContinue).ProcessName)" } else { Say "Porta 8787: livre (a Aurora não está aberta ou não subiu o servidor)" }

# IA local (Ollama)
Say ""
Say "--- IA local (Ollama) ---"
$ollama = Find @("ollama")
if (-not $ollama) { $default = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"; if (Test-Path $default) { $ollama = $default } }
if ($ollama) {
  Say "Ollama: $ollama"
  Say "Versão: $(Run $ollama '--version' $null 15)"
  try { $v = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -TimeoutSec 5; Say "Servidor: rodando (versão $($v.version))" }
  catch { Say "Servidor: NÃO responde em 127.0.0.1:11434 ($($_.Exception.Message))" }
  try {
    $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
    $names = $tags.models | ForEach-Object { $_.name }
    Say "Modelos baixados: $(if ($names) { $names -join ', ' } else { 'NENHUM' })"
    Say "qwen3.5:4b (padrão da Aurora): $(if ($names -contains 'qwen3.5:4b') { 'sim' } else { 'NÃO' }) | nomic-embed-text (memória/busca): $(if ($names | Where-Object { $_ -like 'nomic-embed-text*' }) { 'sim' } else { 'NÃO' })"
    if ($names -contains "qwen3.5:4b") {
      $t = Get-Date
      try {
        $body = @{ model = "qwen3.5:4b"; messages = @(@{ role = "user"; content = "Responda só: ok" }); stream = $false; think = $false } | ConvertTo-Json -Depth 4
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/chat" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 180
        Say "Teste do modelo: respondeu '$($r.message.content.Trim())' em $([math]::Round(((Get-Date) - $t).TotalSeconds,1)) s"
      } catch { Say "Teste do modelo: FALHOU ($($_.Exception.Message)) depois de $([math]::Round(((Get-Date) - $t).TotalSeconds,1)) s" }
    }
  } catch { Say "Lista de modelos: indisponível" }
} else { Say "Ollama: NÃO instalado (nem no PATH nem em $env:LOCALAPPDATA\Programs\Ollama)" }

# IAs pagas (CLIs)
foreach ($cli in @(
  @{ Name = "Codex"; Cmd = @("codex"); Npm = "@openai\codex\bin\codex.js"; Version = "--version"; Auth = "login status"; Ask = "exec --skip-git-repo-check -" },
  @{ Name = "Claude"; Cmd = @("claude"); Npm = "@anthropic-ai\claude-code\cli.js"; Version = "--version"; Auth = $null; Ask = "-p --output-format text" }
)) {
  Say ""
  Say "--- $($cli.Name) ---"
  $path = Find $cli.Cmd
  $npmScript = Join-Path $env:APPDATA "npm\node_modules\$($cli.Npm)"
  if (-not $path -and (Test-Path $npmScript)) { $path = $npmScript }
  if (-not $path) { Say "$($cli.Name): NÃO encontrado no PATH nem em $env:APPDATA\npm"; continue }
  Say "Encontrado: $path"
  $runner = $path; $prefix = ""
  if ($path -like "*.js") { $node = Find @("node"); if (-not $node) { Say "Precisa do Node para rodar $path, e o node não está no PATH"; continue }; $runner = $node; $prefix = "`"$path`" " }
  elseif ($path -like "*.cmd" -or $path -like "*.ps1") {
    $js = Join-Path (Split-Path $path) "node_modules\$($cli.Npm)"
    if (Test-Path $js) { $node = Find @("node"); $runner = $node; $prefix = "`"$js`" " } else { Say "Só existe o atalho $path (sem o pacote npm ao lado): a Aurora não consegue chamar esse formato" }
  }
  Say "Versão: $(Run $runner ($prefix + $cli.Version) $null 20)"
  if ($cli.Auth) { Say "Login: $(Run $runner ($prefix + $cli.Auth) $null 20)" }
  Say "Pergunta de teste: $(Run $runner ($prefix + $cli.Ask) 'Responda so: ok' 120)"
}

Say ""
Say "PATH (pastas que contêm codex, claude, ollama ou node):"
($env:PATH -split ";") | Where-Object { $_ -and (Test-Path $_) -and (Get-ChildItem -Path (Join-Path $_ "*") -Include "codex*","claude*","ollama*","node.exe" -ErrorAction SilentlyContinue | Select-Object -First 1) } | ForEach-Object { Say "  $_" }

$file = Join-Path ([Environment]::GetFolderPath("Desktop")) "aurora-diagnostico.txt"
$lines | Out-File -FilePath $file -Encoding utf8
Write-Host ""
Write-Host "Relatório salvo em: $file" -ForegroundColor Green
