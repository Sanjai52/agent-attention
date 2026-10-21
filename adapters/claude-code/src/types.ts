import type { AgentEvent } from "@agent-attention/contract";

export const CLAUDE_CODE_ADAPTER_ID = "claude-code";
export const CLAUDE_CODE_ADAPTER_VERSION = "0.0.0";
export const CLAUDE_CODE_HOST_VERSION_RANGE = ">=2.1.181 <3.0.0";

/** Allow-listed metadata read from a Claude Code hook invocation. */
export interface ClaudeCodeHookEvent {
  hookEventName: string;
  sessionId: string;
  cwd?: string;
  projectId?: string;
  projectName?: string;
  requestId?: string;
  turnId?: string;
  receivedAt?: string;
  occurredAt?: string;
  failureCode?: "host_error" | "cancelled" | "timeout" | "unknown";
}

export interface ClaudeCodeAdapterDependencies {
  send: (event: AgentEvent) => Promise<void>;
  now?: () => number;
  onError?: (error: unknown) => void;
}
