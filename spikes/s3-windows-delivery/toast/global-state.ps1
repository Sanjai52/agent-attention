# Controls the Windows "Notifications" master toggle for the suppression spike.
# Saves the previous value so restore is exact.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('read', 'disable', 'restore')]
  [string]$Action,
  [string]$StatePath
)

$ErrorActionPreference = 'Stop'
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings'
$name = 'NOC_GLOBAL_SETTING_TOASTS_ENABLED'

if ($Action -eq 'read') {
  $v = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).$name
  [pscustomobject]@{ Action = 'read'; Value = $v; Exists = ($null -ne $v) } | ConvertTo-Json
  return
}

if ($Action -eq 'disable') {
  $prop = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
  $existed = $prop.PSObject.Properties.Name -contains $name
  $previous = if ($existed) { $prop.$name } else { $null }
  if (-not $StatePath) { $StatePath = Join-Path $env:TEMP 'aa-global-toast-state.json' }
  [pscustomobject]@{ Existed = $existed; Previous = $previous; SavedAtUtc = [DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -Path $StatePath -Encoding UTF8
  Set-ItemProperty -Path $key -Name $name -Value 0 -Type DWord
  [pscustomobject]@{ Action = 'disable'; Existed = $existed; Previous = $previous; Now = 0; StatePath = $StatePath } | ConvertTo-Json
  return
}

# restore
if (-not $StatePath) { $StatePath = Join-Path $env:TEMP 'aa-global-toast-state.json' }
if (-not (Test-Path $StatePath)) { throw "State file not found: $StatePath" }
$state = Get-Content -Path $StatePath -Raw | ConvertFrom-Json
if ($state.Existed) {
  Set-ItemProperty -Path $key -Name $name -Value ([int]$state.Previous) -Type DWord
} else {
  Remove-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue
}
$now = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).$name
[pscustomobject]@{ Action = 'restore'; ExistedBefore = $state.Existed; Previous = $state.Previous; Now = $now; ExistsNow = ($null -ne $now) } | ConvertTo-Json
