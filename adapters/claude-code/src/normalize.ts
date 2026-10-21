import { EVENT_SCHEMA_VERSION, type AdapterCapabilities, type AgentEvent, type AgentEventSession, type AgentEventType, type EventConfidence } from "@agent-attention/contract";
import { assertEmittable } from "./capabilities";
import type { ClaudeCodeHookEvent } from "./types";
import { CLAUDE_CODE_ADAPTER_ID, CLAUDE_CODE_ADAPTER_VERSION } from "./types";

export interface NormalizerOptions { capabilities: AdapterCapabilities; now?: () => number; }
export interface ClaudeCodeNormalizer { normalize(event: ClaudeCodeHookEvent): AgentEvent[]; }

function identifierPart(value: string): string { return value.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 96); }
function sessionOf(event: ClaudeCodeHookEvent): AgentEventSession {
  const projectName = event.projectName ?? event.cwd?.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1);
  return { sessionId: event.sessionId, ...(event.projectId === undefined ? {} : { projectId: event.projectId }), ...(projectName === undefined ? {} : { projectName: identifierPart(projectName) }), ...(event.cwd === undefined ? {} : { workingDirectory: identifierPart(event.cwd) }) };
}
function buildEvent(options: NormalizerOptions, event: ClaudeCodeHookEvent, eventType: AgentEventType, confidence: EventConfidence, details?: AgentEvent["details"]): AgentEvent {
  assertEmittable(options.capabilities, eventType);
  const receivedAt = event.receivedAt ?? new Date(options.now?.() ?? Date.now()).toISOString();
  const occurredAt = event.occurredAt ?? receivedAt;
  const discriminator = event.requestId ?? event.turnId ?? event.hookEventName;
  const dedupeKey = `${CLAUDE_CODE_ADAPTER_ID}:${event.sessionId}:${discriminator}`;
  return { schemaVersion: EVENT_SCHEMA_VERSION, eventId: identifierPart(dedupeKey), eventIdStability: "synthetic", dedupeKey: identifierPart(dedupeKey), eventType, source: { adapterId: CLAUDE_CODE_ADAPTER_ID, adapterVersion: CLAUDE_CODE_ADAPTER_VERSION, agentId: CLAUDE_CODE_ADAPTER_ID, agentName: "Claude Code" }, session: sessionOf(event), occurredAt, receivedAt, confidence, ...(details === undefined ? {} : { details }) };
}
export function createNormalizer(options: NormalizerOptions): ClaudeCodeNormalizer {
  const seen = new Set<string>();
  return { normalize(event) {
    const supportedHook = new Set(["SessionStart", "PermissionRequest", "Stop", "StopFailure", "PostToolUseFailure", "SessionEnd"]);
    if (!supportedHook.has(event.hookEventName)) return [];
    const discriminator = event.requestId ?? event.turnId ?? event.hookEventName;
    const dedupeKey = `${CLAUDE_CODE_ADAPTER_ID}:${event.sessionId}:${discriminator}`;
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);
    switch (event.hookEventName) {
      case "SessionStart": return [buildEvent(options, event, "agent.started", "authoritative")];
      case "PermissionRequest": return [buildEvent(options, event, "agent.needs_approval", "authoritative", event.requestId === undefined ? undefined : { requestId: event.requestId })];
      case "Stop": return [buildEvent(options, event, "agent.turn_ended", "inferred")];
      case "StopFailure":
      case "PostToolUseFailure": return [buildEvent(options, event, "agent.failed", "authoritative", { failureCode: event.failureCode ?? "host_error" })];
      case "SessionEnd": return [buildEvent(options, event, "agent.session_ended", "authoritative")];
      default: return [];
    }
  } };
}
