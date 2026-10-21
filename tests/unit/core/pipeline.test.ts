import {
  AGENT_EVENT_TYPES,
  defaultConfig,
  type AdapterCapabilities,
  type AgentAttentionConfig,
  type AgentEvent,
  type AgentEventType,
  type SupportLevel,
} from "@agent-attention/contract";
import {
  RollingRateLimiter,
  processEvent,
  type AdmitOptions,
  type GraceState,
  type PlannedNotification,
  type PipelineDependencies,
  type RateLimitDecision,
} from "@agent-attention/core";
import { describe, expect, it } from "vitest";
import { makeEvent, makeSession, type EventOverrides } from "./event-factory";
import { MemoryPipelineStore } from "../../helpers/memory-store";

const NOW = "2026-10-20T10:00:00Z";

function makeClock(start = NOW) {
  let current = start;
  return {
    now: () => current,
    nowMs: () => Date.parse(current),
    set(next: string) {
      current = next;
    },
  };
}

type TestClock = ReturnType<typeof makeClock>;

function makeConfig(mutate: (config: AgentAttentionConfig) => void = () => {}): AgentAttentionConfig {
  const config = structuredClone(defaultConfig);
  mutate(config);
  return config;
}

function enableAllChannels(config: AgentAttentionConfig): void {
  config.channels.sound = true;
  config.channels.voice = true;
  config.channels.desktop = true;

  for (const eventClass of [
    "needsInput",
    "needsApproval",
    "turnEnded",
    "completed",
    "failed",
  ] as const) {
    config.events[eventClass].sound.enabled = true;
    config.events[eventClass].voice.enabled = true;
    config.events[eventClass].desktop.enabled = true;
  }
}

function makeCapabilities(
  overrides: Partial<Record<AgentEventType, SupportLevel>> = {},
): AdapterCapabilities {
  const events = Object.fromEntries(
    AGENT_EVENT_TYPES.map((eventType) => [
      eventType,
      { support: overrides[eventType] ?? "authoritative" },
    ]),
  ) as AdapterCapabilities["events"];

  return {
    adapterId: "adapter-a",
    adapterVersion: "1.0.0",
    executionModel: "hook_process",
    events,
    eventIdsStable: true,
    supportsSequence: true,
    supportsTaskScope: true,
    supportsSubagents: true,
    supportsLiveness: true,
    supportsResolutionSignals: true,
  };
}

function makeGrace(graceMs = 1_000): GraceState {
  return { pending: new Map(), graceMs };
}

interface DepsOptions {
  config?: AgentAttentionConfig;
  capabilities?: AdapterCapabilities;
  clock?: TestClock;
  rateLimiter?: RollingRateLimiter;
  quietHoursMinutes?: (now: string) => number;
  formatTimeLabel?: (iso: string) => string;
  grace?: GraceState;
}

function makeDeps(
  store: MemoryPipelineStore,
  options: DepsOptions = {},
): PipelineDependencies {
  const config = options.config ?? makeConfig();

  return {
    store,
    config,
    clock: options.clock ?? makeClock(),
    rateLimiter:
      options.rateLimiter ?? new RollingRateLimiter(config.rateLimit.maxAlertsPerMinute),
    quietHoursMinutes: options.quietHoursMinutes ?? (() => 12 * 60),
    ...(options.capabilities !== undefined ? { capabilities: options.capabilities } : {}),
    ...(options.formatTimeLabel !== undefined
      ? { formatTimeLabel: options.formatTimeLabel }
      : {}),
    ...(options.grace !== undefined ? { grace: options.grace } : {}),
  };
}

function event(overrides: EventOverrides): AgentEvent {
  return makeEvent(overrides);
}

function channel(
  plan: PlannedNotification,
  name: "sound" | "voice" | "desktop",
): PlannedNotification["channels"][number] | undefined {
  return plan.channels.find((entry) => entry.channel === name);
}

class CountingRateLimiter extends RollingRateLimiter {
  admits = 0;

  override admit(event: AgentEvent, nowMs: number, options: AdmitOptions): RateLimitDecision {
    this.admits += 1;
    return super.admit(event, nowMs, options);
  }
}

