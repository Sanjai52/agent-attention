import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@agent-attention/contract";
import { applyEvent, type PendingRequest, type SessionState } from "@agent-attention/core";
import { makeEvent, makeSession, type EventOverrides } from "./event-factory";

const NOW = "2026-10-20T10:00:05Z";
const LATER = "2026-10-20T10:05:00Z";

function event(overrides: EventOverrides): AgentEvent {
  return makeEvent(overrides);
}

function openRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    kind: "input",
    requestId: "req-1",
    openedAt: "2026-10-20T09:59:00Z",
    remindersSent: 0,
    ...overrides,
  };
}

describe("applyEvent — creation and terminal states (§13.2)", () => {
  it("creates a session as working on started", () => {
    const started = event({
      eventType: "agent.started",
      eventId: "event-start",
      sequence: 1,
      projectName: "project-a",
      workingDirectory: "/repo",
    });

    const result = applyEvent(undefined, started, NOW);

    expect(result.stateChanged).toBe(true);
    expect(result.session).toMatchObject({
      adapterId: "adapter-a",
      sessionId: "session-1",
      agentName: "Agent A",
      state: "working",
      stateConfidence: "authoritative",
      lastEventAt: started.receivedAt,
      lastSeenAt: NOW,
      lastVerifiedAt: NOW,
      pendingRequests: [],
      tasks: [],
      isSubagent: false,
      projectName: "project-a",
      workingDirectory: "/repo",
      lastAcceptedSequence: 1,
    });
    expect(result.session.parentSessionId).toBeUndefined();
    expect(result.openedRequest).toBeUndefined();
    expect(result.closedRequest).toBeUndefined();
  });

  it("revives terminal and unknown sessions on started", () => {
    for (const state of ["completed", "failed", "ended", "unknown"] as SessionState[]) {
      const session = makeSession({ state });
      const result = applyEvent(session, event({ eventType: "agent.started", sequence: 2 }), LATER);

      expect(result.session.state, state).toBe("working");
      expect(result.session.stateConfidence, state).toBe("authoritative");
      expect(result.stateChanged, state).toBe(true);
      expect(result.session.lastSeenAt, state).toBe(LATER);
      expect(result.session.lastVerifiedAt, state).toBe(LATER);
    }
  });

  it("keeps working→working on started without claiming a state change", () => {
    const result = applyEvent(
      makeSession(),
      event({ eventType: "agent.started", sequence: 2 }),
      NOW,
    );

    expect(result.session.state).toBe("working");
    expect(result.stateChanged).toBe(false);
    expect(result.session.lastSeenAt).toBe(NOW);
  });

  it("marks an unseen late-joined session as inferred", () => {
    const result = applyEvent(undefined, event({ eventType: "agent.progress", sequence: 1 }), NOW);

    expect(result.session.state).toBe("working");
    expect(result.session.stateConfidence).toBe("inferred");
    expect(result.session.lastVerifiedAt).toBeUndefined();
    expect(result.stateChanged).toBe(true);
  });

  it("derives state per event for an unseen late-joined session", () => {
    const cases: Array<[EventOverrides, SessionState]> = [
      [{ eventType: "agent.needs_input", details: { requestId: "req-1" } }, "waiting_for_input"],
      [
        { eventType: "agent.needs_approval", details: { requestId: "req-2" } },
        "waiting_for_approval",
      ],
      [{ eventType: "agent.turn_ended" }, "idle"],
      [{ eventType: "agent.completed", details: { completionScope: "session" } }, "completed"],
      [{ eventType: "agent.failed", details: { failureCode: "host_error" } }, "failed"],
      [{ eventType: "agent.session_ended" }, "ended"],
      [{ eventType: "agent.state_unknown" }, "unknown"],
    ];

    for (const [overrides, expected] of cases) {
      const result = applyEvent(undefined, event(overrides), NOW);
      expect(result.session.state, overrides.eventType).toBe(expected);
      expect(result.session.stateConfidence, overrides.eventType).toBe(
        expected === "unknown" ? "unverified" : "inferred",
      );
      expect(result.session.lastVerifiedAt, overrides.eventType).toBeUndefined();
    }
  });

  it("completes a working session on session-scope completion", () => {
    const result = applyEvent(
      makeSession(),
      event({
        eventType: "agent.completed",
        details: { completionScope: "session" },
      }),
      NOW,
    );

    expect(result.session.state).toBe("completed");
    expect(result.completionScope).toBe("session");
    expect(result.stateChanged).toBe(true);
  });

  it("fails a working session on failed", () => {
    const result = applyEvent(
      makeSession(),
      event({ eventType: "agent.failed", details: { failureCode: "timeout" } }),
      NOW,
    );

    expect(result.session.state).toBe("failed");
    expect(result.stateChanged).toBe(true);
  });

  it("never produces completed from turn_ended (AC-F10-04)", () => {
    const result = applyEvent(
      makeSession(),
      event({ eventType: "agent.turn_ended", confidence: "inferred" }),
      NOW,
    );

    expect(result.session.state).toBe("idle");
    expect(result.session.state).not.toBe("completed");
    expect(result.session.stateConfidence).toBe("inferred");
    expect(result.stateChanged).toBe(true);
  });

  it("keeps idle stable on turn_ended", () => {
    const result = applyEvent(
      makeSession({ state: "idle", stateConfidence: "inferred" }),
      event({ eventType: "agent.turn_ended", confidence: "inferred" }),
      NOW,
    );

    expect(result.session.state).toBe("idle");
    expect(result.stateChanged).toBe(false);
  });

  it("ends any session on session_ended and closes its requests", () => {
    const session = makeSession({
      state: "waiting_for_input",
      pendingRequests: [openRequest()],
    });
    const result = applyEvent(session, event({ eventType: "agent.session_ended" }), NOW);

    expect(result.session.state).toBe("ended");
    expect(result.session.pendingRequests).toEqual([]);
    expect(result.closedRequest?.requestId).toBe("req-1");
    expect(result.stateChanged).toBe(true);
  });

  it("ends a completed session on session_ended", () => {
    const result = applyEvent(
      makeSession({ state: "completed" }),
      event({ eventType: "agent.session_ended" }),
      NOW,
    );

    expect(result.session.state).toBe("ended");
    expect(result.stateChanged).toBe(true);
  });

  it("maps state_unknown to unknown/unverified and closes requests", () => {
    const session = makeSession({
      state: "waiting_for_approval",
      pendingRequests: [openRequest({ kind: "approval" })],
    });
    const result = applyEvent(session, event({ eventType: "agent.state_unknown" }), NOW);

    expect(result.session.state).toBe("unknown");
    expect(result.session.stateConfidence).toBe("unverified");
    expect(result.session.pendingRequests).toEqual([]);
    expect(result.session.lastVerifiedAt).toBe(session.lastVerifiedAt);
    expect(result.stateChanged).toBe(true);
  });
});

