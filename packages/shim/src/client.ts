/**
 * Shim IPC client with a hard runtime budget (PRD.md §9.2, S2-05/S2-09).
 *
 * Order: connect to the pipe and await an ack; if unreachable, spawn the host
 * detached hidden, run ONE bounded retry phase (polling, not a single
 * immediate retry), and finally spool the event. Every await is bounded by the
 * remaining budget so a wedged host can never hang the caller. The shim never
 * throws to its caller.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { connect as netConnect, type Socket } from "node:net";
import { userInfo } from "node:os";

import {
  IPC_PROTOCOL_VERSION,
  encodeIpcRequest,
  parseAgentEvent,
  parseIpcResponse,
  type AgentEvent,
  type IpcRequest,
  type IpcResponse,
} from "@agent-attention/contract";

import { appendSpool, defaultSpoolDir } from "./spool";
import { spawnHostDetached, type SpawnHostResult } from "./spawn-host";

export const TOTAL_BUDGET_MS = 950;
export const CONNECT_TIMEOUT_MS = 200;
export const SPAWN_RETRY_TIMEOUT_MS = 300;
export const RETRY_POLL_MS = 40;
export const SPOOL_RESERVE_MS = 100;

export interface ShimSocket {
  write(data: string): boolean;
  on(event: "data", listener: (chunk: string | Buffer) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  destroy(): void;
  setEncoding?(encoding: "utf8"): unknown;
}

export type ConnectFn = (pipeName: string, timeoutMs: number) => Promise<ShimSocket>;

export type SpawnFn = () => SpawnHostResult | boolean | void;

export interface SendToHostOptions {
  pipeName?: string;
  spoolDir?: string;
  budgetMs?: number;
  connectTimeoutMs?: number;
  retryTimeoutMs?: number;
  retryPollMs?: number;
  spawnHost?: SpawnFn;
  connect?: ConnectFn;
  now?: () => number;
}

export interface ShimOutcome {
  channel: "pipe" | "spawn" | "spool";
  ok: boolean;
  reason?: string;
}

function currentUserSid(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.AGENT_ATTENTION_SID?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }

  if (process.platform !== "win32") {
    return undefined;
  }

  try {
    const output = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 500,
    });
    return /"?(S-\d-(?:[^",\r\n]+))"?/.exec(output)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/** Same SID-derived name as the host (PRD §9.2, S2 amendment 1). */
