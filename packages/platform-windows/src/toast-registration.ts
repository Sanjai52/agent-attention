import { fileURLToPath } from "node:url";
import { runFixedScript, type RunFixedScript } from "./powershell";

export const DEFAULT_TOAST_APP_ID = "AgentAttention.Desktop";
export const DEFAULT_TOAST_SCRIPT_PATH = fileURLToPath(
  new URL("../scripts/toast.ps1", import.meta.url),
);
export const DEFAULT_TOAST_DISPLAY_NAME = "Agent Attention";

const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// eslint-disable-next-line no-control-regex -- control characters are the input being rejected
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const MAX_DISPLAY_NAME_LENGTH = 128;

export interface ToastRegistrationTarget {
  appId: string;
  displayName: string;
}

export interface ToastScriptOptions {
  scriptPath?: string;
  runScript?: RunFixedScript;
  timeoutMs?: number;
}

export interface ToastRegistrationResult {
  /** Registry key and/or shortcut newly created; empty when already installed. */
  created: string[];
}

function assertAppId(appId: string): void {
  if (!APP_ID_PATTERN.test(appId)) {
    throw new TypeError(
      "appId must be 1-64 characters of letters, digits, '.', '_' or '-'",
    );
  }
}

function assertDisplayName(displayName: string): void {
  if (
    displayName.trim() === "" ||
    displayName.length > MAX_DISPLAY_NAME_LENGTH ||
    CONTROL_CHARACTERS.test(displayName)
  ) {
    throw new TypeError(
      `displayName must be non-empty, at most ${MAX_DISPLAY_NAME_LENGTH} characters, and contain no control characters`,
    );
  }
}

/**
 * Deterministic Start Menu shortcut name derived from the app id, so
 * `unregister` can remove exactly what `register` created without install-time
 * state.
 */
export function toastShortcutName(appId: string): string {
  return appId === DEFAULT_TOAST_APP_ID
    ? DEFAULT_TOAST_DISPLAY_NAME
    : `Agent Attention (${appId})`;
}

function parseObject(stdout: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error("toast helper returned invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("toast helper returned an unexpected payload");
  }
  return parsed as Record<string, unknown>;
}

async function invokeToastScript(
  options: ToastScriptOptions,
  args: string[],
): Promise<Record<string, unknown>> {
  const runScript = options.runScript ?? runFixedScript;
  const result = await runScript({
    scriptPath: options.scriptPath ?? DEFAULT_TOAST_SCRIPT_PATH,
    args,
    timeoutMs: options.timeoutMs ?? 30_000,
  });

  if (result.timedOut) throw new Error("toast helper timed out");
  if (result.aborted) throw new Error("toast helper was cancelled");
  if (result.spawnError !== undefined) {
    throw new Error(`toast helper could not start: ${result.spawnError}`);
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim();
    throw new Error(
      detail === "" ? `toast helper exited with code ${result.code}` : detail,
    );
  }
  return parseObject(result.stdout);
}

/**
 * Creates the per-user AUMID registry key and Start Menu shortcut required for
 * unpackaged toast delivery (S3-TO-01). No administrator rights are needed and
 * the fixed script is idempotent.
 */
export async function registerToastIdentity(
  options: ToastRegistrationTarget & ToastScriptOptions,
): Promise<ToastRegistrationResult> {
  assertAppId(options.appId);
  assertDisplayName(options.displayName);

  const payload = await invokeToastScript(options, [
    "-Mode",
    "register",
    "-Aumid",
    options.appId,
    "-DisplayName",
    options.displayName,
    "-ShortcutName",
    toastShortcutName(options.appId),
  ]);

  const created = Array.isArray(payload.created)
    ? payload.created.filter((entry): entry is string => typeof entry === "string")
    : [];
  return { created };
}

/** Removes the registry key, shortcut, and per-app notification settings key. */
export async function unregisterToastIdentity(
  appId: string,
  options: ToastScriptOptions = {},
): Promise<void> {
  assertAppId(appId);
  await invokeToastScript(options, [
    "-Mode",
    "unregister",
    "-Aumid",
    appId,
    "-ShortcutName",
    toastShortcutName(appId),
  ]);
}

/** `doctor`/provider registration check. Never throws. */
export async function isRegistered(
  appId: string,
  options: ToastScriptOptions = {},
): Promise<boolean> {
  try {
    assertAppId(appId);
    const payload = await invokeToastScript(options, [
      "-Mode",
      "status",
      "-Aumid",
      appId,
      "-ShortcutName",
      toastShortcutName(appId),
    ]);
    return (
      payload.registered === true &&
      payload.registryKeyExists === true &&
      payload.shortcutExists === true
    );
  } catch {
    return false;
  }
}
