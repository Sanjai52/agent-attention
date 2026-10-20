using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

// Throwaway S2 helper: read or replace the DACL of an existing named pipe.
// Proves that ACL hardening does not require a PowerShell startup (~600 ms).
public static class PipeAclHelper {
  const uint READ_CONTROL = 0x00020000;
  const uint WRITE_DAC = 0x00040000;
  const uint FILE_SHARE_READ = 0x1;
  const uint FILE_SHARE_WRITE = 0x2;
  const uint OPEN_EXISTING = 3;
  const uint DACL_SECURITY_INFORMATION = 0x4;
  const uint PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
  const int SE_KERNEL_OBJECT = 6;

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern uint GetSecurityInfo(IntPtr h, int type, uint info, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr sd);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern uint SetSecurityInfo(IntPtr h, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr sd, uint rev, uint info, out IntPtr str, out uint len);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl, uint rev, out IntPtr sd, out uint len);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool GetSecurityDescriptorDacl(IntPtr sd, out bool present, out IntPtr dacl, out bool defaulted);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr h);

  static string Read(string pipe) {
    IntPtr h = CreateFileW(pipe, READ_CONTROL, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) return "OPEN_FAILED err=" + Marshal.GetLastWin32Error();
    IntPtr o, g, d, s, sd;
    uint rc = GetSecurityInfo(h, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION, out o, out g, out d, out s, out sd);
    CloseHandle(h);
    if (rc != 0) return "GETSEC_FAILED err=" + rc;
    IntPtr str; uint len;
    if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, DACL_SECURITY_INFORMATION, out str, out len)) return "SDDL_FAILED err=" + Marshal.GetLastWin32Error();
    string text = Marshal.PtrToStringUni(str);
    LocalFree(str); LocalFree(sd);
    return text;
  }

  static string SetUserOnly(string pipe) {
    string sid = WindowsIdentity.GetCurrent().User.Value;
    string sddl = "D:P(A;;FA;;;SY)(A;;FA;;;" + sid + ")";
    IntPtr h = CreateFileW(pipe, READ_CONTROL | WRITE_DAC, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) return "OPEN_FAILED err=" + Marshal.GetLastWin32Error();
    IntPtr sd; uint len;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out sd, out len)) {
      int e = Marshal.GetLastWin32Error(); CloseHandle(h); return "SDDL_PARSE_FAILED err=" + e;
    }
    bool present; IntPtr dacl; bool defaulted;
    if (!GetSecurityDescriptorDacl(sd, out present, out dacl, out defaulted)) {
      int e = Marshal.GetLastWin32Error(); LocalFree(sd); CloseHandle(h); return "GETDACL_FAILED err=" + e;
    }
    uint rc = SetSecurityInfo(h, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero);
    LocalFree(sd); CloseHandle(h);
    if (rc != 0) return "SETSEC_FAILED err=" + rc;
    return "SET_OK " + sddl;
  }

  public static int Main(string[] args) {
    if (args.Length < 2) { Console.Error.WriteLine("usage: pipe-acl-helper <read|set-user-only> <pipe>"); return 2; }
    string pipe = args[1].StartsWith("\\\\.\\pipe\\") ? args[1] : "\\\\.\\pipe\\" + args[1];
    switch (args[0]) {
      case "read": Console.WriteLine("DACL_SDDL=" + Read(pipe)); return 0;
      case "set-user-only": Console.WriteLine("SET_RESULT=" + SetUserOnly(pipe)); Console.WriteLine("DACL_SDDL=" + Read(pipe)); return 0;
      default: Console.Error.WriteLine("unknown action"); return 2;
    }
  }
}