export function resolvePipeName(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AGENT_ATTENTION_PIPE?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }

  const sid = currentUserSid(env);
  const token = createHash("sha256")
    .update(sid ?? `user:${userInfo().username}`, "utf8")
    .digest("hex")
    .slice(0, 8);
  return `\\\\.\\pipe\\agent-attention-u-${token}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function connectPipe(pipeName: string, timeoutMs: number): Promise<ShimSocket> {
  return new Promise<ShimSocket>((resolve, reject) => {
    const socket: Socket = netConnect(pipeName);
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`connect timed out after ${timeoutMs} ms`));
      }
    }, Math.max(1, timeoutMs));

    socket.once("connect", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function exchange(
  socket: ShimSocket,
  request: IpcRequest,
  timeoutMs: number,
): Promise<IpcResponse> {
  return new Promise<IpcResponse>((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const finish = (error?: Error, response?: IpcResponse): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error !== undefined) {
        reject(error);
      } else if (response !== undefined) {
        resolve(response);
      }
    };

    const timer = setTimeout(
      () => finish(new Error(`response timed out after ${timeoutMs} ms`)),
      Math.max(1, timeoutMs),
    );

    socket.setEncoding?.("utf8");
    socket.on("data", (chunk) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }

      const line = buffer.slice(0, newline);
      const parsed = parseIpcResponse(line);
      if (!parsed.ok) {
        finish(new Error(parsed.error.message));
        return;
      }
      if (parsed.response.id !== request.id) {
        finish(new Error("response id does not match the request id"));
        return;
      }
      finish(undefined, parsed.response);
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(new Error("connection closed before the response")));

    try {
      socket.write(encodeIpcRequest(request));
    } catch (error) {
      finish(error instanceof Error ? error : new Error("write failed"));
    }
  });
}

async function attempt(
  request: IpcRequest,
  options: Required<Pick<SendToHostOptions, "pipeName" | "connect" | "now">> & {
    connectTimeoutMs: number;
    deadline: number;
  },
): Promise<IpcResponse> {
  const remaining = Math.max(1, options.deadline - options.now());
  const timeoutMs = Math.min(options.connectTimeoutMs, remaining);
  const socket = await withTimeout(
    options.connect(options.pipeName, timeoutMs),
    timeoutMs,
    "connect timed out",
  );

  try {
    return await exchange(socket, request, Math.max(1, options.deadline - options.now()));
  } finally {
    socket.destroy();
  }
}

function spoolFallback(
  request: IpcRequest,
  spoolDir: string,
): ShimOutcome {
  if (request.kind !== "submit_event") {
    return { channel: "spool", ok: false, reason: "request is not spoolable" };
  }

  const event = request.payload.event;
  if (typeof event !== "object" || event === null) {
    return { channel: "spool", ok: false, reason: "event payload is not spoolable" };
  }

  try {
    appendSpool(event as AgentEvent, spoolDir);
    return { channel: "spool", ok: true };
  } catch (error) {
    return {
      channel: "spool",
      ok: false,
      reason: error instanceof Error ? error.message : "spool write failed",
    };
  }
}

/**
 * Send one request. Never throws and never exceeds the budget: an unreachable
 * or wedged host ends in the spool (for `submit_event`) or an `ok: false`
 * outcome (for non-spoolable requests).
 */
export async function sendToHost(
  request: IpcRequest,
  options: SendToHostOptions = {},
): Promise<ShimOutcome> {
  const now = options.now ?? (() => Date.now());
  const budgetMs = Math.max(1, options.budgetMs ?? TOTAL_BUDGET_MS);
  const connectTimeoutMs = Math.max(1, options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
  const retryTimeoutMs = Math.max(0, options.retryTimeoutMs ?? SPAWN_RETRY_TIMEOUT_MS);
  const retryPollMs = Math.max(1, options.retryPollMs ?? RETRY_POLL_MS);
  const spoolDir = options.spoolDir ?? defaultSpoolDir();
  const connect = options.connect ?? connectPipe;
  const spawnHost = options.spawnHost ?? (() => spawnHostDetached());
  const deadline = now() + budgetMs;

  try {
    const response = await attempt(request, {
      pipeName: options.pipeName ?? resolvePipeName(),
      connect,
      now,
      connectTimeoutMs,
      deadline,
    });
    return response.ok
      ? { channel: "pipe", ok: true }
      : { channel: "pipe", ok: false, reason: response.error.code };
  } catch {
    // Unreachable (or the ack was not valid): start the host and retry once.
  }

  let spawned = false;
  try {
    const result = spawnHost();
    spawned =
      typeof result === "boolean" ? result : result === undefined ? false : result.spawned;
  } catch {
    spawned = false;
  }

  const reserve = Math.min(SPOOL_RESERVE_MS, Math.max(0, budgetMs / 4));
  const retryDeadline = Math.min(deadline - reserve, now() + retryTimeoutMs);

  for (;;) {
    const remaining = retryDeadline - now();
    if (remaining <= 0) {
      break;
    }

    try {
      const response = await attempt(request, {
        pipeName: options.pipeName ?? resolvePipeName(),
        connect,
        now,
        connectTimeoutMs: Math.min(connectTimeoutMs, remaining),
        deadline: retryDeadline,
      });
      return response.ok
        ? { channel: spawned ? "spawn" : "pipe", ok: true }
        : {
            channel: spawned ? "spawn" : "pipe",
            ok: false,
            reason: response.error.code,
          };
    } catch {
      const wait = Math.min(retryPollMs, retryDeadline - now());
      if (wait <= 0) {
        break;
      }
      await sleep(wait);
    }
  }

  return spoolFallback(request, spoolDir);
}

export type RunShimOptions = SendToHostOptions;

function diagnostic(message: string): void {
  try {
    process.stderr.write(`agent-attention: ${message}\n`);
  } catch {
    // Never let diagnostics affect the caller.
  }
}

/**
 * Hook entry: parse one already-normalized event from stdin, submit it, and
 * always return 0 (PRD §9.2). Adapter-specific normalization is Phase 3.
 */
export async function runShim(
  input: string,
  options: RunShimOptions = {},
): Promise<number> {
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(input);
    } catch {
      diagnostic("stdin payload is not valid JSON");
      return 0;
    }

    const parsed = parseAgentEvent(raw);
    if (!parsed.ok) {
      diagnostic("stdin payload is not a valid AgentEvent");
      return 0;
    }

    const request: IpcRequest = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      id: `shim-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`,
      kind: "submit_event",
      payload: { event: parsed.event },
    };

    const outcome = await sendToHost(request, options);
    if (!outcome.ok && outcome.channel === "pipe") {
      diagnostic(`host rejected the event (${outcome.reason ?? "unknown"})`);
    }
  } catch (error) {
    diagnostic(error instanceof Error ? error.message : "shim failed");
  }

  return 0;
}

/** Read all of stdin (the hook contract is one JSON document). */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runShimFromStdin(options: RunShimOptions = {}): Promise<number> {
  return runShim(await readStdin(), options);
}
