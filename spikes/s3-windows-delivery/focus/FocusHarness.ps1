<#
.SYNOPSIS
  Interactive focus/keystroke harness for S3 Task 0.11.

.DESCRIPTION
  Creates a WinForms window that:
    * shows a marker in its title,
    * logs every KeyDown/KeyPress/KeyUp/MouseDown with a monotonic timestamp,
    * writes its HWND/PID to a ready file,
    * optionally (FocusTargetHwnd > 0) performs a focus attempt on another
      window after FocusAfterMs, modelling a toast-activation handler that runs
      in a foreground process,
    * writes a JSON summary on exit.

  The harness uses only window-management APIs. It never calls SendInput,
  keybd_event, SendKeys, or PostMessage/SendMessage.

.PARAMETER Title
  Window title marker (include a unique suffix).

.PARAMETER LogPath
  Line-delimited keystroke/mouse log.

.PARAMETER ReadyPath
  JSON file written once the window is shown.

.PARAMETER ResultPath
  JSON summary written on exit.

.PARAMETER DurationSeconds
  How long the window stays open.

.PARAMETER FocusTargetHwnd
  If non-zero, the harness attempts to activate this window after FocusAfterMs.

.PARAMETER Method
  plain | attach (passed through to the in-process focus routine).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File FocusHarness.ps1 -Title "S3 CANARY A" -LogPath out/a.log -ReadyPath out/a-ready.json -ResultPath out/a-result.json -DurationSeconds 15
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$LogPath,
  [Parameter(Mandatory = $true)][string]$ReadyPath,
  [Parameter(Mandatory = $true)][string]$ResultPath,
  [Parameter(Mandatory = $false)][int]$DurationSeconds = 15,
  [Parameter(Mandatory = $false)][string]$FocusTargetHwnd = '0',
  [Parameter(Mandatory = $false)][string]$TriggerPath = '',
  [Parameter(Mandatory = $false)][switch]$SelfFocusFirst,
  [Parameter(Mandatory = $false)][ValidateSet('plain', 'attach')][string]$Method = 'plain'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class S3Harness {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  public static uint LastInputTick() {
    var lii = new LASTINPUTINFO();
    lii.cbSize = (uint)Marshal.SizeOf(lii);
    if (!GetLastInputInfo(ref lii)) return 0;
    return lii.dwTime;
  }
}
'@

function Convert-Hwnd([string]$value) {
  if ($value -match '^0x') { return [IntPtr][Convert]::ToInt64($value.Substring(2), 16) }
  return [IntPtr][Int64]$value
}

# Surface handler exceptions instead of letting WinForms open a modal .NET dialog.
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
[System.Windows.Forms.Application]::add_ThreadException({
  param($sender, $eventArgs)
  $text = $eventArgs.Exception.ToString()
  Add-Content -Path $LogPath -Value ("THREAD_EXCEPTION " + $text) -ErrorAction SilentlyContinue
  try { [System.IO.File]::WriteAllText("$ResultPath.error.txt", $text) } catch { }
})

function Invoke-FocusAttempt {
  try {
    $selfForeground = $false
    if ($SelfFocusFirst) {
      # Model the toast-activated handler already owning the foreground.
      [void][S3Harness]::SetForegroundWindow($form.Handle)
      Start-Sleep -Milliseconds 250
      $selfForeground = ([S3Harness]::GetForegroundWindow() -eq $form.Handle)
    }
    $before = [S3Harness]::GetForegroundWindow()
    $beforeInput = [S3Harness]::LastInputTick()
    $err = @()
    if ($Method -eq 'attach') {
      $cur = [S3Harness]::GetCurrentThreadId()
      $tid = [uint32]0
      [void][S3Harness]::GetWindowThreadProcessId($target, [ref]$tid)
      $attached = [S3Harness]::AttachThreadInput($cur, $tid, $true)
      if (-not $attached) { $err += 'AttachThreadInput failed' }
      try {
        [void][S3Harness]::BringWindowToTop($target)
        if (-not [S3Harness]::SetForegroundWindow($target)) { $err += 'SetForegroundWindow false' }
        [void][S3Harness]::SetFocus($target)
      } finally {
        if ($attached) { [void][S3Harness]::AttachThreadInput($cur, $tid, $false) }
      }
    } else {
      if (-not [S3Harness]::SetForegroundWindow($target)) { $err += 'SetForegroundWindow false' }
    }
    Start-Sleep -Milliseconds 400
    $after = [S3Harness]::GetForegroundWindow()
    $script:focusResult = [pscustomobject]@{
      method = $Method
      targetHwnd = ('0x{0:X}' -f $target.ToInt64())
      selfFocusRequested = [bool]$SelfFocusFirst
      selfFocusAchieved = $selfForeground
      foregroundBefore = ('0x{0:X}' -f $before.ToInt64())
      foregroundBeforeIsSelf = ($before -eq $form.Handle)
      foregroundAfter = ('0x{0:X}' -f $after.ToInt64())
      targetIsForeground = ($after -eq $target)
      lastInputBefore = $beforeInput
      lastInputAfter = [S3Harness]::LastInputTick()
      inputTickChanged = ([S3Harness]::LastInputTick() -ne $beforeInput)
      attemptAtMs = [math]::Round($script:started.Elapsed.TotalMilliseconds, 1)
      errors = @($err)
      at = (Get-Date).ToString('o')
    }
  } catch {
    $script:focusResult = [pscustomobject]@{
      method = $Method
      targetHwnd = ('0x{0:X}' -f $target.ToInt64())
      attemptAtMs = [math]::Round($script:started.Elapsed.TotalMilliseconds, 1)
      errors = @("exception: $($_.Exception.Message)")
      at = (Get-Date).ToString('o')
    }
  }
  Write-Event 'FOCUSATTEMPT' ($script:focusResult | ConvertTo-Json -Compress)
  # Persist immediately so a blocked/hung UI still leaves evidence behind.
  [pscustomobject]@{
    title = $Title
    pid = $PID
    keyCount = $script:keyCount
    mouseCount = $script:mouseCount
    lastKey = $script:lastKey
    focusAttempt = $script:focusResult
    logPath = $LogPath
    partial = $true
  } | ConvertTo-Json -Depth 5 | Out-File -FilePath $ResultPath -Encoding UTF8
}

