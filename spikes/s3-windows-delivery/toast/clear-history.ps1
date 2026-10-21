$ErrorActionPreference = 'Continue'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$ids = @('AgentAttention.S3Spike', 'AgentAttention.S3Spike.Alt', 'AgentAttention.S3Spike.Never')
foreach ($a in $ids) {
  try {
    [Windows.UI.Notifications.ToastNotificationManager]::History.Clear($a)
    $h = @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($a))
    Write-Output ("CLEARED " + $a + " HISTORY_AFTER=" + $h.Count)
  } catch {
    Write-Output ("CLEAR_FAILED " + $a + " " + $_.Exception.Message)
  }
}
