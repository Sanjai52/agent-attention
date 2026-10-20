<#
.SYNOPSIS
  Windows Terminal topology probe for S3 0.11 (Q-06).

.DESCRIPTION
  1. Creates two separate Windows Terminal windows and records whether they
     share a process ID (PID-only mapping would then be ambiguous).
  2. Creates one Windows Terminal window containing two tabs and one split
     pane, then resolves each session's ancestry to the hosting process/window.
  3. Runs wt-probe-console.ps1 inside a terminal tab to test whether
     GetConsoleWindow() can lead back to the hosting top-level window.

  No input is synthesized. Test sessions are stopped by PID (never by closing
  the window) so a shared terminal process is not disturbed.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Invoke-WtTopology.ps1
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
$inventory = Join-Path $here 'Get-WindowInventory.ps1'
$probe = Join-Path $here 'Get-ForegroundWindow.ps1'
$focus = Join-Path $here 'Focus-Window.ps1'
$transcript = Join-Path $out 'wt-topology-transcript.txt'

function Log([string]$msg) {
  ('{0} {1}' -f (Get-Date).ToString('HH:mm:ss.fff'), $msg) | Tee-Object -FilePath $transcript -Append
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

function Wait-For([scriptblock]$Condition, [int]$Seconds = 15, [string]$What = 'window') {
  for ($i = 0; $i -lt ($Seconds * 4); $i++) {
    $result = & $Condition
    if ($result) { return $result }
    Start-Sleep -Milliseconds 250
  }
  throw "Timed out waiting for $What"
}

function Get-SessionPids([string]$Marker) {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like "*$Marker*" } |
    Select-Object -ExpandProperty ProcessId
}

function Get-Ancestry([int]$ProcessId) {
  $chain = @()
  $current = $ProcessId
  for ($i = 0; $i -lt 12 -and $current) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue
    if (-not $p) { break }
    $chain += [pscustomobject]@{ pid = [int]$p.ProcessId; name = $p.Name; parent = [int]$p.ParentProcessId }
    if ($p.ParentProcessId -eq 0 -or $p.ParentProcessId -eq $current) { break }
    $current = [int]$p.ParentProcessId
  }
  $chain
}

function Stop-MarkerSessions([string]$Marker) {
  foreach ($spid in (Get-SessionPids $Marker)) {
    try { Stop-Process -Id $spid -Force -ErrorAction Stop; Log "stopped session pid=$spid ($Marker)" } catch { Log "could not stop $spid : $($_.Exception.Message)" }
  }
}

$result = [pscustomobject]@{
  startedAt = (Get-Date).ToString('o')
  twoWindows = @()
  multiSessionWindow = $null
  consoleWindowProbe = $null
  foregroundSamples = @()
  endedAt = $null
}

# ---------------------------------------------------------- two separate windows
Start-Process -FilePath wt.exe -ArgumentList @(
  '-w', 'new', '--title', 'S3-WT-TAB-A',
  'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $here 'fixtures\wt-session-a.ps1')
) | Out-Null
$winA = Wait-For { Find-Window '^S3-WT-TAB-A$' } 15 'WT window A'
Log "window A: $($winA | ConvertTo-Json -Compress)"

Start-Process -FilePath wt.exe -ArgumentList @(
  '-w', 'new', '--title', 'S3-WT-TAB-B',
  'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $here 'fixtures\wt-session-b.ps1')
) | Out-Null
$winB = Wait-For { Find-Window '^S3-WT-TAB-B$' } 15 'WT window B'
Log "window B: $($winB | ConvertTo-Json -Compress)"

$result.twoWindows = @(
  [pscustomobject]@{ label = 'A'; hwnd = $winA.hwnd; pid = $winA.pid; title = $winA.title },
  [pscustomobject]@{ label = 'B'; hwnd = $winB.hwnd; pid = $winB.pid; title = $winB.title }
)
Log "two windows share PID: $($winA.pid -eq $winB.pid)"

