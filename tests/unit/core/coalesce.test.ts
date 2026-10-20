import type { AgentEventType } from "@agent-attention/contract";
import { planCoalescing } from "@agent-attention/core";
import type { EligibleAlert } from "@agent-attention/core";
import { describe, expect, it } from "vitest";

const T0 = Date.parse("2026-10-20T10:00:00Z");

function at(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

function alert(
  eventClass: AgentEventType,
  offsetMs: number,
  sessionKey = "adapter-a:session-1",
): EligibleAlert {
  return { eventClass, at: at(offsetMs), sessionKey };
}

describe("planCoalescing", () => {
  it("returns an empty plan when there are no eligible alerts", () => {
    expect(planCoalescing([], 5)).toEqual({ groups: [], summaryRequired: false });
  });

  it("merges alerts of the same class within the window (F12-R3)", () => {
    const alerts = [
      alert("agent.needs_input", 0, "adapter-a:session-1"),
      alert("agent.needs_input", 2_000, "adapter-a:session-2"),
      alert("agent.needs_input", 4_000, "adapter-b:session-3"),
    ];

    expect(planCoalescing(alerts, 5)).toEqual({
      groups: [
        {
          eventClass: "agent.needs_input",
          count: 3,
          firstAt: at(0),
          lastAt: at(4_000),
        },
      ],
      summaryRequired: true,
    });
  });

  it("never merges different event classes", () => {
    const alerts = [
      alert("agent.needs_input", 0),
      alert("agent.needs_approval", 1_000),
      alert("agent.completed", 2_000),
    ];

    const plan = planCoalescing(alerts, 5);

    expect(plan.groups.map((group) => group.eventClass)).toEqual([
      "agent.needs_input",
      "agent.needs_approval",
      "agent.completed",
    ]);
    expect(plan.groups.every((group) => group.count === 1)).toBe(true);
    expect(plan.summaryRequired).toBe(false);
  });

  it("starts a new group once the window has elapsed", () => {
    const alerts = [alert("agent.failed", 0), alert("agent.failed", 6_000)];

    expect(planCoalescing(alerts, 5)).toEqual({
      groups: [
        { eventClass: "agent.failed", count: 1, firstAt: at(0), lastAt: at(0) },
        { eventClass: "agent.failed", count: 1, firstAt: at(6_000), lastAt: at(6_000) },
      ],
      summaryRequired: false,
    });
  });

  it("anchors each window at its first alert instead of chaining indefinitely", () => {
    const alerts = [
      alert("agent.completed", 0),
      alert("agent.completed", 4_000),
      alert("agent.completed", 8_000),
    ];

    const plan = planCoalescing(alerts, 5);

    expect(plan.groups).toHaveLength(2);
    expect(plan.groups[0]).toMatchObject({ count: 2, firstAt: at(0), lastAt: at(4_000) });
    expect(plan.groups[1]).toMatchObject({ count: 1, firstAt: at(8_000), lastAt: at(8_000) });
  });

  it("merges alerts at the same instant with a zero-second window", () => {
    const alerts = [
      alert("agent.turn_ended", 0, "adapter-a:session-1"),
      alert("agent.turn_ended", 0, "adapter-a:session-2"),
      alert("agent.turn_ended", 1),
    ];

    const plan = planCoalescing(alerts, 0);

    expect(plan.groups).toEqual([
      { eventClass: "agent.turn_ended", count: 2, firstAt: at(0), lastAt: at(0) },
      {
        eventClass: "agent.turn_ended",
        count: 1,
        firstAt: at(1),
        lastAt: at(1),
      },
    ]);
  });

  it("keeps every event in history and does not mutate the caller's list", () => {
    const history = [
      alert("agent.needs_input", 3_000),
      alert("agent.needs_input", 1_000),
      alert("agent.needs_input", 2_000),
    ];
    const before = history.map((entry) => ({ ...entry }));

    const plan = planCoalescing(history, 5);

    expect(history).toEqual(before);
    expect(history).toHaveLength(3);
    expect(plan.groups.reduce((total, group) => total + group.count, 0)).toBe(history.length);
    expect(plan.groups[0]).toMatchObject({ firstAt: at(1_000), lastAt: at(3_000) });
  });

  it("sorts out-of-order alerts without reordering the caller's list", () => {
    const history = [
      alert("agent.failed", 3_000),
      alert("agent.failed", 1_000),
      alert("agent.failed", 2_000),
    ];

    const plan = planCoalescing(history, 5);

    expect(plan.groups).toEqual([
      { eventClass: "agent.failed", count: 3, firstAt: at(1_000), lastAt: at(3_000) },
    ]);
    expect(history.map((entry) => entry.at)).toEqual([at(3_000), at(1_000), at(2_000)]);
  });
});
