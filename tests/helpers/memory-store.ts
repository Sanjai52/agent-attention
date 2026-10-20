/**
 * In-memory `PipelineStore` for core tests (Task 1.16).
 *
 * The store is deliberately observable: `calls` records the order of store
 * operations so tests can prove that persistence precedes dispatch planning.
 */

import type { AgentEvent, ValidationIssue } from "@agent-attention/contract";
import type {
  PipelineDiagnostic,
  PipelineStore,
  SessionRecord,
} from "@agent-attention/core";

export interface RecordedEvent {
  event: AgentEvent;
  meta: { fingerprint: string; late: boolean; duplicate: boolean };
}

export interface MemoryPipelineStoreOptions {
  onRecordEvent?: (event: AgentEvent) => void;
  onSaveSession?: (session: SessionRecord) => void;
  onClaimFingerprint?: (fingerprint: string) => void;
}

function sessionKey(adapterId: string, sessionId: string): string {
  return `${adapterId}\u0000${sessionId}`;
}

export class MemoryPipelineStore implements PipelineStore {
  readonly events: RecordedEvent[] = [];
  readonly sessions = new Map<string, SessionRecord>();
  readonly diagnostics: Array<ValidationIssue | PipelineDiagnostic> = [];
  readonly claims = new Map<string, string>();
  readonly duplicateCounts = new Map<string, number>();
  readonly calls: string[] = [];

  onRecordEvent?: (event: AgentEvent) => void;
  onSaveSession?: (session: SessionRecord) => void;
  onClaimFingerprint?: (fingerprint: string) => void;

  constructor(options: MemoryPipelineStoreOptions = {}) {
    this.onRecordEvent = options.onRecordEvent;
    this.onSaveSession = options.onSaveSession;
    this.onClaimFingerprint = options.onClaimFingerprint;
  }

  claimFingerprint(
    fingerprint: string,
    eventId: string,
    _now: string,
  ): { claimed: boolean; duplicateCount?: number } {
    this.calls.push("claimFingerprint");
    this.onClaimFingerprint?.(fingerprint);

    if (this.claims.has(fingerprint)) {
      const duplicateCount = (this.duplicateCounts.get(fingerprint) ?? 0) + 1;
      this.duplicateCounts.set(fingerprint, duplicateCount);
      return { claimed: false, duplicateCount };
    }

    this.claims.set(fingerprint, eventId);
    return { claimed: true };
  }

  recordEvent(
    event: AgentEvent,
    meta: { fingerprint: string; late: boolean; duplicate: boolean },
  ): void {
    this.calls.push("recordEvent");
    this.events.push({ event, meta });
    this.onRecordEvent?.(event);
  }

  loadSession(adapterId: string, sessionId: string): SessionRecord | undefined {
    this.calls.push("loadSession");
    return this.sessions.get(sessionKey(adapterId, sessionId));
  }

  saveSession(session: SessionRecord): void {
    this.calls.push("saveSession");
    this.sessions.set(sessionKey(session.adapterId, session.sessionId), session);
    this.onSaveSession?.(session);
  }

  recordDiagnostic(issue: ValidationIssue | PipelineDiagnostic): void {
    this.calls.push("recordDiagnostic");
    this.diagnostics.push(issue);
  }
}
