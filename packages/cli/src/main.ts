import type { IpcRequestKind, RequestPayloads } from "@agent-attention/contract";
import { runClaudeHookFromStdin } from "@agent-attention/adapter-claude-code";
import { createIpcClient, defaultIpcOptions } from "./ipc-client";
import { error, emit, type CliIo } from "./output";
import { HELP } from "./commands/help";
import { parsePreviewArgs } from "./commands/preview";
import { runConfig } from "./commands/config";
import { defaultClaudeCodeSettingsPath, installClaudeCode, uninstallClaudeCode } from "./install/claude-code";
import { defaultOpenCodeConfigPath, installOpenCode, uninstallOpenCode } from "./install/opencode";

export interface RunCliOptions {
  io?: CliIo;
  env?: NodeJS.ProcessEnv;
  request?: (kind: IpcRequestKind, payload: RequestPayloads[IpcRequestKind]) => Promise<unknown>;
}

function has(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  const value = index < 0 ? undefined : argv[index + 1];
  return value?.trim() || undefined;
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const command = argv[0];
  const json = has(argv, "--json");
  if (command === undefined || command === "--help" || command === "help") {
    emit(HELP, { json: false, io });
    return 0;
  }
  if (!new Set(["status", "history", "preview", "doctor", "config", "mute", "unmute", "install", "uninstall", "claude-hook"]).has(command)) {
    error(io, `Unknown command: ${command}\n${HELP}`);
    return 2;
  }
  if (command === "config") {
    try {
      const result = await runConfig(argv.slice(1), options.env);
      emit(result, { json, io });
      return result && typeof result === "object" && "valid" in result && (result as { valid: boolean }).valid === false ? 4 : 0;
    } catch (cause) {
      error(io, cause instanceof Error ? cause.message : "configuration command failed");
      return 4;
    }
  }
  if (command === "install" || command === "uninstall") {
    const host = valueOf(argv, "--host") ?? "claude-code";
    try {
      let report;
      if (host === "claude-code") {
        const settingsPath = valueOf(argv, "--settings") ?? defaultClaudeCodeSettingsPath(options.env);
        const hookCommand = valueOf(argv, "--command");
        if (hookCommand === undefined) {
          error(io, `${command} requires --command for host ${host}`);
          return 2;
        }
        report = command === "install"
          ? await installClaudeCode({ settingsPath, hookCommand })
          : await uninstallClaudeCode({ settingsPath, hookCommand });
      } else if (host === "opencode") {
        const hostConfigPath = valueOf(argv, "--config") ?? defaultOpenCodeConfigPath(options.env);
        const stateDir = valueOf(argv, "--state-dir");
        const pluginEntry = valueOf(argv, "--plugin");
        if (command === "install" && pluginEntry === undefined) {
          error(io, "install requires --plugin for host opencode");
          return 2;
        }
        report = command === "install"
          ? await installOpenCode({ hostConfigPath, pluginEntry: pluginEntry!, stateDir, dryRun: has(argv, "--dry-run") })
          : await uninstallOpenCode({ hostConfigPath, stateDir, purge: has(argv, "--purge") });
      } else {
        error(io, `Unsupported installer host: ${host}`);
        return 2;
      }
      emit(report, { json, io });
      return 0;
    } catch (cause) {
      error(io, cause instanceof Error ? cause.message : `${command} failed`);
      return 4;
    }
  }

  if (command === "claude-hook") {
    return runClaudeHookFromStdin({
      ...(options.env === undefined ? {} : { pipeName: options.env.AGENT_ATTENTION_PIPE }),
    });
  }

  const client = createIpcClient(defaultIpcOptions(options.env));
  try {
    const payload = command === "status"
      ? { json }
      : command === "history"
        ? { filters: {} }
        : command === "preview"
          ? parsePreviewArgs(argv.slice(1))
          : command === "doctor"
            ? { json }
          : command === "mute"
            ? {}
            : command === "unmute"
              ? {}
            : {};
    const response = options.request
      ? await options.request(command as IpcRequestKind, payload as never)
      : await client.request(command as IpcRequestKind, payload as never);
    if (typeof response === "object" && response !== null && "ok" in response && response.ok === false) {
      error(io, (response as { error?: { message?: string } }).error?.message ?? "Notification Host request failed");
      return 1;
    }
    emit(response, { json, io });
    return 0;
  } catch {
    error(io, "Notification Host is not running. Start the host and retry.");
    return 3;
  }
}

if (process.argv[1]?.endsWith("index.js") === true) {
  void runCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
