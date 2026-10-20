import { describe, expect, it } from "vitest";
import { compareEvents, isLateEvent, isTrustworthyTime } from "@agent-attention/core";
import { makeEvent, makeSession } from "./event-factory";

const SESSION = makeSession({
  lastEventAt: "2026-10-20T10:00:00Z",
  pendingRequests: [
    {
      kind: "approval",
      requestId: "req-approval",
      openedAt: "2026-10-20T09:59:00Z",
      remindersSent: 0,
    },
    {
      kind: "input",
      requestId: "req-input",
      openedAt: "2026-10-20T09:59:00Z",
      remindersSent: 0,
    },
  ],
});

describe("isTrustworthyTime (RF3)", () => {
  it("is true only when occurredAt differs from receivedAt", () => {
    const trustworthy = makeEvent({
      eventType: "agent.progress",
      occurredAt: "2026-10-20T10:00:00Z",
      receivedAt: "2026-10-20T10:00:03Z",
    });
    const untrustworthy = makeEvent({
      eventType: "agent.progress",
      occurredAt: "2026-10-20T10:00:00Z",
      receivedAt: "2026-10-20T10:00:00Z",
    });

    expect(isTrustworthyTime(trustworthy)).toBe(true);
    expect(isTrustworthyTime(untrustworthy)).toBe(false);
  });
});

describe("compareEvents (PRD §13.4)", () => {
  it("orders by sequence even when occurredAt disagrees", () => {
    const earlierSequence = makeEvent({
      eventType: "agent.progress",
      eventId: "event-a",
      sequence: 2,
      occurredAt: "2026-10-20T09:00:00Z",
      receivedAt: "2026-10-20T09:00:01Z",
    });
    const laterSequence = makeEvent({
      eventType: "agent.progress",
      eventId: "event-b",
      sequence: 1,
      occurredAt: "2026-10-20T11:00:00Z",
      receivedAt: "2026-10-20T11:00:01Z",
    });

    expect(compareEvents(earlierSequence, laterSequence)).toBeGreaterThan(0);
    expect(compareEvents(laterSequence, earlierSequence)).toBeLessThan(0);
  });

  it("falls back to trustworthy occurredAt when sequence is missing", () => {
    const earlier = makeEvent({
      eventType: "agent.progress",
      eventId: "event-a",
      occurredAt: "2026-10-20T10:00:00Z",
      receivedAt: "2026-10-20T12:00:00Z",
    });
    const later = makeEvent({
      eventType: "agent.progress",
      eventId: "event-b",
      occurredAt: "2026-10-20T11:00:00Z",
      receivedAt: "2026-10-20T11:00:01Z",
    });

    expect(compareEvents(earlier, later)).toBeLessThan(0);
    expect(compareEvents(later, earlier)).toBeGreaterThan(0);
  });

  it("falls back to receipt order when either timestamp is untrustworthy", () => {
    const untrustworthyButReceivedLater = makeEvent({
      eventType: "agent.progress",
      eventId: "event-a",
      occurredAt: "2026-10-20T12:00:00Z",
      receivedAt: "2026-10-20T12:00:00Z",
    });
    const trustworthyButReceivedEarlier = makeEvent({
      eventType: "agent.progress",
      eventId: "event-b",
      occurredAt: "2026-10-20T10:00:00Z",
      receivedAt: "2026-10-20T11:00:00Z",
    });

    expect(
      compareEvents(trustworthyButReceivedEarlier, untrustworthyButReceivedLater),
    ).toBeLessThan(0);
    expect(
      compareEvents(untrustworthyButReceivedLater, trustworthyButReceivedEarlier),
    ).toBeGreaterThan(0);
  });

  it("uses receipt order when both times are untrustworthy", () => {
    const first = makeEvent({
      eventType: "agent.progress",
      eventId: "event-z",
      occurredAt: "2026-10-20T10:00:00Z",
      receivedAt: "2026-10-20T10:00:00Z",
    });
    const second = makeEvent({
      eventType: "agent.progress",
      eventId: "event-a",
      occurredAt: "2026-10-20T11:00:00Z",
      receivedAt: "2026-10-20T11:00:00Z",
    });

    expect(compareEvents(first, second)).toBeLessThan(0);
  });

  it("breaks equal sequence and receipt ties by eventId deterministically", () => {
    const a = makeEvent({
      eventType: "agent.progress",
      eventId: "event-a",
      sequence: 5,
      occurredAt: "2026-10-20T10:00:00Z",
      receivedAt: "2026-10-20T10:00:00Z",
    });
    const b = makeEvent({
      eventType: "agent.progress",
      eventId: "event-b",
      sequence: 5,
      occurredAt: "2026-10-20T10:00:00Z",
      receivedAt: "2026-10-20T10:00:00Z",
    });

    expect(compareEvents(a, b)).toBeLessThan(0);
    expect(compareEvents(b, a)).toBeGreaterThan(0);
    expect(compareEvents(a, a)).toBe(0);
    expect([b, a].sort(compareEvents).map((event) => event.eventId)).toEqual([
      "event-a",
      "event-b",
    ]);
  });
});

