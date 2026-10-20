param(
  [Parameter(Mandatory=$true)][int]$TargetPid
)
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class WinScan {
  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("kernel32.dll")] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();

  public class WindowInfo {
    public long Handle;
    public string Title;
    public string ClassName;
    public bool Visible;
  }

  public static List<WindowInfo> WindowsFor(uint target) {
    var list = new List<WindowInfo>();
    EnumWindows((h, l) => {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid == target) {
        var title = new StringBuilder(512);
        GetWindowTextW(h, title, 512);
        var cls = new StringBuilder(256);
        GetClassNameW(h, cls, 256);
        list.Add(new WindowInfo {
          Handle = h.ToInt64(),
          Title = title.ToString(),
          ClassName = cls.ToString(),
          Visible = IsWindowVisible(h)
        });
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static string ConsoleProbe(uint target) {
    FreeConsole();
    bool attached = AttachConsole(target);
    int err = Marshal.GetLastWin32Error();
    long hwnd = 0;
    bool visible = false;
    string title = "";
    if (attached) {
      IntPtr h = GetConsoleWindow();
      hwnd = h.ToInt64();
      if (h != IntPtr.Zero) {
        visible = IsWindowVisible(h);
        var sb = new StringBuilder(512);
        GetWindowTextW(h, sb, 512);
        title = sb.ToString();
      }
      FreeConsole();
    }
    return "{\"attached\":" + (attached ? "true" : "false") + ",\"attachError\":" + err + ",\"consoleWindow\":" + hwnd + ",\"consoleWindowVisible\":" + (visible ? "true" : "false") + ",\"consoleTitle\":\"" + title.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}";
  }
}
'@
Add-Type -TypeDefinition $src -Language CSharp

$wins = [WinScan]::WindowsFor([uint32]$TargetPid)
$visible = @($wins | Where-Object { $_.Visible })
$payload = [ordered]@{
  pid = $TargetPid
  totalWindows = $wins.Count
  visibleWindows = $visible.Count
  windows = @($wins | ForEach-Object { [ordered]@{ handle = $_.Handle; title = $_.Title; className = $_.ClassName; visible = $_.Visible } })
  console = ([WinScan]::ConsoleProbe([uint32]$TargetPid) | ConvertFrom-Json)
}
$payload | ConvertTo-Json -Depth 5 -Compress
