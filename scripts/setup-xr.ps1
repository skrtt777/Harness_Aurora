param([string]$Address='192.168.0.40')
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$data=Join-Path $env:APPDATA 'Harness Aurora XR'
New-Item -ItemType Directory -Force -Path $data | Out-Null
& icacls.exe $data /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) {throw 'Não foi possível restringir o diretório de credenciais.'}
$openssl='C:\Program Files\Git\usr\bin\openssl.exe'
if (-not (Test-Path -LiteralPath (Join-Path $data 'server-cert.pem'))) {
    $certArgs=@('req','-x509','-newkey','rsa:3072','-sha256','-days','365','-nodes','-keyout',('"'+(Join-Path $data 'server-key.pem')+'"'),'-out',('"'+(Join-Path $data 'server-cert.pem')+'"'),'-subj','"/CN=Aurora Local XR"','-addext',"subjectAltName=IP:$Address,IP:127.0.0.1,DNS:localhost",'-addext','basicConstraints=critical,CA:TRUE')
    $certificateProcess=Start-Process -FilePath $openssl -ArgumentList $certArgs -Wait -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $data 'certificate-setup.log')
    if ($certificateProcess.ExitCode -ne 0) {throw 'Falha gerando certificado XR.'}
}
$certificateDir=Join-Path $repo 'unreal\AuroraXR\Content\Certificates'
New-Item -ItemType Directory -Force -Path $certificateDir | Out-Null
Copy-Item -LiteralPath (Join-Path $data 'server-cert.pem') -Destination (Join-Path $certificateDir 'cacert.pem')
$configDir=Join-Path $repo 'unreal\AuroraXR\Saved'
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
Write-Output 'Certificado público preparado. Chave privada permanece no perfil Windows.'
