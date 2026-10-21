import { parseAgentEvent, type AgentEvent } from "@agent-attention/contract";
import { describe, expect, it } from "vitest";
import { capabilitiesFor } from "../../../../adapters/claude-code/src/capabilities";
import { createNormalizer } from "../../../../adapters/claude-code/src/normalize";
import type { ClaudeCodeHookEvent } from "../../../../adapters/claude-code/src/types";

const NOW = "2026-10-21T10:00:00.000Z";
const normalizer = () => createNormalizer({ capabilities: capabilitiesFor(), now: () => Date.parse(NOW) });

function expectValid(events: readonly AgentEvent[]): void {
  for (const event of events) expect(parseAgentEvent(event).ok).toBe(true);
}

describe("Claude Code hook normalization", () => {
  it("maps verified hooks without copying host payload text", () => {
    const events = [
      { hookEventName: "SessionStart", sessionId: "session-1", cwd: "C:\\work\\hostile project", projectId: "project-1" },
      { hookEventName: "PermissionRequest", sessionId: "session-1", requestId: "request-1" },
      { hookEventName: "Stop", sessionId: "session-1", turnId: "turn-1" },
      { hookEventName: "StopFailure", sessionId: "session-1", turnId: "turn-2", failureCode: "host_error" as const },
      { hookEventName: "SessionEnd", sessionId: "session-1" },
    ] satisfies ClaudeCodeHookEvent[];

    const emitted = events.flatMap((event) => normalizer().normalize(event));
    expectValid(emitted);
    expect(emitted.map((event) => event.eventType)).toEqual(["agent.started", "agent.needs_approval", "agent.turn_ended", "agent.failed", "agent.session_ended"]);
    expect(emitted[1]?.details).toEqual({ requestId: "request-1" });
    expect(emitted[3]?.details).toEqual({ failureCode: "host_error" });
    expect(JSON.stringify(emitted)).not.toContain("hostile project");
    expect(emitted.every((event) => event.eventIdStability === "synthetic" && event.dedupeKey)).toBe(true);
  });

  it("suppresses repeated delivery of the same hook discriminator", () => {
    const instance = normalizer();
    const hook: ClaudeCodeHookEvent = { hookEventName: "PermissionRequest", sessionId: "session-1", requestId: "request-1" };
    expect(instance.normalize(hook)).toHaveLength(1);
    expect(instance.normalize(hook)).toHaveLength(0);
  });

  it("never treats Stop as completion and ignores unverified hooks", () => {
    const instance = normalizer();
    const stop = instance.normalize({ hookEventName: "Stop", sessionId: "session-1", turnId: "turn-1" });
    expect(stop[0]?.eventType).toBe("agent.turn_ended");
    expect(instance.normalize({ hookEventName: "Progress", sessionId: "session-1" })).toEqual([]);
  });
});
