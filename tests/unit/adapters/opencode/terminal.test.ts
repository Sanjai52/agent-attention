import { parseAgentEvent, type AgentEvent } from "@agent-attention/contract";
import { describe, expect, it } from "vitest";

import type { OpenCodeEvent } from "../../../../adapters/opencode/src/types";
import { normalizeEvents, normalizeFixture } from "./helpers";

function expectContractValid(events: readonly AgentEvent[]): void {
  for (const event of events) {
    const parsed = parseAgentEvent(event);
    expect(parsed.ok, parsed.ok ? undefined : JSON.stringify(parsed.errors)).toBe(true);
  }
}

function terminalEvents(events: readonly AgentEvent[]): AgentEvent[] {
  return events.filter(
    (event) =>
      event.eventType === "agent.completed" ||
      event.eventType === "agent.failed" ||
      event.eventType === "agent.turn_ended",
  );
}

describe("OpenCode terminal signals", () => {
  it("maps a user abort to an inferred turn end, never a failure", () => {
    const { emitted } = normalizeFixture("abort.jsonl");
    expectContractValid(emitted);

    expect(emitted.map((event) => event.eventType)).toEqual([
      "agent.started",
      "agent.progress",
      "agent.turn_ended",
    ]);

    const turnEnded = terminalEvents(emitted)[0];
    expect(turnEnded).toMatchObject({
      eventType: "agent.turn_ended",
      eventId: "evt_158af85c5001KJ115wcCTnw6K0",
      sequence: 7,
      confidence: "inferred",
      occurredAt: "2026-10-20T09:41:00.485Z",
      session: { sessionId: "ses_ea750873dffeeQCuvi4BCE3QJb" },
    });
    expect(turnEnded?.details).toBeUndefined();
    expect(emitted.some((event) => event.eventType === "agent.failed")).toBe(false);
    expect(emitted.some((event) => event.eventType === "agent.completed")).toBe(false);
  });

  it("maps session.execution.failed to host_error exactly once", () => {
    const { emitted } = normalizeFixture("error-invalid-model.jsonl");
    expectContractValid(emitted);

    const terminal = terminalEvents(emitted);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      eventType: "agent.failed",
      eventId: "evt_158af9b39001yqwzBOGZazv6fU",
      sequence: 7,
      confidence: "authoritative",
      occurredAt: "2026-10-20T09:41:05.977Z",
      details: { failureCode: "host_error" },
      session: { sessionId: "ses_ea7507524ffeq781lq0dyU3lhL" },
    });
    expect(emitted.some((event) => event.eventType === "agent.completed")).toBe(false);
  });

  it("treats a denied permission followed by interrupted(shutdown) as a turn end", () => {
    const { emitted } = normalizeFixture("permission-deny.jsonl");
    expectContractValid(emitted);

    expect(emitted.some((event) => event.eventType === "agent.failed")).toBe(false);
    expect(emitted.some((event) => event.eventType === "agent.completed")).toBe(false);

    const terminal = terminalEvents(emitted);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      eventType: "agent.turn_ended",
      confidence: "inferred",
      eventId: "evt_158af16d6001kxsn3tCjsF9cTs",
      sequence: 14,
      session: { sessionId: "ses_ea750fc26ffeFBc5VhUrsb17r9" },
    });
  });

  it("does not emit a second terminal event when a host line repeats", () => {
    const context = {
      app: { name: "cli", version: "2.0.32" },
      location: { directory: "C:\\work\\sandbox" },
    };
    const succeeded: OpenCodeEvent = {
      id: "evt_repeated_success",
      created: 1_792_489_000_009,
      type: "session.execution.succeeded",
      durable: { aggregateID: "ses_repeated", seq: 10, version: 1 },
      data: { sessionID: "ses_repeated" },
    };

    const emitted = normalizeEvents([succeeded, succeeded], context);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      eventType: "agent.completed",
      details: { completionScope: "session" },
    });
  });

  it("does not map step or tool failures to agent.failed", () => {
    const context = {
      app: { name: "cli", version: "2.0.32" },
      location: { directory: "C:\\work\\sandbox" },
    };
    const stepFailed: OpenCodeEvent = {
      id: "evt_step_failed",
      created: 1_792_489_000_010,
      type: "session.step.failed",
      durable: { aggregateID: "ses_step_failed", seq: 6, version: 1 },
      data: {
        sessionID: "ses_step_failed",
        error: { type: "aborted", message: "Step interrupted" },
      },
    };
    const toolFailed: OpenCodeEvent = {
      id: "evt_tool_failed",
      created: 1_792_489_000_011,
      type: "session.tool.failed",
      durable: { aggregateID: "ses_step_failed", seq: 7, version: 1 },
      data: {
        sessionID: "ses_step_failed",
        error: { type: "aborted", message: "The user declined this tool call" },
      },
    };

    expect(normalizeEvents([stepFailed, toolFailed], context)).toEqual([]);
  });
});
