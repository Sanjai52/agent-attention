# Per-user registration for the Agent Attention toast identity (spike only).
# Creates:
#   HKCU\Software\Classes\AppUserModelId\<AUMID>
#     DisplayName (REG_SZ)
#     IconUri     (REG_SZ)
#   %APPDATA%\Microsoft\Windows\Start Menu\Programs\<ShortcutName>.lnk
#     with System.AppUserModel.ID = <AUMID>
# No administrator rights required. Idempotent.
[CmdletBinding()]
param(
  [string]$Aumid = 'AgentAttention.S3Spike',
  [string]$DisplayName = 'Agent Attention S3 Spike',
  [string]$ShortcutName = 'Agent Attention S3 Spike',
  [string]$IconUri = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
)

$ErrorActionPreference = 'Stop'

$regPath = "HKCU:\Software\Classes\AppUserModelId\$Aumid"
$startMenu = [Environment]::GetFolderPath('Programs')
$shortcutPath = Join-Path $startMenu "$ShortcutName.lnk"

if (-not (Test-Path $regPath)) {
  New-Item -Path $regPath -Force | Out-Null
}
New-ItemProperty -Path $regPath -Name 'DisplayName' -Value $DisplayName -PropertyType String -Force | Out-Null
New-ItemProperty -Path $regPath -Name 'IconUri' -Value $IconUri -PropertyType String -Force | Out-Null

# --- Shortcut with System.AppUserModel.ID via IPropertyStore -----------------
$code = @'
using System;
using System.Runtime.InteropServices;

public static class AumidShortcut
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

    public static void SetAumid(string lnkPath, string aumid)
    {
        Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore store;
        int hr = SHGetPropertyStoreFromParsingName(lnkPath, IntPtr.Zero, 2, ref iid, out store);
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);

        PROPERTYKEY key = new PROPERTYKEY();
        key.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); // PKEY_AppUserModel_ID
        key.pid = 5;

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

if (-not ('AumidShortcut' -as [type])) {
  Add-Type -TypeDefinition $code -Language CSharp
}

$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut($shortcutPath)
$lnk.TargetPath = "$env:SystemRoot\System32\cmd.exe"
$lnk.Arguments = '/c exit'
$lnk.WorkingDirectory = $env:SystemRoot
$lnk.Description = 'Agent Attention S3 toast registration spike (throwaway)'
$lnk.IconLocation = "$IconUri,0"
$lnk.Save()
[AumidShortcut]::SetAumid($shortcutPath, $Aumid)

[pscustomobject]@{
  Aumid = $Aumid
  RegistryKey = $regPath
  RegistryValues = @('DisplayName', 'IconUri')
  ShortcutPath = $shortcutPath
  ShortcutAumid = $Aumid
} | ConvertTo-Json -Depth 4
