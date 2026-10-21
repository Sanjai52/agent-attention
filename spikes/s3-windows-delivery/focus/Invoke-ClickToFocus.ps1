<#
.SYNOPSIS
  Click-to-focus prototype for S3 0.11 (Q-07): focus without input.

.DESCRIPTION
  Models a toast activation as closely as possible without the 0.10 toast
  registration: an activator process is first granted the foreground (the state
  Windows gives a toast-activated handler), then calls plain SetForegroundWindow
  on the target. Two targets are exercised:

    1. a canary window that logs every key event, so delivery of synthesized
       input would be visible;
    2. a real Windows Terminal window hosting a marker session.

  Control case: the same plain SetForegroundWindow call from a background
  process is expected to fail (measured separately by Invoke-FocusMethods).

  No SendInput / keybd_event / SendKeys / PostMessage keystrokes exist in any
  script used here.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Invoke-ClickToFocus.ps1
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)][string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Split-Path -Parent $here
if (-not $OutDir) { $OutDir = Join-Path $root 'out\focus' }
$out = (Resolve-Path $OutDir).Path
$harness = Join-Path $here 'FocusHarness.ps1'
$focus = Join-Path $here 'Focus-Window.ps1'
$probe = Join-Path $here 'Get-ForegroundWindow.ps1'
$inventory = Join-Path $here 'Get-WindowInventory.ps1'
$transcript = Join-Path $out 'click-to-focus-transcript.txt'

function Log([string]$msg) {
  ('{0} {1}' -f (Get-Date).ToString('HH:mm:ss.fff'), $msg) | Tee-Object -FilePath $transcript -Append
}

function Invoke-Probe {
  ((& powershell -NoProfile -ExecutionPolicy Bypass -File $probe) | Out-String) | ConvertFrom-Json
}

function Invoke-Focus {
  param([string]$Hwnd, [string]$Method = 'attachfg')
  ((& powershell -NoProfile -ExecutionPolicy Bypass -File $focus -TargetHwnd $Hwnd -Method $Method) | Out-String) | ConvertFrom-Json
}

function Get-WindowRows {
  param([string]$TitleMatch = '')
  if ($TitleMatch) {
    $json = & powershell -NoProfile -ExecutionPolicy Bypass -File $inventory -TitleMatch $TitleMatch -AsJson
  } else {
    $json = & powershell -NoProfile -ExecutionPolicy Bypass -File $inventory -AsJson
  }
  if (-not $json) { return }
  $parsed = ($json | Out-String) | ConvertFrom-Json
  foreach ($row in @($parsed)) { $row }
}

function Start-Harness {
  param([string]$Title, [string]$Prefix, [int]$Duration, [string]$TargetHwnd = '0', [string]$Trigger = '', [switch]$SelfFocusFirst)
  $ready = Join-Path $out "$Prefix-ready.json"
  $result = Join-Path $out "$Prefix-result.json"
  $keys = Join-Path $out "$Prefix-keys.log"
  Remove-Item $ready, $result, $keys -ErrorAction SilentlyContinue
  $harnessArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $harness,
    '-Title', $Title, '-LogPath', $keys, '-ReadyPath', $ready, '-ResultPath', $result,
    '-DurationSeconds', "$Duration")
  if ($TargetHwnd -ne '0') { $harnessArgs += @('-FocusTargetHwnd', $TargetHwnd) }
  if ($Trigger) { $harnessArgs += @('-TriggerPath', $Trigger) }
  if ($SelfFocusFirst) { $harnessArgs += '-SelfFocusFirst' }
  $proc = Start-Process -FilePath powershell -ArgumentList $harnessArgs -PassThru
  for ($i = 0; $i -lt 60 -and -not (Test-Path $ready); $i++) { Start-Sleep -Milliseconds 200 }
  if (-not (Test-Path $ready)) { throw "harness $Prefix did not become ready" }
  [pscustomobject]@{
    proc = $proc
    info = (Get-Content $ready -Raw | ConvertFrom-Json)
    resultPath = $result
    keyLog = $keys
  }
}

function Complete-Harness($h, [int]$TimeoutSeconds = 20) {
  $h.proc.WaitForExit($TimeoutSeconds * 1000) | Out-Null
  if (-not $h.proc.HasExited) { Stop-Process -Id $h.proc.Id -Force }
  $result = if (Test-Path $h.resultPath) { Get-Content $h.resultPath -Raw | ConvertFrom-Json } else { $null }
  $keyLines = if (Test-Path $h.keyLog) { @(Get-Content $h.keyLog) } else { @() }
  [pscustomobject]@{
    title = $h.info.title
    pid = $h.info.pid
    readyIsForeground = $h.info.isForeground
    keyCount = if ($result) { $result.keyCount } else { $null }
    mouseCount = if ($result) { $result.mouseCount } else { $null }
    focusAttempt = if ($result) { $result.focusAttempt } else { $null }
    keyLogLines = $keyLines.Count
    keyLog = $keyLines
  }
}

$initial = Invoke-Probe
Log "initial foreground: $($initial.hwnd) pid=$($initial.pid) $($initial.process) :: $($initial.title)"

$report = [pscustomobject]@{
  startedAt = (Get-Date).ToString('o')
  os = [System.Environment]::OSVersion.Version.ToString()
  initialForeground = $initial
  canaryCase = $null
  terminalCase = $null
  controlCase = $null
  endedAt = $null
}

