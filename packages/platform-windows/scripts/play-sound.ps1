# Fixed sound player. The only variable input is -Path (an absolute file path
# validated by the provider) and -Volume (0..100). Both arrive as typed
# parameters; no event-derived text is accepted and no shell is invoked.
#
# Primary route: WinMM MCI, which supports per-playback volume. Fallback:
# System.Media.SoundPlayer for WAV files at full volume. Exit codes:
#   0 delivered
#   2 playback/file failure
#   3 audio device unavailable
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$Volume = 100
)

$ErrorActionPreference = 'Stop'
$Volume = [Math]::Max(0, [Math]::Min(100, $Volume))

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
  [Console]::Error.WriteLine('SOUND_FILE_NOT_FOUND')
  exit 2
}

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class AgentAttentionSound
{
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    public static extern int mciSendStringW(
        string command, StringBuilder buffer, int bufferSize, IntPtr hwnd);
}
'@

function Invoke-Mci {
  param([string]$Command)
  $buffer = New-Object System.Text.StringBuilder 512
  $code = [AgentAttentionSound]::mciSendStringW($Command, $buffer, $buffer.Capacity, [IntPtr]::Zero)
  [pscustomobject]@{ Code = $code; Message = $buffer.ToString() }
}

# Windows file names cannot contain a double quote, so the MCI command cannot
# be broken out of by a file path. MCI is not a shell.
$alias = 'agentattentionsound'
$opened = $false
try {
  $open = Invoke-Mci ('open "' + $Path + '" alias ' + $alias)
  if ($open.Code -ne 0) {
    [Console]::Error.WriteLine("MCI_OPEN_FAILED $($open.Code) $($open.Message)")
    if ($open.Code -eq 296 -or $open.Code -eq 304) {
      exit 2
    }
    if ($Path.ToLowerInvariant().EndsWith('.wav')) {
      try {
        $player = New-Object System.Media.SoundPlayer $Path
        $player.PlaySync()
        exit 0
      } catch {
        [Console]::Error.WriteLine($_.Exception.Message)
      }
    }
    exit 3
  }
  $opened = $true

  if ($Volume -gt 0) {
    # MCI volume is 0..1000; the script parameter is 0..100.
    $null = Invoke-Mci ('setaudio ' + $alias + ' volume to ' + ($Volume * 10))
    $play = Invoke-Mci ('play ' + $alias + ' wait')
    if ($play.Code -ne 0) {
      [Console]::Error.WriteLine("MCI_PLAY_FAILED $($play.Code) $($play.Message)")
      exit 2
    }
  }
  exit 0
}
catch {
  [Console]::Error.WriteLine($_.Exception.GetType().FullName + ': ' + $_.Exception.Message)
  exit 2
}
finally {
  if ($opened) {
    $null = Invoke-Mci ('close ' + $alias)
  }
}
