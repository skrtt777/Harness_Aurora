param(
    [string]$Engine = 'C:\Program Files\Epic Games\UE_5.8',
    [string]$AndroidSdk = "$env:LOCALAPPDATA\Android\Sdk",
    [string]$Java = 'C:\Program Files\Java\jdk-19',
    [switch]$SkipCook
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$project = Join-Path $projectRoot 'AuroraXR.uproject'
# Use only for native-code-only changes after a successful full cook.
$cookFlag = if ($SkipCook) { '-skipcook' } else { '-cook' }
$env:ANDROID_HOME = $AndroidSdk
$env:NDKROOT = Join-Path $AndroidSdk 'ndk\27.2.12479018'
$env:JAVA_HOME = $Java
foreach ($required in @($project,$env:NDKROOT,$env:JAVA_HOME)) {
    if (!(Test-Path -LiteralPath $required)) { throw "Missing requirement: $required" }
}
& (Join-Path $Engine 'Engine\Build\BatchFiles\RunUAT.bat') BuildCookRun `
    "-project=$project" -noP4 -platform=Android -cookflavor=ASTC -clientconfig=Development `
    -build $cookFlag -map=/Game/Aurora/Maps/L_AuroraMR -stage -pak -package -archive `
    "-archivedirectory=$projectRoot\Saved\Builds\Quest3" -unattended -utf8output
if ($LASTEXITCODE -ne 0) { throw "Quest build failed with exit code $LASTEXITCODE" }
