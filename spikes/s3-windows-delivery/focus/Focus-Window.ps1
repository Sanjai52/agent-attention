<#
.SYNOPSIS
  Focus-attempt helper for S3 Task 0.11 (Q-07).

.DESCRIPTION
  Tries to bring an existing top-level window to the foreground WITHOUT
  synthesizing input. There is no SendInput, keybd_event, SendKeys, or
  PostMessage/SendMessage keystroke anywhere in this file; the only calls are
  window-management APIs.

  Methods:
    plain   ShowWindow(SW_RESTORE) + SetForegroundWindow
    attach  AttachThreadInput to the target thread, then ShowWindow +
            BringWindowToTop + SetForegroundWindow + SetFocus, then detach
    switch  SwitchToThisWindow (legacy shell activation path)
    allow   AllowSetForegroundWindow(ASFW_ANY) + plain (models a process that
            already owns the foreground granting the right to another process)

  Always reports the real foreground window before/after, whether the target
  ended up foreground, the focused HWND inside the target thread, and the
  GetLastInputInfo tick before/after (to show no input was delivered).

.PARAMETER TargetHwnd
  Decimal or 0x-prefixed handle of the window to activate.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Focus-Window.ps1 -TargetHwnd 0x1234 -Method attach
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$TargetHwnd,
  [Parameter(Mandatory = $false)][ValidateSet('plain', 'attach', 'attachfg', 'switch', 'allow', 'uia')][string]$Method = 'plain',
  [Parameter(Mandatory = $false)][int]$SettleMs = 350,
  [Parameter(Mandatory = $false)][string]$ResultPath = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class S3Focus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] public static extern uint GetLastError();
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [StructLayout(LayoutKind.Sequential)]
  public struct GUITHREADINFO {
    public uint cbSize; public uint flags;
    public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
    public RECT rcCaret;
  }

  public static uint LastInputTick() {
    var lii = new LASTINPUTINFO();
    lii.cbSize = (uint)Marshal.SizeOf(lii);
    if (!GetLastInputInfo(ref lii)) return 0;
    return lii.dwTime;
  }

  public static string Text(IntPtr h) {
    var sb = new StringBuilder(1024);
    GetWindowTextW(h, sb, sb.Capacity);
    return sb.ToString();
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int c);

  public static IntPtr ForegroundFocus() {
    var fg = GetForegroundWindow();
    if (fg == IntPtr.Zero) return IntPtr.Zero;
    uint pid; uint tid = GetWindowThreadProcessId(fg, out pid);
    var gti = new GUITHREADINFO();
    gti.cbSize = (uint)Marshal.SizeOf(gti);
    if (!GetGUIThreadInfo(tid, ref gti)) return IntPtr.Zero;
    return gti.hwndFocus;
  }
}
'@

function Convert-Hwnd([string]$value) {
  if ($value -match '^0x') { return [IntPtr][Convert]::ToInt64($value.Substring(2), 16) }
  return [IntPtr][Int64]$value
}

$target = Convert-Hwnd $TargetHwnd
if (-not [S3Focus]::IsWindow($target)) {
  throw "Target HWND $TargetHwnd is not a window"
}

$beforeFg = [S3Focus]::GetForegroundWindow()
$beforeInput = [S3Focus]::LastInputTick()
$targetPid = [uint32]0
$targetTid = [S3Focus]::GetWindowThreadProcessId($target, [ref]$targetPid)
$errors = New-Object System.Collections.Generic.List[string]

$sw = [System.Diagnostics.Stopwatch]::StartNew()

