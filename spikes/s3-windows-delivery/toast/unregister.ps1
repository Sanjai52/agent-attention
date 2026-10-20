# Removes everything register.ps1 created. Idempotent; verifies absence.
[CmdletBinding()]
param(
  [string]$Aumid = 'AgentAttention.S3Spike',
  [string]$ShortcutName = 'Agent Attention S3 Spike'
)

$ErrorActionPreference = 'Stop'
$results = [ordered]@{}

$regPath = "HKCU:\Software\Classes\AppUserModelId\$Aumid"
if (Test-Path $regPath) {
  Remove-Item -Path $regPath -Recurse -Force
  $results.RegistryKeyRemoved = $regPath
} else {
  $results.RegistryKeyRemoved = $null
}
$results.RegistryKeyExistsAfter = Test-Path $regPath

$startMenu = [Environment]::GetFolderPath('Programs')
$shortcutPath = Join-Path $startMenu "$ShortcutName.lnk"
if (Test-Path $shortcutPath) {
  Remove-Item -Path $shortcutPath -Force
  $results.ShortcutRemoved = $shortcutPath
} else {
  $results.ShortcutRemoved = $null
}
$results.ShortcutExistsAfter = Test-Path $shortcutPath

# The OS creates a per-app notification settings key on first toast. Delete it
# only if this spike owns it (cleanup evidence records whether it existed before).
$appSettings = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\$Aumid"
if (Test-Path $appSettings) {
  Remove-Item -Path $appSettings -Recurse -Force
  $results.AppSettingsKeyRemoved = $appSettings
} else {
  $results.AppSettingsKeyRemoved = $null
}
$results.AppSettingsKeyExistsAfter = Test-Path $appSettings

[pscustomobject]$results | ConvertTo-Json -Depth 4
