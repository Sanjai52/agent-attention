# Throwaway spike script. Fixed text; the only variable input is -Path, a file
# path passed as a parameter (never interpolated into command text).
# Emits one JSON line on stdout. No event-derived text is accepted.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$Repeat = 1,
  [int]$SpacingMs = 650
)

$ErrorActionPreference = 'Stop'
$procStart = [System.Diagnostics.Stopwatch]::StartNew()

$result = [ordered]@{
  route      = 'soundplayer'
  path       = $Path
  repeat     = $Repeat
  loadMs     = $null
  playCallMs = $null
  calls      = @()
  console    = $null
  error      = $null
}

try {
  $result.console = [int][System.Diagnostics.Process]::GetCurrentProcess().SessionId
  Add-Type -AssemblyName System
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $player = New-Object System.Media.SoundPlayer
  $player.SoundLocation = $Path
  $player.Load()
  $result.loadMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)

  for ($i = 1; $i -le $Repeat; $i++) {
    $call = [System.Diagnostics.Stopwatch]::StartNew()
    $player.Play() # asynchronous; returns once playback is queued
    $result.calls += [ordered]@{
      index         = $i
      playCallMs    = [math]::Round($call.Elapsed.TotalMilliseconds, 2)
      sinceStartMs  = [math]::Round($procStart.Elapsed.TotalMilliseconds, 2)
    }
    if ($i -eq 1) {
      # Emitted immediately so the harness can timestamp spawn -> Play() accepted.
      [Console]::Out.WriteLine('FIRST_PLAY_MS=' + [math]::Round($procStart.Elapsed.TotalMilliseconds, 2))
      [Console]::Out.Flush()
    }
    if ($i -lt $Repeat) { Start-Sleep -Milliseconds $SpacingMs }
  }
  $result.playCallMs = $result.calls[0].playCallMs
  # Keep the process alive so the queued audio can actually render.
  Start-Sleep -Milliseconds 700
}
catch {
  $result.error = $_.Exception.GetType().FullName + ': ' + $_.Exception.Message
  [Console]::Error.WriteLine($result.error)
}
finally {
  $result.totalMs = [math]::Round($procStart.Elapsed.TotalMilliseconds, 2)
  $result | ConvertTo-Json -Compress -Depth 5
}