describe("validation and capability honesty (PRD §14.2 step 1, RF5)", () => {
  it("rejects an invalid payload before claiming or storing anything", () => {
    const store = new MemoryPipelineStore();
    const result = processEvent({ eventType: "agent.started" }, makeDeps(store));

    expect(result.status).toBe("rejected");
    expect(result.planned).toEqual([]);
    expect(result.timers).toEqual([]);
    expect(result.diagnostics.every((diagnostic) => diagnostic.code === "validation")).toBe(
      true,
    );
    expect(store.calls).not.toContain("claimFingerprint");
    expect(store.events).toEqual([]);

    const rawIssues = store.diagnostics.filter(
      (issue): issue is Extract<typeof issue, { path: string }> => "path" in issue,
    );
    expect(rawIssues.length).toBeGreaterThan(0);
  });

  it("rejects an event type the adapter declared unsupported", () => {
    const store = new MemoryPipelineStore();
    const capabilities = makeCapabilities({ "agent.needs_input": "unsupported" });

    const result = processEvent(
      event({ eventType: "agent.needs_input", details: { requestId: "req-1" } }),
      makeDeps(store, { capabilities }),
    );

    expect(result.status).toBe("rejected");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "capability_violation",
    ]);
    expect(store.calls).not.toContain("claimFingerprint");
    expect(store.events).toEqual([]);
    expect(store.diagnostics.some((issue) => issue.code === "capability_violation")).toBe(
      true,
    );
  });

  it("rejects an authoritative event when the adapter declared only inferred support", () => {
    const store = new MemoryPipelineStore();
    const capabilities = makeCapabilities({ "agent.needs_input": "inferred" });

    const result = processEvent(
      event({
        eventType: "agent.needs_input",
        confidence: "authoritative",
        details: { requestId: "req-1" },
      }),
      makeDeps(store, { capabilities }),
    );

    expect(result.status).toBe("rejected");
    expect(result.diagnostics[0]?.code).toBe("capability_violation");
    expect(store.events).toEqual([]);
  });

  it("accepts an inferred event for an inferred capability", () => {
    const store = new MemoryPipelineStore();
    const capabilities = makeCapabilities({ "agent.needs_input": "inferred" });

    const result = processEvent(
      event({
        eventType: "agent.needs_input",
        confidence: "inferred",
        details: { requestId: "req-1" },
      }),
      makeDeps(store, { capabilities }),
    );

    expect(result.status).toBe("processed");
  });

  it("requires turn_ended to be emitted as inferred when capabilities are supplied", () => {
    const store = new MemoryPipelineStore();
    const result = processEvent(
      event({ eventType: "agent.turn_ended", confidence: "authoritative" }),
      makeDeps(store, { capabilities: makeCapabilities() }),
    );

    expect(result.status).toBe("rejected");
    expect(result.diagnostics[0]?.code).toBe("capability_violation");
    expect(store.events).toEqual([]);
  });

  it("accepts an inferred turn_ended and skips capability checks when none are supplied", () => {
    const inferredStore = new MemoryPipelineStore();
    const inferred = processEvent(
      event({ eventType: "agent.turn_ended", confidence: "inferred" }),
      makeDeps(inferredStore, { capabilities: makeCapabilities() }),
    );
    expect(inferred.status).toBe("processed");

    const noCapabilitiesStore = new MemoryPipelineStore();
    const unchecked = processEvent(
      event({ eventType: "agent.turn_ended", confidence: "authoritative" }),
      makeDeps(noCapabilitiesStore),
    );
    expect(unchecked.status).toBe("processed");
    expect(unchecked.diagnostics).toEqual([]);
  });
});