describe("applyEvent — pending requests (§13.2)", () => {
  it("opens an input request on needs_input", () => {
    const needsInput = event({
      eventType: "agent.needs_input",
      details: { requestId: "req-1", summaryCode: "INPUT_REQUIRED" },
    });

    const result = applyEvent(makeSession(), needsInput, NOW);

    expect(result.session.state).toBe("waiting_for_input");
    expect(result.session.pendingRequests).toEqual([
      { kind: "input", requestId: "req-1", openedAt: NOW, remindersSent: 0 },
    ]);
    expect(result.openedRequest).toEqual(result.session.pendingRequests[0]);
    expect(result.stateChanged).toBe(true);
  });

  it("opens an approval request on needs_approval", () => {
    const result = applyEvent(
      makeSession(),
      event({
        eventType: "agent.needs_approval",
        details: { requestId: "req-2", summaryCode: "APPROVAL_REQUIRED" },
      }),
      NOW,
    );

    expect(result.session.state).toBe("waiting_for_approval");
    expect(result.session.pendingRequests).toHaveLength(1);
    expect(result.session.pendingRequests[0]?.kind).toBe("approval");
    expect(result.openedRequest?.requestId).toBe("req-2");
  });

  it("does not open the same request twice", () => {
    const session = makeSession({
      state: "waiting_for_input",
      pendingRequests: [openRequest()],
    });

    const result = applyEvent(
      session,
      event({ eventType: "agent.needs_input", details: { requestId: "req-1" } }),
      NOW,
    );

    expect(result.session.pendingRequests).toHaveLength(1);
    expect(result.openedRequest).toBeUndefined();
    expect(result.stateChanged).toBe(false);
  });

  it("closes the input request and returns to working on resumed(input_provided)", () => {
    const session = makeSession({
      state: "waiting_for_input",
      pendingRequests: [openRequest()],
    });

    const result = applyEvent(
      session,
      event({
        eventType: "agent.resumed",
        details: { resumeReason: "input_provided", requestId: "req-1" },
      }),
      NOW,
    );

    expect(result.session.state).toBe("working");
    expect(result.session.stateConfidence).toBe("authoritative");
    expect(result.session.pendingRequests).toEqual([]);
    expect(result.closedRequest?.requestId).toBe("req-1");
    expect(result.stateChanged).toBe(true);
  });

  it("treats progress during waiting_for_input as an inferred resume", () => {
    const session = makeSession({
      state: "waiting_for_input",
      pendingRequests: [openRequest()],
    });

    const result = applyEvent(
      session,
      event({ eventType: "agent.progress", confidence: "authoritative" }),
      NOW,
    );

    expect(result.session.state).toBe("working");
    expect(result.session.stateConfidence).toBe("inferred");
    expect(result.session.pendingRequests).toEqual([]);
    expect(result.session.lastVerifiedAt).toBe(session.lastVerifiedAt);
    expect(result.stateChanged).toBe(true);
  });

  it("does not resume waiting_for_approval on progress", () => {
    const session = makeSession({
      state: "waiting_for_approval",
      pendingRequests: [openRequest({ kind: "approval", requestId: "req-2" })],
    });

    const result = applyEvent(session, event({ eventType: "agent.progress" }), NOW);

    expect(result.session.state).toBe("waiting_for_approval");
    expect(result.session.pendingRequests).toHaveLength(1);
    expect(result.stateChanged).toBe(false);
  });

  it.each(["approved", "denied", "unknown"] as const)(
    "closes the approval request and returns to working on %s",
    (resolution) => {
      const session = makeSession({
        state: "waiting_for_approval",
        pendingRequests: [openRequest({ kind: "approval", requestId: "req-2" })],
      });

      const result = applyEvent(
        session,
        event({
          eventType: "agent.approval_resolved",
          details: { requestId: "req-2", resolution },
        }),
        NOW,
      );

      expect(result.session.state).toBe("working");
      expect(result.session.state).not.toBe("waiting_for_approval");
      expect(result.session.pendingRequests).toEqual([]);
      expect(result.closedRequest?.requestId).toBe("req-2");
      expect(result.stateChanged).toBe(true);
    },
  );

  it("closes requests when a waiting session completes, fails, or turns idle", () => {
    const cases: Array<[EventOverrides, SessionState]> = [
      [{ eventType: "agent.completed", details: { completionScope: "session" } }, "completed"],
      [{ eventType: "agent.failed", details: { failureCode: "cancelled" } }, "failed"],
      [{ eventType: "agent.turn_ended" }, "idle"],
    ];

    for (const [overrides, expected] of cases) {
      const session = makeSession({
        state: "waiting_for_input",
        pendingRequests: [openRequest()],
      });
      const result = applyEvent(session, event(overrides), NOW);

      expect(result.session.state, overrides.eventType).toBe(expected);
      expect(result.session.pendingRequests, overrides.eventType).toEqual([]);
      expect(result.closedRequest?.requestId, overrides.eventType).toBe("req-1");
    }
  });

  it("closes an approval request when a waiting session turns idle", () => {
    const session = makeSession({
      state: "waiting_for_approval",
      pendingRequests: [openRequest({ kind: "approval", requestId: "req-2" })],
    });

    const result = applyEvent(
      session,
      event({ eventType: "agent.turn_ended", confidence: "inferred" }),
      NOW,
    );

    expect(result.session.state).toBe("idle");
    expect(result.session.pendingRequests).toEqual([]);
    expect(result.closedRequest?.requestId).toBe("req-2");
  });
});

