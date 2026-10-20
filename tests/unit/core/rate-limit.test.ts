import type { AgentEventType } from "@agent-attention/contract";
import { defaultConfig } from "@agent-attention/contract";
import { AUDIO_PRIORITY, BYPASS_QUIET_PERIOD_MS, RollingRateLimiter } from "@agent-attention/core";
import { describe, expect, it } from "vitest";
import { makeEvent } from "./event-factory";

const T0 = Date.parse("2026-10-20T10:00:00Z");
const MAX = defaultConfig.rateLimit.maxAlertsPerMinute;

function makeAlert(
  eventType: AgentEventType,
  index: number,
  details?: { requestId?: string },
): ReturnType<typeof makeEvent> {
  return makeEvent({
    eventType,
    eventId: `event-${eventType}-${index}`,
    sessionId: `session-${index}`,
    details,
  });
}

describe("AUDIO_PRIORITY", () => {
  it("orders the five PRD D-10 alert classes from highest to lowest", () => {
    expect(AUDIO_PRIORITY["agent.needs_approval"]).toBeGreaterThan(
      AUDIO_PRIORITY["agent.needs_input"] ?? Number.NaN,
    );
    expect(AUDIO_PRIORITY["agent.needs_input"]).toBeGreaterThan(
      AUDIO_PRIORITY["agent.failed"] ?? Number.NaN,
    );
    expect(AUDIO_PRIORITY["agent.failed"]).toBeGreaterThan(
      AUDIO_PRIORITY["agent.turn_ended"] ?? Number.NaN,
    );
    expect(AUDIO_PRIORITY["agent.turn_ended"]).toBeGreaterThan(
      AUDIO_PRIORITY["agent.completed"] ?? Number.NaN,
    );
  });

  it("assigns a priority only to the five PRD D-10 classes", () => {
    const expected: AgentEventType[] = [
      "agent.needs_approval",
      "agent.needs_input",
      "agent.failed",
      "agent.turn_ended",
      "agent.completed",
    ];
    const nonAlertClasses: AgentEventType[] = [
      "agent.started",
      "agent.progress",
      "agent.approval_resolved",
      "agent.resumed",
      "agent.session_ended",
      "agent.state_unknown",
    ];

    expect(Object.keys(AUDIO_PRIORITY).sort()).toEqual([...expected].sort());
    for (const eventType of nonAlertClasses) {
      expect(AUDIO_PRIORITY[eventType]).toBeUndefined();
    }
  });

  it("sorts an arriving batch approval-first (AC-F12-01 sanity)", () => {
    const arriving: AgentEventType[] = [
      "agent.completed",
      "agent.turn_ended",
      "agent.failed",
      "agent.needs_input",
      "agent.needs_approval",
    ];

    const ordered = [...arriving].sort(
      (a, b) => (AUDIO_PRIORITY[b] ?? 0) - (AUDIO_PRIORITY[a] ?? 0),
    );

    expect(ordered).toEqual([
      "agent.needs_approval",
      "agent.needs_input",
      "agent.failed",
      "agent.turn_ended",
      "agent.completed",
    ]);
  });
});

