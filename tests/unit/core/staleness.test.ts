import type { PendingRequest, SessionState } from "@agent-attention/core";
import { evaluateStaleness, reconcileAfterHostRestart } from "@agent-attention/core";
import { describe, expect, it } from "vitest";
import { makeSession } from "./event-factory";

const NOW = "2026-10-20T12:00:00.000Z";

const CONFIG = { workingAfterMinutes: 15, waitingAfterHours: 12 };

function request(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    kind: "approval",
    requestId: "request-1",
    openedAt: "2026-10-20T09:00:00.000Z",
    remindersSent: 0,
    ...overrides,
  };
}

describe("evaluateStaleness", () => {
  it("marks a silent working session unknown with unverified confidence (AC-F7-04)", () => {
    const session = makeSession({
      state: "working",
      lastSeenAt: "2026-10-20T11:44:00.000Z",
    });

    expect(evaluateStaleness(session, NOW, CONFIG)).toEqual({
      state: "unknown",
      stateConfidence: "unverified",
      closedRequests: [],
    });
  });

  it("leaves a working session alone before the window elapses", () => {
    const session = makeSession({
      state: "working",
      lastSeenAt: "2026-10-20T11:45:00.001Z",
    });

    expect(evaluateStaleness(session, NOW, CONFIG)).toBeUndefined();
  });

  it("treats the window boundary as stale", () => {
    const session = makeSession({
      state: "working",
      lastSeenAt: "2026-10-20T11:45:00.000Z",
    });

    expect(evaluateStaleness(session, NOW, CONFIG)).toMatchObject({
      state: "unknown",
      stateConfidence: "unverified",
    });
  });

  it("counts lastSeenAt progress heartbeats as activity", () => {
    const session = makeSession({
      state: "working",
      lastEventAt: "2026-10-20T10:00:00.000Z",
      lastSeenAt: "2026-10-20T11:55:00.000Z",
      lastVerifiedAt: "2026-10-20T10:00:00.000Z",
    });

    expect(evaluateStaleness(session, NOW, CONFIG)).toBeUndefined();
  });

  it("counts a later lastVerifiedAt as activity", () => {
    const session = makeSession({
      state: "working",
      lastEventAt: "2026-10-20T11:00:00.000Z",
      lastSeenAt: "2026-10-20T11:00:00.000Z",
      lastVerifiedAt: "2026-10-20T11:55:00.000Z",
    });

    expect(evaluateStaleness(session, NOW, CONFIG)).toBeUndefined();
  });

  it("keeps a waiting session younger than the waiting window", () => {
    const session = makeSession({
      state: "waiting_for_input",
      lastSeenAt: "2026-10-20T01:00:00.000Z",
      pendingRequests: [request({ kind: "input" })],
    });

    expect(evaluateStaleness(session, NOW, CONFIG)).toBeUndefined();
  });

  it("marks a waiting session past the waiting window unknown and closes its requests", () => {
    const pending = request({ requestId: "approval-1" });
    const session = makeSession({
      state: "waiting_for_approval",
      lastEventAt: "2026-10-19T23:59:00.000Z",
      lastSeenAt: "2026-10-19T23:59:00.000Z",
      lastVerifiedAt: "2026-10-19T23:59:00.000Z",
      pendingRequests: [pending],
    });

    const result = evaluateStaleness(session, NOW, CONFIG);

    expect(result).toEqual({
      state: "unknown",
      stateConfidence: "unverified",
      closedRequests: [pending],
    });
    expect(result?.closedRequests[0]).not.toBe(pending);
  });

  it("applies the waiting window to idle sessions", () => {
    const stale = makeSession({
      state: "idle",
      lastEventAt: "2026-10-19T23:00:00.000Z",
      lastSeenAt: "2026-10-19T23:00:00.000Z",
      lastVerifiedAt: "2026-10-19T23:00:00.000Z",
    });
    const fresh = makeSession({
      state: "idle",
      lastEventAt: "2026-10-20T01:00:00.000Z",
      lastSeenAt: "2026-10-20T01:00:00.000Z",
      lastVerifiedAt: "2026-10-20T01:00:00.000Z",
    });

    expect(evaluateStaleness(stale, NOW, CONFIG)).toMatchObject({
      state: "unknown",
      stateConfidence: "unverified",
      closedRequests: [],
    });
    expect(evaluateStaleness(fresh, NOW, CONFIG)).toBeUndefined();
  });

  it.each<SessionState>(["completed", "failed", "ended"])(
    "never marks a terminal %s session stale",
    (state) => {
      const session = makeSession({
        state,
        lastSeenAt: "2020-01-01T00:00:00.000Z",
        pendingRequests: [request()],
      });

      expect(evaluateStaleness(session, NOW, CONFIG)).toBeUndefined();
    },
  );

  it("leaves an already unknown session alone", () => {
    const session = makeSession({
      state: "unknown",
      stateConfidence: "unverified",
      lastSeenAt: "2020-01-01T00:00:00.000Z",
    });

    expect(evaluateStaleness(session, NOW, CONFIG)).toBeUndefined();
  });

  it("does not mutate the session", () => {
    const pending = request();
    const session = makeSession({
      state: "waiting_for_input",
      lastEventAt: "2020-01-01T00:00:00.000Z",
      lastSeenAt: "2020-01-01T00:00:00.000Z",
      lastVerifiedAt: "2020-01-01T00:00:00.000Z",
      pendingRequests: [pending],
    });
    const before = {
      ...session,
      pendingRequests: session.pendingRequests.map((entry) => ({ ...entry })),
    };

    evaluateStaleness(session, NOW, CONFIG);

    expect(session).toEqual(before);
    expect(session.pendingRequests[0]).toBe(pending);
  });

  it("fails safe when activity timestamps cannot be parsed", () => {
    const session = makeSession({
      state: "working",
      lastEventAt: "not-a-time",
      lastSeenAt: "not-a-time",
      lastVerifiedAt: undefined,
    });

    expect(evaluateStaleness(session, NOW, CONFIG)).toMatchObject({
      state: "unknown",
      stateConfidence: "unverified",
    });
  });

  it("returns undefined when now cannot be parsed", () => {
    const session = makeSession({
      state: "waiting_for_input",
      lastSeenAt: "2020-01-01T00:00:00.000Z",
    });

    expect(evaluateStaleness(session, "not-a-time", CONFIG)).toBeUndefined();
  });
});

