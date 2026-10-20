# Throwaway spike: speak text read from stdin with System.Speech.
# The text is NEVER interpolated into a command, script, or markup; it is only
# assigned to $text and handed to SpeakAsync as a string.
#
# Modes:
#   speak   sequential utterances (use -Repeat for the warm in-process case)
#   cancel  one utterance, cancel after -CancelAfterMs
#   queue   two queued utterances, cancel all after -CancelAfterMs
#
# Emits FIRST_AUDIO_MS=<ms> lines as each utterance starts rendering, then one
# JSON line on stdout.
[CmdletBinding()]
param(
  [int]$Rate = 0,
  [int]$Volume = 100,
  [string]$Voice = '',
  [ValidateSet('speak', 'cancel', 'queue')][string]$Mode = 'speak',
  [int]$Repeat = 1,
  [int]$CancelAfterMs = 700,
  [switch]$NullOutput,
  [switch]$EchoSha256
)

$ErrorActionPreference = 'Stop'
$procStart = [System.Diagnostics.Stopwatch]::StartNew()

# Read stdin as raw bytes and decode UTF-8 explicitly. PowerShell 5.1's
# [Console]::In uses the legacy console input encoding and mangles non-ASCII
# (measured: 126 UTF-8 chars arrived as 136 mojibake chars), so production must
# not use it for Unicode event text.
$stdinStream = [Console]::OpenStandardInput()
$stdinBuffer = New-Object System.IO.MemoryStream
$stdinStream.CopyTo($stdinBuffer)
$text = [System.Text.Encoding]::UTF8.GetString($stdinBuffer.ToArray())
$sha = [System.Security.Cryptography.SHA256]::Create()
$textBytes = [System.Text.Encoding]::UTF8.GetBytes($text)
$textSha256 = -join ($sha.ComputeHash($textBytes) | ForEach-Object { $_.ToString('x2') })

$result = [ordered]@{
  route       = 'system.speech'
  mode        = $Mode
  rate        = $Rate
  volume      = $Volume
  voice       = $Voice
  chars       = $text.Length
  stdinSha256 = $textSha256
  utterances  = @()
  error       = $null
}

$synth = $null
try {
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
  $synth.Volume = [Math]::Max(0, [Math]::Min(100, $Volume))
  if ($Voice) {
    # Throws if the requested voice is not installed; the error is recorded.
    $synth.SelectVoice($Voice)
  }
  if ($NullOutput) {
    # Simulates rendering with no audio endpoint; speech is synthesized and discarded.
    $synth.SetOutputToNull()
  }

  $null = Register-ObjectEvent -InputObject $synth -EventName SpeakProgress -SourceIdentifier 'spike.progress'
  $null = Register-ObjectEvent -InputObject $synth -EventName SpeakCompleted -SourceIdentifier 'spike.done'

  $count = if ($Mode -eq 'queue') { 1 } else { $Repeat }
  for ($u = 1; $u -le $count; $u++) {
    # Drop stale events left by previous utterances so timing is per-utterance.
    Get-Event -SourceIdentifier 'spike.progress' -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue
    Get-Event -SourceIdentifier 'spike.done' -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue
    $u0 = [DateTime]::Now
    $uResult = [ordered]@{ index = $u; firstAudioMs = $null; completedMs = $null; cancelled = $null; completed = $false }

    if ($Mode -eq 'queue') {
      $synth.SpeakAsync($text) | Out-Null
      $synth.SpeakAsync($text) | Out-Null
    }
    else {
      $synth.SpeakAsync($text) | Out-Null
    }

    $first = Wait-Event -SourceIdentifier 'spike.progress' -Timeout 30
    if ($first) {
      $uResult.firstAudioMs = [math]::Round(($first.TimeGenerated - $u0).TotalMilliseconds, 2)
      Remove-Event -EventIdentifier $first.EventIdentifier
      [Console]::Out.WriteLine('FIRST_AUDIO_MS=' + [math]::Round($procStart.Elapsed.TotalMilliseconds, 2))
      [Console]::Out.Flush()
    }

    if ($Mode -eq 'cancel' -or $Mode -eq 'queue') {
      Start-Sleep -Milliseconds $CancelAfterMs
      $synth.SpeakAsyncCancelAll()
    }

    $done = Wait-Event -SourceIdentifier 'spike.done' -Timeout 120
    if ($done) {
      $uResult.completed = $true
      $uResult.cancelled = [bool]$done.SourceEventArgs.Cancelled
      $uResult.completedMs = [math]::Round(($done.TimeGenerated - $u0).TotalMilliseconds, 2)
      Remove-Event -EventIdentifier $done.EventIdentifier
    }
    else {
      $uResult.error = 'timeout waiting for SpeakCompleted'
    }
    $result.utterances += $uResult
  }
}
catch {
  $result.error = $_.Exception.GetType().FullName + ': ' + $_.Exception.Message
  [Console]::Error.WriteLine($result.error)
}
finally {
  Unregister-Event -SourceIdentifier 'spike.progress' -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier 'spike.done' -ErrorAction SilentlyContinue
  if ($synth) { $synth.Dispose() }
  $result.totalMs = [math]::Round($procStart.Elapsed.TotalMilliseconds, 2)
  $result | ConvertTo-Json -Compress -Depth 6
}
