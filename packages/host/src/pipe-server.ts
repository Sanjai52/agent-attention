/**
 * Windows named-pipe server (PRD.md §9.2, D-03).
 *
 * Exclusive pipe creation is the single-instance guard: a second host receives
 * `EADDRINUSE` and must exit without serving. Node cannot set a security
 * descriptor at creation time, so the server exposes a `hardenPipeAcl` hook
 * that runs immediately after `listen()` and before `ready` resolves. If no
 * hook is supplied, `aclHardened` stays false and the caller must not claim a
 * hardened ACL. If the supplied hook fails, binding fails closed.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { userInfo } from "node:os";

import {
  IPC_MAX_LINE_BYTES,
  encodeIpcResponse,
  parseIpcLine,
  type IpcParseError,
  type IpcResponse,
} from "@agent-attention/contract";

import {
  createConnection,
  type ConnectionDependencies,
  type HostConnection,
} from "./connection";

export const DEFAULT_HELLO_TIMEOUT_MS = 5_000;

export type PipeServerErrorCode =
  | "already_running"
  | "listen_failed"
  | "acl_hardening_failed";

export class PipeServerError extends Error {
  readonly code: PipeServerErrorCode;

  constructor(code: PipeServerErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PipeServerError";
    this.code = code;
  }
}

export interface PipeServerOptions extends ConnectionDependencies {
  pipeName: string;
  /** Runs after listen; the pipe is not ready until it resolves. */
  hardenPipeAcl?: (address: string) => void | Promise<void>;
  /** Defaults to 5000 ms (PRD §9.2). */
  helloTimeoutMs?: number;
  /** Extra readiness gate; requests get `unavailable` until this returns true. */
  isReady?: () => boolean;
  onConnectionChange?: (openConnections: number) => void;
  maxLineBytes?: number;
}

export interface PipeServer {
  readonly address: string;
  readonly ready: Promise<void>;
  readonly aclHardened: boolean;
  readonly openConnections: number;
  close(): Promise<void>;
}

/** Stable short token for a Windows account SID (not a username). */
export function sidSuffix(sid: string): string {
  return createHash("sha256").update(sid, "utf8").digest("hex").slice(0, 8);
}

export function pipeNameForSid(sid: string): string {
  return `\\\\.\\pipe\\agent-attention-u-${sidSuffix(sid)}`;
}

/**
 * Read the current account SID without PowerShell. `AGENT_ATTENTION_SID`
 * overrides the lookup for tests and unusual packaging.
 */
export function currentUserSid(env: NodeJS.ProcessEnv = process.env): string | undefined {
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
      timeout: 2_000,
    });
    const match = /"?(S-\d-(?:[^",\r\n]+))"?/.exec(output);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/**
 * Default per-user pipe. On Windows this is SID-derived; the non-Windows
 * fallback only exists so unit tests can exercise the framing code.
 */
export function defaultPipeName(env: NodeJS.ProcessEnv = process.env): string {
  const sid = currentUserSid(env);
  if (sid !== undefined) {
    return pipeNameForSid(sid);
  }
  return `\\\\.\\pipe\\agent-attention-u-${sidSuffix(`user:${userInfo().username}`)}`;
}

export function normalizePipePath(pipeName: string): string {
  return pipeName.startsWith("\\\\") ? pipeName : `\\\\.\\pipe\\${pipeName}`;
}

function parseErrorResponse(error: IpcParseError): IpcResponse {
  return {
    id: error.error.id ?? "unknown",
    ok: false,
    error: { code: error.error.code, message: error.error.message },
  };
}

