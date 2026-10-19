import { describe, expect, expectTypeOf, it } from "vitest";
import {
  SUMMARY_CODES,
  type AgentEvent,
  type AgentEventDetails,
  type CompletionScope,
} from "@agent-attention/contract";

const exampleEvent: AgentEvent = {
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
};

describe("AgentEvent contract types", () => {
  it("keeps details optional", () => {
    expectTypeOf<AgentEvent["details"]>().toEqualTypeOf<AgentEventDetails | undefined>();

    const withoutDetails: AgentEvent = { ...exampleEvent, details: undefined };
    expect(withoutDetails.details).toBeUndefined();
  });

  it("narrows completionScope to task or session", () => {
    expectTypeOf<CompletionScope>().toEqualTypeOf<"task" | "session">();
    expectTypeOf<NonNullable<AgentEventDetails["completionScope"]>>().toEqualTypeOf<
      "task" | "session"
    >();
  });

  it("has no index signature or free-text field", () => {
    expectTypeOf<AgentEvent>().not.toHaveProperty("letter");
    expectTypeOf<AgentEvent>().not.toHaveProperty("message");

    // @ts-expect-error the contract has no free-text message field
    const withMessage: AgentEvent = { ...exampleEvent, message: "hi" };
    expect(withMessage).toBeDefined();
  });

  it("enumerates exactly the seven summary codes", () => {
    expect(SUMMARY_CODES).toEqual([
      "INPUT_REQUIRED",
      "APPROVAL_REQUIRED",
      "TURN_ENDED",
      "TASK_COMPLETED",
      "SESSION_COMPLETED",
      "FAILED",
      "UNKNOWN",
    ]);
    expect(Object.isFrozen(SUMMARY_CODES)).toBe(true);
  });
});
