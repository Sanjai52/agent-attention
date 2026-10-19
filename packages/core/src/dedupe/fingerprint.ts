/**
 * Deduplication fingerprints (PRD.md §14.4).
 *
 * A fingerprint is a deterministic SHA-256 over a pipe-delimited identity.
 * Selection is ordered exactly as the PRD specifies:
 *
 * 1. source-stable `eventId`;
 * 2. adapter-supplied `dedupeKey`;
 * 3. a composite of session identity, event type, optional task/request
 *    identity, and a fixed time bucket.
 *
 * Only rule 3 is time-windowed. Because a bucket boundary can split two
 * deliveries of the same source event, rule 3 also returns the previous
 * bucket as `adjacent`; the caller must check the primary fingerprint and,
 * when present, the adjacent one.
 *
 * Pure computation: `node:crypto` hashing only, no I/O and no timers.
 */

import { createHash } from "node:crypto";
import type { AgentEvent } from "@agent-attention/contract";

export interface EventFingerprints {
  /** Fingerprint claimed first for the event. */
  primary: string;
  /** Previous-bucket fingerprint used to catch boundary-split duplicates. */
  adjacent?: string;
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Fixed delimiters; absent optional fields are encoded as empty strings. */
function encode(parts: readonly string[]): string {
  return parts.join("|");
}

/**
 * Compute the deduplication fingerprints for an event.
 *
 * Returns `null` when the event must not be fingerprinted: `agent.progress`
 * events, composite events with an unparseable `occurredAt`, or an unusable
 * fallback window. Returning `null` (rather than throwing or producing a
 * `NaN` bucket) keeps malformed input from blocking ingestion and prevents
 * unrelated malformed events from collapsing into one fingerprint.
 */
export function computeFingerprints(
  event: AgentEvent,
  fallbackWindowSeconds: number,
): EventFingerprints | null {
  // PRD §14.4: progress events are never fingerprinted or stored.
  if (event.eventType === "agent.progress") {
    return null;
  }

  const { adapterId } = event.source;
  const { sessionId } = event.session;

  if (event.eventIdStability === "source") {
    return { primary: sha256(encode([adapterId, sessionId, event.eventId])) };
  }

  if (event.dedupeKey !== undefined) {
    return { primary: sha256(encode([adapterId, sessionId, event.dedupeKey])) };
  }

  if (!Number.isFinite(fallbackWindowSeconds) || fallbackWindowSeconds <= 0) {
    return null;
  }

  const occurredAtMs = Date.parse(event.occurredAt);
  if (Number.isNaN(occurredAtMs)) {
    return null;
  }

  const bucket = Math.floor(occurredAtMs / (fallbackWindowSeconds * 1000));
  const identity = [
    adapterId,
    sessionId,
    event.session.taskId ?? "",
    event.eventType,
    event.details?.requestId ?? "",
  ];

  return {
    primary: sha256(encode([...identity, String(bucket)])),
    adjacent: sha256(encode([...identity, String(bucket - 1)])),
  };
}
