param(
  [Parameter(Mandatory=$true)][string]$PipeName
)
$ErrorActionPreference = 'Stop'
if (-not $PipeName.StartsWith('\\.\pipe\')) {
  $PipeName = '\\.\pipe\' + $PipeName
}
$src = @'
using System;
using System.Runtime.InteropServices;

public static class PipeAclReader {
  const uint GENERIC_READ = 0x80000000;
  const uint READ_CONTROL = 0x00020000;
  const uint FILE_SHARE_READ = 0x1;
  const uint FILE_SHARE_WRITE = 0x2;
  const uint OPEN_EXISTING = 3;
  const uint SECURITY_INFORMATION_DACL = 0x4;
  const int SE_KERNEL_OBJECT = 6;

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode,
    IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr hObject);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern uint GetSecurityInfo(IntPtr handle, int objectType, uint securityInfo,
    out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr sd);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr sd,
    uint revision, uint securityInfo, out IntPtr str, out uint len);

  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr hMem);

  public static string ReadDacl(string pipeName) {
    IntPtr h = CreateFileW(pipeName, READ_CONTROL, FILE_SHARE_READ | FILE_SHARE_WRITE,
      IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) {
      return "OPEN_FAILED err=" + Marshal.GetLastWin32Error();
    }
    IntPtr owner, group, dacl, sacl, sd;
    uint rc = GetSecurityInfo(h, SE_KERNEL_OBJECT, SECURITY_INFORMATION_DACL,
      out owner, out group, out dacl, out sacl, out sd);
    CloseHandle(h);
    if (rc != 0) return "GETSEC_FAILED err=" + rc;
    IntPtr str;
    uint len;
    if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, SECURITY_INFORMATION_DACL, out str, out len)) {
      return "SDDL_FAILED err=" + Marshal.GetLastWin32Error();
    }
    string sddl = Marshal.PtrToStringUni(str);
    LocalFree(str);
    LocalFree(sd);
    return sddl;
  }
}
'@
Add-Type -TypeDefinition $src -Language CSharp
Write-Output ("PIPE=" + $PipeName)
Write-Output ("DACL_SDDL=" + [PipeAclReader]::ReadDacl($PipeName))