describe("persistence precedes dispatch (PRD §14.2, step 2)", () => {
  it("claims, records, saves, and only then renders a plan", () => {
    const store = new MemoryPipelineStore();
    let recorded = false;
    let saved = false;
    let observed: { recorded: boolean; saved: boolean } | undefined;

    store.onRecordEvent = () => {
      recorded = true;
    };
    store.onSaveSession = () => {
      saved = true;
    };

    const result = processEvent(
      event({
        eventType: "agent.needs_input",
        projectName: "proj",
        details: { requestId: "req-1" },
      }),
      makeDeps(store, {
        formatTimeLabel: (iso) => {
          observed = { recorded, saved };
          return iso.slice(11, 16);
        },
      }),
    );

    expect(result.status).toBe("processed");
    expect(observed).toEqual({ recorded: true, saved: true });
    expect(
      store.calls.filter(
        (call) =>
          call === "claimFingerprint" || call === "recordEvent" || call === "saveSession",
      ),
    ).toEqual(["claimFingerprint", "recordEvent", "saveSession"]);
  });

  it("uses the store's crash-atomic claim+insert path when available", () => {
    const store = new MemoryPipelineStore({ atomicClaims: true });

    const result = processEvent(
      event({
        eventType: "agent.needs_input",
        projectName: "proj",
        details: { requestId: "req-atomic" },
      }),
      makeDeps(store),
    );

    expect(result.status).toBe("processed");
    expect(store.events).toHaveLength(1);
    expect(store.events[0]?.meta).toEqual({
      fingerprint: expect.any(String),
      late: false,
      duplicate: false,
    });
    expect(
      store.calls.filter(
        (call) =>
          call === "claimEvent" ||
          call === "claimFingerprint" ||
          call === "recordEvent" ||
          call === "saveSession",
      ),
    ).toEqual(["claimEvent", "claimFingerprint", "recordEvent", "saveSession"]);
  });

  it("keeps the persisted event when planning fails with an internal error", () => {
    const store = new MemoryPipelineStore();

    const result = processEvent(
      event({
        eventType: "agent.needs_input",
        details: { requestId: "req-1" },
      }),
      makeDeps(store, {
        formatTimeLabel: () => {
          throw new Error("renderer exploded");
        },
      }),
    );

    expect(result.status).toBe("rejected");
    expect(result.diagnostics[0]?.code).toBe("internal");
    expect(store.events).toHaveLength(1);
    expect(store.sessions.size).toBe(1);
  });
});

describe("duplicates and progress (PRD §14.4, F8-R10, AC-F8-04)", () => {
  it("stops a duplicate after the claim without state, plans, or timers", () => {
    const store = new MemoryPipelineStore();
    const limiter = new CountingRateLimiter(6);
    const deps = makeDeps(store, { rateLimiter: limiter });
    const duplicate = event({
      eventType: "agent.needs_input",
      details: { requestId: "req-1" },
    });

    const first = processEvent(duplicate, deps);
    expect(first.status).toBe("processed");
    const saveCount = store.calls.filter((call) => call === "saveSession").length;

    const second = processEvent(duplicate, deps);

    expect(second.status).toBe("duplicate");
    expect(second.planned).toEqual([]);
    expect(second.timers).toEqual([]);
    expect(second.session).toBeUndefined();
    expect(store.events).toHaveLength(1);
    expect(store.calls.filter((call) => call === "saveSession")).toHaveLength(saveCount);
    expect(limiter.admits).toBe(1);
  });

  it("does not fingerprint or store progress events but updates liveness", () => {
    const store = new MemoryPipelineStore();
    const progress = event({ eventType: "agent.progress", eventId: "progress-1" });

    const first = processEvent(progress, makeDeps(store));
    const second = processEvent(progress, makeDeps(store));

    expect(first.status).toBe("processed");
    expect(second.status).toBe("processed");
    expect(store.events).toEqual([]);
    expect(store.claims.size).toBe(0);
    expect(store.calls.filter((call) => call === "saveSession")).toHaveLength(2);
    expect(first.planned).toEqual([]);
    expect(second.planned).toEqual([]);
  });

  it("updates liveness for an older progress heartbeat instead of treating it as late", () => {
    const store = new MemoryPipelineStore();
    store.saveSession(
      makeSession({
        state: "working",
        lastEventAt: "2026-10-20T10:05:00Z",
      }),
    );
    store.calls.length = 0;

    const result = processEvent(
      event({
        eventType: "agent.progress",
        occurredAt: "2026-10-20T10:00:00Z",
        receivedAt: "2026-10-20T10:00:00Z",
      }),
      makeDeps(store),
    );

    expect(result.status).toBe("processed");
    expect(store.calls).toContain("saveSession");
    expect(result.session?.lastSeenAt).toBe(NOW);
    expect(store.events).toEqual([]);
  });
});