describe("reconcileAfterHostRestart", () => {
  it("demotes a working session to unknown/unverified regardless of recency (PRD §13.4)", () => {
    const session = makeSession({
      state: "working",
      stateConfidence: "authoritative",
      lastSeenAt: "2026-10-20T11:59:59.000Z",
    });

    const reconciled = reconcileAfterHostRestart(session, NOW);

    expect(reconciled.state).toBe("unknown");
    expect(reconciled.stateConfidence).toBe("unverified");
    expect(session.state).toBe("working");
    expect(reconciled).not.toBe(session);
  });

  it.each<SessionState>(["waiting_for_input", "waiting_for_approval", "idle"])(
    "leaves %s for the normal staleness rules",
    (state) => {
      const session = makeSession({ state, stateConfidence: "authoritative" });
      const reconciled = reconcileAfterHostRestart(session, NOW);

      expect(reconciled.state).toBe(state);
      expect(reconciled.stateConfidence).toBe("authoritative");
      expect(reconciled).not.toBe(session);
    },
  );

  it.each<SessionState>(["completed", "failed", "ended", "unknown"])(
    "never touches the %s state",
    (state) => {
      const session = makeSession({ state, stateConfidence: "authoritative" });
      const reconciled = reconcileAfterHostRestart(session, NOW);

      expect(reconciled.state).toBe(state);
      expect(reconciled.stateConfidence).toBe("authoritative");
    },
  );

  it("returns a new record with cloned arrays", () => {
    const pending = request();
    const session = makeSession({
      state: "waiting_for_input",
      pendingRequests: [pending],
      tasks: [{ taskId: "task-1", state: "active", startedAt: "2026-10-20T10:00:00.000Z" }],
    });

    const reconciled = reconcileAfterHostRestart(session, NOW);

    expect(reconciled.pendingRequests).toEqual(session.pendingRequests);
    expect(reconciled.pendingRequests).not.toBe(session.pendingRequests);
    expect(reconciled.pendingRequests[0]).not.toBe(pending);
    expect(reconciled.tasks).not.toBe(session.tasks);
  });
});
