# Fixed toast sender. Event-derived text arrives ONLY on stdin (PRD §17.2).
# Builds the toast XML through the WinRT DOM so metacharacters are escaped by the
# serializer, submits, then reports what the API observed.
[CmdletBinding()]
param(
  [string]$ResultPath,
  [string]$ScreenshotPath,
  [int]$SettleMs = 1800
)

$ErrorActionPreference = 'Stop'
$startUtc = [DateTime]::UtcNow
$result = [ordered]@{
  Submitted = $false
  Error = $null
  Aumid = $null
  Title = $null
  Body = $null
  Project = $null
  Xml = $null
  NotifierSetting = $null
  SubmitMs = $null
  HistoryCount = $null
  HistoryIds = @()
  HistoryXml = $null
  ScreenshotPath = $null
  ScreenshotError = $null
  ToastWindows = @()
  Pid = $PID
  ParentPid = $null
  ConsoleWindow = $null
  StartUtc = $startUtc.ToString('o')
  EndUtc = $null
  DurationMs = $null
}

try {
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw)) { throw 'Empty stdin payload' }
  $payload = $raw | ConvertFrom-Json

  foreach ($field in @('aumid', 'title', 'body')) {
    if ([string]::IsNullOrEmpty($payload.$field)) { throw "Missing payload field: $field" }
  }

  $aumid = [string]$payload.aumid
  $title = [string]$payload.title
  $body = [string]$payload.body
  $project = [string]$payload.project
  $result.Aumid = $aumid
  $result.Title = $title
  $result.Body = $body
  $result.Project = $project

  # --- WinRT types ---------------------------------------------------------
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
  [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null

  # --- Build XML through the DOM (never string interpolation) --------------
  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
  $toastEl = $doc.CreateElement('toast')
  $doc.AppendChild($toastEl) | Out-Null
  $visual = $doc.CreateElement('visual')
  $toastEl.AppendChild($visual) | Out-Null
  $binding = $doc.CreateElement('binding')
  $binding.SetAttribute('template', 'ToastGeneric')
  $visual.AppendChild($binding) | Out-Null

  foreach ($line in @($title, $body)) {
    $textEl = $doc.CreateElement('text')
    $textEl.AppendChild($doc.CreateTextNode($line)) | Out-Null
    $binding.AppendChild($textEl) | Out-Null
  }

  $audio = $doc.CreateElement('audio')
  $audio.SetAttribute('silent', 'true')
  $toastEl.AppendChild($audio) | Out-Null

  $result.Xml = $doc.GetXml()

  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid)
  $result.NotifierSetting = [string]$notifier.Setting

  $toast = New-Object Windows.UI.Notifications.ToastNotification $doc
  $showStart = [DateTime]::UtcNow
  $notifier.Show($toast)
  $result.SubmitMs = [int]([DateTime]::UtcNow - $showStart).TotalMilliseconds
  $result.Submitted = $true

  Start-Sleep -Milliseconds $SettleMs

  # --- Screenshot + visible toast windows ----------------------------------
  if ($ScreenshotPath) {
    try {
      Add-Type -Namespace Win32 -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
      [Win32.Dpi]::SetProcessDPIAware() | Out-Null
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bmp.Size)
      $bmp.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose(); $bmp.Dispose()
      $result.ScreenshotPath = $ScreenshotPath
    } catch {
      $result.ScreenshotError = $_.Exception.Message
    }
  }

  # --- What the API reports afterward --------------------------------------
  try {
    $history = @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($aumid))
    $result.HistoryCount = $history.Count
    $ids = @()
    $firstXml = $null
    foreach ($item in $history) {
      $ids += $item.Id
      if ($null -eq $firstXml) { $firstXml = $item.Content.GetXml() }
    }
    $result.HistoryIds = $ids
    $result.HistoryXml = $firstXml
  } catch {
    $result.HistoryError = $_.Exception.Message
  }
} catch {
  $result.Error = $_.Exception.Message
} finally {
  $end = [DateTime]::UtcNow
  $result.EndUtc = $end.ToString('o')
  $result.DurationMs = [int]($end - $startUtc).TotalMilliseconds
  $result.ParentPid = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
  try {
    Add-Type -Namespace Win32 -Name Console -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();'
    $result.ConsoleWindow = [int64][Win32.Console]::GetConsoleWindow()
  } catch { $result.ConsoleWindow = -1 }

  $json = [pscustomobject]$result | ConvertTo-Json -Depth 6
  if ($ResultPath) {
    # UTF-8 without BOM so the file is machine-readable.
    [System.IO.File]::WriteAllText($ResultPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  } else {
    Write-Output $json
  }
}
