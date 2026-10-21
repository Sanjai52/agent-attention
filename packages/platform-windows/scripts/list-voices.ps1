# Fixed voice enumeration for doctor/config. Emits one JSON object on stdout.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

try {
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voices = @()
  foreach ($voice in $synth.GetInstalledVoices()) {
    $voices += [ordered]@{
      name    = $voice.VoiceInfo.Name
      culture = $voice.VoiceInfo.Culture.Name
      gender  = [string]$voice.VoiceInfo.Gender
      age     = [string]$voice.VoiceInfo.Age
      enabled = [bool]$voice.Enabled
    }
  }
  [ordered]@{
    count  = $voices.Count
    voices = $voices
  } | ConvertTo-Json -Compress -Depth 5
  $synth.Dispose()
  exit 0
}
catch {
  [Console]::Error.WriteLine($_.Exception.GetType().FullName + ': ' + $_.Exception.Message)
  exit 2
}
