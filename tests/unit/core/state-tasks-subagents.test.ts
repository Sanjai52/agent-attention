import { describe, expect, it } from "vitest";
import type { AdapterCapabilities, AgentEvent } from "@agent-attention/contract";
import { applyEvent, type SessionRecord } from "@agent-attention/core";
import { makeEvent, makeSession, type EventOverrides } from "./event-factory";

const NOW = "2026-10-20T10:00:05Z";
const LATER = "2026-10-20T10:05:00Z";

type TaskCapabilities = Pick<AdapterCapabilities, "supportsTaskScope">;

function event(overrides: EventOverrides): AgentEvent {
  return makeEvent(overrides);
}

function startSession(taskIds: string[] = []): SessionRecord {
  let session = applyEvent(
    undefined,
    event({ eventType: "agent.started", sequence: 1 }),
    NOW,
  ).session;

  let sequence = 2;
  for (const taskId of taskIds) {
    session = applyEvent(
      session,
      event({ eventType: "agent.progress", taskId, sequence }),
      NOW,
    ).session;
    sequence += 1;
  }

  return session;
}

function completeTask(
  session: SessionRecord,
  taskId: string | undefined,
  capabilities?: TaskCapabilities,
): ReturnType<typeof applyEvent> {
  return applyEvent(
    session,
    event({
      eventType: "agent.completed",
      taskId,
      details: { completionScope: "task" },
      occurredAt: LATER,
      receivedAt: LATER,
      sequence: 99,
    }),
    LATER,
    capabilities,
  );
}

describe("task-scope completion (PRD §13.2, F2-R8, AC-F2-06, D-13)", () => {
  it("keeps the session working when another task is still active (AC-F2-06)", () => {
    const session = startSession(["task-a", "task-b"]);

    const result = completeTask(session, "task-a");

    expect(result.session.state).toBe("working");
    expect(result.completionScope).toBe("task");
    expect(result.stateChanged).toBe(true);
    expect(result.session.tasks).toEqual([
      {
        taskId: "task-a",
        state: "completed",
        startedAt: "2026-10-20T10:00:00Z",
        endedAt: "2026-10-20T10:05:00Z",
      },
      {
        taskId: "task-b",
        state: "active",
        startedAt: "2026-10-20T10:00:00Z",
      },
    ]);
  });

  it("completes the session when the last active task finishes", () => {
    const session = startSession(["task-a", "task-b"]);
    const first = completeTask(session, "task-a");

    const result = applyEvent(
      first.session,
      event({
        eventType: "agent.completed",
        taskId: "task-b",
        details: { completionScope: "task" },
        sequence: 100,
      }),
      LATER,
      { supportsTaskScope: true },
    );

    expect(result.session.state).toBe("completed");
    expect(result.session.tasks.every((task) => task.state === "completed")).toBe(true);
  });

  it("does not complete the session when the adapter does not declare task scope", () => {
    const session = startSession(["task-a"]);

    const result = completeTask(session, "task-a", { supportsTaskScope: false });

    expect(result.session.state).toBe("working");
    expect(result.session.tasks[0]?.state).toBe("completed");
  });

  it("still completes a session-scope outcome when task scope is unsupported", () => {
    const result = applyEvent(
      makeSession(),
      event({
        eventType: "agent.completed",
        details: { completionScope: "session" },
      }),
      NOW,
      { supportsTaskScope: false },
    );

    expect(result.session.state).toBe("completed");
  });

  it("never completes the session for a task-scope event without a taskId", () => {
    const result = completeTask(startSession(["task-a"]), undefined, {
      supportsTaskScope: true,
    });

    expect(result.session.state).toBe("working");
    expect(result.completionScope).toBe("task");
    expect(result.session.tasks[0]?.state).toBe("active");
  });

  it("infers task support from a taskId when capabilities are omitted", () => {
    const result = completeTask(startSession(), "task-a");

    expect(result.session.state).toBe("completed");
  });

  it("does not overwrite a failed task with a later completion (PRD §13.3)", () => {
    const failed = applyEvent(
      startSession(["task-a"]),
      event({
        eventType: "agent.failed",
        taskId: "task-a",
        details: { failureCode: "host_error" },
        sequence: 50,
      }),
      NOW,
    );
    expect(failed.session.state).toBe("failed");
    expect(failed.session.tasks[0]?.state).toBe("failed");

    const revived = applyEvent(
      failed.session,
      event({ eventType: "agent.started", sequence: 51 }),
      LATER,
    ).session;
    expect(revived.state).toBe("working");
    expect(revived.tasks[0]?.state).toBe("failed");

    const completed = completeTask(revived, "task-a", { supportsTaskScope: true });

    expect(completed.session.tasks[0]?.state).toBe("failed");
    expect(completed.session.state).toBe("working");
  });

  it("reactivates a terminal task on a new started event with the same taskId", () => {
    const completed = completeTask(startSession(["task-a"]), "task-a");
    expect(completed.session.state).toBe("completed");

    const restarted = applyEvent(
      completed.session,
      event({
        eventType: "agent.started",
        taskId: "task-a",
        occurredAt: LATER,
        receivedAt: LATER,
        sequence: 100,
      }),
      LATER,
    );

    expect(restarted.session.state).toBe("working");
    expect(restarted.session.tasks).toEqual([
      {
        taskId: "task-a",
        state: "active",
        startedAt: "2026-10-20T10:05:00Z",
      },
    ]);
  });
});

