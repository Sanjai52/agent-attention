import { describe, expect, it } from "vitest";
import { buildStatusReport } from "../../../packages/host/src/status-query";

describe("status query", () => {
  it("keeps sessions separate and reports pending request age", () => {
    const report = buildStatusReport({
      listSessions: () => [{ adapterId: "opencode", sessionId: "session-123456789", agentName: "OpenCode", state: "working", stateConfidence: "authoritative", lastEventAt: "2026-10-21T10:00:00.000Z", lastSeenAt: "2026-10-21T10:00:00.000Z", lastVerifiedAt: undefined, pendingRequests: [], tasks: [], isSubagent: false }],
      openRequests: () => [{ adapterId: "opencode", sessionId: "session-123456789", requestId: "req-1", kind: "approval", openedAt: "2026-10-21T09:59:00.000Z", remindersSent: 0 }],
    }, "2026-10-21T10:01:00.000Z");
    expect(report.sessions[0]?.sessionIdShort).toBe("session-…789");
    expect(report.sessions[0]?.pendingRequests[0]?.ageSeconds).toBe(120);
  });
});
