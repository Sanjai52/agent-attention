import path from "node:path";
import { runFixedScript, type RunFixedScript } from "./powershell";
import { resolvePlatformResource } from "./resources";
import type { FocusProvider, ForegroundWindow } from "./provider-types";

export const DEFAULT_FOCUS_SCRIPT_PATH = resolvePlatformResource("scripts/focus.ps1");

export interface WindowsFocusProviderOptions {
  scriptPath?: string;
  timeoutMs?: number;
  runScript?: RunFixedScript;
}

function parseForeground(stdout: string): ForegroundWindow | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const processId = record.processId;
  const executable = record.executable;

  if (
    typeof processId !== "number" ||
    !Number.isInteger(processId) ||
    processId <= 0 ||
    typeof executable !== "string" ||
    executable.trim() === ""
  ) {
    return undefined;
  }

  return {
    processId,
    executable: path.win32.basename(executable.trim()),
  };
}

/**
 * Foreground window detection only (F13). Returning `undefined` means "unknown"
 * and MUST be treated as "not focused" by callers: detection failure never
 * suppresses an alert (AC-F13-03).
 *
 * Q-06/F13-R5: session -> window attribution is supported only for Windows
 * Terminal and classic console, and is supplied by the host integration. This
 * provider deliberately performs no PID-only host matching and no VS Code
 * attribution.
 */
export function createWindowsFocusProvider(
  options: WindowsFocusProviderOptions = {},
): FocusProvider {
  const runScript = options.runScript ?? runFixedScript;
  const scriptPath = options.scriptPath ?? DEFAULT_FOCUS_SCRIPT_PATH;
  const timeoutMs = options.timeoutMs ?? 5_000;

  return {
    async getForeground(): Promise<ForegroundWindow | undefined> {
      try {
        const result = await runScript({
          scriptPath,
          args: [],
          timeoutMs,
        });
        if (
          result.code !== 0 ||
          result.timedOut ||
          result.aborted ||
          result.spawnError !== undefined
        ) {
          return undefined;
        }
        return parseForeground(result.stdout);
      } catch {
        return undefined;
      }
    },
  };
}
