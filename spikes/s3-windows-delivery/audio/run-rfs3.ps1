# Throwaway RF-S3 child: run one delivery route with no terminal attached and
# write the result plus process context to -OutFile. All paths are fixed or
# validated; no event-derived text is accepted or interpolated.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('soundplayer', 'mci')][string]$Route,
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Stop'
Add-Type -Namespace Spike -Name Console -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
'@

$self = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
$parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($self.ParentProcessId)" -ErrorAction SilentlyContinue
$info = [ordered]@{
  route               = $Route
  pid                 = $PID
  parentPid           = $self.ParentProcessId
  parentName          = if ($parent) { $parent.Name } else { $null }
  consoleWindowHandle = [int64]([Spike.Console]::GetConsoleWindow())
  userInteractive     = [Environment]::UserInteractive
  startedAt           = (Get-Date).ToString('o')
}

try {
  if ($Route -eq 'mci') {
    $info.output = (& node (Join-Path $PSScriptRoot 'play-mci.mjs') $Path 1 | Out-String).Trim()
  }
  else {
    $info.output = (& (Join-Path $PSScriptRoot 'play-soundplayer.ps1') -Path $Path -Repeat 1 | Out-String).Trim()
  }
}
catch {
  $info.error = $_.Exception.GetType().FullName + ': ' + $_.Exception.Message
}

$info.finishedAt = (Get-Date).ToString('o')
$info | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutFile -Encoding UTF8
