<#
.SYNOPSIS
  Closes a test window with WM_CLOSE (no synthesized input).

.DESCRIPTION
  Posts WM_CLOSE to each supplied HWND. Intended only for windows this spike
  created (the harness and the host test windows). Sending WM_CLOSE is a window
  message, not a keystroke, and is never used against the user's own windows.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Close-TestWindow.ps1 -Hwnd 0x1234,0x5678
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string[]]$Hwnd
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class S3Close {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
'@

foreach ($raw in $Hwnd) {
  $h = if ($raw -match '^0x') { [IntPtr][Convert]::ToInt64($raw.Substring(2), 16) } else { [IntPtr][Int64]$raw }
  if (-not [S3Close]::IsWindow($h)) {
    [pscustomobject]@{ hwnd = $raw; posted = $false; reason = 'not a window' }
    continue
  }
  $ok = [S3Close]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  [pscustomobject]@{ hwnd = $raw; posted = $ok }
}
