import { parseAgentEvent, type AgentEvent } from "@agent-attention/contract";
import { describe, expect, it } from "vitest";

import type { OpenCodeEvent } from "../../../../adapters/opencode/src/types";
import { normalizeEvents, serialized } from "./helpers";

const context = {
  app: { name: "cli", version: "2.0.32" },
  location: { directory: "C:\\work\\sandbox" },
};

function expectValid(events: readonly AgentEvent[]): void {
  for (const event of events) expect(parseAgentEvent(event).ok).toBe(true);
}

describe("OpenCode approval signals", () => {
  it("emits a redacted approval request and its resolution", () => {
    const asked: OpenCodeEvent = {
      id: "evt_permission_asked",
      created: 1792489223731,
      type: "permission.asked",
      durable: { aggregateID: "ses_approval", seq: 4, version: 1 },
      data: {
        sessionID: "ses_approval",
        id: "per_approval",
        action: "shell",
        resources: ["DECOY_COMMAND"],
        source: { id: "DECOY_TOOL_CALL", messageID: "DECOY_MESSAGE" },
      },
    };
    const replied: OpenCodeEvent = {
      id: "evt_permission_replied",
      created: 1792489223906,
      type: "permission.replied",
      durable: { aggregateID: "ses_approval", seq: 5, version: 1 },
      data: { sessionID: "ses_approval", requestID: "per_approval", reply: "once" },
    };

    const events = normalizeEvents([asked, replied], context);
    expectValid(events);
    expect(events.map((event) => event.eventType)).toEqual([
      "agent.needs_approval",
      "agent.approval_resolved",
    ]);
    expect(events[0]?.details).toEqual({ requestId: "per_approval" });
    expect(events[1]?.details).toEqual({ requestId: "per_approval", resolution: "approved" });
    expect(serialized(events)).not.toContain("DECOY_COMMAND");
    expect(serialized(events)).not.toContain("DECOY_TOOL_CALL");
    expect(serialized(events)).not.toContain("DECOY_MESSAGE");
  });

  it("maps reject to denied and suppresses duplicate host event ids", () => {
    const replied: OpenCodeEvent = {
      id: "evt_permission_denied",
      created: 1792489223906,
      type: "permission.replied",
      durable: { aggregateID: "ses_approval", seq: 5, version: 1 },
      data: { sessionID: "ses_approval", requestID: "per_approval", reply: "reject" },
    };
    const events = normalizeEvents([replied, replied], context);
    expect(events).toHaveLength(1);
    expect(events[0]?.details).toEqual({ requestId: "per_approval", resolution: "denied" });
  });
});
