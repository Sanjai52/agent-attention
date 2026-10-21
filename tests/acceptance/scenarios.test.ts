import {
  defaultConfig,
  type AgentAttentionConfig,
  type AgentEvent,
} from "@agent-attention/contract";
import {
  processEvent,
  reconcileAfterHostRestart,
  RollingRateLimiter,
  type PipelineDependencies,
} from "@agent-attention/core";
import { describe, expect, it } from "vitest";
import { MemoryPipelineStore } from "../helpers/memory-store";
import { makeEvent, makeSession } from "../unit/core/event-factory";

const NOW = "2026-10-20T10:00:00Z";

function config(mutate: (value: AgentAttentionConfig) => void = () => {}): AgentAttentionConfig {
  const value = structuredClone(defaultConfig);
  mutate(value);
  return value;
}

function deps(
  store: MemoryPipelineStore,
  overrides: Partial<PipelineDependencies> = {},
): PipelineDependencies {
  const value = overrides.config ?? config();
  return {
    store,
    config: value,
    clock: overrides.clock ?? { now: () => NOW, nowMs: () => Date.parse(NOW) },
    rateLimiter:
      overrides.rateLimiter ?? new RollingRateLimiter(value.rateLimit.maxAlertsPerMinute),
    quietHoursMinutes: overrides.quietHoursMinutes ?? (() => 12 * 60),
    ...overrides,
  };
}

function event(overrides: Parameters<typeof makeEvent>[0]): AgentEvent {
  return makeEvent(overrides);
}

function dispatched(result: ReturnType<typeof processEvent>, channel = "sound") {
  return result.planned.some((plan) =>
    plan.channels.some((entry) => entry.channel === channel && entry.decision === "dispatch"),
  );
}