describe("late events (PRD §13.4)", () => {
  it("records a late non-closing event without changing state or planning", () => {
    const store = new MemoryPipelineStore();
    store.saveSession(
      makeSession({
        state: "waiting_for_input",
        lastEventAt: "2026-10-20T10:05:00Z",
        lastAcceptedSequence: 10,
        pendingRequests: [
          {
            kind: "input",
            requestId: "req-open",
            openedAt: "2026-10-20T10:00:00Z",
            remindersSent: 0,
          },
        ],
      }),
    );
    store.calls.length = 0;

    const result = processEvent(
      event({
        eventType: "agent.needs_approval",
        sequence: 9,
        occurredAt: "2026-10-20T10:00:00Z",
        details: { requestId: "req-new" },
      }),
      makeDeps(store),
    );

    expect(result.status).toBe("late");
    expect(result.planned).toEqual([]);
    expect(result.session?.state).toBe("waiting_for_input");
    expect(result.session?.pendingRequests.map((request) => request.requestId)).toEqual([
      "req-open",
    ]);
    expect(store.events[0]?.meta.late).toBe(true);
    expect(store.calls).not.toContain("saveSession");
  });

  it("still applies a late closing event and reports it as late", () => {
    const store = new MemoryPipelineStore();
    const clock = makeClock("2026-10-20T10:10:00Z");
    store.saveSession(
      makeSession({
        state: "waiting_for_approval",
        lastEventAt: "2026-10-20T10:05:00Z",
        lastAcceptedSequence: 10,
        pendingRequests: [
          {
            kind: "approval",
            requestId: "req-1",
            openedAt: "2026-10-20T10:00:00Z",
            remindersSent: 0,
          },
        ],
      }),
    );
    store.calls.length = 0;

    const result = processEvent(
      event({
        eventType: "agent.approval_resolved",
        sequence: 9,
        occurredAt: "2026-10-20T10:00:00Z",
        details: { requestId: "req-1", resolution: "approved" },
      }),
      makeDeps(store, { clock }),
    );

    expect(result.status).toBe("late");
    expect(result.planned).toEqual([]);
    expect(result.session?.state).toBe("working");
    expect(result.session?.pendingRequests).toEqual([]);
    expect(store.events[0]?.meta.late).toBe(true);
    expect(store.calls).toContain("saveSession");
    expect(result.timers).toContainEqual({
      kind: "stale",
      dueAt: "2026-10-20T10:25:00.000Z",
      sessionKey: "adapter-a:session-1",
    });
  });

  it("closes an approval request and returns the session to working (AC-F3-05)", () => {
    const store = new MemoryPipelineStore();
    const waiting = processEvent(
      event({
        eventType: "agent.needs_approval",
        details: { requestId: "req-approval" },
      }),
      makeDeps(store),
    );
    expect(waiting.session?.state).toBe("waiting_for_approval");

    const clock = makeClock("2026-10-20T10:00:01Z");
    const resolved = processEvent(
      event({
        eventType: "agent.approval_resolved",
        occurredAt: "2026-10-20T10:00:01Z",
        receivedAt: "2026-10-20T10:00:01Z",
        details: { requestId: "req-approval", resolution: "approved" },
      }),
      makeDeps(store, { clock }),
    );

    expect(resolved.status).toBe("processed");
    expect(resolved.session?.state).toBe("working");
    expect(resolved.session?.pendingRequests).toEqual([]);
    expect(resolved.planned).toEqual([]);
  });
});

