param([string]$Serial, [string]$AndroidSdk = "$env:LOCALAPPDATA\Android\Sdk")
$ErrorActionPreference = 'Stop'
$adb = Join-Path $AndroidSdk 'platform-tools\adb.exe'
$root = Split-Path $PSScriptRoot -Parent
$apk = Get-ChildItem (Join-Path $root 'Saved\Builds\Quest3') -Recurse -Filter '*.apk' |
    Where-Object Name -NotLike '*AFS*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$apk) { throw 'Run Build-Quest.ps1 first. No packaged APK found.' }
$connected = @(& $adb devices | Select-String '^([^\s]+)\s+device$' | ForEach-Object { $_.Matches[0].Groups[1].Value })
if (!$Serial) {
    if ($connected.Count -ne 1) { throw 'Connect one Quest through ADB (USB or Wi-Fi), or pass -Serial with its serial/IP:port.' }
    $Serial = $connected[0]
}
if ($Serial -notin $connected) { throw 'Selected headset is not connected and authorized through ADB (USB or Wi-Fi).' }
& $adb -s $Serial install -r $apk.FullName
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed.' }
& $adb -s $Serial shell am start -n com.aurora.xr/com.epicgames.unreal.GameActivity
if ($LASTEXITCODE -ne 0) { throw 'Application launch failed.' }
