<#
.SYNOPSIS
  Orchestrates the background-helper focus methods against a canary window.

.DESCRIPTION
  Launches FocusHarness.ps1 (canary), then tries plain / attach / switch / allow
  focus attempts from separate background PowerShell processes. Records the JSON
  result of each attempt, probes the foreground window after each, and finally
  reads the canary's keystroke count.

  No input is synthesized by any step.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Invoke-FocusMethods.ps1
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)][string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # spikes/s3-windows-delivery
if (-not $OutDir) { $OutDir = Join-Path $root 'out\focus' }
$out = (Resolve-Path $OutDir).Path
$focusScript = Join-Path $PSScriptRoot 'Focus-Window.ps1'
$harness = Join-Path $PSScriptRoot 'FocusHarness.ps1'
$probe = Join-Path $PSScriptRoot 'Get-ForegroundWindow.ps1'

$log = Join-Path $out 'methods-transcript.txt'
function Log([string]$msg) {
  $line = '{0} {1}' -f (Get-Date).ToString('HH:mm:ss.fff'), $msg
  $line | Tee-Object -FilePath $log -Append
}

$initialFg = (& powershell -NoProfile -ExecutionPolicy Bypass -File $probe) | ConvertFrom-Json
Log "initial foreground: $($initialFg.hwnd) pid=$($initialFg.pid) $($initialFg.process) :: $($initialFg.title)"

$ready = Join-Path $out 'methods-canary-ready.json'
$result = Join-Path $out 'methods-canary-result.json'
$keys = Join-Path $out 'methods-canary-keys.log'
Remove-Item $ready, $result, $keys, $log -ErrorAction SilentlyContinue

$canary = Start-Process -FilePath powershell -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $harness,
  '-Title', '"S3 CANARY METHODS"',
  '-LogPath', $keys, '-ReadyPath', $ready, '-ResultPath', $result,
  '-DurationSeconds', '45'
) -PassThru

for ($i = 0; $i -lt 60 -and -not (Test-Path $ready); $i++) { Start-Sleep -Milliseconds 250 }
if (-not (Test-Path $ready)) { throw 'Canary did not become ready' }
$canaryInfo = Get-Content $ready -Raw | ConvertFrom-Json
Log "canary hwnd=$($canaryInfo.hwnd) pid=$($canaryInfo.pid) isForeground=$($canaryInfo.isForeground)"

$methodResults = @()
foreach ($method in @('plain', 'attach', 'attachfg', 'switch', 'allow', 'uia')) {
  Log "--- method=$method (canary should NOT already be foreground) ---"
  $json = & powershell -NoProfile -ExecutionPolicy Bypass -File $focusScript -TargetHwnd $canaryInfo.hwnd -Method $method
  $json | Out-File -FilePath (Join-Path $out "method-$method.json") -Encoding UTF8
  Log "focus result: $json"
  $fg = (& powershell -NoProfile -ExecutionPolicy Bypass -File $probe) | ConvertFrom-Json
  Log "foreground after: $($fg.hwnd) pid=$($fg.pid) $($fg.process) :: $($fg.title)"
  $methodResults += ($json | ConvertFrom-Json)
  Start-Sleep -Milliseconds 500
}

$canary.CloseMainWindow() | Out-Null
$canary.WaitForExit(8000) | Out-Null
if (-not $canary.HasExited) { Stop-Process -Id $canary.Id -Force }

$summary = [pscustomobject]@{
  initialForeground = $initialFg
  canary = $canaryInfo
  methods = $methodResults
  canaryKeystrokes = $(if (Test-Path $result) { (Get-Content $result -Raw | ConvertFrom-Json).keyCount } else { $null })
}
$summary | ConvertTo-Json -Depth 6 | Out-File -FilePath (Join-Path $out 'methods-summary.json') -Encoding UTF8
Log "canary keystrokes: $($summary.canaryKeystrokes)"

# Restore the window that was foreground before the probe.
if ($initialFg.hwnd -and $initialFg.hwnd -ne '0x0') {
  Log "restoring initial foreground $($initialFg.hwnd)"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $focusScript -TargetHwnd $initialFg.hwnd -Method attachfg | ForEach-Object { Log "restore: $_" }
}
