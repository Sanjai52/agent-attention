# Fixed toast helper for the per-user notification identity (Q-05, S3 Task 0.10).
#
# Modes:
#   send        reads toast XML from stdin (UTF-8) and submits it
#   register    creates the HKCU AUMID key and Start Menu shortcut
#   unregister  removes the key, shortcut, and per-app notification settings
#   status      reports registration state for doctor
#
# Event-derived text only enters through stdin in `send` mode. Registration
# values are typed parameters supplied by the installer, never event data. No
# shell string is built from any input.
#
# Exit codes: 0 success, 2 failure.
[CmdletBinding()]
param(
  [ValidateSet('send', 'register', 'unregister', 'status')][string]$Mode = 'send',
  [string]$Aumid = 'AgentAttention.Desktop',
  [string]$DisplayName = 'Agent Attention',
  [string]$ShortcutName = 'Agent Attention',
  [string]$IconUri = ''
)

$ErrorActionPreference = 'Stop'

function Write-JsonResult {
  param([object]$Payload)
  $json = $Payload | ConvertTo-Json -Compress -Depth 6
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.WriteByte([byte]10)
  $stdout.Flush()
}

if ([string]::IsNullOrWhiteSpace($Aumid)) { throw 'AUMID is required' }
if ([string]::IsNullOrWhiteSpace($ShortcutName)) { throw 'ShortcutName is required' }

$regPath = "HKCU:\Software\Classes\AppUserModelId\$Aumid"
$appSettingsPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\$Aumid"
$startMenu = [Environment]::GetFolderPath('Programs')
$shortcutPath = Join-Path $startMenu ($ShortcutName + '.lnk')
if (-not $IconUri) {
  $IconUri = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
}

$shortcutCode = @'
using System;
using System.Runtime.InteropServices;

public static class AgentAttentionAumidShortcut
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PROPERTYKEY { public Guid fmtid; public uint pid; }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROPVARIANT
    {
        public ushort vt;
        public ushort r1;
        public ushort r2;
        public ushort r3;
        public IntPtr p;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore
    {
        uint GetCount(out uint cProps);
        void GetAt(uint iProp, out PROPERTYKEY pkey);
        void GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        void SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
        void Commit();
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int SHGetPropertyStoreFromParsingName(
        string pszPath, IntPtr pbc, uint flags, ref Guid riid,
        out IPropertyStore ppv);

    [DllImport("ole32.dll")]
    public static extern int PropVariantClear(ref PROPVARIANT pvar);

    private static PROPERTYKEY AumidKey()
    {
        PROPERTYKEY key = new PROPERTYKEY();
        key.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
        key.pid = 5;
        return key;
    }

    public static void SetAumid(string lnkPath, string aumid)
    {
        Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore store;
        int hr = SHGetPropertyStoreFromParsingName(lnkPath, IntPtr.Zero, 2, ref iid, out store);
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);

        PROPERTYKEY key = AumidKey();
        PROPVARIANT pv = new PROPVARIANT();
        pv.vt = 31; // VT_LPWSTR
        pv.p = Marshal.StringToCoTaskMemUni(aumid);
        try
        {
            store.SetValue(ref key, ref pv);
            store.Commit();
        }
        finally
        {
            PropVariantClear(ref pv);
            Marshal.ReleaseComObject(store);
        }
    }
}
'@

function Get-RegisteredState {
  $keyExists = Test-Path -LiteralPath $regPath
  $shortcutExists = Test-Path -LiteralPath $shortcutPath
  $displayNameValue = $null
  if ($keyExists) {
    try {
      $displayNameValue = (Get-ItemProperty -LiteralPath $regPath -Name DisplayName -ErrorAction Stop).DisplayName
    } catch {
      $displayNameValue = $null
    }
  }

  $shortcutAumid = $null
  if ($shortcutExists) {
    try {
      # Shell.Application exposes the shortcut's PKEY_AppUserModel_ID without
      # touching the registry or invoking any external process.
      $shell = New-Object -ComObject Shell.Application
      $folder = $shell.NameSpace((Split-Path -Parent $shortcutPath))
      $item = $folder.ParseName((Split-Path -Leaf $shortcutPath))
      $value = $item.ExtendedProperty('System.AppUserModel.ID')
      if ($null -ne $value -and "$value" -ne '') { $shortcutAumid = [string]$value }
    } catch {
      $shortcutAumid = $null
    }
  }

  $registered = $keyExists -and $shortcutExists -and
    (-not [string]::IsNullOrWhiteSpace($displayNameValue)) -and
    ($shortcutAumid -eq $Aumid)

  [ordered]@{
    aumid             = $Aumid
    registryKeyExists = $keyExists
    shortcutExists    = $shortcutExists
    displayName       = $displayNameValue
    registryKey       = $regPath
    shortcutPath      = $shortcutPath
    shortcutAumid     = $shortcutAumid
    registered        = [bool]$registered
  }
}

