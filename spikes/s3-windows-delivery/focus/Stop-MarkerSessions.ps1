<#
.SYNOPSIS
  Stops only the shell sessions created by the S3 focus fixtures.

.DESCRIPTION
  Matches powershell.exe command lines containing the fixture marker names and
  stops those processes. Never closes a terminal window or a host process, so a
  Windows Terminal instance shared with the user's windows is left intact.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Stop-MarkerSessions.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$markers = @('wt-session-a.ps1', 'wt-session-b.ps1', 'wt-multi-a.ps1', 'wt-multi-b.ps1', 'wt-multi-pane.ps1', 'wt-probe-console.ps1')

$procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'"
foreach ($p in $procs) {
  foreach ($m in $markers) {
    if ($p.CommandLine -and $p.CommandLine.Contains($m)) {
      [pscustomobject]@{ pid = [int]$p.ProcessId; marker = $m; action = 'stop' }
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {
        [pscustomobject]@{ pid = [int]$p.ProcessId; marker = $m; action = "failed: $($_.Exception.Message)" }
      }
      break
    }
  }
}
