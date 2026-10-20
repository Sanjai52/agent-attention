param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$true)][string]$OutFile,
  [int]$HoldMs = 3000
)
$ErrorActionPreference = 'Stop'
$created = $false
$mutex = New-Object System.Threading.Mutex($true, $Name, [ref]$created)
$result = [ordered]@{
  pid = $PID
  name = $Name
  createdNew = $created
  acquired = $created
  at = (Get-Date).ToString('o')
}
if ($created) {
  $result | ConvertTo-Json -Compress | Out-File -FilePath $OutFile -Encoding utf8
  Start-Sleep -Milliseconds $HoldMs
  $mutex.ReleaseMutex()
} else {
  $result | ConvertTo-Json -Compress | Out-File -FilePath $OutFile -Encoding utf8
}
$mutex.Dispose()