switch ($Method) {
  'allow' {
    $ok = [S3Focus]::AllowSetForegroundWindow(-1)
    if (-not $ok) { $errors.Add("AllowSetForegroundWindow(ASFW_ANY) failed, lasterr=$([S3Focus]::GetLastError())") }
    if ([S3Focus]::IsIconic($target)) { [void][S3Focus]::ShowWindow($target, 9) }
    if (-not [S3Focus]::SetForegroundWindow($target)) { $errors.Add("SetForegroundWindow returned false, lasterr=$([S3Focus]::GetLastError())") }
  }
  'plain' {
    if ([S3Focus]::IsIconic($target)) { [void][S3Focus]::ShowWindow($target, 9) }
    if (-not [S3Focus]::SetForegroundWindow($target)) { $errors.Add("SetForegroundWindow returned false, lasterr=$([S3Focus]::GetLastError())") }
  }
  'switch' {
    [S3Focus]::SwitchToThisWindow($target, $true)
  }
  'attach' {
    $curTid = [S3Focus]::GetCurrentThreadId()
    if ($targetTid -eq 0) { throw "Could not resolve target thread" }
    $attached = [S3Focus]::AttachThreadInput($curTid, $targetTid, $true)
    if (-not $attached) { $errors.Add("AttachThreadInput failed, lasterr=$([S3Focus]::GetLastError())") }
    try {
      if ([S3Focus]::IsIconic($target)) { [void][S3Focus]::ShowWindow($target, 9) }
      [void][S3Focus]::BringWindowToTop($target)
      if (-not [S3Focus]::SetForegroundWindow($target)) { $errors.Add("SetForegroundWindow returned false, lasterr=$([S3Focus]::GetLastError())") }
      [void][S3Focus]::SetFocus($target)
    } finally {
      if ($attached) { [void][S3Focus]::AttachThreadInput($curTid, $targetTid, $false) }
    }
  }
  'attachfg' {
    # Classic workaround: share input state with the CURRENT foreground thread,
    # then activate the target. No input is synthesized.
    $curTid = [S3Focus]::GetCurrentThreadId()
    $fgPid = [uint32]0
    $fgTid = [S3Focus]::GetWindowThreadProcessId($beforeFg, [ref]$fgPid)
    if ($fgTid -eq 0) { throw "Could not resolve foreground thread" }
    $attached = [S3Focus]::AttachThreadInput($curTid, $fgTid, $true)
    if (-not $attached) { $errors.Add("AttachThreadInput(fg) failed, lasterr=$([S3Focus]::GetLastError())") }
    try {
      if ([S3Focus]::IsIconic($target)) { [void][S3Focus]::ShowWindow($target, 9) }
      [void][S3Focus]::BringWindowToTop($target)
      if (-not [S3Focus]::SetForegroundWindow($target)) { $errors.Add("SetForegroundWindow returned false, lasterr=$([S3Focus]::GetLastError())") }
      [void][S3Focus]::SetFocus($target)
    } finally {
      if ($attached) { [void][S3Focus]::AttachThreadInput($curTid, $fgTid, $false) }
    }
  }
  'uia' {
    try {
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $el = [System.Windows.Automation.AutomationElement]::FromHandle($target)
      if ($null -eq $el) { $errors.Add('UIA FromHandle returned null') }
      else { $el.SetFocus() }
    } catch {
      $errors.Add("UIA SetFocus threw: $($_.Exception.Message)")
    }
  }
}

Start-Sleep -Milliseconds $SettleMs
$sw.Stop()

$afterFg = [S3Focus]::GetForegroundWindow()
$afterInput = [S3Focus]::LastInputTick()
$afterTid = [uint32]0
[void][S3Focus]::GetWindowThreadProcessId($afterFg, [ref]$afterTid)

$result = [pscustomobject]@{
  method              = $Method
  targetHwnd          = ('0x{0:X}' -f $target.ToInt64())
  targetTitle         = [S3Focus]::Text($target)
  targetPid           = $targetPid
  targetThreadId      = $targetTid
  foregroundBefore    = ('0x{0:X}' -f $beforeFg.ToInt64())
  foregroundBeforePid = $(if ($beforeFg -ne [IntPtr]::Zero) { $p = [uint32]0; [void][S3Focus]::GetWindowThreadProcessId($beforeFg, [ref]$p); $p } else { 0 })
  foregroundAfter     = ('0x{0:X}' -f $afterFg.ToInt64())
  foregroundAfterPid  = $afterTid
  targetIsForeground  = ($afterFg -eq $target)
  focusHwnd           = ('0x{0:X}' -f [S3Focus]::ForegroundFocus().ToInt64())
  lastInputBefore     = $beforeInput
  lastInputAfter      = $afterInput
  inputTickChanged    = ($afterInput -ne $beforeInput)
  elapsedMs           = $sw.ElapsedMilliseconds
  errors              = @($errors)
  sampledAt           = (Get-Date).ToString('o')
}

$json = $result | ConvertTo-Json -Compress
if ($ResultPath) { $json | Out-File -FilePath $ResultPath -Encoding UTF8 }
$json
