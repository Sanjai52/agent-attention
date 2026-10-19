/**
 * Agent event contract types (PRD.md §12.2).
 *
 * The event payload intentionally has no free-text fields: notification
 * wording is produced only from controlled templates (PRD §12.3, §14.3).
 */

import type { EVENT_SCHEMA_VERSION } from "./versions";
import type { SummaryCode } from "./summary";

/** All event types in the internal contract (PRD §12.1). */
export const AGENT_EVENT_TYPES = Object.freeze([
  "agent.started",
  "agent.progress",
  "agent.needs_input",
  "agent.needs_approval",
  "agent.approval_resolved",
  "agent.resumed",
  "agent.turn_ended",
  "agent.completed",
  "agent.failed",
  "agent.session_ended",
  "agent.state_unknown",
] as const);

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export type EventConfidence = "authoritative" | "inferred";
export type EventIdStability = "source" | "synthetic";
export type CompletionScope = "task" | "session";
export type ApprovalResolution = "approved" | "denied" | "unknown";
export type ResumeReason = "input_provided" | "new_prompt" | "unknown";
export type FailureCode = "host_error" | "cancelled" | "timeout" | "unknown";

export interface AgentEventSource {
  adapterId: string;
  adapterVersion: string;
  agentId: string;
  agentName: string;
  agentVersion?: string;
}

export interface AgentEventSession {
  sessionId: string;
  parentSessionId?: string;
  isSubagent?: boolean;
  taskId?: string;
  projectId?: string;
  projectName?: string;
  workingDirectory?: string;
}

export interface AgentEventDetails {
  summaryCode?: SummaryCode;
  requestId?: string;
  completionScope?: CompletionScope;
  resolution?: ApprovalResolution;
  resumeReason?: ResumeReason;
  failureCode?: FailureCode;
  turnDurationMs?: number;
}

export interface AgentEvent {
  schemaVersion: typeof EVENT_SCHEMA_VERSION;

  eventId: string;
  eventIdStability: EventIdStability;
  dedupeKey?: string;
  sequence?: number;

  eventType: AgentEventType;

  source: AgentEventSource;
  session: AgentEventSession;

  occurredAt: string;
  receivedAt: string;

  confidence: EventConfidence;

  details?: AgentEventDetails;
}
