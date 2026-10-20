import { defaultConfig } from "@agent-attention/contract";
import {
  RollingRateLimiter,
  type PipelineDependencies,
} from "@agent-attention/core";
import { describe, expect, it } from "vitest";
import { MemoryPipelineStore } from "../../helpers/memory-store";
import {
  loadFixture,
  parseFixture,
  replayFixture,
} from "../../helpers/fixtures";

const NOW = "2026-10-20T10:01:00Z";

function makeHarness() {
  const store = new MemoryPipelineStore();
  const config = structuredClone(defaultConfig);
  const deps: PipelineDependencies = {
    store,
    config,
    clock: { now: () => NOW, nowMs: () => Date.parse(NOW) },
    rateLimiter: new RollingRateLimiter(config.rateLimit.maxAlertsPerMinute),
    quietHoursMinutes: () => 600,
  };
  return { store, deps };
}

describe("synthetic fixture replay", () => {
  it("replays a full session to the expected snapshot and notifications", () => {
    const fixture = loadFixture("synthetic/basic-session.jsonl");
    const harness = makeHarness();

    const result = replayFixture(fixture, harness.deps);

    expect(result.statuses).toEqual([
      "processed",
      "processed",
      "processed",
      "processed",
      "processed",
    ]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      adapterId: "synthetic",
      sessionId: "session-1",
      state: "completed",
      stateConfidence: "authoritative",
      pendingRequests: [],
    });
    expect(result.notifications.map((plan) => plan.eventType)).toEqual([
      "agent.needs_input",
      "agent.completed",
    ]);
  });

  it("does not re-deliver notifications when the same stream is replayed", () => {
    const fixture = loadFixture("synthetic/basic-session.jsonl");
    const harness = makeHarness();

    replayFixture(fixture, harness.deps);
    const storedAfterFirstRun = harness.store.events.length;

    const second = replayFixture(fixture, harness.deps);

    expect(second.notifications).toEqual([]);
    expect(second.statuses).toContain("duplicate");
    expect(harness.store.events).toHaveLength(storedAfterFirstRun);
  });

  it("fails with a readable diff when the expected snapshot is wrong", () => {
    const fixture = loadFixture("synthetic/basic-session.jsonl");
    const mismatched = {
      ...fixture,
      expected: [
        {
          adapterId: "synthetic",
          sessionId: "session-1",
          state: "failed" as const,
          stateConfidence: "authoritative" as const,
        },
      ],
    };

    expect(() => replayFixture(mismatched, makeHarness().deps)).toThrow(
      /state: expected "failed", got "completed"/,
    );
  });

  it("rejects a fixture whose first content line is not meta", () => {
    expect(() =>
      parseFixture('{"kind":"event","event":{"schemaVersion":1}}', "bad"),
    ).toThrow(/meta must be the first content line/);
  });

  it("rejects a fixture event that fails contract validation", () => {
    const text = [
      '{"kind":"meta","name":"bad","host":"synthetic","recordedAt":"2026-10-20T10:00:00Z","hostVersion":"0.0.0"}',
      '{"kind":"event","event":{"schemaVersion":1,"eventType":"agent.completed"}}',
    ].join("\n");

    expect(() => parseFixture(text, "bad")).toThrow(/invalid event/);
  });
});
