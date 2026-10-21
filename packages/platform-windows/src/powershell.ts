import { spawn } from "node:child_process";

export const POWERSHELL_EXECUTABLE = "powershell.exe";

export interface FixedScriptOptions {
  /** Absolute path to a committed, fixed `.ps1` script. */
  scriptPath: string;
  /** Data-only arguments appended after `-File <scriptPath>`. */
  args: string[];
  /** Payload written to stdin, then stdin is closed. Never command text. */
  stdin?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface FixedScriptResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  spawnError?: string;
}

export type RunFixedScript = (
  options: FixedScriptOptions,
) => Promise<FixedScriptResult>;

export interface SpawnStream {
  on(event: "data", listener: (chunk: unknown) => void): unknown;
}

export interface SpawnStdin {
  end(data?: string): void;
}

/**
 * Minimal child-process surface used by the runner. Keeping it narrow makes the
 * no-shell invocation testable without monkey-patching `node:child_process`.
 */
export interface SpawnedProcess {
  stdin: SpawnStdin | null;
  stdout: SpawnStream | null;
  stderr: SpawnStream | null;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
  kill(): boolean;
}

export interface SpawnProcessOptions {
  windowsHide: boolean;
  stdio: ["pipe", "pipe", "pipe"];
}

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnProcessOptions,
) => SpawnedProcess;

/**
 * The only command line this package ever builds. The script path and all
 * arguments are separate argv elements; `scriptPath` is package-controlled and
 * args are typed data (PRD §17.2).
 */
export function buildPowerShellArgs(
  scriptPath: string,
  args: readonly string[],
): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    ...args,
  ];
}

const defaultSpawn: SpawnProcess = (command, args, options) =>
  spawn(command, args, options) as unknown as SpawnedProcess;

/** Kill the child, then stop waiting for it if `close` never arrives. */
const KILL_GRACE_MS = 1_000;

function chunkToString(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  return String(chunk);
}

export function createFixedScriptRunner(
  spawnProcess: SpawnProcess = defaultSpawn,
): RunFixedScript {
  return (options) =>
    new Promise<FixedScriptResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let aborted = false;
      let settled = false;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let graceTimer: NodeJS.Timeout | undefined;

      const finish = (code: number, spawnError?: string): void => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (graceTimer) clearTimeout(graceTimer);
        options.signal?.removeEventListener("abort", onAbort);
        const result: FixedScriptResult = {
          code,
          stdout,
          stderr,
          timedOut,
          aborted,
        };
        if (spawnError !== undefined) result.spawnError = spawnError;
        resolve(result);
      };

      const terminate = (): void => {
        try {
          child.kill();
        } catch {
          // The child may already have exited; the close/error event decides.
        }
        graceTimer = setTimeout(() => finish(-1), KILL_GRACE_MS);
        graceTimer.unref?.();
      };

      function onAbort(): void {
        if (settled || aborted) return;
        aborted = true;
        terminate();
      }

      if (options.signal?.aborted) {
        aborted = true;
        resolve({
          code: -1,
          stdout: "",
          stderr: "",
          timedOut: false,
          aborted: true,
        });
        return;
      }

      let child: SpawnedProcess;
      try {
        child = spawnProcess(
          POWERSHELL_EXECUTABLE,
          buildPowerShellArgs(options.scriptPath, options.args),
          { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
        );
      } catch (error) {
        finish(-1, error instanceof Error ? error.message : String(error));
        return;
      }

      child.stdout?.on("data", (chunk) => {
        stdout += chunkToString(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunkToString(chunk);
      });
      child.on("error", (error) => {
        finish(-1, error.message);
      });
      child.on("close", (code) => {
        finish(code ?? -1);
      });

      if (Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          if (settled) return;
          timedOut = true;
          terminate();
        }, options.timeoutMs);
        timeoutTimer.unref?.();
      }
      options.signal?.addEventListener("abort", onAbort, { once: true });

      // Always close stdin, even when there is no payload, so a script that
      // reads stdin cannot block forever.
      try {
        child.stdin?.end(options.stdin);
      } catch {
        // A child that exited before reading stdin emits the real error via
        // `error`/`close`; closing is best-effort.
      }
    });
}

export const runFixedScript: RunFixedScript = createFixedScriptRunner();