describe("isLateEvent (PRD §13.4, RF2)", () => {
  it("flags an event with an older sequence as late", () => {
    const lastAccepted = makeEvent({
      eventType: "agent.progress",
      eventId: "event-10",
      sequence: 10,
    });
    const candidate = makeEvent({
      eventType: "agent.progress",
      eventId: "event-9",
      sequence: 9,
    });

    expect(isLateEvent(candidate, lastAccepted, SESSION)).toBe(true);
    expect(isLateEvent(lastAccepted, candidate, SESSION)).toBe(false);
  });

  it("prefers sequence over a newer timestamp", () => {
    const lastAccepted = makeEvent({
      eventType: "agent.progress",
      eventId: "event-10",
      sequence: 10,
      occurredAt: "2026-10-20T09:00:00Z",
      receivedAt: "2026-10-20T09:00:01Z",
    });
    const candidate = makeEvent({
      eventType: "agent.progress",
      eventId: "event-9",
      sequence: 9,
      occurredAt: "2026-10-20T12:00:00Z",
      receivedAt: "2026-10-20T12:00:01Z",
    });

    expect(isLateEvent(candidate, lastAccepted, SESSION)).toBe(true);
  });

  it("flags an older trustworthy occurredAt when sequence is missing", () => {
    const lastAccepted = makeEvent({
      eventType: "agent.progress",
      eventId: "event-10",
      occurredAt: "2026-10-20T10:00:00Z",
      receivedAt: "2026-10-20T10:00:01Z",
    });
    const candidate = makeEvent({
      eventType: "agent.progress",
      eventId: "event-9",
      occurredAt: "2026-10-20T09:00:00Z",
      receivedAt: "2026-10-20T09:00:01Z",
    });

    expect(isLateEvent(candidate, lastAccepted, SESSION)).toBe(true);
  });

  it("does not flag a duplicate of the last accepted event", () => {
    const lastAccepted = makeEvent({
      eventType: "agent.progress",
      eventId: "event-10",
      sequence: 10,
    });

    expect(isLateEvent(lastAccepted, lastAccepted, SESSION)).toBe(false);
  });

  it("does not compare events from different sessions", () => {
    const otherSession = makeEvent({
      eventType: "agent.progress",
      eventId: "event-1",
      sessionId: "session-2",
      sequence: 1,
    });
    const lastAccepted = makeEvent({
      eventType: "agent.progress",
      eventId: "event-10",
      sessionId: "session-1",
      sequence: 10,
    });

    expect(isLateEvent(otherSession, lastAccepted, SESSION)).toBe(false);
  });

  it("falls back to the session lastEventAt when no accepted event is supplied", () => {
    const older = makeEvent({
      eventType: "agent.progress",
      eventId: "event-old",
      occurredAt: "2026-10-20T09:00:00Z",
      receivedAt: "2026-10-20T09:00:01Z",
    });
    const newer = makeEvent({
      eventType: "agent.progress",
      eventId: "event-new",
      occurredAt: "2026-10-20T11:00:00Z",
      receivedAt: "2026-10-20T11:00:01Z",
    });

    expect(isLateEvent(older, undefined, SESSION)).toBe(true);
    expect(isLateEvent(newer, undefined, SESSION)).toBe(false);
  });

  it("never flags a late approval_resolved that closes an open request", () => {
    const lastAccepted = makeEvent({
      eventType: "agent.progress",
      eventId: "event-10",
      sequence: 10,
    });
    const closing = makeEvent({
      eventType: "agent.approval_resolved",
      eventId: "event-9",
      sequence: 9,
      details: { requestId: "req-approval", resolution: "approved" },
    });

    expect(isLateEvent(closing, lastAccepted, SESSION)).toBe(false);
  });

  it("never flags a late resumed that closes an open request", () => {
    const lastAccepted = makeEvent({
      eventType: "agent.progress",
      eventId: "event-10",
      sequence: 10,
    });
    const closing = makeEvent({
      eventType: "agent.resumed",
      eventId: "event-9",
      sequence: 9,
      details: { requestId: "req-input", resumeReason: "input_provided" },
    });

    expect(isLateEvent(closing, lastAccepted, SESSION)).toBe(false);
  });

  it("still flags a resolution whose requestId is not open", () => {
    const lastAccepted = makeEvent({
      eventType: "agent.progress",
      eventId: "event-10",
      sequence: 10,
    });
    const unrelated = makeEvent({
      eventType: "agent.approval_resolved",
      eventId: "event-9",
      sequence: 9,
      details: { requestId: "req-other", resolution: "approved" },
    });

    expect(isLateEvent(unrelated, lastAccepted, SESSION)).toBe(true);
  });

  it("flags a resolution when the session has no open requests", () => {
    const closedSession = { lastEventAt: SESSION.lastEventAt, pendingRequests: [] };
    const lastAccepted = makeEvent({
      eventType: "agent.progress",
      eventId: "event-10",
      sequence: 10,
    });
    const closing = makeEvent({
      eventType: "agent.approval_resolved",
      eventId: "event-9",
      sequence: 9,
      details: { requestId: "req-approval", resolution: "approved" },
    });

    expect(isLateEvent(closing, lastAccepted, closedSession)).toBe(true);
  });
});