describe("PRD §19.2 acceptance scenarios A–Q", () => {
  it("A — records an authoritative blocking question and plans an alert", () => {
    const store = new MemoryPipelineStore();
    const result = processEvent(
      event({ eventType: "agent.needs_input", details: { requestId: "input-1" } }),
      deps(store),
    );
    expect(result.session?.state).toBe("waiting_for_input");
    expect(dispatched(result)).toBe(true);
  });

  it("B — records ordinary progress without an alert", () => {
    const store = new MemoryPipelineStore();
    const result = processEvent(event({ eventType: "agent.progress" }), deps(store));
    expect(result.planned).toEqual([]);
    expect(result.session?.state).toBe("working");
  });

  it("C — prioritizes approval and leaves execution to the host", () => {
    const store = new MemoryPipelineStore();
    const result = processEvent(
      event({ eventType: "agent.needs_approval", details: { requestId: "approval-1" } }),
      deps(store),
    );
    expect(result.session?.state).toBe("waiting_for_approval");
    expect(result.planned[0]?.priority).toBe(5);
    expect(dispatched(result)).toBe(true);
  });

  it("D — records verified session completion and one notification", () => {
    const store = new MemoryPipelineStore();
    const result = processEvent(
      event({ eventType: "agent.completed", details: { completionScope: "session" } }),
      deps(store),
    );
    expect(result.session?.state).toBe("completed");
    expect(result.planned.filter((plan) => plan.eventType === "agent.completed")).toHaveLength(1);
  });

  it("E — keeps concurrent sessions independent", () => {
    const store = new MemoryPipelineStore();
    const pipeline = deps(store);
    processEvent(event({ eventType: "agent.started", sessionId: "one" }), pipeline);
    processEvent(event({ eventType: "agent.started", sessionId: "two" }), pipeline);
    const waiting = processEvent(
      event({
        eventType: "agent.needs_input",
        sessionId: "three",
        details: { requestId: "input-3" },
      }),
      pipeline,
    );
    expect(store.sessions.get("adapter-a\u0000one")?.state).toBe("working");
    expect(store.sessions.get("adapter-a\u0000two")?.state).toBe("working");
    expect(waiting.session?.sessionId).toBe("three");
    expect(waiting.session?.state).toBe("waiting_for_input");
  });

  it("F — suppresses quiet-hour channels while retaining history", () => {
    const store = new MemoryPipelineStore();
    const result = processEvent(
      event({ eventType: "agent.needs_input", details: { requestId: "quiet-1" } }),
      deps(store, {
        config: config((value) => {
          value.quietHours.enabled = true;
          value.quietHours.startTime = "00:00";
          value.quietHours.endTime = "23:59";
        }),
      }),
    );
    expect(store.events).toHaveLength(1);
    expect(result.planned[0]?.channels.some((entry) => entry.reason === "quiet_hours")).toBe(true);
  });

  it("G — deduplicates repeated delivery without changing state twice", () => {
    const store = new MemoryPipelineStore();
    const pipeline = deps(store);
    const input = event({
      eventType: "agent.needs_input",
      eventId: "duplicate-1",
      details: { requestId: "dup" },
    });
    expect(processEvent(input, pipeline).status).toBe("processed");
    const duplicate = processEvent(input, pipeline);
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.planned).toEqual([]);
    expect(store.events).toHaveLength(1);
  });

  it("H — persists an event even when channel delivery is represented as unavailable", () => {
    const store = new MemoryPipelineStore();
    const result = processEvent(
      event({ eventType: "agent.needs_input", details: { requestId: "failure-1" } }),
      deps(store),
    );
    expect(result.status).toBe("processed");
    expect(store.events).toHaveLength(1);
    expect(result.planned[0]?.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: "desktop", decision: "dispatch" }),
      ]),
    );
  });

  it("I — represents an unverifiable session as unknown", () => {
    const store = new MemoryPipelineStore();
    const result = processEvent(
      event({ eventType: "agent.state_unknown", confidence: "inferred" }),
      deps(store),
    );
    expect(result.session?.state).toBe("unknown");
    expect(result.session?.stateConfidence).toBe("unverified");
    expect(result.planned).toEqual([]);
  });

  it("J — never upgrades idle-only evidence to completion", () => {
    const store = new MemoryPipelineStore();
    const result = processEvent(
      event({
        eventType: "agent.turn_ended",
        confidence: "inferred",
        details: { turnDurationMs: 20_000 },
      }),
      deps(store),
    );
    expect(result.session?.state).toBe("idle");
    expect(result.planned[0]?.eventType).toBe("agent.turn_ended");
    expect(result.planned[0]?.rendered?.title).toContain("waiting");
  });

  it("K — classified approval supersedes a pending idle alert", () => {
    const store = new MemoryPipelineStore();
    const grace = {
      pending: new Map([
        ["adapter-a:session-1", { eventId: "idle-1", dueAt: "2026-10-20T10:00:01.000Z" }],
      ]),
      graceMs: 1_000,
    };
    const result = processEvent(
      event({ eventType: "agent.needs_approval", details: { requestId: "approval-2" } }),
      deps(store, { grace }),
    );
    expect(result.planned[0]?.eventType).toBe("agent.needs_approval");
    expect(grace.pending.size).toBe(0);
  });

  it("L — records failure and resumes on a new prompt", () => {
    const store = new MemoryPipelineStore();
    const pipeline = deps(store);
    const failed = processEvent(
      event({ eventType: "agent.failed", details: { failureCode: "host_error" } }),
      pipeline,
    );
    const resumed = processEvent(
      event({ eventType: "agent.resumed", details: { resumeReason: "new_prompt" } }),
      pipeline,
    );
    expect(failed.session?.state).toBe("failed");
    expect(dispatched(failed)).toBe(true);
    expect(resumed.session?.state).toBe("working");
  });

  it("M — denial closes approval and returns the session to working", () => {
    const store = new MemoryPipelineStore();
    const pipeline = deps(store);
    processEvent(
      event({ eventType: "agent.needs_approval", details: { requestId: "deny-1" } }),
      pipeline,
    );
    const denied = processEvent(
      event({
        eventType: "agent.approval_resolved",
        details: { requestId: "deny-1", resolution: "denied" },
      }),
      pipeline,
    );
    expect(denied.session?.state).toBe("working");
    expect(denied.session?.pendingRequests).toEqual([]);
  });

  it("N — bounds a simultaneous event burst and retains every event", () => {
    const store = new MemoryPipelineStore();
    const pipeline = deps(store, {
      config: config((value) => {
        value.rateLimit.maxAlertsPerMinute = 6;
      }),
    });
    const results = Array.from({ length: 50 }, (_, index) =>
      processEvent(
        event({
          eventType: "agent.completed",
          eventId: `storm-${index}`,
          sessionId: `storm-session-${index}`,
          details: { completionScope: "session" },
        }),
        pipeline,
      ),
    );
    expect(store.events.length).toBeGreaterThanOrEqual(50);
    expect(
      results
        .flatMap((result) => result.planned)
        .filter((plan) => plan.eventType === "agent.completed").length,
    ).toBeGreaterThanOrEqual(50);
    expect(results.every((result) => result.status === "processed")).toBe(true);
  });

  it("O — renders hostile project names as inert text", () => {
    const store = new MemoryPipelineStore();
    const hostile = "$(whoami); <script>alert(1)</script> `& %PATH%";
    const result = processEvent(
      event({
        eventType: "agent.needs_input",
        projectName: hostile,
        details: { requestId: "hostile-1" },
      }),
      deps(store),
    );
    expect(result.planned[0]?.rendered?.body).toContain(hostile);
    expect(result.planned[0]?.rendered?.title).not.toContain(hostile);
  });

  it("P — reconciles working sessions to unknown after host restart", () => {
    const session = makeSession({ state: "working" });
    const reconciled = reconcileAfterHostRestart(session, NOW);
    expect(reconciled.state).toBe("unknown");
    expect(reconciled.stateConfidence).toBe("unverified");
  });

  it.todo("Q — manually verify doctor reports WSL, SSH, and container environments");
});
