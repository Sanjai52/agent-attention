import {
  runFixedScript,
  type FixedScriptResult,
  type RunFixedScript,
} from "./powershell";
import {
  DEFAULT_TOAST_SCRIPT_PATH,
  isRegistered as defaultIsRegistered,
} from "./toast-registration";
import type { DesktopProvider, DesktopRequest, ProviderResult } from "./provider-types";

// XML 1.0 forbids most C0 controls, DEL/C1, and the noncharacters below. S3-TO-03
// measured that a single C0 character makes XmlDocument.GetXml() throw.
const INVALID_XML_CHARACTERS =
  // eslint-disable-next-line no-control-regex -- control characters are the input being filtered
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g;

function escapeCharacter(character: string): string {
  switch (character) {
    case "&":
      return "&amp;";
    case "<":
      return "&lt;";
    case ">":
      return "&gt;";
    case '"':
      return "&quot;";
    case "'":
      return "&apos;";
    default:
      return character;
  }
}

/** Centralized toast-XML escaper; every interpolated value goes through it. */
export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARACTERS, "")
    .replace(/[&<>"']/g, escapeCharacter);
}

/**
 * The provider builds the toast document itself so the escaping is unit-tested.
 * The fixed script loads this XML; it does not build markup from event text.
 */
export function buildToastXml(title: string, body: string): string {
  return (
    "<toast>" +
    "<visual>" +
    '<binding template="ToastGeneric">' +
    `<text>${escapeXml(title)}</text>` +
    `<text>${escapeXml(body)}</text>` +
    "</binding>" +
    "</visual>" +
    '<audio silent="true"/>' +
    "</toast>"
  );
}

export interface WindowsToastProviderOptions {
  appId: string;
  scriptPath?: string;
  timeoutMs?: number;
  runScript?: RunFixedScript;
  /** Injectable for tests and for `doctor`; defaults to the fixed script. */
  isRegistered?: (appId: string) => Promise<boolean>;
}

export interface WindowsToastProvider extends DesktopProvider {
  /** Re-check registration after `install`/`uninstall`. */
  refreshRegistration(): void;
  /** Report the current per-user toast identity registration state. */
  isRegistered(): Promise<boolean>;
}

type RegistrationState = "registered" | "unregistered" | "error";

function parseObject(stdout: string): Record<string, unknown> | undefined {
  if (stdout.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function createWindowsToastProvider(
  options: WindowsToastProviderOptions,
): WindowsToastProvider {
  const runScript = options.runScript ?? runFixedScript;
  const scriptPath = options.scriptPath ?? DEFAULT_TOAST_SCRIPT_PATH;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const checkRegistration =
    options.isRegistered ??
    ((appId: string) =>
      defaultIsRegistered(appId, { scriptPath, runScript, timeoutMs }));

  let registration: RegistrationState | undefined;

  const ensureRegistration = async (): Promise<RegistrationState> => {
    if (registration !== undefined) return registration;
    try {
      registration = (await checkRegistration(options.appId))
        ? "registered"
        : "unregistered";
    } catch {
      registration = "error";
    }
    return registration;
  };

  return {
    refreshRegistration(): void {
      registration = undefined;
    },

    async isRegistered(): Promise<boolean> {
      return (await ensureRegistration()) === "registered";
    },

    async show(request: DesktopRequest): Promise<ProviderResult> {
      const state = await ensureRegistration();
      if (state === "unregistered") {
        return { status: "unavailable", errorCode: "toast_not_registered" };
      }
      if (state === "error") {
        return { status: "unavailable", errorCode: "registration_check_failed" };
      }

      let result: FixedScriptResult;
      try {
        result = await runScript({
          scriptPath,
          args: ["-Mode", "send"],
          // XML is data on stdin. It never appears in argv or command text.
          stdin: buildToastXml(request.title, request.body),
          timeoutMs,
        });
      } catch {
        return { status: "failed", errorCode: "provider_error" };
      }

      if (result.timedOut) return { status: "failed", errorCode: "timeout" };
      if (result.aborted) return { status: "failed", errorCode: "cancelled" };
      if (result.spawnError !== undefined) {
        return { status: "unavailable", errorCode: "powershell_unavailable" };
      }

      const payload = parseObject(result.stdout);
      if (payload?.submitted === true) {
        // Delivered means submitted to the OS. Focus Assist, DND, or a per-app
        // disable may still hide it; never claim the user saw it (F6-R10).
        return { status: "delivered" };
      }
      if (payload?.submitted === false || result.code !== 0) {
        return { status: "failed", errorCode: "toast_submit_failed" };
      }
      return { status: "failed", errorCode: "invalid_script_output" };
    },
  };
}