describe("turn-end grace and precedence (F10, AC-F10-02)", () => {
  it("registers a pending turn-end and emits a grace timer for an alerting turn end", () => {
    const store = new MemoryPipelineStore();
    const grace = makeGrace();
    const config = makeConfig();
    config.events.turnEnded.graceMs = 1_000;

    const result = processEvent(
      event({
        eventType: "agent.turn_ended",
        eventId: "turn-1",
        details: { turnDurationMs: 60_000 },
      }),
      makeDeps(store, { config, grace }),
    );

    expect(result.status).toBe("processed");
    expect(result.session?.state).toBe("idle");
    expect(result.timers).toContainEqual({
      kind: "grace",
      dueAt: "2026-10-20T10:00:01.000Z",
      sessionKey: "adapter-a:session-1",
    });
    expect(grace.pending.get("adapter-a:session-1")).toEqual({
      eventId: "turn-1",
      dueAt: "2026-10-20T10:00:01.000Z",
    });
    expect(channel(result.planned[0]!, "sound")?.decision).toBe("dispatch");
  });

  it("lets a classified event supersede pending turn-end within the grace window", () => {
    const store = new MemoryPipelineStore();
    const clock = makeClock();
    const grace = makeGrace();
    const deps = makeDeps(store, { clock, grace });

    processEvent(
      event({
        eventType: "agent.turn_ended",
        eventId: "turn-1",
        details: { turnDurationMs: 60_000 },
      }),
      deps,
    );

    clock.set("2026-10-20T10:00:00.500Z");
    const completed = processEvent(
      event({
        eventType: "agent.completed",
        eventId: "done-1",
        occurredAt: "2026-10-20T10:00:00.500Z",
        receivedAt: "2026-10-20T10:00:00.500Z",
        details: { completionScope: "session" },
      }),
      deps,
    );

    expect(completed.status).toBe("processed");
    expect(grace.pending.size).toBe(0);
    expect(completed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "state_conflict",
    ]);
    expect(store.diagnostics.some((issue) => issue.code === "state_conflict")).toBe(true);
    expect(completed.planned[0]?.eventType).toBe("agent.completed");
  });

  it("does not report a state conflict once the grace deadline has passed", () => {
    const store = new MemoryPipelineStore();
    const clock = makeClock();
    const grace = makeGrace();
    const deps = makeDeps(store, { clock, grace });

    processEvent(
      event({
        eventType: "agent.turn_ended",
        eventId: "turn-1",
        details: { turnDurationMs: 60_000 },
      }),
      deps,
    );

    clock.set("2026-10-20T10:00:02Z");
    const completed = processEvent(
      event({
        eventType: "agent.completed",
        eventId: "done-1",
        occurredAt: "2026-10-20T10:00:02Z",
        receivedAt: "2026-10-20T10:00:02Z",
        details: { completionScope: "session" },
      }),
      deps,
    );

    expect(completed.diagnostics).toEqual([]);
    expect(grace.pending.size).toBe(0);
  });

  it("suppresses a turn shorter than minTurnSeconds but still records and updates state", () => {
    const store = new MemoryPipelineStore();
    const grace = makeGrace();

    const result = processEvent(
      event({
        eventType: "agent.turn_ended",
        details: { turnDurationMs: 1_000 },
      }),
      makeDeps(store, { grace }),
    );

    expect(result.status).toBe("processed");
    expect(result.session?.state).toBe("idle");
    expect(store.events).toHaveLength(1);
    expect(
      result.planned[0]?.channels.every(
        (entry) => entry.decision === "suppress" && entry.reason === "below_min_turn",
      ),
    ).toBe(true);
    expect(grace.pending.size).toBe(0);
    expect(result.timers.some((timer) => timer.kind === "grace")).toBe(false);
  });
});

