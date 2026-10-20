import { createHash } from "node:crypto";
import type { AgentEvent } from "@agent-attention/contract";
import { describe, expect, it } from "vitest";
import { computeFingerprints } from "@agent-attention/core";
import { makeEvent } from "./event-factory";

const WINDOW_SECONDS = 30;
const OCCURRED_AT = "2026-10-20T10:00:00Z";
const BUCKET = Math.floor(Date.parse(OCCURRED_AT) / (WINDOW_SECONDS * 1000));

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function fingerprintsFor(event: AgentEvent, fallbackWindowSeconds = WINDOW_SECONDS) {
  const fingerprints = computeFingerprints(event, fallbackWindowSeconds);
  if (fingerprints === null) {
    throw new Error("expected a fingerprint");
  }
  return fingerprints;
}

function syntheticEvent(overrides: Parameters<typeof makeEvent>[0]): AgentEvent {
  return makeEvent({ eventIdStability: "synthetic", ...overrides });
}

describe("computeFingerprints — rule selection (PRD §14.4)", () => {
  it("uses the source-stable event ID first, even when a dedupeKey is present", () => {
    const event = makeEvent({
      eventType: "agent.needs_input",
      eventId: "source-event-7",
      dedupeKey: "ignored-adapter-key",
      details: { requestId: "req-1" },
    });

    expect(computeFingerprints(event, WINDOW_SECONDS)).toEqual({
      primary: sha256("adapter-a|session-1|source-event-7"),
    });
  });

  it("uses the adapter dedupeKey for synthetic events that carry one", () => {
    const event = syntheticEvent({
      eventType: "agent.completed",
      eventId: "synthetic-event-7",
      dedupeKey: "session-1:turn-7",
      occurredAt: OCCURRED_AT,
    });

    expect(computeFingerprints(event, WINDOW_SECONDS)).toEqual({
      primary: sha256("adapter-a|session-1|session-1:turn-7"),
    });
  });

  it("falls back to the composite fingerprint with the current and previous bucket", () => {
    const event = syntheticEvent({
      eventType: "agent.needs_input",
      eventId: "synthetic-event-7",
      occurredAt: OCCURRED_AT,
    });

    expect(computeFingerprints(event, WINDOW_SECONDS)).toEqual({
      primary: sha256(`adapter-a|session-1||agent.needs_input||${BUCKET}`),
      adjacent: sha256(`adapter-a|session-1||agent.needs_input||${BUCKET - 1}`),
    });
  });

  it("derives the bucket from occurredAt, not receivedAt", () => {
    const sameSourceTime = syntheticEvent({
      eventType: "agent.needs_input",
      occurredAt: OCCURRED_AT,
      receivedAt: "2026-10-20T10:00:29Z",
    });
    const defaultReceiptTime = syntheticEvent({
      eventType: "agent.needs_input",
      occurredAt: OCCURRED_AT,
      receivedAt: OCCURRED_AT,
    });

    expect(fingerprintsFor(sameSourceTime)).toEqual(fingerprintsFor(defaultReceiptTime));
  });
});

describe("computeFingerprints — null encoding and request identity (PRD §14.4)", () => {
  it("encodes absent optional fields as empty strings with fixed delimiters", () => {
    const event = syntheticEvent({
      eventType: "agent.needs_input",
      occurredAt: OCCURRED_AT,
    });

    expect(fingerprintsFor(event).primary).toBe(
      sha256(`adapter-a|session-1||agent.needs_input||${BUCKET}`),
    );
  });

  it("includes taskId and requestId in the composite fingerprint", () => {
    const event = syntheticEvent({
      eventType: "agent.needs_approval",
      taskId: "task-9",
      occurredAt: OCCURRED_AT,
      details: { requestId: "req-3" },
    });

    expect(fingerprintsFor(event).primary).toBe(
      sha256(`adapter-a|session-1|task-9|agent.needs_approval|req-3|${BUCKET}`),
    );
  });

  it("produces a new fingerprint whenever requestId changes", () => {
    const base = {
      eventType: "agent.needs_approval",
      occurredAt: OCCURRED_AT,
    } as const;

    const first = syntheticEvent({ ...base, details: { requestId: "req-1" } });
    const second = syntheticEvent({ ...base, details: { requestId: "req-2" } });
    const withoutRequest = syntheticEvent(base);

    expect(fingerprintsFor(first).primary).not.toBe(fingerprintsFor(second).primary);
    expect(fingerprintsFor(first).primary).not.toBe(fingerprintsFor(withoutRequest).primary);
    expect(fingerprintsFor(first).adjacent).not.toBe(fingerprintsFor(second).adjacent);
  });
});