describe("applyEvent — resume rules (§13.2, §13.3)", () => {
  it("resumes idle on new_prompt, started, and progress", () => {
    const cases: Array<[EventOverrides, "authoritative" | "inferred"]> = [
      [
        {
          eventType: "agent.resumed",
          details: { resumeReason: "new_prompt" },
        },
        "authoritative",
      ],
      [{ eventType: "agent.started" }, "authoritative"],
      [{ eventType: "agent.progress" }, "inferred"],
    ];

    for (const [overrides, confidence] of cases) {
      const result = applyEvent(
        makeSession({ state: "idle", stateConfidence: "inferred" }),
        event(overrides),
        NOW,
      );

      expect(result.session.state, overrides.eventType).toBe("working");
      expect(result.session.stateConfidence, overrides.eventType).toBe(confidence);
      expect(result.stateChanged, overrides.eventType).toBe(true);
    }
  });

  it("resumes completed and failed on new_prompt", () => {
    for (const state of ["completed", "failed"] as SessionState[]) {
      const result = applyEvent(
        makeSession({ state }),
        event({
          eventType: "agent.resumed",
          details: { resumeReason: "new_prompt" },
        }),
        NOW,
      );

      expect(result.session.state, state).toBe("working");
      expect(result.stateChanged, state).toBe(true);
    }
  });

  it("does not revive a completed session on input_provided", () => {
    const result = applyEvent(
      makeSession({ state: "completed" }),
      event({
        eventType: "agent.resumed",
        details: { resumeReason: "input_provided" },
      }),
      NOW,
    );

    expect(result.session.state).toBe("completed");
    expect(result.stateChanged).toBe(false);
  });

  it("closes no requests when an unrelated resumed arrives", () => {
    const session = makeSession({
      state: "waiting_for_input",
      pendingRequests: [openRequest({ requestId: "req-other" })],
    });

    const result = applyEvent(
      session,
      event({
        eventType: "agent.resumed",
        details: { resumeReason: "input_provided", requestId: "req-1" },
      }),
      NOW,
    );

    expect(result.session.state).toBe("working");
    expect(result.session.pendingRequests).toHaveLength(1);
    expect(result.closedRequest).toBeUndefined();
  });
});