describe("suppressors (PRD §14.2 step 6, F8, F9, F10-R6)", () => {
  it("suppresses every configured channel during quiet hours while keeping history", () => {
    const store = new MemoryPipelineStore();
    const config = makeConfig((draft) => {
      draft.channels.voice = true;
      draft.events.needsInput.voice.enabled = true;
      draft.quietHours.enabled = true;
      draft.quietHours.startTime = "00:00";
      draft.quietHours.endTime = "23:59";
      draft.quietHours.suppressSound = true;
      draft.quietHours.suppressVoice = true;
      draft.quietHours.suppressDesktop = true;
    });

    const result = processEvent(
      event({
        eventType: "agent.needs_input",
        details: { requestId: "req-1" },
      }),
      makeDeps(store, { config, quietHoursMinutes: () => 12 * 60 }),
    );

    expect(result.status).toBe("processed");
    expect(store.events).toHaveLength(1);
    expect(
      result.planned[0]?.channels.every(
        (entry) => entry.decision === "suppress" && entry.reason === "quiet_hours",
      ),
    ).toBe(true);
  });

  it("uses occurredAt when trustworthy and receivedAt when it is not", () => {
    const config = makeConfig((draft) => {
      draft.quietHours.enabled = true;
    });
    const seen: string[] = [];

    processEvent(
      event({
        eventType: "agent.needs_input",
        occurredAt: "2026-10-20T09:00:00Z",
        receivedAt: "2026-10-20T10:00:00Z",
        details: { requestId: "req-1" },
      }),
      makeDeps(new MemoryPipelineStore(), {
        config,
        quietHoursMinutes: (at) => {
          seen.push(at);
          return 12 * 60;
        },
      }),
    );

    processEvent(
      event({
        eventType: "agent.needs_input",
        occurredAt: "2026-10-20T10:00:00Z",
        receivedAt: "2026-10-20T10:00:00Z",
        details: { requestId: "req-1" },
      }),
      makeDeps(new MemoryPipelineStore(), {
        config,
        quietHoursMinutes: (at) => {
          seen.push(at);
          return 12 * 60;
        },
      }),
    );

    expect(seen).toEqual(["2026-10-20T09:00:00Z", "2026-10-20T10:00:00Z"]);
  });

  it("mutes sound and voice globally but leaves desktop intact (AC-F4-05)", () => {
    const store = new MemoryPipelineStore();
    const config = makeConfig((draft) => {
      draft.globalMute = true;
      draft.channels.voice = true;
      draft.events.needsApproval.voice.enabled = true;
    });

    const result = processEvent(
      event({
        eventType: "agent.needs_approval",
        details: { requestId: "req-1" },
      }),
      makeDeps(store, { config }),
    );

    const plan = result.planned[0]!;
    expect(channel(plan, "sound")).toEqual({
      channel: "sound",
      decision: "suppress",
      reason: "muted",
    });
    expect(channel(plan, "voice")).toEqual({
      channel: "voice",
      decision: "suppress",
      reason: "muted",
    });
    expect(channel(plan, "desktop")).toEqual({ channel: "desktop", decision: "dispatch" });
  });

  it("plans nothing when the event class is disabled", () => {
    const store = new MemoryPipelineStore();
    const config = makeConfig((draft) => {
      draft.events.needsInput.enabled = false;
    });

    const result = processEvent(
      event({ eventType: "agent.needs_input", details: { requestId: "req-1" } }),
      makeDeps(store, { config }),
    );

    expect(result.status).toBe("processed");
    expect(result.planned).toEqual([]);
    expect(store.events).toHaveLength(1);
  });

  it("suppresses a channel that is disabled independently", () => {
    const store = new MemoryPipelineStore();
    const config = makeConfig((draft) => {
      draft.channels.voice = true;
      draft.events.needsInput.voice.enabled = true;
      draft.events.needsInput.sound.enabled = false;
    });

    const result = processEvent(
      event({ eventType: "agent.needs_input", details: { requestId: "req-1" } }),
      makeDeps(store, { config }),
    );

    const plan = result.planned[0]!;
    expect(channel(plan, "sound")).toEqual({
      channel: "sound",
      decision: "suppress",
      reason: "disabled",
    });
    expect(channel(plan, "voice")?.decision).toBe("dispatch");
    expect(channel(plan, "desktop")?.decision).toBe("dispatch");
  });

  it("suppresses cancelled failures unless notifyOnCancelled is enabled", () => {
    const store = new MemoryPipelineStore();
    const config = makeConfig((draft) => {
      draft.events.failed.notifyOnCancelled = false;
    });

    const cancelled = processEvent(
      event({
        eventType: "agent.failed",
        details: { failureCode: "cancelled" },
      }),
      makeDeps(store, { config }),
    );

    expect(cancelled.session?.state).toBe("failed");
    expect(
      cancelled.planned[0]?.channels.every(
        (entry) => entry.decision === "suppress" && entry.reason === "disabled",
      ),
    ).toBe(true);

    const notifyConfig = makeConfig((draft) => {
      draft.events.failed.notifyOnCancelled = true;
    });
    const notified = processEvent(
      event({
        eventType: "agent.failed",
        details: { failureCode: "cancelled" },
        sessionId: "session-2",
      }),
      makeDeps(new MemoryPipelineStore(), { config: notifyConfig }),
    );

    expect(channel(notified.planned[0]!, "sound")?.decision).toBe("dispatch");
  });

  it("suppresses known-subagent completions unless subagent notifications are enabled", () => {
    const store = new MemoryPipelineStore();
    store.saveSession(makeSession({ sessionId: "parent-1", state: "working" }));

    const result = processEvent(
      event({
        eventType: "agent.completed",
        sessionId: "child-1",
        isSubagent: true,
        parentSessionId: "parent-1",
        details: { completionScope: "session" },
      }),
      makeDeps(store),
    );

    expect(
      result.planned[0]?.channels.every(
        (entry) => entry.decision === "suppress" && entry.reason === "subagent",
      ),
    ).toBe(true);

    const notifyConfig = makeConfig((draft) => {
      draft.subagents.notify = true;
    });
    const notifyStore = new MemoryPipelineStore();
    notifyStore.saveSession(makeSession({ sessionId: "parent-1", state: "working" }));
    const notified = processEvent(
      event({
        eventType: "agent.completed",
        sessionId: "child-1",
        isSubagent: true,
        parentSessionId: "parent-1",
        details: { completionScope: "session" },
      }),
      makeDeps(notifyStore, { config: notifyConfig }),
    );

    expect(channel(notified.planned[0]!, "sound")?.decision).toBe("dispatch");
  });

  it("still notifies subagent input requests and unknown-parent sessions", () => {
    const store = new MemoryPipelineStore();
    store.saveSession(makeSession({ sessionId: "parent-1", state: "working" }));

    const subagentInput = processEvent(
      event({
        eventType: "agent.needs_input",
        sessionId: "child-1",
        isSubagent: true,
        parentSessionId: "parent-1",
        details: { requestId: "req-1" },
      }),
      makeDeps(store),
    );

    expect(channel(subagentInput.planned[0]!, "sound")?.decision).toBe("dispatch");

    const unknownParent = processEvent(
      event({
        eventType: "agent.completed",
        sessionId: "orphan-1",
        isSubagent: true,
        parentSessionId: "missing-parent",
        details: { completionScope: "session" },
      }),
      makeDeps(store),
    );

    expect(channel(unknownParent.planned[0]!, "sound")?.decision).toBe("dispatch");
  });

  it("suppresses a subagent turn-end and schedules no grace", () => {
    const store = new MemoryPipelineStore();
    store.saveSession(makeSession({ sessionId: "parent-1", state: "working" }));
    const grace = makeGrace();

    const result = processEvent(
      event({
        eventType: "agent.turn_ended",
        sessionId: "child-1",
        isSubagent: true,
        parentSessionId: "parent-1",
        details: { turnDurationMs: 60_000 },
      }),
      makeDeps(store, { grace }),
    );

    expect(
      result.planned[0]?.channels.every(
        (entry) => entry.decision === "suppress" && entry.reason === "subagent",
      ),
    ).toBe(true);
    expect(grace.pending.size).toBe(0);
  });
});

