<#
.SYNOPSIS
  S3 0.11 host detection probe: foreground window -> process/window mapping.

.DESCRIPTION
  Brings each test host window to the foreground with the attachfg helper
  (window-management APIs only; no synthesized input), samples the foreground
  window, and records the mapping from a session process to the host window.

  Hosts:
    * Windows Terminal (dedicated window created by this spike)
    * VS Code (existing windows, read-only focus changes, restored afterwards)
    * Classic console host (dedicated conhost + cmd window)

  Also exercises Windows Terminal tab switching and pane splitting to test
  whether the foreground window can distinguish tabs/panes.

  Results are written as JSON under out/focus/.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Invoke-HostDetection.ps1
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
$focus = Join-Path $here 'Focus-Window.ps1'
$probe = Join-Path $here 'Get-ForegroundWindow.ps1'
$inventory = Join-Path $here 'Get-WindowInventory.ps1'
$close = Join-Path $here 'Close-TestWindow.ps1'
$transcript = Join-Path $out 'detection-transcript.txt'

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

function Get-Sessions {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='cmd.exe'" |
    Select-Object ProcessId, ParentProcessId, Name, CommandLine
}

function Get-Ancestry {
  param([int]$ProcessId)
  $chain = @()
  $current = $ProcessId
  for ($i = 0; $i -lt 12 -and $current; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue
    if (-not $p) { break }
    $chain += [pscustomobject]@{ pid = [int]$p.ProcessId; name = $p.Name; parent = [int]$p.ParentProcessId }
    if ($p.ParentProcessId -eq 0 -or $p.ParentProcessId -eq $current) { break }
    $current = [int]$p.ParentProcessId
  }
  $chain
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

function Find-Window([string]$Pattern) {
  Get-WindowRows | Where-Object { $_.title -match $Pattern } | Select-Object -First 1
}

$initial = Invoke-Probe
Log "initial foreground: $($initial.hwnd) pid=$($initial.pid) $($initial.process) :: $($initial.title)"

# ---------------------------------------------------------------- host windows
$wt = Find-Window '^S3-WT-TAB-A$'
$console = Find-Window '^S3-CONHOST-SESSION$'
$codeWindows = Get-WindowRows | Where-Object { $_.process -eq 'Code' }

Log "WT window: $($wt | ConvertTo-Json -Compress)"
Log "console window: $($console | ConvertTo-Json -Compress)"
Log "VS Code windows: $($codeWindows | ConvertTo-Json -Compress)"

# ------------------------------------------------------- session -> host mapping
$wtSession = Get-Sessions | Where-Object { $_.CommandLine -like '*wt-session-a.ps1*' } | Select-Object -First 1
$wtChain = if ($wtSession) { Get-Ancestry -ProcessId ([int]$wtSession.ProcessId) } else { @() }
Log "WT tab A session pid=$($wtSession.ProcessId) ancestry=$(($wtChain | ForEach-Object { "$($_.name):$($_.pid)" }) -join ' <- ')"

$consoleSession = Get-Sessions | Where-Object { $_.ProcessId -eq [int]$console.pid } | Select-Object -First 1
$consoleChain = if ($consoleSession) { Get-Ancestry -ProcessId ([int]$consoleSession.ProcessId) } else { @() }
Log "console session pid=$($console.pid) ancestry=$(($consoleChain | ForEach-Object { "$($_.name):$($_.pid)" }) -join ' <- ')"

$targets = @()
if ($wt) { $targets += [pscustomobject]@{ label = 'windows-terminal'; hwnd = $wt.hwnd } }
if ($codeWindows) {
  $i = 0
  foreach ($cw in $codeWindows) {
    $i++
    $targets += [pscustomobject]@{ label = "vscode-window-$i"; hwnd = $cw.hwnd }
  }
}
if ($console) { $targets += [pscustomobject]@{ label = 'classic-console'; hwnd = $console.hwnd } }

$detections = @()
foreach ($t in $targets) {
  Log "--- focusing $($t.label) $($t.hwnd) ---"
  $focusResult = Invoke-Focus -Hwnd $t.hwnd
  Start-Sleep -Milliseconds 500
  $samples = @()
  for ($i = 0; $i -lt 5; $i++) {
    $samples += Invoke-Probe
    Start-Sleep -Milliseconds 200
  }
  $matchCount = @($samples | Where-Object { $_.hwnd -eq $t.hwnd }).Count
  $detections += [pscustomobject]@{
    label = $t.label
    targetHwnd = $t.hwnd
    focusResult = $focusResult
    samples = $samples
    consistentSamples = $matchCount
    sampleCount = $samples.Count
  }
  Log "$($t.label): focus targetIsForeground=$($focusResult.targetIsForeground); stable $matchCount/$($samples.Count); foreground now $($samples[-1].hwnd) pid=$($samples[-1].pid) $($samples[-1].process) :: $($samples[-1].title)"
}

# --------------------------------------------------------- tabs and panes in WT
$tabPane = @()
if ($wt) {
  Log '--- WT tab/pane test ---'
  [void](Invoke-Focus -Hwnd $wt.hwnd)
  Start-Sleep -Milliseconds 500

  & wt.exe -w last new-tab --title 'S3-WT-B' powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'fixtures\wt-session-b.ps1')
  Start-Sleep -Seconds 4
  $afterNewTab = Invoke-Probe
  $tabPane += [pscustomobject]@{ step = 'new-tab-B (tab B active)'; foreground = $afterNewTab }
  Log "after new tab B: $($afterNewTab.hwnd) pid=$($afterNewTab.pid) title=$($afterNewTab.title)"

  [void](Invoke-Focus -Hwnd $wt.hwnd)
  Start-Sleep -Milliseconds 300
  & wt.exe -w last focus-tab -t 0
  Start-Sleep -Seconds 2
  $afterTab0 = Invoke-Probe
  $tabPane += [pscustomobject]@{ step = 'focus-tab-0 (tab A active)'; foreground = $afterTab0 }
  Log "after focus tab 0: $($afterTab0.hwnd) pid=$($afterTab0.pid) title=$($afterTab0.title)"

  [void](Invoke-Focus -Hwnd $wt.hwnd)
  Start-Sleep -Milliseconds 300
  & wt.exe -w last split-pane -V -- powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'fixtures\wt-pane.ps1')
  Start-Sleep -Seconds 4
  $afterPane = Invoke-Probe
  $tabPane += [pscustomobject]@{ step = 'split-pane (new pane active)'; foreground = $afterPane }
  Log "after split pane: $($afterPane.hwnd) pid=$($afterPane.pid) title=$($afterPane.title)"

  $paneSession = Get-Sessions | Where-Object { $_.CommandLine -like '*wt-pane.ps1*' } | Select-Object -First 1
  $paneChain = if ($paneSession) { Get-Ancestry -ProcessId ([int]$paneSession.ProcessId) } else { @() }
  $tabPane += [pscustomobject]@{
    step = 'pane session ancestry'
    panePid = if ($paneSession) { [int]$paneSession.ProcessId } else { $null }
    ancestry = @($paneChain | ForEach-Object { "$($_.name):$($_.pid)" })
  }
  Log "pane session ancestry: $(($paneChain | ForEach-Object { "$($_.name):$($_.pid)" }) -join ' <- ')"
}

