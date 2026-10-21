import { AGENT_EVENT_TYPES, type AgentEventType } from "@agent-attention/contract";
import { describe, expect, it } from "vitest";

import {
  assertEmittable,
  capabilitiesFor,
} from "../../../../adapters/opencode/src/capabilities";
import {
  OPENCODE_ADAPTER_ID,
  OPENCODE_ADAPTER_VERSION,
} from "../../../../adapters/opencode/src/types";

const EXPECTED: Record<
  AgentEventType,
  { support: "authoritative" | "inferred" | "unsupported"; sourceSignal?: string }
> = {
  "agent.started": { support: "authoritative", sourceSignal: "session.execution.started" },
  "agent.progress": { support: "authoritative", sourceSignal: "session.step.started" },
  "agent.needs_input": { support: "unsupported" },
  "agent.needs_approval": { support: "authoritative", sourceSignal: "permission.asked" },
  "agent.approval_resolved": {
    support: "authoritative",
    sourceSignal: "permission.replied",
  },
  "agent.resumed": { support: "unsupported" },
  "agent.turn_ended": { support: "inferred", sourceSignal: "session.execution.interrupted" },
  "agent.completed": { support: "authoritative", sourceSignal: "session.execution.succeeded" },
  "agent.failed": { support: "authoritative", sourceSignal: "session.execution.failed" },
  "agent.session_ended": { support: "unsupported" },
  "agent.state_unknown": { support: "unsupported" },
};

describe("OpenCode capability declaration", () => {
  it("declares every contract event exactly once", () => {
    const capabilities = capabilitiesFor("2.0.32");

    expect(Object.keys(capabilities.events).sort()).toEqual([...AGENT_EVENT_TYPES].sort());
    expect(AGENT_EVENT_TYPES).toHaveLength(11);
  });

  it("declares the measured support level and source signal for every event", () => {
    const capabilities = capabilitiesFor("2.0.32");

    for (const eventType of AGENT_EVENT_TYPES) {
      const expected = EXPECTED[eventType];
      const actual = capabilities.events[eventType];

      expect(actual.support, eventType).toBe(expected.support);
      if (expected.sourceSignal !== undefined) {
        expect(actual.sourceSignal, eventType).toBe(expected.sourceSignal);
        expect(actual.verifiedAgainst, eventType).toBe("OpenCode v2.0.32");
      } else {
        expect(actual.sourceSignal, eventType).toBeUndefined();
      }
    }
  });

  it("advertises the adapter flags verified for OpenCode v2.0.32", () => {
    const capabilities = capabilitiesFor("2.0.32");

    expect(capabilities.adapterId).toBe(OPENCODE_ADAPTER_ID);
    expect(capabilities.adapterVersion).toBe(OPENCODE_ADAPTER_VERSION);
    expect(capabilities.executionModel).toBe("in_process_plugin");
    expect(capabilities.hostVersionRange).toBe(">=2.0.32 <2.1.0");
    expect(capabilities.eventIdsStable).toBe(true);
    expect(capabilities.supportsSequence).toBe(true);
    expect(capabilities.supportsTaskScope).toBe(false);
    expect(capabilities.supportsSubagents).toBe(true);
    expect(capabilities.supportsLiveness).toBe(true);
    expect(capabilities.supportsResolutionSignals).toBe(true);
  });

  it("refuses to emit an unsupported event type", () => {
    const capabilities = capabilitiesFor("2.0.32");

    for (const eventType of [
      "agent.needs_input",
      "agent.resumed",
      "agent.session_ended",
      "agent.state_unknown",
    ] as const) {
      expect(() => assertEmittable(capabilities, eventType)).toThrow(eventType);
    }
  });

  it("allows every supported event type", () => {
    const capabilities = capabilitiesFor("2.0.32");

    for (const eventType of AGENT_EVENT_TYPES) {
      if (capabilities.events[eventType].support === "unsupported") {
        continue;
      }
      expect(() => assertEmittable(capabilities, eventType)).not.toThrow();
    }
  });
});
