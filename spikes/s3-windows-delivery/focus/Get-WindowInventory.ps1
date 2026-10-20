<#
.SYNOPSIS
  Read-only top-level window inventory used to locate host windows for S3 0.11.

.DESCRIPTION
  EnumWindows over visible, titled top-level windows with owning PID, process
  name, class, and title. Performs no input synthesis and no focus changes.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Get-WindowInventory.ps1
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)][string]$TitleMatch = '',
  [Parameter(Mandatory = $false)][switch]$AsJson
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class S3Enum {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);

  public static List<IntPtr> TopLevel() {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  public static string Text(IntPtr h) {
    var sb = new StringBuilder(1024);
    GetWindowTextW(h, sb, sb.Capacity);
    return sb.ToString();
  }
  public static string Class(IntPtr h) {
    var sb = new StringBuilder(256);
    GetClassNameW(h, sb, sb.Capacity);
    return sb.ToString();
  }
}
'@

$rows = foreach ($h in [S3Enum]::TopLevel()) {
  if (-not [S3Enum]::IsWindowVisible($h)) { continue }
  $title = [S3Enum]::Text($h)
  if ([string]::IsNullOrWhiteSpace($title)) { continue }
  if ($TitleMatch -and $title -notmatch $TitleMatch) { continue }

  $pidValue = [uint32]0
  [void][S3Enum]::GetWindowThreadProcessId($h, [ref]$pidValue)
  $procName = $null
  try { $procName = (Get-Process -Id $pidValue -ErrorAction Stop).ProcessName } catch { $procName = '<unknown>' }

  [pscustomobject]@{
    hwnd    = ('0x{0:X}' -f $h.ToInt64())
    pid     = $pidValue
    process = $procName
    class   = [S3Enum]::Class($h)
    title   = $title
  }
}

if ($AsJson) {
  $rows | ConvertTo-Json -Depth 4
} else {
  $rows | Sort-Object process, hwnd | Format-Table -AutoSize | Out-String -Width 220
}