describe("applyEvent — completed/failed are not overwritten (§13.3)", () => {
  it("does not overwrite failed with a later completed", () => {
    const session = makeSession({ state: "failed" });

    const result = applyEvent(
      session,
      event({
        eventType: "agent.completed",
        details: { completionScope: "session" },
      }),
      NOW,
    );

    expect(result.session.state).toBe("failed");
    expect(result.stateChanged).toBe(false);
  });

  it("does not overwrite completed with a later failed", () => {
    const session = makeSession({ state: "completed" });

    const result = applyEvent(
      session,
      event({ eventType: "agent.failed", details: { failureCode: "unknown" } }),
      NOW,
    );

    expect(result.session.state).toBe("completed");
    expect(result.stateChanged).toBe(false);
  });

  it("allows a completed outcome after an intervening started", () => {
    const failed = makeSession({ state: "failed" });
    const revived = applyEvent(failed, event({ eventType: "agent.started" }), NOW);
    const completed = applyEvent(
      revived.session,
      event({ eventType: "agent.completed", details: { completionScope: "session" } }),
      LATER,
    );

    expect(revived.session.state).toBe("working");
    expect(completed.session.state).toBe("completed");
  });

  it("allows a failed outcome after an intervening new_prompt", () => {
    const completed = makeSession({ state: "completed" });
    const revived = applyEvent(
      completed,
      event({
        eventType: "agent.resumed",
        details: { resumeReason: "new_prompt" },
      }),
      NOW,
    );
    const failed = applyEvent(
      revived.session,
      event({ eventType: "agent.failed", details: { failureCode: "host_error" } }),
      LATER,
    );

    expect(revived.session.state).toBe("working");
    expect(failed.session.state).toBe("failed");
  });
});