try {
  switch ($Mode) {
    'status' {
      Write-JsonResult (Get-RegisteredState)
      exit 0
    }

    'register' {
      if ([string]::IsNullOrWhiteSpace($DisplayName)) { throw 'DisplayName is required' }
      $created = @()

      if (-not (Test-Path -LiteralPath $regPath)) {
        New-Item -Path $regPath -Force | Out-Null
        $created += $regPath
      }
      New-ItemProperty -LiteralPath $regPath -Name 'DisplayName' -Value $DisplayName -PropertyType String -Force | Out-Null
      New-ItemProperty -LiteralPath $regPath -Name 'IconUri' -Value $IconUri -PropertyType String -Force | Out-Null

      $shortcutWasPresent = Test-Path -LiteralPath $shortcutPath
      $wsh = New-Object -ComObject WScript.Shell
      $lnk = $wsh.CreateShortcut($shortcutPath)
      $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
      $lnk.Arguments = '/c exit'
      $lnk.WorkingDirectory = $env:SystemRoot
      $lnk.Description = 'Agent Attention notification identity'
      $lnk.IconLocation = "$IconUri,0"
      $lnk.Save()
      if (-not $shortcutWasPresent) { $created += $shortcutPath }

      if (-not ('AgentAttentionAumidShortcut' -as [type])) {
        Add-Type -TypeDefinition $shortcutCode -Language CSharp
      }
      [AgentAttentionAumidShortcut]::SetAumid($shortcutPath, $Aumid)

      $state = Get-RegisteredState
      Write-JsonResult ([ordered]@{
        aumid        = $Aumid
        created      = $created
        registryKey  = $regPath
        shortcutPath = $shortcutPath
        registered   = $state.registered
      })
      exit 0
    }

    'unregister' {
      $removed = @()
      if (Test-Path -LiteralPath $regPath) {
        Remove-Item -LiteralPath $regPath -Recurse -Force
        $removed += $regPath
      }
      if (Test-Path -LiteralPath $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
        $removed += $shortcutPath
      }
      if (Test-Path -LiteralPath $appSettingsPath) {
        Remove-Item -LiteralPath $appSettingsPath -Recurse -Force
        $removed += $appSettingsPath
      }

      # Best-effort history cleanup; registration removal does not clear it.
      try {
        [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::History.Clear($Aumid)
      } catch {
        # Not fatal: the durable artifacts above are what uninstall owns.
      }

      Write-JsonResult ([ordered]@{
        aumid      = $Aumid
        removed    = $removed
        registered = $false
      })
      exit 0
    }

    'send' {
      # Read raw bytes from stdin and decode UTF-8 explicitly (S3-T04).
      $stdinStream = [Console]::OpenStandardInput()
      $stdinBuffer = New-Object System.IO.MemoryStream
      $stdinStream.CopyTo($stdinBuffer)
      $xml = [System.Text.Encoding]::UTF8.GetString($stdinBuffer.ToArray())
      $xml = $xml.TrimStart([char]0xFEFF)
      if ([string]::IsNullOrWhiteSpace($xml)) { throw 'Empty toast XML on stdin' }

      try {
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
        [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null

        $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
        $doc.LoadXml($xml)
        if ($doc.DocumentElement.NodeName -ne 'toast') { throw 'Document element is not <toast>' }

        $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid)
        $notifierSetting = [string]$notifier.Setting
        $toast = New-Object Windows.UI.Notifications.ToastNotification $doc
        $started = [DateTime]::UtcNow
        $notifier.Show($toast)
        $submitMs = [int]([DateTime]::UtcNow - $started).TotalMilliseconds

        Write-JsonResult ([ordered]@{
          submitted       = $true
          aumid           = $Aumid
          notifierSetting = $notifierSetting
          submitMs        = $submitMs
        })
        exit 0
      } catch {
        Write-JsonResult ([ordered]@{
          submitted = $false
          aumid     = $Aumid
          error     = $_.Exception.Message
        })
        exit 2
      }
    }
  }
}
catch {
  [Console]::Error.WriteLine($_.Exception.GetType().FullName + ': ' + $_.Exception.Message)
  exit 2
}
