param(
  [Parameter(Mandatory=$true)][string]$Mode,
  [Parameter(Mandatory=$true)][string]$PidFile,
  [Parameter(Mandatory=$true)][string]$HostLog,
  [Parameter(Mandatory=$true)][string]$DataRoot,
  [Parameter(Mandatory=$true)][string]$Suffix
)
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Con {
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AllocConsole();
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
}
'@
Add-Type -TypeDefinition $src -Language CSharp
[void][Con]::FreeConsole()
$ok = [Con]::AllocConsole()
$hwnd = [Con]::GetConsoleWindow()
$visible = $false
if ($hwnd -ne [IntPtr]::Zero) { $visible = [Con]::IsWindowVisible($hwnd) }
Write-Output ("ALLOC ok=" + $ok + " hwnd=" + $hwnd.ToInt64() + " visible=" + $visible)

$node = (Get-Command node).Source
$script = Join-Path $PSScriptRoot '..\bench\spawn-child.mjs'
$argList = @($script, $Mode, $PidFile, $HostLog, $DataRoot, $Suffix)
$p = Start-Process -FilePath $node -ArgumentList $argList -NoNewWindow -PassThru
Write-Output ("CHILD_LAUNCHER_PID=" + $p.Id)
$p.WaitForExit()
Write-Output ("CHILD_LAUNCHER_EXIT=" + $p.ExitCode)