describe("waiting_for_approval completion rows (PRD §13.2)", () => {
  const cases: Array<[EventOverrides, "completed" | "failed" | "idle"]> = [
    [{ eventType: "agent.completed", details: { completionScope: "session" } }, "completed"],
    [{ eventType: "agent.failed", details: { failureCode: "cancelled" } }, "failed"],
    [{ eventType: "agent.turn_ended", confidence: "inferred" }, "idle"],
  ];

  it.each(cases)(
    "moves waiting_for_approval to the event's outcome and closes the request",
    (overrides, expected) => {
      const session = makeSession({
        state: "waiting_for_approval",
        pendingRequests: [
          {
            kind: "approval",
            requestId: "req-approval",
            openedAt: "2026-10-20T09:59:00Z",
            remindersSent: 0,
          },
        ],
      });

      const result = applyEvent(session, event(overrides), LATER);

      expect(result.session.state).toBe(expected);
      expect(result.session.pendingRequests).toEqual([]);
      expect(result.closedRequest?.requestId).toBe("req-approval");
      expect(result.stateChanged).toBe(true);
    },
  );
});

describe("subagent semantics (PRD §13.5, AC-F2-07, D-14)", () => {
  const subagentStart = event({
    eventType: "agent.started",
    sessionId: "sub-1",
    isSubagent: true,
    parentSessionId: "session-1",
    sequence: 1,
  });

  it("tracks a subagent as its own session", () => {
    const result = applyEvent(undefined, subagentStart, NOW);

    expect(result.session.sessionId).toBe("sub-1");
    expect(result.session.isSubagent).toBe(true);
    expect(result.session.parentSessionId).toBe("session-1");
    expect(result.session.state).toBe("working");
    expect(result.affectsParent).toBe(true);
  });

  it("opens a request on the subagent, not the parent (D-14)", () => {
    const started = applyEvent(undefined, subagentStart, NOW).session;
    const parent = makeSession({ state: "working" });
    const parentSnapshot = JSON.stringify(parent);

    const result = applyEvent(
      started,
      event({
        eventType: "agent.needs_input",
        sessionId: "sub-1",
        isSubagent: true,
        parentSessionId: "session-1",
        details: { requestId: "req-sub" },
        sequence: 2,
      }),
      NOW,
    );

    expect(result.session.state).toBe("waiting_for_input");
    expect(result.session.pendingRequests).toHaveLength(1);
    expect(result.session.pendingRequests[0]?.requestId).toBe("req-sub");
    expect(result.affectsParent).toBe(true);
    expect(parent.state).toBe("working");
    expect(JSON.stringify(parent)).toBe(parentSnapshot);
  });

  it("leaves the parent untouched on subagent completion (AC-F2-07)", () => {
    const started = applyEvent(undefined, subagentStart, NOW).session;
    const parent = makeSession({ state: "working" });
    const parentSnapshot = JSON.stringify(parent);

    const result = applyEvent(
      started,
      event({
        eventType: "agent.completed",
        sessionId: "sub-1",
        isSubagent: true,
        parentSessionId: "session-1",
        details: { completionScope: "session" },
        sequence: 2,
      }),
      LATER,
    );

    expect(result.session.state).toBe("completed");
    expect(result.session.parentSessionId).toBe("session-1");
    expect(result.affectsParent).toBe(true);
    expect(parent.state).toBe("working");
    expect(JSON.stringify(parent)).toBe(parentSnapshot);
  });

  it("leaves the parent untouched on subagent turn_ended and failure", () => {
    const started = applyEvent(undefined, subagentStart, NOW).session;
    const parent = makeSession({ state: "working" });
    const parentSnapshot = JSON.stringify(parent);

    const idle = applyEvent(
      started,
      event({
        eventType: "agent.turn_ended",
        sessionId: "sub-1",
        isSubagent: true,
        parentSessionId: "session-1",
        confidence: "inferred",
        sequence: 2,
      }),
      LATER,
    );
    const failed = applyEvent(
      idle.session,
      event({
        eventType: "agent.failed",
        sessionId: "sub-1",
        isSubagent: true,
        parentSessionId: "session-1",
        details: { failureCode: "host_error" },
        sequence: 3,
      }),
      LATER,
    );

    expect(idle.session.state).toBe("idle");
    expect(idle.affectsParent).toBe(true);
    expect(failed.session.state).toBe("failed");
    expect(failed.affectsParent).toBe(true);
    expect(JSON.stringify(parent)).toBe(parentSnapshot);
  });

  it("does not mark ordinary sessions as affecting a parent", () => {
    const result = applyEvent(
      makeSession(),
      event({
        eventType: "agent.completed",
        details: { completionScope: "session" },
      }),
      NOW,
    );

    expect(result.session.isSubagent).toBe(false);
    expect(result.affectsParent).toBe(false);
  });

  it("treats an event with a parentSessionId but no isSubagent as independent", () => {
    const result = applyEvent(
      undefined,
      event({
        eventType: "agent.started",
        sessionId: "orphan-1",
        parentSessionId: "missing-parent",
      }),
      NOW,
    );

    expect(result.session.isSubagent).toBe(false);
    expect(result.session.parentSessionId).toBeUndefined();
    expect(result.affectsParent).toBe(false);
    expect(result.session.state).toBe("working");
  });

  it("treats isSubagent without a parentSessionId as independent (unknown parent)", () => {
    const result = applyEvent(
      undefined,
      event({
        eventType: "agent.started",
        sessionId: "orphan-2",
        isSubagent: true,
      }),
      NOW,
    );

    expect(result.session.isSubagent).toBe(false);
    expect(result.session.parentSessionId).toBeUndefined();
    expect(result.affectsParent).toBe(false);
  });

  it("reports affectsParent false for a no-op subagent event", () => {
    const started = applyEvent(undefined, subagentStart, NOW).session;

    const result = applyEvent(
      started,
      event({
        eventType: "agent.progress",
        sessionId: "sub-1",
        isSubagent: true,
        parentSessionId: "session-1",
        sequence: 2,
      }),
      NOW,
    );

    expect(result.stateChanged).toBe(false);
    expect(result.affectsParent).toBe(false);
  });
});
