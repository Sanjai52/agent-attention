import { AGENT_EVENT_TYPES, type AgentEventType } from "@agent-attention/contract";
import { describe, expect, it } from "vitest";
import { assertEmittable, capabilitiesFor } from "../../../../adapters/claude-code/src/capabilities";

const EXPECTED: Record<AgentEventType, "authoritative" | "inferred" | "unsupported"> = {
  "agent.started": "authoritative",
  "agent.progress": "unsupported",
  "agent.needs_input": "unsupported",
  "agent.needs_approval": "authoritative",
  "agent.approval_resolved": "unsupported",
  "agent.resumed": "unsupported",
  "agent.turn_ended": "inferred",
  "agent.completed": "unsupported",
  "agent.failed": "authoritative",
  "agent.session_ended": "authoritative",
  "agent.state_unknown": "unsupported",
};

describe("Claude Code capability declaration", () => {
  it("declares every contract event exactly once", () => {
    const capabilities = capabilitiesFor();
    expect(Object.keys(capabilities.events).sort()).toEqual([...AGENT_EVENT_TYPES].sort());
  });

  it("claims only the verified hook support", () => {
    const capabilities = capabilitiesFor();
    for (const eventType of AGENT_EVENT_TYPES) expect(capabilities.events[eventType].support, eventType).toBe(EXPECTED[eventType]);
    expect(capabilities.events["agent.started"].sourceSignal).toBe("SessionStart");
    expect(capabilities.events["agent.needs_approval"].sourceSignal).toBe("PermissionRequest");
    expect(capabilities.events["agent.turn_ended"].sourceSignal).toBe("Stop");
    expect(capabilities.events["agent.failed"].sourceSignal).toBe("StopFailure | PostToolUseFailure");
  });

  it("advertises hook-process limitations", () => {
    const capabilities = capabilitiesFor();
    expect(capabilities.executionModel).toBe("hook_process");
    expect(capabilities.eventIdsStable).toBe(false);
    expect(capabilities.supportsSequence).toBe(false);
    expect(capabilities.supportsTaskScope).toBe(false);
    expect(capabilities.supportsSubagents).toBe(false);
    expect(capabilities.supportsResolutionSignals).toBe(false);
  });

  it("rejects unsupported event emission", () => {
    const capabilities = capabilitiesFor();
    expect(() => assertEmittable(capabilities, "agent.completed")).toThrow("agent.completed");
    expect(() => assertEmittable(capabilities, "agent.approval_resolved")).toThrow("agent.approval_resolved");
  });
});