describe("rate limiting and coalesced summary (F12, AC-F12-01)", () => {
  it("orders needs_approval above completed", () => {
    const store = new MemoryPipelineStore();
    const deps = makeDeps(store);

    const approval = processEvent(
      event({
        eventType: "agent.needs_approval",
        sessionId: "session-a",
        details: { requestId: "req-a" },
      }),
      deps,
    );
    const completed = processEvent(
      event({
        eventType: "agent.completed",
        sessionId: "session-b",
        details: { completionScope: "session" },
      }),
      deps,
    );

    expect(approval.planned[0]?.priority).toBe(5);
    expect(completed.planned[0]?.priority).toBe(1);
    expect(approval.planned[0]!.priority).toBeGreaterThan(completed.planned[0]!.priority);
  });

  it("uses one audible admission for sound and voice together", () => {
    const store = new MemoryPipelineStore();
    const limiter = new CountingRateLimiter(6);
    const config = makeConfig(enableAllChannels);

    processEvent(
      event({
        eventType: "agent.needs_approval",
        details: { requestId: "req-1" },
      }),
      makeDeps(store, { config, rateLimiter: limiter }),
    );

    expect(limiter.admits).toBe(1);
  });

  it("rate-limits only audible channels and synthesizes one coalesced summary", () => {
    const store = new MemoryPipelineStore();
    const config = makeConfig((draft) => {
      enableAllChannels(draft);
      draft.rateLimit.maxAlertsPerMinute = 0;
    });

    const result = processEvent(
      event({
        eventType: "agent.completed",
        projectName: "proj",
        details: { completionScope: "session" },
      }),
      makeDeps(store, { config }),
    );

    expect(result.planned).toHaveLength(2);
    const original = result.planned[0]!;
    const summary = result.planned[1]!;

    expect(channel(original, "sound")).toEqual({
      channel: "sound",
      decision: "suppress",
      reason: "rate_limit",
    });
    expect(channel(original, "voice")).toEqual({
      channel: "voice",
      decision: "suppress",
      reason: "rate_limit",
    });
    expect(channel(original, "desktop")).toEqual({
      channel: "desktop",
      decision: "dispatch",
    });

    expect(channel(summary, "sound")?.decision).toBe("dispatch");
    expect(channel(summary, "voice")?.decision).toBe("dispatch");
    expect(channel(summary, "desktop")).toEqual({
      channel: "desktop",
      decision: "suppress",
      reason: "coalesced",
    });
    expect(summary.rendered?.title).toBe("1 agents need your attention");
    expect(summary.priority).toBe(original.priority);
  });

  it("bypasses the limit only for a new input requestId", () => {
    const store = new MemoryPipelineStore();
    const config = makeConfig((draft) => {
      draft.rateLimit.maxAlertsPerMinute = 1;
    });
    const limiter = new RollingRateLimiter(1);
    const deps = makeDeps(store, { config, rateLimiter: limiter });

    processEvent(
      event({
        eventType: "agent.completed",
        sessionId: "filler",
        details: { completionScope: "session" },
      }),
      deps,
    );

    const first = processEvent(
      event({
        eventType: "agent.needs_input",
        details: { requestId: "req-a" },
      }),
      deps,
    );
    expect(channel(first.planned[0]!, "sound")?.decision).toBe("dispatch");

    const second = processEvent(
      event({
        eventType: "agent.needs_input",
        eventId: "event-second",
        details: { requestId: "req-a" },
      }),
      deps,
    );
    expect(channel(second.planned[0]!, "sound")).toEqual({
      channel: "sound",
      decision: "suppress",
      reason: "rate_limit",
    });
  });
});

