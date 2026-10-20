import { describe, expect, it } from "vitest";
import {
  parseAgentEvent,
  type EventParseResult,
  type ValidationIssue,
} from "@agent-attention/contract";

const exampleEvent = {
  schemaVersion: 1,
  eventId: "event-1001",
  eventIdStability: "source",
  sequence: 14,
  eventType: "agent.needs_input",
  source: {
    adapterId: "example-adapter",
    adapterVersion: "1.0.0",
    agentId: "example-agent",
    agentName: "Example Agent",
  },
  session: { sessionId: "session-123", projectName: "example-project" },
  occurredAt: "2026-10-20T18:20:00Z",
  receivedAt: "2026-10-20T18:20:01Z",
  confidence: "authoritative",
  details: { summaryCode: "INPUT_REQUIRED", requestId: "request-455" },
} as const;

const turnEndedEvent = {
  schemaVersion: 1,
  eventId: "event-1004",
  eventIdStability: "synthetic",
  dedupeKey: "session-123:turn-7",
  eventType: "agent.turn_ended",
  source: {
    adapterId: "example-adapter",
    adapterVersion: "1.0.0",
    agentId: "example-agent",
    agentName: "Example Agent",
  },
  session: { sessionId: "session-123", projectName: "example-project" },
  occurredAt: "2026-10-20T18:25:00Z",
  receivedAt: "2026-10-20T18:25:00Z",
  confidence: "inferred",
  details: { summaryCode: "TURN_ENDED", turnDurationMs: 312000 },
} as const;

function expectRejected(
  result: EventParseResult,
  code: ValidationIssue["code"],
  path?: string,
): ValidationIssue[] {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected event to be rejected");
  }
  const match = result.errors.find(
    (issue) => issue.code === code && (path === undefined || issue.path === path),
  );
  expect(match, JSON.stringify(result.errors)).toBeDefined();
  return result.errors;
}

describe("parseAgentEvent", () => {
  it("parses the PRD §12.4 example and round-trips it identically", () => {
    const result = parseAgentEvent(exampleEvent);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.errors));
    }
    expect(result.event).toEqual(exampleEvent);
  });

  it("parses the PRD §12.6 synthetic turn-ended example", () => {
    const result = parseAgentEvent(turnEndedEvent);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.eventType).toBe("agent.turn_ended");
      expect(result.event.confidence).toBe("inferred");
    }
  });

  it("rejects unsupported schema versions", () => {
    expectRejected(parseAgentEvent({ ...exampleEvent, schemaVersion: 2 }), "unsupported_version");
  });

  it("rejects unknown event types", () => {
    expectRejected(
      parseAgentEvent({ ...exampleEvent, eventType: "agent.exploded" }),
      "unsupported_type",
    );
  });

  it.each([
    ["completionScope", "agent.completed"],
    ["resolution", "agent.approval_resolved"],
    ["resumeReason", "agent.resumed"],
    ["failureCode", "agent.failed"],
  ] as const)("requires details.%s for %s", (field, eventType) => {
    const input = {
      ...exampleEvent,
      eventType,
      details: {},
    };

    expectRejected(parseAgentEvent(input), "missing_details", `details.${field}`);
  });

  it("accepts required-details variants when the field is present", () => {
    const result = parseAgentEvent({
      ...exampleEvent,
      eventType: "agent.completed",
      details: { summaryCode: "TASK_COMPLETED", completionScope: "task" },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects free text at the top level", () => {
    expectRejected(parseAgentEvent({ ...exampleEvent, message: "hi" }), "schema", "message");
  });

  it("rejects free text inside details", () => {
    expectRejected(
      parseAgentEvent({
        ...exampleEvent,
        details: { ...exampleEvent.details, message: "hi" },
      }),
      "schema",
      "details.message",
    );
  });

  it("requires dedupeKey for synthetic events", () => {
    const withoutDedupeKey = { ...turnEndedEvent } as Record<string, unknown>;
    delete withoutDedupeKey.dedupeKey;

    expectRejected(parseAgentEvent(withoutDedupeKey), "invalid_field", "dedupeKey");
  });

  it("rejects name fields longer than 64 characters", () => {
    const input = {
      ...exampleEvent,
      session: { ...exampleEvent.session, projectName: "x".repeat(65) },
    };

    expectRejected(parseAgentEvent(input), "invalid_field", "session.projectName");
  });

  it("rejects name fields containing control characters", () => {
    const input = {
      ...exampleEvent,
      source: { ...exampleEvent.source, agentName: "bad\u0007name" },
    };

    expectRejected(parseAgentEvent(input), "invalid_field", "source.agentName");
  });

  it("rejects timestamps without a timezone", () => {
    expectRejected(
      parseAgentEvent({ ...exampleEvent, occurredAt: "2026-10-20T18:20:00" }),
      "invalid_field",
      "occurredAt",
    );
  });

  it("never throws for non-object input", () => {
    for (const input of [null, undefined, 42, "event", [], true]) {
      const result = parseAgentEvent(input);
      expect(result.ok).toBe(false);
    }
  });
});