# ------------------------------------------------------------------ false neg/pos candidates
$overlaps = @()
$allWindows = Get-WindowRows
$byPid = $allWindows | Group-Object pid | Where-Object { $_.Count -gt 1 -and $_.Group[0].process -in @('Code', 'WindowsTerminal') }
foreach ($g in $byPid) {
  $overlaps += [pscustomobject]@{ pid = $g.Name; windows = @($g.Group | ForEach-Object { "$($_.hwnd) :: $($_.title)" }) }
}
Log "same-PID multi-window groups: $($overlaps | ConvertTo-Json -Compress)"

$summary = [pscustomobject]@{
  initialForeground = $initial
  hosts = @(
    $(if ($wt) { [pscustomobject]@{ label = 'windows-terminal'; window = $wt; sessionPid = $wtSession.ProcessId; ancestry = @($wtChain) } }),
    $(if ($console) { [pscustomobject]@{ label = 'classic-console'; window = $console; sessionPid = $console.pid; ancestry = @($consoleChain) } }),
    $(if ($codeWindows) { [pscustomobject]@{ label = 'vscode'; windows = @($codeWindows) } })
  )
  detections = $detections
  tabPane = $tabPane
  samePidGroups = $overlaps
}
$summary | ConvertTo-Json -Depth 8 | Out-File -FilePath (Join-Path $out 'host-detection.json') -Encoding UTF8

# --------------------------------------------------------------- restore + close
Log "restoring initial foreground $($initial.hwnd)"
[void](Invoke-Focus -Hwnd $initial.hwnd)
if ($wt) { & powershell -NoProfile -ExecutionPolicy Bypass -File $close -Hwnd $wt.hwnd | Out-Null }
if ($console) { & powershell -NoProfile -ExecutionPolicy Bypass -File $close -Hwnd $console.hwnd | Out-Null }
Start-Sleep -Seconds 2
Log 'done'
