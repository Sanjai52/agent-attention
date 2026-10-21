# Fixed SAPI speaker. Event text arrives ONLY on stdin as UTF-8 bytes and is
# handed to SpeechSynthesizer.Speak() as a string. It is never interpolated into
# a command, script, or markup (PRD §17.2).
#
# Exit codes:
#   0 delivered
#   2 synthesis failure
#   4 no enabled voices installed
#   5 requested voice not installed
[CmdletBinding()]
param(
  [int]$Rate = 0,
  [int]$Volume = 100,
  [string]$Voice = ''
)

$ErrorActionPreference = 'Stop'
$Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
$Volume = [Math]::Max(0, [Math]::Min(100, $Volume))

# PowerShell 5.1's [Console]::In uses the legacy console encoding and mangles
# non-ASCII. Read raw bytes and decode UTF-8 explicitly (S3-T04).
$stdinStream = [Console]::OpenStandardInput()
$stdinBuffer = New-Object System.IO.MemoryStream
$stdinStream.CopyTo($stdinBuffer)
$text = [System.Text.Encoding]::UTF8.GetString($stdinBuffer.ToArray())

if ([string]::IsNullOrWhiteSpace($text)) {
  exit 0
}

$synth = $null
try {
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

  $installed = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled })
  if ($installed.Count -eq 0) {
    [Console]::Error.WriteLine('TTS_NO_VOICES')
    exit 4
  }

  if ($Voice) {
    $match = @($installed | Where-Object { $_.VoiceInfo.Name -ieq $Voice })
    if ($match.Count -eq 0) {
      [Console]::Error.WriteLine('VOICE_NOT_FOUND: ' + $Voice)
      exit 5
    }
    $synth.SelectVoice($match[0].VoiceInfo.Name)
  }

  $synth.Rate = $Rate
  $synth.Volume = $Volume
  # Synchronous: the provider owns the timeout and terminates this process to
  # cancel an utterance.
  $synth.Speak($text)
  exit 0
}
catch {
  [Console]::Error.WriteLine($_.Exception.GetType().FullName + ': ' + $_.Exception.Message)
  exit 2
}
finally {
  if ($synth) { $synth.Dispose() }
}
