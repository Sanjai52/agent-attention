# Enumerates visible top-level windows that look like toast surfaces.
[CmdletBinding()]
param([string]$OutPath)

$ErrorActionPreference = 'Continue'

$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class WindowProbe
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public static List<string> Visible()
    {
        var rows = new List<string>();
        EnumWindows((h, l) =>
        {
            if (!IsWindowVisible(h)) return true;
            var cls = new StringBuilder(256);
            GetClassName(h, cls, 256);
            var title = new StringBuilder(512);
            GetWindowText(h, title, 512);
            uint pid; GetWindowThreadProcessId(h, out pid);
            RECT r; GetWindowRect(h, out r);
            rows.Add(pid + "\t" + cls + "\t" + title + "\t" + r.Left + "," + r.Top + "," + (r.Right - r.Left) + "x" + (r.Bottom - r.Top));
            return true;
        }, IntPtr.Zero);
        return rows;
    }
}
'@

if (-not ('WindowProbe' -as [type])) { Add-Type -TypeDefinition $code -Language CSharp }

$rows = [WindowProbe]::Visible()
$toasties = @()
foreach ($row in $rows) {
  $parts = $row -split "`t"
  if ($parts[1] -match '(?i)toast|notification|corewindow|xamlexplorer|Windows\.UI' -or $parts[2] -match '(?i)notification|toast') {
    $toasties += [pscustomobject]@{
      Pid = [int]$parts[0]
      Class = $parts[1]
      Title = $parts[2]
      Rect = $parts[3]
    }
  }
}

$out = [pscustomobject]@{
  CapturedAtUtc = [DateTime]::UtcNow.ToString('o')
  TotalVisibleWindows = $rows.Count
  ToastCandidateCount = $toasties.Count
  ToastCandidates = $toasties
}
$json = $out | ConvertTo-Json -Depth 5
if ($OutPath) { [System.IO.File]::WriteAllText($OutPath, $json, (New-Object System.Text.UTF8Encoding($false))) }
else { Write-Output $json }
