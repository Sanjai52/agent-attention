/**
 * Pure event ordering and lateness rules (PRD.md §13.4).
 *
 * Ordering is scoped to one `(adapterId, sessionId)` stream: sequence first,
 * then trustworthy source time, then receipt order, with a deterministic
 * `eventId` tiebreak.
 */

import type { AgentEvent } from "@agent-attention/contract";
import type { SessionRecord } from "./state/session";

/** Source time is only trustworthy when the adapter did not copy receipt time. */
export function isTrustworthyTime(event: AgentEvent): boolean {
  return event.occurredAt !== event.receivedAt;
}

function eventTimeMs(event: AgentEvent): number {
  return Date.parse(isTrustworthyTime(event) ? event.occurredAt : event.receivedAt);
}

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Total, deterministic order for events. Negative means `a` precedes `b`.
 *
 * 1. `sequence` when both events carry one.
 * 2. Trustworthy `occurredAt` when both events carry trustworthy times.
 * 3. Receipt order.
 * 4. `eventId` as the final deterministic tiebreak.
 */
export function compareEvents(a: AgentEvent, b: AgentEvent): number {
  if (a.sequence !== undefined && b.sequence !== undefined) {
    const bySequence = a.sequence - b.sequence;
    if (bySequence !== 0) {
      return bySequence;
    }
  }

  if (isTrustworthyTime(a) && isTrustworthyTime(b)) {
    const byOccurredAt = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    if (byOccurredAt !== 0) {
      return byOccurredAt;
    }
  }

  const byReceipt = Date.parse(a.receivedAt) - Date.parse(b.receivedAt);
  if (byReceipt !== 0) {
    return byReceipt;
  }

  return compareStrings(a.eventId, b.eventId);
}

function closesOpenRequest(
  event: AgentEvent,
  session: Pick<SessionRecord, "pendingRequests">,
): boolean {
  if (event.eventType !== "agent.approval_resolved" && event.eventType !== "agent.resumed") {
    return false;
  }

  const requestId = event.details?.requestId;
  return (
    requestId !== undefined &&
    session.pendingRequests.some((request) => request.requestId === requestId)
  );
}

/**
 * True when `candidate` is older than the last accepted state-changing event.
 *
 * Resolution events for a still-open request are never late: they must always
 * be allowed to close their request (PRD §13.4).
 */
export function isLateEvent(
  candidate: AgentEvent,
  lastAccepted: AgentEvent | undefined,
  session: Pick<SessionRecord, "lastEventAt" | "pendingRequests">,
): boolean {
  if (closesOpenRequest(candidate, session)) {
    return false;
  }

  if (lastAccepted !== undefined) {
    if (
      lastAccepted.source.adapterId !== candidate.source.adapterId ||
      lastAccepted.session.sessionId !== candidate.session.sessionId
    ) {
      return false;
    }

    return compareEvents(candidate, lastAccepted) < 0;
  }

  const lastEventAtMs = Date.parse(session.lastEventAt);
  if (Number.isNaN(lastEventAtMs)) {
    return false;
  }

  return eventTimeMs(candidate) < lastEventAtMs;
}
