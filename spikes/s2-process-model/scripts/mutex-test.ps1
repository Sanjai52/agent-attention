$ErrorActionPreference = 'Stop'
$id = [guid]::NewGuid().ToString('N').Substring(0, 8)
$name = "Local\agent-attention-s2-mutex-$id"
$dir = Join-Path $PSScriptRoot '..\out\bench\mutex'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Start-Contender([string]$tag, [int]$holdMs) {
  $out = Join-Path $dir "$tag.json"
  if (Test-Path $out) { Remove-Item $out -Force }
  $node = (Get-Command powershell).Source
  $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'mutex-contender.ps1'), '-Name', $name, '-OutFile', $out, '-HoldMs', $holdMs)
  $p = Start-Process -FilePath $node -ArgumentList $args -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds(10)
  while (-not (Test-Path $out) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 50 }
  $data = $null
  if (Test-Path $out) { $data = Get-Content $out -Raw | ConvertFrom-Json }
  return [pscustomobject]@{ tag = $tag; processId = $p.Id; result = $data; process = $p }
}

Write-Output ("MUTEX_NAME=" + $name)
$a = Start-Contender 'A' 6000
Write-Output ("A createdNew=" + $a.result.createdNew + " pid=" + $a.result.pid)
$b = Start-Contender 'B' 0
Write-Output ("B createdNew=" + $b.result.createdNew + " pid=" + $b.result.pid)

# kill the owner while it holds the mutex, then take it again
Stop-Process -Id $a.processId -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
$c = Start-Contender 'C' 0
Write-Output ("C_after_kill createdNew=" + $c.result.createdNew + " pid=" + $c.result.pid)

$summary = [ordered]@{
  name = $name
  a_createdNew = $a.result.createdNew
  b_createdNew = $b.result.createdNew
  c_afterOwnerKilled_createdNew = $c.result.createdNew
  onlyOneOwnerAtATime = ($a.result.createdNew -eq $true -and $b.result.createdNew -eq $false)
  mutexIsPerSession = $name.StartsWith('Local\')
} | ConvertTo-Json -Compress
Write-Output ("SUMMARY=" + $summary)
$summary | Out-File -FilePath (Join-Path $dir 'mutex-summary.json') -Encoding utf8
