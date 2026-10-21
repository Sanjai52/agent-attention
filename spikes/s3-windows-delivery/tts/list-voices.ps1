# Throwaway spike: enumerate SAPI voices available to System.Speech.
Add-Type -AssemblyName System.Speech
$ErrorActionPreference = 'Stop'

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @()
foreach ($v in $synth.GetInstalledVoices()) {
  $voices += [ordered]@{
    name    = $v.VoiceInfo.Name
    culture = $v.VoiceInfo.Culture.Name
    gender  = [string]$v.VoiceInfo.Gender
    age     = [string]$v.VoiceInfo.Age
    enabled = $v.Enabled
  }
}
$result = [ordered]@{
  count  = $voices.Count
  voices = $voices
}
$synth.Dispose()
$result | ConvertTo-Json -Depth 5