export function createPipeServer(options: PipeServerOptions): PipeServer {
  const address = normalizePipePath(options.pipeName);
  const maxLineBytes = options.maxLineBytes ?? IPC_MAX_LINE_BYTES;
  const helloTimeoutMs = options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
  const sockets = new Set<Socket>();
  const helloTimers = new Map<Socket, NodeJS.Timeout>();
  let closed = false;
  let aclHardened = false;

  const server: Server = createServer((socket) => {
    if (closed) {
      socket.destroy();
      return;
    }

    sockets.add(socket);
    options.onConnectionChange?.(sockets.size);
    socket.setEncoding("utf8");
    socket.setNoDelay(true);

    const connection: HostConnection = createConnection({
      store: options.store,
      config: options.config,
      providers: options.providers,
      clock: options.clock,
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
      ...(options.rateLimiter === undefined ? {} : { rateLimiter: options.rateLimiter }),
      ...(options.grace === undefined ? {} : { grace: options.grace }),
      ...(options.quietHoursMinutes === undefined
        ? {}
        : { quietHoursMinutes: options.quietHoursMinutes }),
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.doctor === undefined ? {} : { doctor: options.doctor }),
      ...(options.history === undefined ? {} : { history: options.history }),
      ...(options.preview === undefined ? {} : { preview: options.preview }),
      ...(options.mute === undefined ? {} : { mute: options.mute }),
      ...(options.unmute === undefined ? {} : { unmute: options.unmute }),
      ...(options.shutdown === undefined ? {} : { shutdown: options.shutdown }),
      ...(options.dispatch === undefined ? {} : { dispatch: options.dispatch }),
      ...(options.onActivity === undefined ? {} : { onActivity: options.onActivity }),
    });

    const helloTimer = setTimeout(() => {
      if (!connection.hasHello) {
        socket.destroy();
      }
    }, helloTimeoutMs);
    helloTimer.unref();
    helloTimers.set(socket, helloTimer);

    let buffer = "";
    let queue: Promise<void> = Promise.resolve();

    const send = (response: IpcResponse): void => {
      if (socket.destroyed || !socket.writable) {
        return;
      }
      socket.write(encodeIpcResponse(response));
    };

    const processLine = async (line: string): Promise<void> => {
      if (Buffer.byteLength(line, "utf8") > maxLineBytes) {
        send({
          id: "unknown",
          ok: false,
          error: {
            code: "invalid_payload",
            message: `request exceeds the 256 KiB (${maxLineBytes}-byte) line limit`,
          },
        });
        // An oversized frame cannot be recovered by continuing to buffer.
        socket.destroy();
        return;
      }

      const parsed = parseIpcLine(line);
      if (!parsed.ok) {
        send(parseErrorResponse(parsed));
        return;
      }

      if (!connection.hasHello && parsed.request.kind === "adapter_hello") {
        const timer = helloTimers.get(socket);
        if (timer !== undefined) {
          clearTimeout(timer);
          helloTimers.delete(socket);
        }
      }

      if (options.isReady !== undefined && !options.isReady()) {
        send({
          id: parsed.request.id,
          ok: false,
          error: { code: "unavailable", message: "host is still starting" },
        });
        return;
      }

      send(await connection.handleRequest(parsed.request));
    };

    socket.on("data", (chunk: string) => {
      if (closed) {
        return;
      }

      buffer += chunk;

      if (Buffer.byteLength(buffer, "utf8") > maxLineBytes && !buffer.includes("\n")) {
        send({
          id: "unknown",
          ok: false,
          error: {
            code: "invalid_payload",
            message: `request exceeds the 256 KiB (${maxLineBytes}-byte) line limit`,
          },
        });
        socket.destroy();
        return;
      }

      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) {
          break;
        }
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        queue = queue.then(() => processLine(line)).catch(() => {
          socket.destroy();
        });
      }
    });

    const cleanup = (): void => {
      const timer = helloTimers.get(socket);
      if (timer !== undefined) {
        clearTimeout(timer);
        helloTimers.delete(socket);
      }
      if (sockets.delete(socket)) {
        options.onConnectionChange?.(sockets.size);
      }
    };

    socket.on("close", cleanup);
    socket.on("error", () => {
      socket.destroy();
    });
  });

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;

    for (const timer of helloTimers.values()) {
      clearTimeout(timer);
    }
    helloTimers.clear();

    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  };

  const ready = new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener("listening", onListening);
      const code: PipeServerErrorCode =
        error.code === "EADDRINUSE" ? "already_running" : "listen_failed";
      reject(
        new PipeServerError(
          code,
          error.code === "EADDRINUSE"
            ? `already running on ${address}`
            : `could not listen on ${address}: ${error.message}`,
          { cause: error },
        ),
      );
    };

    const onListening = (): void => {
      server.removeListener("error", onError);
      server.on("error", () => {
        // Errors after readiness are per-connection; do not crash the host.
      });

      const harden = options.hardenPipeAcl;
      if (harden === undefined) {
        resolve();
        return;
      }

      void Promise.resolve()
        .then(() => harden(address))
        .then(() => {
          aclHardened = true;
          resolve();
        })
        .catch((error: unknown) => {
          void close().finally(() => {
            reject(
              new PipeServerError(
                "acl_hardening_failed",
                error instanceof Error ? error.message : "pipe ACL hardening failed",
                { cause: error },
              ),
            );
          });
        });
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(address);
  });

  // Callers that never await `ready` must not produce an unhandled rejection;
  // callers that do still observe the rejection above.
  void ready.catch(() => {});

  return {
    address,
    ready,
    get aclHardened() {
      return aclHardened;
    },
    get openConnections() {
      return sockets.size;
    },
    close,
  };
}
