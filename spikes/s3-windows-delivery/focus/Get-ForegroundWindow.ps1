<#
.SYNOPSIS
  Read-only foreground-window probe for S3 Task 0.11 (Q-06).

.DESCRIPTION
  Resolves GetForegroundWindow() to HWND, owning process, process name, window
  title, class name, root/root-owner ancestors, and the immediate child window at
  the center of the client area. Emits one JSON object per invocation.

  This script performs no input synthesis and never calls SetForegroundWindow.

.PARAMETER Hwnd
  Probe an explicit window handle instead of the foreground window.

.PARAMETER Repeat
  Sample the foreground window N times with the given delay (ms).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Get-ForegroundWindow.ps1
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)][Int64]$Hwnd = 0,
  [Parameter(Mandatory = $false)][int]$Repeat = 1,
  [Parameter(Mandatory = $false)][int]$DelayMs = 250
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class S3Win {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT pt);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT pt);
  [DllImport("user32.dll")] public static extern IntPtr RealChildWindowFromPoint(IntPtr hWndParent, POINT pt);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

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
  public static uint LastInputTick() {
    var lii = new LASTINPUTINFO();
    lii.cbSize = (uint)Marshal.SizeOf(lii);
    if (!GetLastInputInfo(ref lii)) return 0;
    return lii.dwTime;
  }
}
'@

function Get-WindowInfo {
  param([IntPtr]$Handle)

  if ($Handle -eq [IntPtr]::Zero) {
    return [pscustomobject]@{ hwnd = '0x0'; note = 'no foreground window' }
  }

  $pidValue = [uint32]0
  [void][S3Win]::GetWindowThreadProcessId($Handle, [ref]$pidValue)

  $procName = $null
  $procPath = $null
  $procStart = $null
  if ($pidValue -ne 0) {
    try {
      $p = Get-Process -Id $pidValue -ErrorAction Stop
      $procName = $p.ProcessName
      $procPath = $p.Path
      $procStart = $p.StartTime.ToString('o')
    } catch {
      $procName = '<access-denied-or-exited>'
    }
  }

  $rect = New-Object S3Win+RECT
  [void][S3Win]::GetWindowRect($Handle, [ref]$rect)

  $client = New-Object S3Win+RECT
  [void][S3Win]::GetClientRect($Handle, [ref]$client)
  $center = New-Object S3Win+POINT
  $center.X = [int](($client.Right - $client.Left) / 2)
  $center.Y = [int](($client.Bottom - $client.Top) / 2)
  [void][S3Win]::ClientToScreen($Handle, [ref]$center)
  $atCenter = [S3Win]::WindowFromPoint($center)
  $childAtCenter = [S3Win]::RealChildWindowFromPoint($Handle, $center)

  [pscustomobject]@{
    hwnd            = ('0x{0:X}' -f $Handle.ToInt64())
    pid             = $pidValue
    process         = $procName
    processPath     = $procPath
    processStart    = $procStart
    title           = [S3Win]::Text($Handle)
    class           = [S3Win]::Class($Handle)
    visible         = [S3Win]::IsWindowVisible($Handle)
    iconic          = [S3Win]::IsIconic($Handle)
    rect            = ('{0},{1},{2},{3}' -f $rect.Left, $rect.Top, $rect.Right, $rect.Bottom)
    ownerHwnd       = ('0x{0:X}' -f [S3Win]::GetWindow($Handle, 4).ToInt64())
    rootHwnd        = ('0x{0:X}' -f [S3Win]::GetAncestor($Handle, 2).ToInt64())
    rootOwnerHwnd   = ('0x{0:X}' -f [S3Win]::GetAncestor($Handle, 3).ToInt64())
    windowAtCenter  = ('0x{0:X}' -f $atCenter.ToInt64())
    windowAtCenterClass = [S3Win]::Class($atCenter)
    windowAtCenterPid = $(if ($atCenter -ne [IntPtr]::Zero) { $p2 = [uint32]0; [void][S3Win]::GetWindowThreadProcessId($atCenter, [ref]$p2); $p2 } else { 0 })
    childAtCenter   = ('0x{0:X}' -f $childAtCenter.ToInt64())
    childAtCenterClass = [S3Win]::Class($childAtCenter)
    lastInputTick   = [S3Win]::LastInputTick()
    sampledAt       = (Get-Date).ToString('o')
  }
}

for ($i = 0; $i -lt $Repeat; $i++) {
  if ($i -gt 0) { Start-Sleep -Milliseconds $DelayMs }
  if ($Hwnd -ne 0) {
    $target = [IntPtr]$Hwnd
  } else {
    $target = [S3Win]::GetForegroundWindow()
  }
  Get-WindowInfo -Handle $target | ConvertTo-Json -Compress
}