describe("timers (PRD §14.2 step 4)", () => {
  it("emits a stale timer for a working session", () => {
    const store = new MemoryPipelineStore();
    const config = makeConfig((draft) => {
      draft.stale.workingAfterMinutes = 15;
    });

    const result = processEvent(
      event({ eventType: "agent.started" }),
      makeDeps(store, { config }),
    );

    expect(result.session?.state).toBe("working");
    expect(result.timers).toContainEqual({
      kind: "stale",
      dueAt: "2026-10-20T10:15:00.000Z",
      sessionKey: "adapter-a:session-1",
    });
  });

  it("emits a reminder timer when an input request opens and reminders are enabled", () => {
    const store = new MemoryPipelineStore();
    const config = makeConfig((draft) => {
      draft.reminders.enabled = true;
      draft.reminders.afterMinutes = 10;
    });

    const result = processEvent(
      event({
        eventType: "agent.needs_input",
        details: { requestId: "req-1" },
      }),
      makeDeps(store, { config }),
    );

    expect(result.timers).toContainEqual({
      kind: "reminder",
      dueAt: "2026-10-20T10:10:00.000Z",
      sessionKey: "adapter-a:session-1",
      requestId: "req-1",
    });
  });

  it("does not emit reminders while reminders are disabled", () => {
    const store = new MemoryPipelineStore();

    const result = processEvent(
      event({
        eventType: "agent.needs_approval",
        details: { requestId: "req-1" },
      }),
      makeDeps(store),
    );

    expect(result.timers.some((timer) => timer.kind === "reminder")).toBe(false);
  });
});

describe("rendering (PRD §14.3)", () => {
  it("uses the configured time-label formatter with an ISO fallback", () => {
    const fallbackStore = new MemoryPipelineStore();
    const fallback = processEvent(
      event({
        eventType: "agent.needs_input",
        projectName: "proj",
        details: { requestId: "req-1" },
      }),
      makeDeps(fallbackStore),
    );
    expect(fallback.planned[0]?.rendered?.body).toBe("proj · 10:00");

    const customStore = new MemoryPipelineStore();
    const custom = processEvent(
      event({
        eventType: "agent.needs_input",
        projectName: "proj",
        details: { requestId: "req-1" },
      }),
      makeDeps(customStore, {
        formatTimeLabel: (iso) => `at ${iso}`,
      }),
    );
    expect(custom.planned[0]?.rendered?.body).toBe("proj · at 2026-10-20T10:00:00Z");
  });

  it("applies discreet privacy mode to the planned notification", () => {
    const store = new MemoryPipelineStore();
    const config = makeConfig((draft) => {
      draft.privacy.mode = "discreet";
    });

    const result = processEvent(
      event({
        eventType: "agent.needs_input",
        projectName: "proj",
        details: { requestId: "req-1" },
      }),
      makeDeps(store, { config }),
    );

    expect(result.planned[0]?.rendered).toEqual({
      title: "An agent needs attention",
      body: "10:00",
      speech: "An agent needs attention.",
    });
  });
});
