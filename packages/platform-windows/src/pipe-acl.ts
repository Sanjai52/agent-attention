/**
 * Named-pipe DACL hardening (PRD D-03).
 *
 * Node does not expose the security descriptor used by `net.Server.listen` on a
 * named pipe. The default descriptor grants broader access than the product
 * allows. This module opens the already-created pipe with `WRITE_DAC`, applies
 * a protected DACL granting full access only to SYSTEM and the pipe owner
 * (the current user), and returns; the pipe server calls it before readiness.
 *
 * koffi is the same FFI dependency used by the in-process sound provider. The
 * calls are local Win32 calls, not a spawned helper, so hardening is fast and
 * cannot be bypassed by a missing script.
 */

const READ_CONTROL = 0x0002_0000;
const WRITE_DAC = 0x0004_0000;
const FILE_SHARE_READ = 0x0000_0001;
const FILE_SHARE_WRITE = 0x0000_0002;
const OPEN_EXISTING = 3;
const SE_KERNEL_OBJECT = 6;
const DACL_SECURITY_INFORMATION = 0x0000_0004;
const PROTECTED_DACL_SECURITY_INFORMATION = 0x8000_0000;
const SDDL_REVISION_1 = 1;

/** SYSTEM and the object owner (the current user) get full access. */
export const PIPE_SECURITY_DESCRIPTOR = "D:P(A;;FA;;;SY)(A;;FA;;;OW)";

type NativeFunction = (...args: unknown[]) => unknown;

interface NativeLibrary {
  func(signature: string): NativeFunction;
}

interface KoffiApi {
  load(path: string): NativeLibrary;
  decode(pointer: unknown, type: string, length?: number): unknown;
  address(pointer: unknown): bigint;
}

interface AclNative {
  koffi: KoffiApi;
  createFile: NativeFunction;
  closeHandle: NativeFunction;
  convertSddlToDescriptor: NativeFunction;
  convertDescriptorToSddl: NativeFunction;
  getDescriptorDacl: NativeFunction;
  getSecurityInfo: NativeFunction;
  getLastError: NativeFunction;
  localFree: NativeFunction;
  setSecurityInfo: NativeFunction;
}

export class PipeAclError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PipeAclError";
    this.code = code;
  }
}

let nativePromise: Promise<AclNative> | undefined;

async function loadNative(): Promise<AclNative> {
  if (process.platform !== "win32") {
    throw new PipeAclError("not_windows", "named-pipe ACL hardening requires Windows");
  }

  const imported = (await import("koffi")) as unknown as KoffiApi & {
    default?: KoffiApi;
  };
  const koffi = imported.default ?? imported;
  const kernel32 = koffi.load("kernel32.dll");
  const advapi32 = koffi.load("advapi32.dll");

  return {
    koffi,
    createFile: kernel32.func(
      "void *__stdcall CreateFileW(str16 name, uint32 access, uint32 share, void *sa, uint32 disposition, uint32 flags, void *template)",
    ),
    closeHandle: kernel32.func("int __stdcall CloseHandle(void *handle)"),
    convertSddlToDescriptor: advapi32.func(
      "int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16 sddl, uint32 revision, _Out_ void **descriptor, _Out_ uint32 *size)",
    ),
    convertDescriptorToSddl: advapi32.func(
      "int __stdcall ConvertSecurityDescriptorToStringSecurityDescriptorW(void *descriptor, uint32 revision, uint32 info, _Out_ void **text, _Out_ uint32 *size)",
    ),
    getDescriptorDacl: advapi32.func(
      "int __stdcall GetSecurityDescriptorDacl(void *descriptor, _Out_ int *present, _Out_ void **dacl, _Out_ int *defaulted)",
    ),
    getSecurityInfo: advapi32.func(
      "uint32 __stdcall GetSecurityInfo(void *handle, int objectType, uint32 info, _Out_ void **owner, _Out_ void **group, _Out_ void **dacl, _Out_ void **sacl, _Out_ void **descriptor)",
    ),
    getLastError: kernel32.func("uint32 __stdcall GetLastError()"),
    localFree: kernel32.func("void *__stdcall LocalFree(void *memory)"),
    setSecurityInfo: advapi32.func(
      "uint32 __stdcall SetSecurityInfo(void *handle, int objectType, uint32 info, void *owner, void *group, void *dacl, void *sacl)",
    ),
  };
}

function native(): Promise<AclNative> {
  nativePromise ??= loadNative();
  return nativePromise;
}

