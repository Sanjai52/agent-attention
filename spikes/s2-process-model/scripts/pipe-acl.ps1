param(
  [Parameter(Mandatory=$true)][ValidateSet('read','set-user-only','set-deny-current-user','set-everyone-full')][string]$Action,
  [Parameter(Mandatory=$true)][string]$PipeName
)
$ErrorActionPreference = 'Stop'
if (-not $PipeName.StartsWith('\\.\pipe\')) { $PipeName = '\\.\pipe\' + $PipeName }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value

$src = @'
using System;
using System.Runtime.InteropServices;

public static class PipeAcl {
  const uint READ_CONTROL = 0x00020000;
  const uint WRITE_DAC = 0x00040000;
  const uint FILE_SHARE_READ = 0x1;
  const uint FILE_SHARE_WRITE = 0x2;
  const uint OPEN_EXISTING = 3;
  const uint DACL_SECURITY_INFORMATION = 0x4;
  const uint PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
  const int SE_KERNEL_OBJECT = 6;

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode,
    IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr hObject);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern uint GetSecurityInfo(IntPtr handle, int objectType, uint securityInfo,
    out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr sd);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern uint SetSecurityInfo(IntPtr handle, int objectType, uint securityInfo,
    IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr sd,
    uint revision, uint securityInfo, out IntPtr str, out uint len);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl,
    uint revision, out IntPtr sd, out uint len);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool GetSecurityDescriptorDacl(IntPtr sd, out bool present, out IntPtr dacl, out bool defaulted);

  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr hMem);

  public static string ReadDacl(string pipeName) {
    IntPtr h = CreateFileW(pipeName, READ_CONTROL, FILE_SHARE_READ | FILE_SHARE_WRITE,
      IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) return "OPEN_FAILED err=" + Marshal.GetLastWin32Error();
    IntPtr owner, group, dacl, sacl, sd;
    uint rc = GetSecurityInfo(h, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION,
      out owner, out group, out dacl, out sacl, out sd);
    CloseHandle(h);
    if (rc != 0) return "GETSEC_FAILED err=" + rc;
    IntPtr str; uint len;
    if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, DACL_SECURITY_INFORMATION, out str, out len)) {
      return "SDDL_FAILED err=" + Marshal.GetLastWin32Error();
    }
    string s = Marshal.PtrToStringUni(str);
    LocalFree(str); LocalFree(sd);
    return s;
  }

  public static string SetDacl(string pipeName, string sddl) {
    IntPtr h = CreateFileW(pipeName, READ_CONTROL | WRITE_DAC, FILE_SHARE_READ | FILE_SHARE_WRITE,
      IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) return "OPEN_FAILED err=" + Marshal.GetLastWin32Error();
    IntPtr sd; uint len;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out sd, out len)) {
      int e = Marshal.GetLastWin32Error(); CloseHandle(h);
      return "SDDL_PARSE_FAILED err=" + e;
    }
    bool present; IntPtr dacl; bool defaulted;
    if (!GetSecurityDescriptorDacl(sd, out present, out dacl, out defaulted)) {
      int e = Marshal.GetLastWin32Error(); LocalFree(sd); CloseHandle(h);
      return "GETDACL_FAILED err=" + e;
    }
    uint rc = SetSecurityInfo(h, SE_KERNEL_OBJECT,
      DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
      IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero);
    LocalFree(sd); CloseHandle(h);
    if (rc != 0) return "SETSEC_FAILED err=" + rc;
    return "SET_OK";
  }
}
'@
Add-Type -TypeDefinition $src -Language CSharp

Write-Output ("PIPE=" + $PipeName)
Write-Output ("SID=" + $sid)
Write-Output ("ACTION=" + $Action)

switch ($Action) {
  'read' {
    Write-Output ("DACL_SDDL=" + [PipeAcl]::ReadDacl($PipeName))
  }
  'set-user-only' {
    $sddl = "D:P(A;;FA;;;SY)(A;;FA;;;$sid)"
    Write-Output ("TARGET_SDDL=" + $sddl)
    Write-Output ("SET_RESULT=" + [PipeAcl]::SetDacl($PipeName, $sddl))
    Write-Output ("DACL_SDDL=" + [PipeAcl]::ReadDacl($PipeName))
  }
  'set-deny-current-user' {
    $sddl = "D:P(A;;FA;;;SY)(D;;FA;;;$sid)"
    Write-Output ("TARGET_SDDL=" + $sddl)
    Write-Output ("SET_RESULT=" + [PipeAcl]::SetDacl($PipeName, $sddl))
    Write-Output ("DACL_SDDL=" + [PipeAcl]::ReadDacl($PipeName))
  }
  'set-everyone-full' {
    $sddl = "D:P(A;;FA;;;WD)"
    Write-Output ("TARGET_SDDL=" + $sddl)
    Write-Output ("SET_RESULT=" + [PipeAcl]::SetDacl($PipeName, $sddl))
    Write-Output ("DACL_SDDL=" + [PipeAcl]::ReadDacl($PipeName))
  }
}
