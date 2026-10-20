# Throwaway RF-S3 launcher for TTS: start run-rfs3-tts.mjs through WMI so the
# child is owned by WmiPrvSE.exe, not the invoking terminal. Fixed paths only.
# Usage: powershell -NoProfile -File trigger-rfs3.ps1 -Text short|hostile
[CmdletBinding()]
param(
  [ValidateSet('short', 'hostile')][string]$Text = 'short',
  [ValidateSet('speak', 'cancel')][string]$Mode = 'speak'
)

$ErrorActionPreference = 'Stop'
$spikeRoot = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $spikeRoot 'out'
$textFile = Join-Path $outDir "$Text-text.txt"
$outFile = Join-Path $outDir "rfs3-tts-$Text.json"
$childScript = Join-Path $PSScriptRoot 'run-rfs3-tts.mjs'
$node = (Get-Command node).Source

$commandLine = '"{0}" "{1}" "{2}" "{3}" {4}' -f $node, $childScript, $textFile, $outFile, $Mode

$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine }
[pscustomobject]@{
  text        = $Text
  mode        = $Mode
  returnValue = $result.ReturnValue
  processId   = $result.ProcessId
  commandLine = $commandLine
  launchedAt  = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 3
