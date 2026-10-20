# Throwaway RF-S3 launcher: start run-rfs3.ps1 through WMI Win32_Process.Create,
# so the child is owned by WmiPrvSE.exe rather than the invoking terminal's
# process tree. The invoking shell returns immediately; the child keeps running.
# Usage: powershell -NoProfile -File trigger-rfs3.ps1 -Route soundplayer|mci
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('soundplayer', 'mci')][string]$Route
)

$ErrorActionPreference = 'Stop'
$spikeRoot = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $spikeRoot 'out'
$wav = Join-Path $outDir 'tone-600ms.wav'
$childScript = Join-Path $PSScriptRoot 'run-rfs3.ps1'
$outFile = Join-Path $outDir "rfs3-$Route.json"

$commandLine = 'powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -File "{0}" -Route {1} -Path "{2}" -OutFile "{3}"' -f $childScript, $Route, $wav, $outFile

$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine }
[pscustomobject]@{
  route       = $Route
  returnValue = $result.ReturnValue
  processId   = $result.ProcessId
  commandLine = $commandLine
  launchedAt  = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 3
