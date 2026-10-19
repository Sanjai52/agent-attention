/**
 * Normalized session state (PRD.md §13.1).
 *
 * These types are storage-agnostic: the core only produces and consumes plain
 * records so that Phase 2 can persist them without pulling I/O into core.
 */

export type SessionState =
  | "working"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "idle"
  | "completed"
  | "failed"
  | "ended"
  | "unknown";

export type SessionStateConfidence = "authoritative" | "inferred" | "unverified";

export type PendingRequestKind = "input" | "approval";

export interface PendingRequest {
  kind: PendingRequestKind;
  requestId: string;
  openedAt: string;
  remindersSent: number;
}

export type TaskState = "active" | "completed" | "failed";

export interface TaskRecord {
  taskId: string;
  state: TaskState;
  startedAt: string;
  endedAt?: string;
}

export interface SessionRecord {
  adapterId: string;
  sessionId: string;
  agentName: string;
  state: SessionState;
  stateConfidence: SessionStateConfidence;
  /** Event-time of the last accepted event (occurredAt when trustworthy). */
  lastEventAt: string;
  /** Receiver-time at which the last accepted event was applied. */
  lastSeenAt: string;
  /** Receiver-time of the last authoritative event, if one was ever seen. */
  lastVerifiedAt: string | undefined;
  pendingRequests: PendingRequest[];
  tasks: TaskRecord[];
  isSubagent: boolean;
  parentSessionId?: string;
  projectName?: string;
  workingDirectory?: string;
  lastAcceptedSequence?: number;
}
