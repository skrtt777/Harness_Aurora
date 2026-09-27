param([string]$Serial,[string]$Address,[string]$AndroidSdk="$env:LOCALAPPDATA\Android\Sdk")
$ErrorActionPreference='Stop'
$adb=Join-Path $AndroidSdk 'platform-tools/adb.exe'
$data=Join-Path $env:APPDATA 'Harness Aurora XR'
$config=Join-Path $data 'quest-wifi.json'
if (!(Test-Path -LiteralPath $adb)) { throw 'ADB não encontrado.' }
$usb=@(& $adb devices | Select-String '^([^\s:]+)\s+device$' | ForEach-Object {$_.Matches[0].Groups[1].Value})
if ($Serial -and $Serial -notin $usb) { throw 'O serial USB escolhido não está autorizado/conectado.' }
if (!$Serial -and $usb.Count -eq 1) { $Serial=$usb[0] }
if (!$Serial -and $usb.Count -gt 1) { throw 'Há vários aparelhos USB. Informe -Serial para escolher o Quest.' }
$expectedSerial=$null
if ($Serial) {
    $product=(& $adb -s $Serial shell getprop ro.product.model | Out-String).Trim()
    if ($product -notmatch 'Quest') { throw 'O dispositivo selecionado não foi identificado como Quest.' }
    $network=(& $adb -s $Serial shell ip -4 addr show wlan0 | Out-String)
    if ($network -notmatch 'inet\s+(\d+\.\d+\.\d+\.\d+)/') { throw 'Conecte o Quest à mesma rede local do PC.' }
    $Address=$Matches[1];$expectedSerial=$Serial
    & $adb -s $Serial tcpip 5555
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível ativar ADB por Wi-Fi.' }
} elseif (!$Address) {
    if (!(Test-Path -LiteralPath $config)) { throw 'Primeira ativação: conecte o Quest ao PC por USB e execute novamente.' }
    $saved=Get-Content -Raw -LiteralPath $config | ConvertFrom-Json
    $Address=$saved.address;$expectedSerial=$saved.serial
}
$parsed=$null
if (![Net.IPAddress]::TryParse($Address,[ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Endereço IPv4 inválido.' }
$target="${Address}:5555"
$ready=$false
for($attempt=0;$attempt -lt 4;$attempt++) {
    & $adb connect $target | Out-Host
    try {$deviceState=(& $adb -s $target get-state 2>$null | Out-String).Trim()}catch{$deviceState=''}
    if ($deviceState -eq 'device') {$ready=$true;break}
    Start-Sleep -Milliseconds 750
}
if (!$ready) { throw 'Quest inacessível por Wi-Fi. Confira a rede, acorde o headset ou reative por USB após reiniciar.' }
$actualSerial=(& $adb -s $target shell getprop ro.serialno | Out-String).Trim()
if ($expectedSerial -and $actualSerial -ne $expectedSerial) { & $adb disconnect $target | Out-Null;throw 'O aparelho conectado não corresponde ao Quest salvo.' }
New-Item -ItemType Directory -Force -Path $data | Out-Null
[IO.File]::WriteAllText($config,(@{address=$Address;serial=$actualSerial;port=5555}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
Write-Output "Quest conectado por Wi-Fi: $target. Agora o cabo de dados pode ser removido."
Write-Output "Para instalar: .\Install-Quest.ps1 -Serial $target"