$target = Convert-Hwnd $FocusTargetHwnd
$script:keyCount = 0
$script:mouseCount = 0
$script:lastKey = ''
$script:events = New-Object System.Collections.Generic.List[object]
$script:started = [System.Diagnostics.Stopwatch]::StartNew()
$script:focusResult = $null

function Write-Event([string]$kind, [string]$detail) {
  $line = '{0} {1} {2}' -f $script:started.Elapsed.TotalMilliseconds.ToString('0.0'), $kind, $detail
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.Width = 460
$form.Height = 220
$form.StartPosition = 'CenterScreen'
$form.KeyPreview = $true
$form.TopMost = $false

$label = New-Object System.Windows.Forms.Label
$label.Text = "S3 focus harness`r`nClose window or wait for the timer.`r`nKeystrokes are logged, never injected."
$label.Dock = 'Fill'
$label.TextAlign = 'MiddleCenter'
$form.Controls.Add($label)

$form.Add_KeyDown({ param($s, $e) $script:keyCount++; $script:lastKey = "Down:$($e.KeyCode)"; Write-Event 'KEYDOWN' $e.KeyCode })
$form.Add_KeyPress({ param($s, $e) $script:lastKey = "Press:$([int]$e.KeyChar)"; Write-Event 'KEYPRESS' ([int]$e.KeyChar) })
$form.Add_KeyUp({ param($s, $e) $script:lastKey = "Up:$($e.KeyCode)"; Write-Event 'KEYUP' $e.KeyCode })
$form.Add_MouseDown({ param($s, $e) $script:mouseCount++; Write-Event 'MOUSEDOWN' "$($e.Button)@$($e.X),$($e.Y)" })
$form.Add_Shown({
  $hwnd = ('0x{0:X}' -f $form.Handle.ToInt64())
  [pscustomobject]@{
    title = $Title
    hwnd = $hwnd
    pid = $PID
    isForeground = ([S3Harness]::GetForegroundWindow() -eq $form.Handle)
    foregroundHwnd = ('0x{0:X}' -f [S3Harness]::GetForegroundWindow().ToInt64())
    shownAt = (Get-Date).ToString('o')
  } | ConvertTo-Json -Compress | Out-File -FilePath $ReadyPath -Encoding UTF8

  if ($target -ne [IntPtr]::Zero) {
    if ($TriggerPath) {
      $script:triggerAttempted = $false
      $timer = New-Object System.Windows.Forms.Timer
      $timer.Interval = 200
      $timer.Add_Tick({
        if ($script:triggerAttempted) { return }
        if (Test-Path $TriggerPath) {
          $script:triggerAttempted = $true
          $script:triggerTimer.Stop()
          Invoke-FocusAttempt
        }
      })
      $script:triggerTimer = $timer
      $timer.Start()
    } else {
      $timer = New-Object System.Windows.Forms.Timer
      $timer.Interval = 1200
      $timer.Add_Tick({
        $script:oneShotTimer.Stop()
        Invoke-FocusAttempt
      })
      $script:oneShotTimer = $timer
      $timer.Start()
    }
  }
})

$closeTimer = New-Object System.Windows.Forms.Timer
$closeTimer.Interval = [Math]::Max(1000, $DurationSeconds * 1000)
$closeTimer.Add_Tick({ $closeTimer.Stop(); $form.Close() })
$closeTimer.Start()

[void]$form.ShowDialog()

[pscustomobject]@{
  title = $Title
  pid = $PID
  keyCount = $script:keyCount
  mouseCount = $script:mouseCount
  lastKey = $script:lastKey
  focusAttempt = $script:focusResult
  logPath = $LogPath
  endedAt = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 5 | Out-File -FilePath $ResultPath -Encoding UTF8
