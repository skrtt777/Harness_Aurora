param([Parameter(Mandatory=$true)][string]$InputFile,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$speaker=New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voice=$speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'pt-BR' } | Select-Object -First 1
    if (-not $voice) { throw 'Nenhuma voz local pt-BR instalada.' }
    $speaker.SelectVoice($voice.VoiceInfo.Name)
    $format=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
    $speaker.SetOutputToWaveFile($OutputFile,$format)
    $speaker.Speak([System.IO.File]::ReadAllText($InputFile,[System.Text.Encoding]::UTF8))
} finally { $speaker.Dispose() }