describe("RollingRateLimiter", () => {
  it("admits at most maxAlertsPerMinute and reports the rest as rate limited (AC-F12-02)", () => {
    const limiter = new RollingRateLimiter(MAX);

    const decisions = Array.from({ length: 10 }, (_, index) =>
      limiter.admit(makeAlert("agent.needs_input", index), T0 + index, { bypass: false }),
    );

    expect(decisions.filter((decision) => decision.admitted)).toHaveLength(MAX);
    expect(decisions.filter((decision) => !decision.admitted)).toHaveLength(10 - MAX);
    for (const decision of decisions.filter((entry) => !entry.admitted)) {
      expect(decision.reason).toBe("rate_limit");
    }
  });

  it("uses a sliding 60 second window", () => {
    const limiter = new RollingRateLimiter(1);

    expect(limiter.admit(makeAlert("agent.completed", 0), T0, { bypass: false }).admitted).toBe(
      true,
    );
    expect(limiter.admit(makeAlert("agent.completed", 1), T0 + 59_999, { bypass: false })).toEqual({
      admitted: false,
      reason: "rate_limit",
    });
    expect(
      limiter.admit(makeAlert("agent.completed", 2), T0 + 60_000, { bypass: false }).admitted,
    ).toBe(true);
  });

  it("bypasses the limit for a new input request after the quiet period (F12-R5)", () => {
    const limiter = new RollingRateLimiter(1);

    expect(
      limiter.admit(makeAlert("agent.needs_approval", 0, { requestId: "request-1" }), T0, {
        bypass: true,
      }).admitted,
    ).toBe(true);

    // Same class within the quiet period: no second bypass, window is full.
    expect(
      limiter.admit(makeAlert("agent.needs_approval", 1, { requestId: "request-2" }), T0 + 1_000, {
        bypass: true,
      }),
    ).toEqual({ admitted: false, reason: "rate_limit" });

    // Exactly at the quiet-period boundary the bypass is available again.
    expect(
      limiter.admit(
        makeAlert("agent.needs_approval", 2, { requestId: "request-3" }),
        T0 + BYPASS_QUIET_PERIOD_MS,
        { bypass: true },
      ).admitted,
    ).toBe(true);
  });

  it("admits an approval through bypass even when the audible window is full", () => {
    const limiter = new RollingRateLimiter(1);

    expect(limiter.admit(makeAlert("agent.completed", 0), T0, { bypass: false }).admitted).toBe(
      true,
    );
    expect(
      limiter.admit(makeAlert("agent.needs_approval", 1, { requestId: "request-1" }), T0 + 1, {
        bypass: true,
      }).admitted,
    ).toBe(true);
  });

  it("requires a requestId and an input/approval class for a bypass", () => {
    const limiter = new RollingRateLimiter(1);
    expect(limiter.admit(makeAlert("agent.completed", 0), T0, { bypass: false }).admitted).toBe(
      true,
    );

    // needs_input without a requestId cannot claim the F12-R5 exception.
    expect(limiter.admit(makeAlert("agent.needs_input", 1), T0 + 1, { bypass: true })).toEqual({
      admitted: false,
      reason: "rate_limit",
    });
  });

  it("does not apply the bypass to non input/approval classes", () => {
    const limiter = new RollingRateLimiter(1);
    expect(limiter.admit(makeAlert("agent.completed", 0), T0, { bypass: false }).admitted).toBe(
      true,
    );

    expect(limiter.admit(makeAlert("agent.completed", 1), T0 + 1, { bypass: true })).toEqual({
      admitted: false,
      reason: "rate_limit",
    });
  });

  it("applies the bypass quiet period per event class, not per session", () => {
    const limiter = new RollingRateLimiter(1);

    // Session A gets the first input bypass.
    expect(
      limiter.admit(makeAlert("agent.needs_input", 0, { requestId: "request-a" }), T0, {
        bypass: true,
      }).admitted,
    ).toBe(true);

    // Session B's brand-new request does not inherit a fresh quiet period.
    expect(
      limiter.admit(makeAlert("agent.needs_input", 1, { requestId: "request-b" }), T0 + 1_000, {
        bypass: true,
      }),
    ).toEqual({ admitted: false, reason: "rate_limit" });
  });

  it("tracks quiet periods independently for input and approval", () => {
    const limiter = new RollingRateLimiter(1);

    expect(
      limiter.admit(makeAlert("agent.needs_approval", 0, { requestId: "approval-1" }), T0, {
        bypass: true,
      }).admitted,
    ).toBe(true);
    expect(
      limiter.admit(makeAlert("agent.needs_input", 1, { requestId: "input-1" }), T0 + 1_000, {
        bypass: true,
      }).admitted,
    ).toBe(true);
  });

  it("records bypass admissions in the sliding window", () => {
    const limiter = new RollingRateLimiter(2);

    expect(
      limiter.admit(makeAlert("agent.needs_approval", 0, { requestId: "approval-1" }), T0, {
        bypass: true,
      }).admitted,
    ).toBe(true);
    expect(
      limiter.admit(makeAlert("agent.needs_input", 1, { requestId: "input-1" }), T0 + 1, {
        bypass: true,
      }).admitted,
    ).toBe(true);
    // Both bypass admissions count toward maxAlertsPerMinute.
    expect(limiter.admit(makeAlert("agent.failed", 2), T0 + 2, { bypass: false })).toEqual({
      admitted: false,
      reason: "rate_limit",
    });
  });
});
