import type { IpcRequestKind, RequestPayloads } from "@agent-attention/contract";
import { createIpcClient, defaultIpcOptions } from "./ipc-client";
import { error, emit, type CliIo } from "./output";
import { HELP } from "./commands/help";
import { runConfig } from "./commands/config";

export interface RunCliOptions {
  io?: CliIo;
  env?: NodeJS.ProcessEnv;
  request?: (kind: IpcRequestKind, payload: RequestPayloads[IpcRequestKind]) => Promise<unknown>;
}

function has(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const command = argv[0];
  const json = has(argv, "--json");
  if (command === undefined || command === "--help" || command === "help") {
    emit(HELP, { json: false, io });
    return 0;
  }
  if (!new Set(["status", "history", "preview", "doctor", "config", "mute", "unmute", "install", "uninstall"]).has(command)) {
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
    error(io, `${command} requires a host-specific installer command`);
    return 2;
  }

  const client = createIpcClient(defaultIpcOptions(options.env));
  try {
    const payload = command === "status"
      ? { json }
      : command === "history"
        ? { filters: {} }
        : command === "preview"
          ? { eventClass: "completed", channel: "sound", voice: false }
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
