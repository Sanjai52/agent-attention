<#
.SYNOPSIS
  Run INSIDE a terminal session: resolve GetConsoleWindow() and its ancestry.

.DESCRIPTION
  Writes a JSON record describing the pseudoconsole window returned by
  GetConsoleWindow(), its ancestors/owner, and the caller's process ancestry.
  Used to test whether a session can discover the hosting top-level terminal
  window without user input.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutPath
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class S3Con {
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder s, int c);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);

  public static string Text(IntPtr h) { var s = new StringBuilder(1024); GetWindowTextW(h, s, s.Capacity); return s.ToString(); }
  public static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassNameW(h, s, s.Capacity); return s.ToString(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
}
'@

function Describe([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return $null }
  $procName = $null
  try { $procName = (Get-Process -Id ([S3Con]::Pid($h)) -ErrorAction Stop).ProcessName } catch { $procName = '<unknown>' }
  [pscustomobject]@{
    hwnd = ('0x{0:X}' -f $h.ToInt64())
    pid = [S3Con]::Pid($h)
    process = $procName
    class = [S3Con]::Class($h)
    title = [S3Con]::Text($h)
    visible = [S3Con]::IsWindowVisible($h)
  }
}

$con = [S3Con]::GetConsoleWindow()
$chain = @()
$current = $con
for ($i = 0; $i -lt 8 -and $current -ne [IntPtr]::Zero; $i++) {
  $chain += Describe $current
  $parent = [S3Con]::GetAncestor($current, 1)   # GA_PARENT
  if ($parent -eq $current) { break }
  $current = $parent
}

$owners = @()
$current = $con
for ($i = 0; $i -lt 8 -and $current -ne [IntPtr]::Zero; $i++) {
  $owners += Describe $current
  $owner = [S3Con]::GetWindow($current, 4)      # GW_OWNER
  if ($owner -eq $current) { break }
  $current = $owner
}

$procChain = @()
$pidCurrent = $PID
for ($i = 0; $i -lt 12 -and $pidCurrent; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pidCurrent" -ErrorAction SilentlyContinue
  if (-not $p) { break }
  $procChain += [pscustomobject]@{ pid = [int]$p.ProcessId; name = $p.Name; parent = [int]$p.ParentProcessId }
  if ($p.ParentProcessId -eq 0 -or $p.ParentProcessId -eq $pidCurrent) { break }
  $pidCurrent = [int]$p.ParentProcessId
}

[pscustomobject]@{
  shellPid = $PID
  consoleWindow = Describe $con
  parentChain = $chain
  ownerChain = $owners
  processChain = $procChain
  terminalEnv = [pscustomobject]@{
    WT_SESSION = $env:WT_SESSION
    WT_PROFILE_ID = $env:WT_PROFILE_ID
    TERM_PROGRAM = $env:TERM_PROGRAM
    TERM_PROGRAM_VERSION = $env:TERM_PROGRAM_VERSION
  }
  sampledAt = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 6 | Out-File -FilePath $OutPath -Encoding UTF8
