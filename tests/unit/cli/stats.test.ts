import { describe, expect, it } from "vitest";
import { buildStatsReport } from "../../../packages/cli/src/commands/stats";

describe("local dogfood stats", () => {
  it("aggregates deliveries by local day and suppression reason", () => {
    const report = buildStatsReport([
      { eventType: "agent.completed", occurredAt: "2026-10-21T10:00:00.000Z", status: "delivered" },
      { eventType: "agent.failed", occurredAt: "2026-10-21T10:01:00.000Z", status: "suppressed", reason: "quiet_hours" },
      { eventType: "reminder", occurredAt: "2026-10-21T10:02:00.000Z", status: "delivered" },
    ], 7, new Date("2026-10-21T12:00:00.000Z"));
    expect(report.days[0]).toEqual({ date: "2026-10-21", alertsByClass: { "agent.completed": 1, reminder: 1 }, suppressedByReason: { quiet_hours: 1 }, remindersSent: 1 });
  });
  it("rejects zero days", () => { expect(() => buildStatsReport([], 0)).toThrow(); });
});
