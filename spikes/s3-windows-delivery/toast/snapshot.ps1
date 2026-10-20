# Records the toast identity's observable state for before/after evidence.
[CmdletBinding()]
param(
  [string]$Aumid = 'AgentAttention.S3Spike',
  [string]$ShortcutName = 'Agent Attention S3 Spike',
  [string]$OutPath
)

$ErrorActionPreference = 'Continue'
$snap = [ordered]@{
  CapturedAtUtc = [DateTime]::UtcNow.ToString('o')
  User = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  OsVersion = [System.Environment]::OSVersion.VersionString
  SessionId = (Get-Process -Id $PID).SessionId
  Aumid = $Aumid
}

$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$snap.WindowsBuild = "$($cv.CurrentBuild).$($cv.UBR)"
$snap.DisplayVersion = $cv.DisplayVersion
$snap.PowerShell = $PSVersionTable.PSVersion.ToString()

$regPath = "HKCU:\Software\Classes\AppUserModelId\$Aumid"
$snap.RegistryKey = $regPath
$snap.RegistryKeyExists = Test-Path $regPath
if ($snap.RegistryKeyExists) {
  $vals = @{}
  (Get-Item $regPath).GetValueNames() | ForEach-Object { $vals[$_] = (Get-ItemProperty $regPath).$_ }
  $snap.RegistryValues = $vals
}

$shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) "$ShortcutName.lnk"
$snap.ShortcutPath = $shortcutPath
$snap.ShortcutExists = Test-Path $shortcutPath
if ($snap.ShortcutExists) {
  $item = Get-Item $shortcutPath
  $snap.ShortcutLength = $item.Length
  $snap.ShortcutLastWriteUtc = $item.LastWriteTimeUtc.ToString('o')
}

$appSettings = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\$Aumid"
$snap.AppSettingsKey = $appSettings
$snap.AppSettingsKeyExists = Test-Path $appSettings
if ($snap.AppSettingsKeyExists) {
  $snap.AppSettingsValues = @{}
  (Get-Item $appSettings).GetValueNames() | ForEach-Object { $snap.AppSettingsValues[$_] = (Get-ItemProperty $appSettings).$_ }
}

$globalSettings = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings'
$snap.GlobalToastEnabled = (Get-ItemProperty $globalSettings -ErrorAction SilentlyContinue).'NOC_GLOBAL_SETTING_TOASTS_ENABLED'
$snap.QuietHoursTelemetryLastRun = [string](Get-ItemProperty $globalSettings -ErrorAction SilentlyContinue).'QuietHoursTelemetryLastRun'

try {
  [Windows.UI.Shell.FocusSessionManager, Windows.UI.Shell, ContentType = WindowsRuntime] | Out-Null
  $mgr = [Windows.UI.Shell.FocusSessionManager]::GetDefault()
  $snap.FocusSessionManagerAvailable = $true
  $snap.FocusSessionSupported = $mgr.IsSupported
  $snap.FocusSessionActive = $mgr.IsFocusActive
} catch {
  $snap.FocusSessionManagerAvailable = $false
  $snap.FocusSessionError = $_.Exception.Message
}

try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid)
  $snap.ToastNotifierSetting = [string]$notifier.Setting
} catch {
  $snap.ToastNotifierSetting = 'ERROR'
  $snap.ToastNotifierError = $_.Exception.Message
}

$json = [pscustomobject]$snap | ConvertTo-Json -Depth 6
if ($OutPath) {
  [System.IO.File]::WriteAllText($OutPath, $json, (New-Object System.Text.UTF8Encoding($false)))
} else {
  Write-Output $json
}
