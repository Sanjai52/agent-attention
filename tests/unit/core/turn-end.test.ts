import type { TurnEndInput } from "@agent-attention/core";
import { evaluateTurnEnd } from "@agent-attention/core";
import { describe, expect, it } from "vitest";

const BASE_INPUT: TurnEndInput = {
  turnDurationMs: 60_000,
  minTurnSeconds: 15,
  classifiedEventWithinGrace: false,
  isSubagent: false,
  notifySubagents: false,
};

function evaluate(overrides: Partial<TurnEndInput> = {}) {
  return evaluateTurnEnd({ ...BASE_INPUT, ...overrides });
}

describe("evaluateTurnEnd minimum duration (F10-R5, AC-F10-03)", () => {
  it("alerts for a turn longer than the minimum", () => {
    expect(evaluate()).toEqual({ decision: "alert" });
  });

  it("suppresses a turn shorter than minTurnSeconds", () => {
    expect(evaluate({ turnDurationMs: 14_999 })).toEqual({
      decision: "suppress",
      reason: "below_min_turn",
    });
  });

  it("alerts exactly at the minimum duration (shorter-than, not shorter-or-equal)", () => {
    expect(evaluate({ turnDurationMs: 15_000 })).toEqual({ decision: "alert" });
  });

  it("suppresses a zero-length turn", () => {
    expect(evaluate({ turnDurationMs: 0 })).toEqual({
      decision: "suppress",
      reason: "below_min_turn",
    });
  });

  it("alerts when the duration is unknown, because it cannot prove the turn was short", () => {
    expect(evaluate({ turnDurationMs: undefined })).toEqual({ decision: "alert" });
  });

  it("alerts when the minimum is zero even for a zero-length turn", () => {
    expect(evaluate({ turnDurationMs: 0, minTurnSeconds: 0 })).toEqual({ decision: "alert" });
  });
});

describe("evaluateTurnEnd grace precedence (F10-R3, AC-F10-02)", () => {
  it("suppresses turn_ended when a classified event arrived within the grace window", () => {
    expect(evaluate({ classifiedEventWithinGrace: true })).toEqual({
      decision: "suppress",
      reason: "grace_superseded",
    });
  });

  it("lets grace suppression win over the minimum-duration check", () => {
    expect(evaluate({ classifiedEventWithinGrace: true, turnDurationMs: 1_000 })).toEqual({
      decision: "suppress",
      reason: "grace_superseded",
    });
  });

  it("lets grace suppression win over subagent suppression", () => {
    expect(
      evaluate({
        classifiedEventWithinGrace: true,
        isSubagent: true,
        notifySubagents: false,
      }),
    ).toEqual({ decision: "suppress", reason: "grace_superseded" });
  });
});

describe("evaluateTurnEnd subagent rules (F10-R6)", () => {
  it("suppresses a subagent turn-end unless notifySubagents is enabled", () => {
    expect(evaluate({ isSubagent: true, notifySubagents: false })).toEqual({
      decision: "suppress",
      reason: "subagent",
    });
  });

  it("alerts for a subagent turn-end when notifySubagents is enabled", () => {
    expect(evaluate({ isSubagent: true, notifySubagents: true })).toEqual({
      decision: "alert",
    });
  });

  it("still applies the minimum duration to an enabled subagent", () => {
    expect(evaluate({ isSubagent: true, notifySubagents: true, turnDurationMs: 2_000 })).toEqual({
      decision: "suppress",
      reason: "below_min_turn",
    });
  });

  it("reports subagent suppression before minimum duration when both apply", () => {
    expect(evaluate({ isSubagent: true, notifySubagents: false, turnDurationMs: 1_000 })).toEqual({
      decision: "suppress",
      reason: "subagent",
    });
  });

  it("does not treat a non-subagent session as suppressed when notifySubagents is false", () => {
    expect(evaluate({ isSubagent: false, notifySubagents: false })).toEqual({ decision: "alert" });
  });
});
