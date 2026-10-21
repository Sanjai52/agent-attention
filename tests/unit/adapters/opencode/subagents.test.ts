import { describe, expect, it } from "vitest";

import type { OpenCodeEvent } from "../../../../adapters/opencode/src/types";
import { normalizeEvents } from "./helpers";

const context = {
  app: { name: "cli", version: "2.0.32" },
  location: { directory: "C:\\work\\sandbox" },
};

describe("OpenCode subagent signals", () => {
  it("retains the parent relationship on child lifecycle events", () => {
    const created: OpenCodeEvent = {
      id: "evt_child_created",
      created: 1792489223900,
      type: "session.created",
      durable: { aggregateID: "ses_child", seq: 0, version: 1 },
      data: {
        sessionID: "ses_child",
        projectID: "project",
        parentID: "ses_parent",
        location: { directory: "C:\\work\\sandbox\\child" },
      },
    };
    const started: OpenCodeEvent = {
      id: "evt_child_started",
      created: 1792489223901,
      type: "session.execution.started",
      durable: { aggregateID: "ses_child", seq: 2, version: 1 },
      data: { sessionID: "ses_child" },
    };
    const completed: OpenCodeEvent = {
      id: "evt_child_completed",
      created: 1792489223902,
      type: "session.execution.succeeded",
      durable: { aggregateID: "ses_child", seq: 3, version: 1 },
      data: { sessionID: "ses_child" },
    };

    const events = normalizeEvents([created, started, completed], context);
    expect(events.map((event) => event.eventType)).toEqual([
      "agent.started",
      "agent.completed",
    ]);
    expect(events[0]?.session).toMatchObject({
      sessionId: "ses_child",
      parentSessionId: "ses_parent",
      isSubagent: true,
    });
  });
});