describe("applyEvent — task scope (§13.2 row, completed in Task 1.8)", () => {
  it("completes the session when a task-scope completion leaves no active tasks", () => {
    const result = applyEvent(
      makeSession(),
      event({
        eventType: "agent.completed",
        taskId: "task-1",
        details: { completionScope: "task" },
      }),
      NOW,
    );

    expect(result.session.state).toBe("completed");
    expect(result.completionScope).toBe("task");
    expect(result.session.tasks).toEqual([
      {
        taskId: "task-1",
        state: "completed",
        startedAt: "2026-10-20T10:00:00Z",
        endedAt: "2026-10-20T10:00:00Z",
      },
    ]);
  });

  it("does not complete the session for a task-scope event without a taskId", () => {
    const result = applyEvent(
      makeSession(),
      event({
        eventType: "agent.completed",
        details: { completionScope: "task" },
      }),
      NOW,
    );

    expect(result.session.state).toBe("working");
    expect(result.session.state).not.toBe("completed");
    expect(result.stateChanged).toBe(false);
  });
});

describe("applyEvent — purity, ordering guards, and liveness", () => {
  it("never mutates the input session", () => {
    const session = makeSession({
      state: "waiting_for_input",
      pendingRequests: [openRequest()],
      tasks: [
        {
          taskId: "task-1",
          state: "active",
          startedAt: "2026-10-20T09:00:00Z",
        },
      ],
    });
    const snapshot = JSON.stringify(session);

    const result = applyEvent(
      session,
      event({
        eventType: "agent.approval_resolved",
        details: { requestId: "req-1", resolution: "approved" },
      }),
      NOW,
    );

    expect(JSON.stringify(session)).toBe(snapshot);
    expect(result.session).not.toBe(session);
  });

  it("ignores an event with a stale sequence", () => {
    const session = makeSession({
      state: "waiting_for_input",
      pendingRequests: [openRequest()],
      lastAcceptedSequence: 10,
    });

    const result = applyEvent(session, event({ eventType: "agent.progress", sequence: 9 }), NOW);

    expect(result.stateChanged).toBe(false);
    expect(result.session.state).toBe("waiting_for_input");
    expect(result.session.pendingRequests).toHaveLength(1);
    expect(result.session.lastAcceptedSequence).toBe(10);
    expect(result.session.lastSeenAt).toBe(session.lastSeenAt);
  });

  it("applies a stale sequence when the event closes an open request", () => {
    const session = makeSession({
      state: "waiting_for_approval",
      pendingRequests: [openRequest({ kind: "approval", requestId: "req-2" })],
      lastAcceptedSequence: 10,
    });

    const result = applyEvent(
      session,
      event({
        eventType: "agent.approval_resolved",
        sequence: 9,
        details: { requestId: "req-2", resolution: "approved" },
      }),
      NOW,
    );

    expect(result.session.state).toBe("working");
    expect(result.session.pendingRequests).toEqual([]);
    expect(result.stateChanged).toBe(true);
    expect(result.session.lastAcceptedSequence).toBe(10);
  });

  it("updates only liveness timestamps on working progress", () => {
    const session = makeSession();

    const result = applyEvent(
      session,
      event({
        eventType: "agent.progress",
        occurredAt: "2026-10-20T10:00:01Z",
        receivedAt: "2026-10-20T10:00:02Z",
      }),
      NOW,
    );

    expect(result.stateChanged).toBe(false);
    expect(result.session.state).toBe("working");
    expect(result.session.lastEventAt).toBe("2026-10-20T10:00:01Z");
    expect(result.session.lastSeenAt).toBe(NOW);
    expect(result.session.lastVerifiedAt).toBe(NOW);
    expect(result.session.pendingRequests).toEqual([]);
  });

  it("does not regress lastEventAt for an out-of-order closing event", () => {
    const session = makeSession({
      state: "waiting_for_input",
      pendingRequests: [openRequest()],
      lastEventAt: "2026-10-20T10:00:00Z",
    });

    const result = applyEvent(
      session,
      event({
        eventType: "agent.resumed",
        occurredAt: "2026-10-20T09:00:00Z",
        receivedAt: "2026-10-20T09:00:01Z",
        details: { resumeReason: "input_provided", requestId: "req-1" },
      }),
      NOW,
    );

    expect(result.session.lastEventAt).toBe("2026-10-20T10:00:00Z");
    expect(result.session.pendingRequests).toEqual([]);
  });
});
