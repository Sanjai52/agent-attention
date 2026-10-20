<#
.SYNOPSIS
  Enumerates every top-level window of a process, visible or not.

.DESCRIPTION
  Diagnostic helper for the focus harness. Read-only: no input, no focus calls.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Get-ProcessWindows.ps1 -ProcessId 1234
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][int]$ProcessId
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class S3ProcWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder s, int c);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static List<IntPtr> All() {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  public static string Text(IntPtr h) { var s = new StringBuilder(1024); GetWindowTextW(h, s, s.Capacity); return s.ToString(); }
  public static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassNameW(h, s, s.Capacity); return s.ToString(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
}
'@

foreach ($h in [S3ProcWin]::All()) {
  if ([S3ProcWin]::Pid($h) -ne $ProcessId) { continue }
  $r = New-Object S3ProcWin+RECT
  [void][S3ProcWin]::GetWindowRect($h, [ref]$r)
  [pscustomobject]@{
    hwnd = ('0x{0:X}' -f $h.ToInt64())
    class = [S3ProcWin]::Class($h)
    title = [S3ProcWin]::Text($h)
    visible = [S3ProcWin]::IsWindowVisible($h)
    owner = ('0x{0:X}' -f [S3ProcWin]::GetWindow($h, 4).ToInt64())
    rootOwner = ('0x{0:X}' -f [S3ProcWin]::GetAncestor($h, 3).ToInt64())
    rect = ('{0},{1},{2},{3}' -f $r.Left, $r.Top, $r.Right, $r.Bottom)
  }
}
