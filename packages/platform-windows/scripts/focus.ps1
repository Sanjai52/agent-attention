# Fixed read-only foreground-window probe (F13 / Q-06). Emits one JSON object:
#   { processId, executable, windowHandle, windowTitle, windowClass }
# `processId: 0, executable: null` means no foreground window. Exit 1 on any
# detection failure. This script never calls SetForegroundWindow and never
# synthesizes input.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Write-JsonResult {
  param([object]$Payload)
  $json = $Payload | ConvertTo-Json -Compress -Depth 4
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.WriteByte([byte]10)
  $stdout.Flush()
}

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class AgentAttentionFocus
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int count);

    public static string WindowText(IntPtr hWnd)
    {
        StringBuilder text = new StringBuilder(1024);
        GetWindowTextW(hWnd, text, text.Capacity);
        return text.ToString();
    }

    public static string WindowClass(IntPtr hWnd)
    {
        StringBuilder text = new StringBuilder(256);
        GetClassNameW(hWnd, text, text.Capacity);
        return text.ToString();
    }
}
'@

try {
  $handle = [AgentAttentionFocus]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) {
    Write-JsonResult ([ordered]@{
      processId    = 0
      executable   = $null
      windowHandle = '0x0'
      windowTitle  = $null
      windowClass  = $null
    })
    exit 0
  }

  $ownerPid = [uint32]0
  [void][AgentAttentionFocus]::GetWindowThreadProcessId($handle, [ref]$ownerPid)
  if ($ownerPid -eq 0) {
    Write-JsonResult ([ordered]@{
      processId    = 0
      executable   = $null
      windowHandle = ('0x{0:X}' -f $handle.ToInt64())
      windowTitle  = [AgentAttentionFocus]::WindowText($handle)
      windowClass  = [AgentAttentionFocus]::WindowClass($handle)
    })
    exit 0
  }

  $process = [System.Diagnostics.Process]::GetProcessById([int]$ownerPid)
  $executable = $process.ProcessName + '.exe'
  try {
    $modulePath = $process.MainModule.FileName
    if ($modulePath) { $executable = [System.IO.Path]::GetFileName($modulePath) }
  } catch {
    # Access denied for elevated/system processes: the process name is enough
    # for a diagnostic, and callers treat an unmatched executable as not focused.
  }

  Write-JsonResult ([ordered]@{
    processId    = [int]$ownerPid
    executable   = $executable
    windowHandle = ('0x{0:X}' -f $handle.ToInt64())
    windowTitle  = [AgentAttentionFocus]::WindowText($handle)
    windowClass  = [AgentAttentionFocus]::WindowClass($handle)
  })
  exit 0
}
catch {
  [Console]::Error.WriteLine($_.Exception.GetType().FullName + ': ' + $_.Exception.Message)
  exit 1
}