describe("computeFingerprints — adjacent buckets (RF2/RF3)", () => {
  it("detects a duplicate split by a bucket boundary through the adjacent bucket", () => {
    const afterBoundary = syntheticEvent({
      eventType: "agent.needs_input",
      occurredAt: "2026-10-20T10:00:05Z",
    });
    const beforeBoundary = syntheticEvent({
      eventType: "agent.needs_input",
      occurredAt: "2026-10-20T09:59:58Z",
    });

    const after = fingerprintsFor(afterBoundary);
    const before = fingerprintsFor(beforeBoundary);

    expect(after.primary).not.toBe(before.primary);
    expect(after.adjacent).toBe(before.primary);
  });

  it("treats events inside the same bucket as duplicates", () => {
    const startOfBucket = syntheticEvent({
      eventType: "agent.needs_input",
      occurredAt: "2026-10-20T10:00:00Z",
    });
    const endOfBucket = syntheticEvent({
      eventType: "agent.needs_input",
      occurredAt: "2026-10-20T10:00:29Z",
    });

    expect(fingerprintsFor(endOfBucket).primary).toBe(fingerprintsFor(startOfBucket).primary);
    expect(fingerprintsFor(endOfBucket).adjacent).toBe(fingerprintsFor(startOfBucket).adjacent);
  });

  it("does not reach duplicates that are two buckets away", () => {
    const currentBucket = syntheticEvent({
      eventType: "agent.needs_input",
      occurredAt: OCCURRED_AT,
    });
    const twoBucketsBefore = syntheticEvent({
      eventType: "agent.needs_input",
      occurredAt: "2026-10-20T09:59:28Z",
    });

    const current = fingerprintsFor(currentBucket);
    const distant = fingerprintsFor(twoBucketsBefore);

    expect(current.primary).not.toBe(distant.primary);
    expect(current.adjacent).not.toBe(distant.primary);
    expect(distant.primary).not.toBe(current.primary);
  });
});

describe("computeFingerprints — session isolation (F8-R8, AC-F8-05)", () => {
  it("never deduplicates the same event across sessions", () => {
    const compositeA = syntheticEvent({
      eventType: "agent.needs_input",
      occurredAt: OCCURRED_AT,
      sessionId: "session-1",
    });
    const compositeB = syntheticEvent({
      eventType: "agent.needs_input",
      occurredAt: OCCURRED_AT,
      sessionId: "session-2",
    });
    const sourceA = makeEvent({
      eventType: "agent.needs_input",
      eventId: "shared-event-id",
      sessionId: "session-1",
    });
    const sourceB = makeEvent({
      eventType: "agent.needs_input",
      eventId: "shared-event-id",
      sessionId: "session-2",
    });

    expect(fingerprintsFor(compositeA).primary).not.toBe(fingerprintsFor(compositeB).primary);
    expect(fingerprintsFor(compositeA).adjacent).not.toBe(fingerprintsFor(compositeB).adjacent);
    expect(fingerprintsFor(sourceA).primary).not.toBe(fingerprintsFor(sourceB).primary);
  });
});

describe("computeFingerprints — exclusions and malformed input", () => {
  it("returns null for agent.progress before evaluating any rule", () => {
    const sourceProgress = makeEvent({
      eventType: "agent.progress",
      eventId: "source-progress",
    });
    const syntheticProgress = syntheticEvent({
      eventType: "agent.progress",
      dedupeKey: "progress-key",
      occurredAt: OCCURRED_AT,
    });

    expect(computeFingerprints(sourceProgress, WINDOW_SECONDS)).toBeNull();
    expect(computeFingerprints(syntheticProgress, WINDOW_SECONDS)).toBeNull();
  });

  it.each(["not-a-timestamp", "2026-02-30T25:99:99Z", ""])(
    "returns null for unparseable occurredAt %j without throwing",
    (occurredAt) => {
      const event = syntheticEvent({
        eventType: "agent.needs_input",
        occurredAt,
      });

      expect(() => computeFingerprints(event, WINDOW_SECONDS)).not.toThrow();
      expect(computeFingerprints(event, WINDOW_SECONDS)).toBeNull();
    },
  );

  it.each([0, -30, Number.NaN, Number.POSITIVE_INFINITY])(
    "returns null when fallbackWindowSeconds is unusable (%s)",
    (fallbackWindowSeconds) => {
      const event = syntheticEvent({
        eventType: "agent.needs_input",
        occurredAt: OCCURRED_AT,
      });

      expect(computeFingerprints(event, fallbackWindowSeconds)).toBeNull();
    },
  );
});
