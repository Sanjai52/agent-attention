/**
 * Event-processing pipeline contracts (PRD.md §14.2).
 *
 * The pipeline is the composition point for the pure core: validation,
 * dedupe, ordering, state transitions, policy, suppressors, and planning. It
 * owns no I/O and executes no timers; storage, time, and rate limiting are
 * injected so Phase 2 can wire persistence and providers without changing the
 * core logic.
 */

import type {
  AdapterCapabilities,
  AgentAttentionConfig,
  AgentEvent,
  AgentEventType,
  ValidationIssue,
} from "@agent-attention/contract";
import type { RollingRateLimiter } from "../attention/rate-limit";
import type { EventFingerprints } from "../dedupe/fingerprint";
import type { RenderedNotification } from "../presentation/templates";
import type { SessionRecord } from "../state/session";

export type Channel = "sound" | "voice" | "desktop";

export type SuppressionReason =
  | "muted"
  | "quiet_hours"
  | "focused"
  | "rate_limit"
  | "coalesced"
  | "grace_superseded"
  | "below_min_turn"
  | "subagent"
  | "disabled";

export interface PlannedChannel {
  channel: Channel;
  decision: "dispatch" | "suppress";
  reason?: SuppressionReason;
}

export interface PlannedNotification {
  eventId: string;
  eventType: AgentEventType;
  priority: number;
  channels: PlannedChannel[];
  rendered?: RenderedNotification;
}

export type TimerKind = "grace" | "stale" | "reminder";

export interface TimerInstruction {
  kind: TimerKind;
  dueAt: string;
  sessionKey: string;
  requestId?: string;
}

export type PipelineDiagnosticCode =
  | "validation"
  | "capability_violation"
  | "state_conflict"
  | "internal";

export interface PipelineDiagnostic {
  code: PipelineDiagnosticCode;
  message: string;
  sessionKey?: string;
}

export interface PipelineStore {
  /**
   * Atomically claim a fingerprint. A single store call owns the dedupe
   * decision so a duplicate can never mutate session state (PRD §14.2 step 2).
   */
  claimFingerprint(
    fingerprint: string,
    eventId: string,
    now: string,
  ): { claimed: boolean; duplicateCount?: number };
  /**
   * Optional crash-atomic path: claim the primary and adjacent fingerprints and
   * insert the event row in one transaction. The pipeline uses this when the
   * store provides it, after reading the session to determine lateness.
   */
  claimEvent?(
    event: AgentEvent,
    fingerprints: EventFingerprints,
    meta: { late: boolean },
    now: string,
  ): { claimed: boolean; duplicateCount?: number };
  recordEvent(
    event: AgentEvent,
    meta: { fingerprint: string; late: boolean; duplicate: boolean },
  ): void;
  loadSession(adapterId: string, sessionId: string): SessionRecord | undefined;
  saveSession(session: SessionRecord): void;
  recordDiagnostic(issue: ValidationIssue | PipelineDiagnostic): void;
}

export interface Clock {
  now(): string;
  nowMs(): number;
}

/**
 * Pending turn-end alerts awaiting their grace window (AC-F10-02).
 *
 * The map is host-owned state passed in by Phase 2. When a classified event
 * arrives before `dueAt`, the pipeline removes the entry and the host drops
 * the previously planned turn-end alert. Keeping this explicit keeps the core
 * deterministic and avoids hidden module state.
 */
export interface GraceState {
  pending: Map<string, { eventId: string; dueAt: string }>;
  graceMs: number;
}

export interface PipelineDependencies {
  store: PipelineStore;
  config: AgentAttentionConfig;
  capabilities?: AdapterCapabilities;
  clock: Clock;
  rateLimiter: RollingRateLimiter;
  /** Local wall-clock minutes (0–1439) at the supplied instant. */
  quietHoursMinutes(now: string): number;
  /** Host-formatted local time label used by templates. */
  formatTimeLabel?: (iso: string) => string;
  grace?: GraceState;
}

export type ProcessingStatus = "processed" | "duplicate" | "late" | "rejected";

export interface ProcessingResult {
  status: ProcessingStatus;
  planned: PlannedNotification[];
  timers: TimerInstruction[];
  diagnostics: PipelineDiagnostic[];
  session?: SessionRecord;
}
