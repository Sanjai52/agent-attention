import type { AgentEvent, AgentEventDetails, AgentEventType } from "@agent-attention/contract";
import type { SessionRecord } from "@agent-attention/core";

let nextId = 0;

export interface EventOverrides {
  eventType: AgentEventType;
  eventId?: string;
  sequence?: number;
  adapterId?: string;
  sessionId?: string;
  occurredAt?: string;
  receivedAt?: string;
  confidence?: AgentEvent["confidence"];
  details?: AgentEventDetails;
  taskId?: string;
  parentSessionId?: string;
  isSubagent?: boolean;
  projectName?: string;
  workingDirectory?: string;
}

/**
 * Builds a valid `AgentEvent`. Timestamps default to the same instant, which
 * means `occurredAt` is untrustworthy unless a test overrides `receivedAt`.
 */
export function makeEvent(overrides: EventOverrides): AgentEvent {
  nextId += 1;

  const occurredAt = overrides.occurredAt ?? "2026-10-20T10:00:00Z";
  const event: AgentEvent = {
    schemaVersion: 1,
    eventId: overrides.eventId ?? `event-${nextId}`,
    eventIdStability: "source",
    eventType: overrides.eventType,
    source: {
      adapterId: overrides.adapterId ?? "adapter-a",
      adapterVersion: "1.0.0",
      agentId: "agent-a",
      agentName: "Agent A",
    },
    session: { sessionId: overrides.sessionId ?? "session-1" },
    occurredAt,
    receivedAt: overrides.receivedAt ?? occurredAt,
    confidence: overrides.confidence ?? "authoritative",
  };

  if (overrides.sequence !== undefined) {
    event.sequence = overrides.sequence;
  }
  if (overrides.details !== undefined) {
    event.details = overrides.details;
  }
  if (overrides.taskId !== undefined) {
    event.session.taskId = overrides.taskId;
  }
  if (overrides.parentSessionId !== undefined) {
    event.session.parentSessionId = overrides.parentSessionId;
  }
  if (overrides.isSubagent !== undefined) {
    event.session.isSubagent = overrides.isSubagent;
  }
  if (overrides.projectName !== undefined) {
    event.session.projectName = overrides.projectName;
  }
  if (overrides.workingDirectory !== undefined) {
    event.session.workingDirectory = overrides.workingDirectory;
  }

  return event;
}

export function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    adapterId: "adapter-a",
    sessionId: "session-1",
    agentName: "Agent A",
    state: "working",
    stateConfidence: "authoritative",
    lastEventAt: "2026-10-20T09:00:00Z",
    lastSeenAt: "2026-10-20T09:00:00Z",
    lastVerifiedAt: "2026-10-20T09:00:00Z",
    pendingRequests: [],
    tasks: [],
    isSubagent: false,
    ...overrides,
  };
}