# ------------------------------------------------- two tabs + one pane, one window
& wt.exe -w new new-tab --title 'S3-MULTI-A' powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'fixtures\wt-multi-a.ps1') ';' new-tab --title 'S3-MULTI-B' powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'fixtures\wt-multi-b.ps1') ';' split-pane -V -- powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'fixtures\wt-multi-pane.ps1')
$multi = Wait-For { Find-Window '^S3-MULTI-(A|B|PANE)$' } 20 'multi-session WT window'
Start-Sleep -Seconds 3
$multiNow = Find-Window '^S3-MULTI-(A|B|PANE)$'
Log "multi window: $($multiNow | ConvertTo-Json -Compress)"

$sessionInfo = foreach ($marker in @('wt-multi-a.ps1', 'wt-multi-b.ps1', 'wt-multi-pane.ps1')) {
  $pids = @(Get-SessionPids $marker)
  $pidValue = if ($pids.Count -gt 0) { [int]$pids[0] } else { 0 }
  $chain = if ($pidValue) { Get-Ancestry -ProcessId $pidValue } else { @() }
  [pscustomobject]@{
    marker = $marker
    sessionPid = $pidValue
    ancestry = @($chain | ForEach-Object { "$($_.name):$($_.pid)" })
    terminalPid = @($chain | Where-Object { $_.name -in @('WindowsTerminal.exe', 'OpenConsole.exe', 'conhost.exe') } | Select-Object -First 1 -ExpandProperty pid)
  }
}
$result.multiSessionWindow = [pscustomobject]@{
  window = $multiNow
  sessions = @($sessionInfo)
}

# --------------------------------------- GetConsoleWindow from inside a WT tab
$consoleProbePath = Join-Path $out 'console-window-probe.json'
Remove-Item $consoleProbePath -ErrorAction SilentlyContinue
& wt.exe -w new new-tab --title 'S3-CONSOLE-PROBE' powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'fixtures\wt-probe-console.ps1') -OutPath $consoleProbePath
for ($i = 0; $i -lt 40 -and -not (Test-Path $consoleProbePath); $i++) { Start-Sleep -Milliseconds 250 }
if (Test-Path $consoleProbePath) {
  $result.consoleWindowProbe = Get-Content $consoleProbePath -Raw | ConvertFrom-Json
  Log "console window probe: $($result.consoleWindowProbe.consoleWindow | ConvertTo-Json -Compress)"
  Log "console parent chain: $(($result.consoleWindowProbe.parentChain | ForEach-Object { "$($_.hwnd)/$($_.class)/$($_.process)" }) -join ' -> ')"
  Log "console owner chain: $(($result.consoleWindowProbe.ownerChain | ForEach-Object { "$($_.hwnd)/$($_.class)/$($_.process)" }) -join ' -> ')"
} else {
  Log 'console window probe did not produce output'
}

# --------------------------------------------------- foreground identity sampling
$samples = @()
foreach ($target in @($winA, $winB, $multiNow)) {
  if (-not $target) { continue }
  $focusJson = ((& powershell -NoProfile -ExecutionPolicy Bypass -File $focus -TargetHwnd $target.hwnd -Method attachfg) | Out-String) | ConvertFrom-Json
  Start-Sleep -Milliseconds 400
  for ($i = 0; $i -lt 3; $i++) {
    $fg = ((& powershell -NoProfile -ExecutionPolicy Bypass -File $probe) | Out-String) | ConvertFrom-Json
    $samples += [pscustomobject]@{
      target = $target.hwnd
      targetPid = $target.pid
      foreground = $fg.hwnd
      foregroundPid = $fg.pid
      title = $fg.title
      match = ($fg.hwnd -eq $target.hwnd)
      focusOk = $focusJson.targetIsForeground
      focusErrors = @($focusJson.errors)
    }
    Start-Sleep -Milliseconds 200
  }
}
$result.foregroundSamples = $samples
Log "foreground samples: $(($samples | Where-Object { $_.match }).Count)/$($samples.Count) matched their target window"

$result.endedAt = (Get-Date).ToString('o')
$result | ConvertTo-Json -Depth 8 | Out-File -FilePath (Join-Path $out 'wt-topology.json') -Encoding UTF8

# --------------------------------------------------------------- stop test sessions
foreach ($marker in @('wt-session-a.ps1', 'wt-session-b.ps1', 'wt-multi-a.ps1', 'wt-multi-b.ps1', 'wt-multi-pane.ps1', 'wt-probe-console.ps1')) {
  Stop-MarkerSessions $marker
}
Log 'done'