function fullPipePath(address: string): string {
  return address.startsWith("\\\\") ? address : `\\\\.\\pipe\\${address}`;
}

function isInvalidHandle(api: AclNative, handle: unknown): boolean {
  if (handle === null || handle === undefined) {
    return true;
  }
  try {
    const raw = api.koffi.address(handle);
    return raw === 0n || raw === 0xffff_ffff_ffff_ffffn;
  } catch {
    return false;
  }
}

function lastError(api: AclNative): number {
  return Number(api.getLastError() ?? 0);
}

function openPipe(api: AclNative, address: string, access: number): unknown {
  const handle = api.createFile(
    fullPipePath(address),
    access,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    null,
    OPEN_EXISTING,
    0,
    null,
  );
  if (isInvalidHandle(api, handle)) {
    throw new PipeAclError(
      "open_failed",
      `could not open pipe ${address} for ACL access (Win32 ${lastError(api)})`,
    );
  }
  return handle;
}

/** Apply the D-03 DACL to an existing pipe. Throws on any failure. */
export async function hardenNamedPipeAcl(address: string): Promise<void> {
  const api = await native();
  const handle = openPipe(api, address, READ_CONTROL | WRITE_DAC);

  const descriptor: unknown[] = [null];
  const descriptorSize = [0];
  let descriptorAllocated = false;
  try {
    if (
      !api.convertSddlToDescriptor(
        PIPE_SECURITY_DESCRIPTOR,
        SDDL_REVISION_1,
        descriptor,
        descriptorSize,
      )
    ) {
      throw new PipeAclError(
        "sddl_failed",
        `could not build pipe security descriptor (Win32 ${lastError(api)})`,
      );
    }
    descriptorAllocated = true;

    const present = [0];
    const dacl: unknown[] = [null];
    const defaulted = [0];
    if (!api.getDescriptorDacl(descriptor[0], present, dacl, defaulted)) {
      throw new PipeAclError(
        "dacl_failed",
        `could not read pipe security descriptor (Win32 ${lastError(api)})`,
      );
    }

    const result = Number(
      api.setSecurityInfo(
        handle,
        SE_KERNEL_OBJECT,
        DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
        null,
        null,
        dacl[0],
        null,
      ),
    );
    if (result !== 0) {
      throw new PipeAclError(
        "set_failed",
        `could not apply pipe DACL (Win32 ${result})`,
      );
    }

    const readback = await readNamedPipeAcl(address);
    if (readback !== PIPE_SECURITY_DESCRIPTOR) {
      throw new PipeAclError(
        "readback_mismatch",
        `pipe DACL readback was ${readback || "(empty)"}`,
      );
    }
  } finally {
    if (descriptorAllocated) {
      api.localFree(descriptor[0]);
    }
    api.closeHandle(handle);
  }
}

/** Read the pipe DACL as SDDL. Used by diagnostics and verification tests. */
export async function readNamedPipeAcl(address: string): Promise<string> {
  const api = await native();
  const handle = openPipe(api, address, READ_CONTROL);

  const owner: unknown[] = [null];
  const group: unknown[] = [null];
  const dacl: unknown[] = [null];
  const sacl: unknown[] = [null];
  const descriptor: unknown[] = [null];
  try {
    const result = Number(
      api.getSecurityInfo(
        handle,
        SE_KERNEL_OBJECT,
        DACL_SECURITY_INFORMATION,
        owner,
        group,
        dacl,
        sacl,
        descriptor,
      ),
    );
    if (result !== 0) {
      throw new PipeAclError(
        "get_failed",
        `could not read pipe security descriptor (Win32 ${result})`,
      );
    }

    const text: unknown[] = [null];
    const textSize = [0];
    if (
      !api.convertDescriptorToSddl(
        descriptor[0],
        SDDL_REVISION_1,
        DACL_SECURITY_INFORMATION,
        text,
        textSize,
      )
    ) {
      throw new PipeAclError(
        "readback_failed",
        `could not render pipe DACL (Win32 ${lastError(api)})`,
      );
    }

    const decoded = api.koffi.decode(text[0], "char16_t", textSize[0]);
    api.localFree(text[0]);
    return typeof decoded === "string" ? decoded : "";
  } finally {
    if (descriptor[0] !== null && descriptor[0] !== undefined) {
      api.localFree(descriptor[0]);
    }
    api.closeHandle(handle);
  }
}
