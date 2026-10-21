import { IPC_PROTOCOL_VERSION, type IpcRequest } from "@agent-attention/contract";
import { sendToHost, type SendToHostOptions } from "@agent-attention/shim";
import { createAdapter } from "./adapter";
import type { ClaudeCodeHookEvent } from "./types";

const STRING_FIELDS = [
  "hookEventName",
  "sessionId",
  "cwd",
  "projectId",
  "projectName",
  "requestId",
  "turnId",
  "receivedAt",
  "occurredAt",
] as const;

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.resume();
  });
}

function allowList(raw: unknown): ClaudeCodeHookEvent | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  if (typeof input.hookEventName !== "string" || typeof input.sessionId !== "string") return undefined;
  const event: Record<string, string> = {};
  for (const field of STRING_FIELDS) {
    if (typeof input[field] === "string") event[field] = input[field] as string;
  }
  const failureCode = input.failureCode;
  if (failureCode === "host_error" || failureCode === "cancelled" || failureCode === "timeout" || failureCode === "unknown") {
    event.failureCode = failureCode;
  }
  return event as unknown as ClaudeCodeHookEvent;
}

export async function runClaudeHook(input: string, options: SendToHostOptions = {}): Promise<number> {
  try {
    const event = allowList(JSON.parse(input));
    if (event === undefined) return 0;
    const adapter = createAdapter({
      send: async (normalized) => {
        const request: IpcRequest = {
          protocolVersion: IPC_PROTOCOL_VERSION,
          id: `claude-hook-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`,
          kind: "submit_event",
          payload: { event: normalized },
        };
        await sendToHost(request, options);
      },
    });
    await adapter.start();
    await adapter.ingest(event);
    await adapter.stop();
  } catch {
    // Hooks must never block or fail the host agent.
  }
  return 0;
}

export async function runClaudeHookFromStdin(options: SendToHostOptions = {}): Promise<number> {
  return runClaudeHook(await readStdin(), options);
}