# ---------------------------------------------------------------- 1. canary case
$trigger = Join-Path $out 'canary-trigger.json'
Remove-Item $trigger -ErrorAction SilentlyContinue
$target = Start-Harness -Title 'S3-TARGET' -Prefix 'target' -Duration 12
Log "target canary: $($target.info.hwnd) pid=$($target.info.pid) isForeground=$($target.info.isForeground)"
$activator = Start-Harness -Title 'S3-ACTIVATOR' -Prefix 'activator' -Duration 12 -TargetHwnd $target.info.hwnd -Trigger $trigger -SelfFocusFirst
Log "activator canary: $($activator.info.hwnd) pid=$($activator.info.pid) isForeground=$($activator.info.isForeground)"

$grant = Invoke-Focus -Hwnd $activator.info.hwnd
Log "grant foreground to activator: targetIsForeground=$($grant.targetIsForeground) errors=$($grant.errors -join ',')"
Start-Sleep -Milliseconds 400
$fgBefore = Invoke-Probe
Log "foreground before trigger: $($fgBefore.hwnd) pid=$($fgBefore.pid) :: $($fgBefore.title)"

New-Item -ItemType File -Path $trigger -Force | Out-Null
Start-Sleep -Seconds 2
$fgAfter = Invoke-Probe
Log "foreground after trigger: $($fgAfter.hwnd) pid=$($fgAfter.pid) :: $($fgAfter.title)"

$targetResult = Complete-Harness $target
$activatorResult = Complete-Harness $activator
Log "canary target keyCount=$($targetResult.keyCount); activator keyCount=$($activatorResult.keyCount); activator focusAttempt=$($activatorResult.focusAttempt | ConvertTo-Json -Compress)"

$report.canaryCase = [pscustomobject]@{
  target = $target.info
  activator = $activator.info
  foregroundGrant = $grant
  foregroundBeforeTrigger = $fgBefore
  foregroundAfterTrigger = $fgAfter
  targetResult = $targetResult
  activatorResult = $activatorResult
}

# -------------------------------------------------------------- 2. terminal case
& wt.exe -w new new-tab --title 'S3-CLICKTARGET' powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'fixtures\wt-click.ps1')
$wt = $null
for ($i = 0; $i -lt 60 -and -not $wt; $i++) {
  Start-Sleep -Milliseconds 250
  $wt = Get-WindowRows -TitleMatch 'S3-CLICKTARGET' | Where-Object { $_.title -eq 'S3-CLICKTARGET' } | Select-Object -First 1
}
if (-not $wt) { throw 'WT click target did not appear' }
Log "WT click target: $($wt | ConvertTo-Json -Compress)"

$trigger2 = Join-Path $out 'terminal-trigger.json'
Remove-Item $trigger2 -ErrorAction SilentlyContinue
$activator2 = Start-Harness -Title 'S3-ACTIVATOR-2' -Prefix 'activator2' -Duration 12 -TargetHwnd $wt.hwnd -Trigger $trigger2 -SelfFocusFirst
Log "activator-2: $($activator2.info.hwnd) pid=$($activator2.info.pid)"
$grant2 = Invoke-Focus -Hwnd $activator2.info.hwnd
Start-Sleep -Milliseconds 400
$fg2Before = Invoke-Probe
Log "grant to activator-2: $($grant2.targetIsForeground); foreground=$($fg2Before.hwnd) pid=$($fg2Before.pid) :: $($fg2Before.title)"
New-Item -ItemType File -Path $trigger2 -Force | Out-Null
Start-Sleep -Seconds 2
$fg2After = Invoke-Probe
Log "after trigger: foreground=$($fg2After.hwnd) pid=$($fg2After.pid) :: $($fg2After.title); expected=$($wt.hwnd)"
$activator2Result = Complete-Harness $activator2
Log "activator-2 keyCount=$($activator2Result.keyCount); focusAttempt=$($activator2Result.focusAttempt | ConvertTo-Json -Compress)"

$report.terminalCase = [pscustomobject]@{
  window = $wt
  activator = $activator2.info
  foregroundGrant = $grant2
  foregroundBeforeTrigger = $fg2Before
  foregroundAfterTrigger = $fg2After
  activatorResult = $activator2Result
}

# --------------------------------------------- 3. control: background helper fails
$control = Invoke-Focus -Hwnd $wt.hwnd -Method plain
Log "control: plain SetForegroundWindow from background helper: targetIsForeground=$($control.targetIsForeground) errors=$($control.errors -join ',')"
$report.controlCase = $control

$report.endedAt = (Get-Date).ToString('o')
$report | ConvertTo-Json -Depth 10 | Out-File -FilePath (Join-Path $out 'click-to-focus.json') -Encoding UTF8

# ------------------------------------------------------------------- cleanup
foreach ($m in @('wt-click.ps1')) {
  $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($m) }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}
for ($i = 0; $i -lt 20; $i++) {
  $still = Get-WindowRows -TitleMatch '^S3-CLICKTARGET$'
  if (-not $still) { break }
  Start-Sleep -Milliseconds 250
}
$still = Get-WindowRows -TitleMatch '^S3-CLICKTARGET$' | Select-Object -First 1
if ($still) {
  Log "closing leftover WT test window $($still.hwnd)"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'Close-TestWindow.ps1') -Hwnd $still.hwnd | Out-Null
}

Log "restoring initial foreground $($initial.hwnd)"
[void](Invoke-Focus -Hwnd $initial.hwnd)
Log 'done'
